import { AuthError, normalizeApiUrl, sessionOwner, type Session } from './authClient';
import type { QueuedVisitOperation } from '../storage/outbox';

export type VisitOutbox = {
  readonly ownerId: string;
  pendingVisitOperations(limit?: number): Promise<QueuedVisitOperation[]>;
  noteVisitAttempt(operations: readonly QueuedVisitOperation[]): Promise<void>;
  acknowledgeVisitOperations(
    sent: readonly QueuedVisitOperation[],
    ids: readonly string[],
    stillCurrent?: () => boolean,
  ): Promise<number>;
};
export class VisitConnectionError extends Error {
  constructor() {
    super('서버에 연결하지 못했습니다. 대기 기록을 보존했습니다.');
    this.name = 'VisitConnectionError';
  }
}
export class VisitSyncClient {
  constructor(
    private readonly send: typeof fetch = fetch,
    private readonly development = false,
  ) {}
  async connectionAvailable(session: Session): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const apiUrl = normalizeApiUrl(session.apiUrl, this.development);
      const response = await this.send(`${apiUrl}/health`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { status?: unknown; service?: unknown } | null;
      return body?.status === 'ok' && body.service === 'travel-visit-tracker-backend';
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
  async sendBatch(
    session: Session,
    operations: readonly QueuedVisitOperation[],
  ): Promise<string[]> {
    if (!session.token) throw new AuthError('방문을 전송하려면 다시 로그인해 주세요.', 401);
    const apiUrl = normalizeApiUrl(session.apiUrl, this.development);
    const body = JSON.stringify({
      operations: operations.map((operation) => ({
        id: operation.id,
        entityType: 'visit',
        entityId: operation.entityId,
        operation: operation.operation,
        payload: JSON.parse(operation.serializedPayload),
      })),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let response: Response;
      try {
        response = await this.send(`${apiUrl}/api/visits/sync`, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
          body,
        });
      } catch {
        throw new VisitConnectionError();
      }
      if (!response.ok)
        throw new AuthError(
          response.status === 401
            ? '방문을 전송하려면 다시 로그인해 주세요.'
            : response.status === 409
              ? '서버 기록과 충돌했습니다. 대기 기록을 보존했습니다.'
              : '방문을 전송하지 못했습니다. 대기 기록을 보존했습니다.',
          response.status,
        );
      let result: { acknowledgedIds?: unknown } | null;
      try {
        result = (await response.json()) as typeof result;
      } catch (error) {
        if (controller.signal.aborted || error instanceof TypeError)
          throw new VisitConnectionError();
        throw new Error('서버의 저장 확인 응답을 읽을 수 없습니다. 대기 기록을 보존했습니다.');
      }
      const ids = result?.acknowledgedIds;
      if (
        !Array.isArray(ids) ||
        ids.some(
          (id) => typeof id !== 'string' || !operations.some((operation) => operation.id === id),
        ) ||
        new Set(ids).size !== ids.length
      )
        throw new Error('서버의 저장 확인 응답을 읽을 수 없습니다. 대기 기록을 보존했습니다.');
      return ids;
    } finally {
      clearTimeout(timeout);
    }
  }
}
// Each batch captures its account; the foreground coordinator owns scheduling.
export class VisitSyncRunner {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly currentSession: () => Session | null,
    private readonly outboxForOwner: (owner: string) => Promise<VisitOutbox>,
    private readonly client = new VisitSyncClient(),
  ) {}
  run(): Promise<{ sent: number; acknowledged: number; paused: boolean }> {
    const next = this.tail.then(() => this.batch());
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async batch() {
    const current = this.currentSession();
    if (!current?.token) throw new AuthError('방문을 전송하려면 로그인해 주세요.', 401);
    const session: Session = { ...current, user: { ...current.user } };
    const owner = sessionOwner(session);
    const isCurrent = () => {
      const latest = this.currentSession();
      return latest !== null && sessionOwner(latest) === owner && latest.token === session.token;
    };
    const outbox = await this.outboxForOwner(owner);
    if (outbox.ownerId !== owner) throw new Error('전송 계정이 기록 계정과 일치하지 않습니다.');
    const operations = await outbox.pendingVisitOperations();
    if (!operations.length) return { sent: 0, acknowledged: 0, paused: false };
    if (!isCurrent()) return { sent: 0, acknowledged: 0, paused: true };
    await outbox.noteVisitAttempt(operations);
    if (!isCurrent()) return { sent: 0, acknowledged: 0, paused: true };
    const ids = await this.client.sendBatch(session, operations);
    if (!isCurrent()) return { sent: operations.length, acknowledged: 0, paused: true };
    try {
      const acknowledged = await outbox.acknowledgeVisitOperations(operations, ids, isCurrent);
      return { sent: operations.length, acknowledged, paused: !isCurrent() };
    } catch (error) {
      if (!isCurrent()) return { sent: operations.length, acknowledged: 0, paused: true };
      throw error;
    }
  }
}
