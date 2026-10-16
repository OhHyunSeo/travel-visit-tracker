import { AuthError, sessionOwner, type Session } from './authClient';
import { VisitSyncClient, VisitSyncRunner, type VisitOutbox } from './visitSync';
import type { QueuedVisitOperation, VisitBackupState } from '../storage/outbox';

export type VisitBackupResult = {
  ownerId: string | null;
  acknowledged: number;
  paused: boolean;
  skipped: boolean;
  message: string | null;
};
export type VisitBackupRepository = VisitOutbox & {
  visitBackupState(): Promise<VisitBackupState>;
  setVisitBackupEnabled(enabled: boolean, stillCurrent?: () => boolean): Promise<void>;
  recordVisitBackupResult(
    result: {
      successAt?: number;
      nextAttemptAt: number | null;
      pauseReason?: VisitBackupState['pauseReason'];
    },
    stillCurrent?: () => boolean,
  ): Promise<void>;
};

const pauseMessage = (reason: VisitBackupState['pauseReason']) =>
  reason === 'authentication'
    ? '다시 로그인한 뒤 방문 백업을 눌러 주세요. 대기 기록은 보관 중입니다.'
    : '서버 기록과 충돌해 자동 백업을 멈췄습니다. 기록을 확인한 뒤 방문 백업을 눌러 주세요.';
class ForegroundBackupPaused extends Error {}
class AutomaticBackupDisabled extends Error {}

// Scheduling belongs to the foreground app. This coordinator also honours persisted delays
// when the app restarts, and never changes the captured account midway through a run.
export class VisitBackupCoordinator {
  private inFlight: Promise<VisitBackupResult> | null = null;
  private manualRequested = false;
  private readonly failures = new Map<string, number>();
  constructor(
    private readonly currentSession: () => Session | null,
    private readonly repositoryForOwner: (owner: string) => Promise<VisitBackupRepository>,
    private readonly client = new VisitSyncClient(),
    private readonly now: () => number = Date.now,
    private readonly isActive: () => boolean = () => true,
  ) {}
  run(manual = false): Promise<VisitBackupResult> {
    if (this.inFlight) {
      this.manualRequested ||= manual;
      return this.inFlight;
    }
    this.manualRequested = manual;
    const current = this.currentSession();
    const captured = current ? { ...current, user: { ...current.user } } : null;
    // Let a simultaneous button press upgrade an automatic no-op to a manual attempt.
    const pending = Promise.resolve().then(() => this.perform(captured));
    this.inFlight = pending;
    const clear = () => {
      if (this.inFlight === pending) this.inFlight = null;
    };
    void pending.then(clear, clear);
    return pending;
  }
  private async perform(current: Session | null): Promise<VisitBackupResult> {
    const manual = () => this.manualRequested;
    const ownerId = current ? sessionOwner(current) : null;
    let acknowledged = 0;
    const result = (
      message: string | null = null,
      { paused = false, skipped = false } = {},
    ): VisitBackupResult => ({ ownerId, acknowledged, paused, skipped, message });
    if (!current?.token)
      return result(manual() ? '방문을 백업하려면 로그인해 주세요.' : null, { skipped: true });
    if (!manual() && !this.isActive()) return result(null, { skipped: true });
    const session: Session = { ...current, user: { ...current.user } };
    const isCurrent = () => {
      const latest = this.currentSession();
      return latest !== null && sessionOwner(latest) === ownerId && latest.token === session.token;
    };
    const paused = () => result('로그인 정보가 바뀌어 방문 백업을 멈췄습니다.', { paused: true });
    const foregroundPaused = () =>
      result('앱을 다시 열면 자동 방문 백업을 이어갑니다.', { paused: true });
    let repository: VisitBackupRepository | undefined;
    let autoEnabled = false;
    try {
      if (!isCurrent()) return paused();
      repository = await this.repositoryForOwner(ownerId!);
      if (!isCurrent()) return paused();
      if (repository.ownerId !== ownerId) throw new Error('wrong owner');
      let state = await repository.visitBackupState();
      autoEnabled = state.autoEnabled;
      if (!isCurrent()) return paused();
      if (!manual() && !state.autoEnabled) return result(null, { skipped: true });
      if (!manual() && state.pauseReason)
        return result(pauseMessage(state.pauseReason), { skipped: true });
      if (!manual() && state.nextAttemptAt !== null && state.nextAttemptAt > this.now())
        return result(null, { skipped: true });
      if (state.pendingVisits === 0) {
        if (manual() && (state.nextAttemptAt !== null || state.pauseReason !== null))
          await repository.recordVisitBackupResult(
            { nextAttemptAt: null, pauseReason: null },
            isCurrent,
          );
        if (!isCurrent()) return paused();
        return result(
          manual()
            ? state.pendingPhotos
              ? '전송할 방문은 없습니다. 사진 백업은 아직 지원하지 않습니다.'
              : '전송할 방문이 없습니다.'
            : null,
          { skipped: true },
        );
      }
      const capturedRepository = repository;
      const client = this.client;
      const canSend = () => manual() || this.isActive();
      const dispatchClient = new (class extends VisitSyncClient {
        override async sendBatch(session: Session, operations: readonly QueuedVisitOperation[]) {
          if (!manual()) {
            const latest = await capturedRepository.visitBackupState();
            if (!latest.autoEnabled && !manual()) throw new AutomaticBackupDisabled();
          }
          if (!isCurrent()) throw new Error('changed session');
          if (!canSend()) throw new ForegroundBackupPaused();
          return client.sendBatch(session, operations);
        }
      })();
      const runner = new VisitSyncRunner(
        () => (isCurrent() ? session : null),
        async () => capturedRepository,
        dispatchClient,
      );
      for (let batch = 0; batch < 10; batch++) {
        if (!isCurrent()) return paused();
        if (!canSend()) return foregroundPaused();
        const sent = await runner.run();
        acknowledged += sent.acknowledged;
        if (sent.paused || !isCurrent()) return paused();
        state = await repository.visitBackupState();
        autoEnabled = state.autoEnabled;
        if (!isCurrent()) return paused();
        if (state.pendingVisits === 0) {
          await repository.recordVisitBackupResult(
            {
              ...(acknowledged > 0 ? { successAt: this.now() } : {}),
              nextAttemptAt: null,
              pauseReason: null,
            },
            isCurrent,
          );
          if (!isCurrent()) return paused();
          this.failures.delete(ownerId!);
          return result(
            state.pendingPhotos
              ? '방문 전송을 마쳤습니다. 사진은 기기에 보관 중이며 아직 백업되지 않습니다.'
              : '방문 전송을 마쳤습니다.',
          );
        }
        if (!manual() && !state.autoEnabled)
          return result('자동 방문 백업을 껐습니다. 남은 방문은 기기에 보관 중입니다.');
        if (sent.acknowledged === 0) break;
      }
      const nextAttemptAt = this.nextRetry(ownerId!);
      await repository.recordVisitBackupResult({ nextAttemptAt, pauseReason: null }, isCurrent);
      if (!isCurrent()) return paused();
      return result(
        autoEnabled
          ? '아직 전송 대기 중인 방문이 있습니다. 잠시 뒤 다시 시도합니다.'
          : '아직 전송 대기 중인 방문이 있습니다. 방문 백업을 다시 눌러 주세요.',
      );
    } catch (error) {
      if (!isCurrent()) return paused();
      if (error instanceof ForegroundBackupPaused) return foregroundPaused();
      if (error instanceof AutomaticBackupDisabled)
        return result('자동 방문 백업을 껐습니다. 남은 방문은 기기에 보관 중입니다.');
      const pauseReason =
        error instanceof AuthError && error.status === 401
          ? 'authentication'
          : error instanceof AuthError && error.status === 409
            ? 'conflict'
            : null;
      if (repository && repository.ownerId === ownerId) {
        try {
          await repository.recordVisitBackupResult(
            {
              nextAttemptAt: pauseReason ? null : this.nextRetry(ownerId!),
              pauseReason,
            },
            isCurrent,
          );
        } catch {
          if (!isCurrent()) return paused();
          return result(
            '백업 상태를 저장하지 못했습니다. 기기 기록과 전송 대기 목록을 확인해 주세요.',
          );
        }
      }
      return result(
        pauseReason
          ? pauseMessage(pauseReason)
          : autoEnabled
            ? '방문을 전송하지 못했습니다. 대기 기록을 보관하며 잠시 뒤 다시 시도합니다.'
            : '방문을 전송하지 못했습니다. 대기 기록을 보관 중입니다. 방문 백업을 다시 눌러 주세요.',
      );
    }
  }
  private nextRetry(owner: string): number {
    const failures = Math.min((this.failures.get(owner) ?? 0) + 1, 5);
    this.failures.set(owner, failures);
    return this.now() + Math.min(30000 * 2 ** (failures - 1), 300000);
  }
}
