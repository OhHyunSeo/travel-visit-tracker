import { AuthError, sessionOwner, type Session } from './authClient';
import { RestoreClient, RestoreFileError } from './restoreSync';
import type { RestoredFile } from './restoreFile';
import type { RemotePhoto, RestoreState } from '../storage/restore';
import type { RestoreRepository } from '../storage/restoreRepository';

export type RestoreConsent = { ownerId: string; token: string };
export type RestoreResult = {
  ownerId: string | null;
  downloaded: number;
  pending: number;
  paused: boolean;
  message: string;
};
export type RestoringRepository = { ownerId: string; restoration: RestoreRepository };
export class RestoreCoordinator {
  private inFlight: { consent: RestoreConsent; promise: Promise<RestoreResult> } | null = null;
  constructor(
    private currentSession: () => Session | null,
    private repositoryForOwner: (owner: string) => Promise<RestoringRepository>,
    private client: RestoreClient,
    private stageFile: (photo: RemotePhoto, bytes: Uint8Array) => Promise<RestoredFile>,
    private isActive: () => boolean = () => true,
    private observeInterruption: (stop: () => void) => () => void = () => () => {},
  ) {}
  run(consent: RestoreConsent): Promise<RestoreResult> {
    const session = this.currentSession();
    const reject = (message: string) =>
      Promise.resolve({ ownerId: null, downloaded: 0, pending: 0, paused: true, message });
    if (
      !session?.token ||
      session.token !== consent?.token ||
      sessionOwner(session) !== consent.ownerId
    )
      return reject('복원할 계정을 다시 확인해 주세요.');
    if (!this.isActive()) return reject('앱을 화면에 연 뒤 복원을 눌러 주세요.');
    if (this.inFlight)
      return this.inFlight.consent.ownerId === consent.ownerId &&
        this.inFlight.consent.token === consent.token
        ? this.inFlight.promise
        : reject('앞선 복원이 끝난 뒤 다시 확인해 주세요.');
    const captured = { ...consent };
    const promise = this.perform({ ...session, user: { ...session.user } }, captured);
    this.inFlight = { consent: captured, promise };
    const clear = () => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    };
    void promise.then(clear, clear);
    return promise;
  }
  private async perform(session: Session, consent: RestoreConsent): Promise<RestoreResult> {
    let interrupted = false,
      downloaded = 0,
      pending = 0,
      cleanupFailed = false;
    let repository: RestoreRepository | undefined;
    const stopObserving = this.observeInterruption(() => {
      interrupted = true;
    });
    const current = () => {
      const latest = this.currentSession();
      if (
        !this.isActive() ||
        !latest ||
        latest.token !== consent.token ||
        sessionOwner(latest) !== consent.ownerId
      )
        interrupted = true;
      return !interrupted;
    };
    const check = () => {
      if (!current()) throw new Error('restore interrupted');
    };
    const result = (message: string, paused = false): RestoreResult => ({
      ownerId: consent.ownerId,
      downloaded,
      pending,
      paused,
      message:
        message + (cleanupFailed ? ' 이번 다운로드의 임시 파일 정리는 다시 확인해야 합니다.' : ''),
    });
    try {
      check();
      const account = await this.repositoryForOwner(consent.ownerId);
      check();
      if (account.ownerId !== consent.ownerId) throw new Error('wrong restore owner');
      repository = account.restoration;
      let state = await repository.state();
      check();
      let visitsRemain = true;
      // Persist the page and cursor together. A later run starts after the last committed page.
      for (let page = 0; page < 10; page++) {
        const data = await this.client.visits(session, state.visitCursor);
        check();
        await repository.saveVisits(state.visitCursor, data, current);
        check();
        state = { ...state, visitCursor: data.cursor };
        visitsRemain = data.hasMore;
        if (!data.hasMore) break;
      }
      let rewound = false;
      const initialVisitScan = state.visitScan;
      for (let batch = 0; batch < 10; batch++) {
        const applied = await repository.applyVisits(current);
        check();
        if (!applied.seen) {
          if (rewound || initialVisitScan === 0) break;
          await repository.rewindVisits(current);
          rewound = true;
        } else if (rewound && applied.lastRevision >= initialVisitScan) break;
      }
      // Drain deletions before discovering/downloading photos, including after a restart.
      let photosRemain = false;
      if (!visitsRemain) {
        for (let page = 0; page < 10; page++) {
          const data = await this.client.photos(session, state.photoCursor);
          check();
          await repository.savePhotos(state.photoCursor, data, current);
          check();
          state = { ...state, photoCursor: data.cursor };
          photosRemain = data.hasMore;
          if (!data.hasMore) break;
        }
        const seen = new Set<string>();
        let wrapped = state.photoScan === 0,
          scanned = 0;
        scan: while (scanned < 1000 && downloaded < 20) {
          const photos = await repository.nextPhotos();
          check();
          if (!photos.length) {
            if (wrapped) break;
            await repository.rewindPhotos(current);
            wrapped = true;
            continue;
          }
          for (const photo of photos) {
            if (seen.has(photo.id) || scanned >= 1000 || downloaded >= 20) break scan;
            seen.add(photo.id);
            scanned++;
            const disposition = await repository.photoDisposition(photo, current);
            check();
            if (disposition.kind !== 'download') continue;
            let file: RestoredFile | undefined,
              keep = false;
            try {
              const bytes = await this.client.download(session, photo);
              check();
              file = await this.stageFile(photo, bytes);
              check();
              keep = await repository.completePhoto(photo, file.uri, current);
              if (keep) downloaded++;
              check();
            } catch (error) {
              // A commit may have succeeded even if its response was lost. Preserve on uncertainty.
              if (file) {
                try {
                  keep = await repository.fileReferenced(file.uri);
                } catch {
                  keep = true;
                }
              }
              check();
              if (error instanceof RestoreFileError && error.reason === 'invalid') {
                await repository.blockPhoto(photo, current);
                continue;
              }
              throw error;
            } finally {
              if (file) {
                try {
                  await file.dispose(keep);
                } catch {
                  cleanupFailed = true;
                }
              }
            }
          }
        }
      }
      const final: RestoreState = await repository.state();
      check();
      pending = final.pendingPhotos + final.pendingVisits;
      return result(
        pending || visitsRemain || photosRemain
          ? `사진 ${downloaded}개를 받았습니다. 남은 복원 대기 ${pending}건은 보관 중입니다. 보내지 않은 변경이나 겹치는 기록을 확인한 뒤 다시 복원을 눌러 주세요.${visitsRemain || photosRemain ? ' 서버 목록도 다음 실행에서 이어받습니다.' : ''}`
          : `서버의 방문을 확인하고 사진 ${downloaded}개를 받았습니다. 기존 기기 기록과 사진 파일은 보관했습니다.`,
      );
    } catch (error) {
      if (repository) {
        try {
          const state = await repository.state();
          pending = state.pendingPhotos + state.pendingVisits;
        } catch {
          /* Keep the last known count. */
        }
      }
      return !current()
        ? result(
            '계정이나 화면 상태가 바뀌어 복원을 멈췄습니다. 대기 작업을 보관했으며 복원을 다시 눌러 이어받을 수 있습니다.',
            true,
          )
        : result(
            error instanceof AuthError
              ? error.message
              : error instanceof RestoreFileError
                ? error.message
                : '복원을 마치지 못했습니다. 기존 기록과 복원 대기를 보관했습니다. 다시 눌러 이어받을 수 있습니다.',
          );
    } finally {
      stopObserving();
    }
  }
}
