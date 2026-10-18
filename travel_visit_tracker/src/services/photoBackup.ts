import { AuthError, sessionOwner, type Session } from './authClient';
import {
  PhotoFileError,
  PhotoSyncClient,
  parsePhotoOperation,
  validPhotoFingerprint,
  type PreparedPhotoFile,
} from './photoSync';
import type {
  PhotoAcknowledgement,
  PhotoBackupState,
  PhotoFingerprint,
  QueuedPhotoOperation,
  VisitBackupState,
} from '../storage/outbox';

export type PhotoBackupConsent = { ownerId: string; token: string };
export type PhotoBackupResult = {
  ownerId: string | null;
  acknowledged: number;
  remaining: number;
  skipped: number;
  paused: boolean;
  message: string;
};
export type PhotoBackupRepository = {
  readonly ownerId: string;
  pendingPhotoOperations(
    limit?: number,
    after?: { createdAt: number; id: string },
  ): Promise<QueuedPhotoOperation[]>;
  preparePhotoOperation(
    operation: QueuedPhotoOperation,
    fingerprint: PhotoFingerprint,
    guard?: () => boolean,
  ): Promise<boolean>;
  acknowledgePhotoOperation(
    operation: QueuedPhotoOperation,
    fingerprint: PhotoFingerprint,
    acknowledgement: PhotoAcknowledgement,
    uploadedAt: number,
    guard?: () => boolean,
  ): Promise<boolean>;
  photoBackupState(): Promise<PhotoBackupState>;
  visitBackupState(): Promise<VisitBackupState>;
};

class PhotoBackupPaused extends Error {}
export class PhotoBackupCoordinator {
  private inFlight: { consent: PhotoBackupConsent; promise: Promise<PhotoBackupResult> } | null =
    null;
  constructor(
    private readonly currentSession: () => Session | null,
    private readonly repositoryForOwner: (owner: string) => Promise<PhotoBackupRepository>,
    private readonly client: PhotoSyncClient,
    private readonly fileLoader: (uri: string) => Promise<PreparedPhotoFile>,
    private readonly beforePhotos: (consent: PhotoBackupConsent) => Promise<void>,
    private readonly isActive: () => boolean = () => true,
    private readonly now: () => number = Date.now,
  ) {}
  run(consent: PhotoBackupConsent): Promise<PhotoBackupResult> {
    const current = this.currentSession();
    const matches =
      current?.token &&
      consent &&
      current.token === consent.token &&
      sessionOwner(current) === consent.ownerId;
    const reject = (message: string): Promise<PhotoBackupResult> =>
      Promise.resolve({
        ownerId: null,
        acknowledged: 0,
        remaining: 0,
        skipped: 0,
        paused: true,
        message,
      });
    if (!matches)
      return reject('로그인 정보가 바뀌었습니다. 사진 백업 대상 계정을 다시 확인해 주세요.');
    if (!this.isActive()) return reject('앱을 화면에 연 뒤 사진 백업을 다시 확인해 주세요.');
    if (this.inFlight) {
      if (
        this.inFlight.consent.ownerId === consent.ownerId &&
        this.inFlight.consent.token === consent.token
      )
        return this.inFlight.promise;
      return reject('앞선 사진 백업이 끝난 뒤 현재 계정의 백업을 다시 확인해 주세요.');
    }
    const capturedConsent = { ...consent };
    const session: Session = { ...current, user: { ...current.user } };
    const promise = this.perform(session, capturedConsent);
    this.inFlight = { consent: capturedConsent, promise };
    const clear = () => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    };
    void promise.then(clear, clear);
    return promise;
  }
  private async perform(session: Session, consent: PhotoBackupConsent): Promise<PhotoBackupResult> {
    let acknowledged = 0,
      skipped = 0,
      remaining = 0,
      cleanupFailed = false;
    const fileReasons: Record<PhotoFileError['reason'], number> = {
      unsupported: 0,
      missing: 0,
      tooLarge: 0,
      invalid: 0,
    };
    const reasonLabels: Record<PhotoFileError['reason'], string> = {
      unsupported: '미지원 형식',
      missing: '파일 없음',
      tooLarge: '크기 제한',
      invalid: '파일 확인 실패',
    };
    let repository: PhotoBackupRepository | undefined;
    const guard = () => {
      const latest = this.currentSession();
      return (
        this.isActive() &&
        latest !== null &&
        sessionOwner(latest) === consent.ownerId &&
        latest.token === consent.token
      );
    };
    const result = (message: string, paused = false): PhotoBackupResult => {
      const reasons = (Object.keys(fileReasons) as PhotoFileError['reason'][])
        .filter((reason) => fileReasons[reason] > 0)
        .map((reason) => `${reasonLabels[reason]} ${fileReasons[reason]}건`)
        .join(', ');
      return {
        ownerId: consent.ownerId,
        acknowledged,
        remaining,
        skipped,
        paused,
        message: [
          message,
          ...(reasons ? [`건너뛴 사진: ${reasons}.`] : []),
          ...(cleanupFailed ? ['임시 전송 파일 정리는 다시 확인해야 합니다.'] : []),
        ].join(' '),
      };
    };
    const paused = () =>
      result(
        '계정이나 앱 상태가 바뀌어 사진 전송을 멈췄습니다. 원본과 대기 기록을 보존했습니다.',
        true,
      );
    try {
      if (!guard()) return paused();
      await this.beforePhotos(consent);
      if (!guard()) return paused();
      repository = await this.repositoryForOwner(consent.ownerId);
      if (!guard()) return paused();
      if (repository.ownerId !== consent.ownerId) throw new Error('wrong photo owner');
      const visits = await repository.visitBackupState();
      if (!guard()) return paused();
      const initial = await repository.photoBackupState();
      remaining = initial.pendingPhotos;
      if (!guard()) return paused();
      if (visits.pendingVisits > 0)
        return result('방문 전송을 먼저 마쳐야 사진을 백업할 수 있습니다. 사진은 대기 중입니다.');
      if (!remaining)
        return result('전송할 사진이 없습니다. 사진 복원 기능은 아직 지원하지 않습니다.');
      let scanned = 0,
        confirmed = 0;
      let after: { createdAt: number; id: string } | undefined;
      while (scanned < initial.pendingPhotos && confirmed < 20) {
        if (!guard()) return paused();
        const operations = await repository.pendingPhotoOperations(100, after);
        if (!guard()) return paused();
        if (!operations.length) break;
        for (const operation of operations) {
          if (scanned >= initial.pendingPhotos || confirmed >= 20) break;
          scanned++;
          after = { createdAt: operation.createdAt, id: operation.id };
          if (!guard()) return paused();
          let file: PreparedPhotoFile | undefined;
          try {
            const photo = parsePhotoOperation(operation);
            file = await this.fileLoader(photo.uri);
            if (!guard()) throw new PhotoBackupPaused();
            if (
              !validPhotoFingerprint(file.fingerprint) ||
              file.body.size !== file.fingerprint.byteLength ||
              file.body.type !== file.fingerprint.mimeType
            )
              throw new PhotoFileError('invalid');
            const prepared = await repository.preparePhotoOperation(
              operation,
              file.fingerprint,
              guard,
            );
            if (!guard()) throw new PhotoBackupPaused();
            if (!prepared) {
              skipped++;
              continue;
            }
            const acknowledgement = await this.client.sendPhoto(session, operation, file);
            confirmed++;
            if (!guard()) throw new PhotoBackupPaused();
            const saved = await repository.acknowledgePhotoOperation(
              operation,
              file.fingerprint,
              acknowledgement,
              this.now(),
              guard,
            );
            if (saved) {
              acknowledged++;
              remaining = Math.max(0, remaining - 1);
            } else skipped++;
            if (!guard()) throw new PhotoBackupPaused();
          } catch (error) {
            // Build the paused result only after finally has attempted snapshot cleanup.
            if (!guard() || error instanceof PhotoBackupPaused) throw new PhotoBackupPaused();
            if (error instanceof PhotoFileError) {
              skipped++;
              fileReasons[error.reason]++;
              continue;
            }
            throw error;
          } finally {
            if (file) {
              try {
                await file.dispose();
              } catch {
                cleanupFailed = true;
              }
            }
          }
        }
      }
      if (!guard()) return paused();
      remaining = (await repository.photoBackupState()).pendingPhotos;
      if (!guard()) return paused();
      return result(
        remaining > 0
          ? `사진 ${acknowledged}건을 전송했습니다. 남은 ${remaining}건은 원본을 보관하며 다음 수동 확인을 기다립니다.`
          : `사진 ${acknowledged}건을 전송했습니다. 기기 원본은 유지하며 다른 기기 복원은 아직 지원하지 않습니다.`,
      );
    } catch (error) {
      if (!guard() || error instanceof PhotoBackupPaused) return paused();
      if (repository?.ownerId === consent.ownerId) {
        try {
          remaining = (await repository.photoBackupState()).pendingPhotos;
        } catch {
          /* Preserve the last known count. */
        }
      }
      if (!guard()) return paused();
      return result(
        error instanceof AuthError
          ? error.message
          : '사진 백업을 마치지 못했습니다. 원본과 대기 기록을 보존했습니다. 다시 확인한 뒤 수동으로 시도해 주세요.',
      );
    }
  }
}
