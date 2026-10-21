import { migrateSchema } from './migrations';
import { RestoreRepository } from './restoreRepository';
import { dwellPolicy } from '../domain/dwell';
import type {
  QueuedVisitOperation,
  VisitBackupState,
  QueuedPhotoOperation,
  PhotoFingerprint,
  PhotoAcknowledgement,
  PhotoBackupState,
} from './outbox';
import type {
  Candidate,
  Photo,
  TrackingStatus,
  TrackingDiagnostics,
  Visit,
  AppSnapshot,
} from '../domain/types';

export type SqlValue = string | number | null;
export interface SqlConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: SqlValue[]): Promise<{ changes: number }>;
  first<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
}
// All owners on one connection must share the same transaction queue.
const connectionTails = new WeakMap<SqlConnection, Promise<unknown>>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
class StalePhotoOperationError extends Error {}
type StoredPhotoFingerprint = {
  owner_id: string;
  operation_id: string;
  serialized_payload: string;
  sha256: string;
  byte_length: number;
  mime_type: string;
};
export class Repository {
  readonly restoration: RestoreRepository;
  constructor(
    private readonly db: SqlConnection,
    readonly ownerId = 'guest',
  ) {
    this.restoration = new RestoreRepository(
      db,
      ownerId,
      (operation) => this.serialize(operation),
      (current, operation) =>
        this.transaction(async () => {
          await this.requireActiveAccount();
          if (!current()) throw new Error('계정이나 화면 상태가 바뀌어 복원을 멈췄습니다.');
          const result = await operation();
          if (!current()) throw new Error('계정이나 화면 상태가 바뀌어 복원 대기를 보존했습니다.');
          return result;
        }),
    );
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = (connectionTails.get(this.db) ?? Promise.resolve()).then(operation);
    connectionTails.set(
      this.db,
      next.catch(() => undefined),
    );
    return next;
  }
  private transaction<T>(operation: () => Promise<T>): Promise<T> {
    return this.serialize(() => this.inTransaction(operation));
  }
  private async inTransaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await operation();
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private settingKey(key: string) {
    return `${this.ownerId}:${key}`;
  }
  async activeOwner(): Promise<string> {
    return this.serialize(async () => {
      const row = await this.db.first<{ value: string }>(
        'SELECT value FROM settings WHERE key=?',
        'active_owner',
      );
      if (!row) return 'guest';
      const owner: unknown = JSON.parse(row.value);
      if (typeof owner !== 'string' || !owner || owner.length > 400)
        throw new Error('기록 계정을 확인할 수 없습니다.');
      return owner;
    });
  }
  async activateOwner(): Promise<void> {
    await this.transaction(async () => {
      await this.writeSetting('recording', false);
      await this.writeSetting('status', 'off');
      await this.writeSetting('message', '계정을 바꿨습니다. 기록을 다시 켜 주세요.');
      await this.writeSetting('diagnostics', {
        ...(await this.diagnostics()),
        collectorMode: 'off',
      });
      await this.db.run('DELETE FROM candidates WHERE owner_id=?', this.ownerId);
      await this.db.run(
        'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        'active_owner',
        JSON.stringify(this.ownerId),
      );
    });
  }
  async guestRecordCounts(): Promise<{ visits: number; photos: number }> {
    return this.serialize(async () => {
      const visits = await this.db.first<{ count: number }>(
        "SELECT count(*) AS count FROM visits WHERE owner_id='guest' AND source='gps' AND deleted_at IS NULL",
      );
      const photos = await this.db.first<{ count: number }>(
        "SELECT count(*) AS count FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.owner_id='guest' AND v.source='gps' AND v.deleted_at IS NULL",
      );
      return { visits: visits?.count ?? 0, photos: photos?.count ?? 0 };
    });
  }
  async importGuestRecords(): Promise<{ visits: number; photos: number }> {
    if (this.ownerId === 'guest') throw new Error('먼저 로그인해 주세요.');
    return this.transaction(async () => {
      const active = await this.db.first<{ value: string }>(
        'SELECT value FROM settings WHERE key=?',
        'active_owner',
      );
      if (!active || JSON.parse(active.value) !== this.ownerId)
        throw new Error('현재 계정이 바뀌었습니다. 기록을 다시 확인해 주세요.');
      const visits = await this.db.first<{ count: number }>(
        "SELECT count(*) AS count FROM visits WHERE owner_id='guest' AND source='gps' AND deleted_at IS NULL",
      );
      const photos = await this.db.first<{ count: number }>(
        "SELECT count(*) AS count FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.owner_id='guest' AND v.source='gps' AND v.deleted_at IS NULL",
      );
      const collision = await this.db.first<{ conflict: number }>(
        `SELECT 1 AS conflict FROM visits g JOIN visits a ON a.owner_id=? AND (a.id=g.id OR a.session_id=g.session_id) WHERE g.owner_id='guest' AND g.source='gps'
UNION ALL SELECT 1 FROM photos g JOIN visits v ON v.id=g.visit_id AND v.owner_id=g.owner_id JOIN photos a ON a.owner_id=? AND a.id=g.id WHERE g.owner_id='guest' AND v.source='gps'
UNION ALL SELECT 1 FROM outbox g JOIN outbox a ON a.owner_id=? AND a.id=g.id WHERE g.owner_id='guest' AND ((g.entity_type='visit' AND g.entity_id IN (SELECT id FROM visits WHERE owner_id='guest' AND source='gps')) OR (g.entity_type='photo' AND g.entity_id IN (SELECT p.id FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.owner_id='guest' AND v.source='gps'))) LIMIT 1`,
        this.ownerId,
        this.ownerId,
        this.ownerId,
      );
      if (collision)
        throw new Error(
          '같은 식별자의 기록이 이미 있어 가져오기를 멈췄습니다. 양쪽 기록을 보존했습니다.',
        );
      await this.db.run(
        "UPDATE outbox SET owner_id=? WHERE owner_id='guest' AND ((entity_type='visit' AND entity_id IN (SELECT id FROM visits WHERE owner_id='guest' AND source='gps')) OR (entity_type='photo' AND entity_id IN (SELECT p.id FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.owner_id='guest' AND v.source='gps')))",
        this.ownerId,
      );
      // Composite FKs move photos and their frozen metadata with the parent visit.
      await this.db.run(
        "UPDATE visits SET owner_id=? WHERE owner_id='guest' AND source='gps'",
        this.ownerId,
      );
      return { visits: visits?.count ?? 0, photos: photos?.count ?? 0 };
    });
  }
  private async requireActiveAccount(): Promise<void> {
    const active = await this.db.first<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      'active_owner',
    );
    if (this.ownerId === 'guest' || !active || JSON.parse(active.value) !== this.ownerId)
      throw new Error('현재 로그인한 계정의 전송 작업만 처리할 수 있습니다.');
  }
  async visitBackupState(): Promise<VisitBackupState> {
    return this.serialize(async () => {
      const rows = await this.db.all<{ key: string; value: string }>(
        'SELECT key,value FROM settings WHERE key IN (?,?,?,?,?)',
        this.settingKey('visitBackupEnabled'),
        this.settingKey('visitBackupLastSuccessAt'),
        this.settingKey('visitBackupNextAttemptAt'),
        this.settingKey('visitBackupPauseReason'),
        this.settingKey('visitBackupConnectionCheckAt'),
      );
      const read = (key: string): unknown => {
        const row = rows.find((item) => item.key === this.settingKey(key));
        if (!row) return null;
        return JSON.parse(row.value);
      };
      const timestamp = (key: string) => {
        const value = read(key);
        if (value === null) return null;
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > Number.MAX_SAFE_INTEGER
        )
          throw new Error('저장된 방문 백업 시각을 확인할 수 없습니다.');
        return value;
      };
      const enabled = read('visitBackupEnabled');
      if (enabled !== null && typeof enabled !== 'boolean')
        throw new Error('저장된 방문 백업 설정을 확인할 수 없습니다.');
      const pauseReason = read('visitBackupPauseReason');
      if (pauseReason !== null && pauseReason !== 'authentication' && pauseReason !== 'conflict')
        throw new Error('저장된 방문 백업 상태를 확인할 수 없습니다.');
      const counts = await this.db.all<{ entityType: string; count: number }>(
        'SELECT entity_type AS entityType,count(*) AS count FROM outbox WHERE owner_id=? GROUP BY entity_type',
        this.ownerId,
      );
      return {
        autoEnabled: this.ownerId !== 'guest' && enabled === true,
        pendingVisits: counts.find((row) => row.entityType === 'visit')?.count ?? 0,
        pendingPhotos: counts.find((row) => row.entityType === 'photo')?.count ?? 0,
        lastSuccessAt: timestamp('visitBackupLastSuccessAt'),
        nextAttemptAt: timestamp('visitBackupNextAttemptAt'),
        connectionCheckAt: timestamp('visitBackupConnectionCheckAt'),
        pauseReason,
      };
    });
  }
  async setVisitBackupEnabled(
    enabled: boolean,
    stillCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('방문 백업 설정을 확인해 주세요.');
    await this.transaction(async () => {
      await this.requireActiveAccount();
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 설정을 보존했습니다.');
      await this.writeSetting('visitBackupEnabled', enabled);
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 설정을 보존했습니다.');
    });
  }
  async recordVisitBackupResult(
    result: {
      successAt?: number;
      nextAttemptAt: number | null;
      pauseReason?: 'authentication' | 'conflict' | null;
      connectionCheckAt?: number | null;
    },
    stillCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const validTime = (value: unknown) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER;
    if (
      (result.successAt !== undefined && !validTime(result.successAt)) ||
      (result.nextAttemptAt !== null && !validTime(result.nextAttemptAt)) ||
      (result.connectionCheckAt !== undefined &&
        result.connectionCheckAt !== null &&
        !validTime(result.connectionCheckAt)) ||
      (result.pauseReason !== undefined &&
        result.pauseReason !== null &&
        result.pauseReason !== 'authentication' &&
        result.pauseReason !== 'conflict')
    )
      throw new Error('방문 백업 시각을 확인해 주세요.');
    return this.transaction(async () => {
      await this.requireActiveAccount();
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 상태를 보존했습니다.');
      if (result.successAt !== undefined) {
        const pending = await this.db.first<{ pending: number }>(
          "SELECT 1 AS pending FROM outbox WHERE owner_id=? AND entity_type='visit' LIMIT 1",
          this.ownerId,
        );
        if (pending) return false;
        await this.writeSetting('visitBackupLastSuccessAt', result.successAt);
      }
      await this.writeSetting('visitBackupNextAttemptAt', result.nextAttemptAt);
      if (result.pauseReason !== undefined)
        await this.writeSetting('visitBackupPauseReason', result.pauseReason);
      if (result.connectionCheckAt !== undefined)
        await this.writeSetting('visitBackupConnectionCheckAt', result.connectionCheckAt);
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 상태를 보존했습니다.');
      return true;
    });
  }
  async updateVisitConnectionCheck(
    expected: { nextAttemptAt: number; connectionCheckAt: number },
    nextCheckAt: number | null,
    stillCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const validTime = (value: unknown) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER;
    if (
      !validTime(expected.nextAttemptAt) ||
      !validTime(expected.connectionCheckAt) ||
      (nextCheckAt !== null && !validTime(nextCheckAt))
    )
      throw new Error('방문 백업 시각을 확인해 주세요.');
    return this.transaction(async () => {
      await this.requireActiveAccount();
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 상태를 보존했습니다.');
      const rows = await this.db.all<{ key: string; value: string }>(
        'SELECT key,value FROM settings WHERE key IN (?,?,?,?)',
        this.settingKey('visitBackupEnabled'),
        this.settingKey('visitBackupPauseReason'),
        this.settingKey('visitBackupNextAttemptAt'),
        this.settingKey('visitBackupConnectionCheckAt'),
      );
      const read = (key: string): unknown => {
        const row = rows.find((item) => item.key === this.settingKey(key));
        return row ? JSON.parse(row.value) : null;
      };
      if (
        read('visitBackupEnabled') !== true ||
        read('visitBackupPauseReason') !== null ||
        read('visitBackupNextAttemptAt') !== expected.nextAttemptAt ||
        read('visitBackupConnectionCheckAt') !== expected.connectionCheckAt
      )
        return false;
      const pending = await this.db.first<{ pending: number }>(
        "SELECT 1 AS pending FROM outbox WHERE owner_id=? AND entity_type='visit' LIMIT 1",
        this.ownerId,
      );
      if (!pending) return false;
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 상태를 보존했습니다.');
      if (nextCheckAt === null) await this.writeSetting('visitBackupNextAttemptAt', null);
      await this.writeSetting('visitBackupConnectionCheckAt', nextCheckAt);
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 백업 상태를 보존했습니다.');
      return true;
    });
  }
  async pendingVisitOperations(limit = 100): Promise<QueuedVisitOperation[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('방문 전송 묶음은 1~100개여야 합니다.');
    return this.serialize(async () => {
      await this.requireActiveAccount();
      return this.db.all<QueuedVisitOperation>(
        "SELECT id,entity_type AS entityType,entity_id AS entityId,operation,payload AS serializedPayload,created_at AS createdAt,attempts FROM outbox WHERE owner_id=? AND entity_type='visit' ORDER BY created_at,id LIMIT ?",
        this.ownerId,
        limit,
      );
    });
  }
  async noteVisitAttempt(operations: readonly QueuedVisitOperation[]): Promise<void> {
    await this.transaction(async () => {
      await this.requireActiveAccount();
      for (const operation of operations) {
        const updated = await this.db.run(
          "UPDATE outbox SET attempts=attempts+1 WHERE owner_id=? AND id=? AND entity_type='visit' AND entity_id=? AND operation=? AND payload=?",
          this.ownerId,
          operation.id,
          operation.entityId,
          operation.operation,
          operation.serializedPayload,
        );
        if (updated.changes !== 1)
          throw new Error('전송할 기록이 바뀌었습니다. 대기 목록을 다시 확인해 주세요.');
      }
    });
  }
  async acknowledgeVisitOperations(
    sent: readonly QueuedVisitOperation[],
    acknowledgedIds: readonly string[],
    stillCurrent: () => boolean = () => true,
  ): Promise<number> {
    const ids = new Set(acknowledgedIds);
    if (
      ids.size !== acknowledgedIds.length ||
      [...ids].some((id) => !sent.some((operation) => operation.id === id))
    )
      throw new Error('서버가 확인한 작업이 전송한 목록과 일치하지 않습니다.');
    return this.transaction(async () => {
      await this.requireActiveAccount();
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 전송 대기 기록을 보존했습니다.');
      let acknowledged = 0;
      for (const operation of sent) {
        if (!ids.has(operation.id)) continue;
        const deleted = await this.db.run(
          "DELETE FROM outbox WHERE owner_id=? AND id=? AND entity_type='visit' AND entity_id=? AND operation=? AND payload=?",
          this.ownerId,
          operation.id,
          operation.entityId,
          operation.operation,
          operation.serializedPayload,
        );
        acknowledged += deleted.changes;
      }
      if (!stillCurrent()) throw new Error('로그인 정보가 바뀌어 전송 대기 기록을 보존했습니다.');
      return acknowledged;
    });
  }
  async pendingPhotoOperations(
    limit = 100,
    after?: { createdAt: number; id: string },
  ): Promise<QueuedPhotoOperation[]> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (after !== undefined &&
        (!after ||
          !validTimestamp(after.createdAt) ||
          typeof after.id !== 'string' ||
          !after.id ||
          after.id.length > 400))
    )
      throw new Error('사진 전송 묶음은 1~100개이며 이어 볼 위치가 올바르게 설정되어야 합니다.');
    return this.serialize(async () => {
      await this.requireActiveAccount();
      return this.db.all<QueuedPhotoOperation>(
        `SELECT id,entity_type AS entityType,entity_id AS entityId,operation,payload AS serializedPayload,created_at AS createdAt,attempts FROM outbox WHERE owner_id=? AND entity_type='photo' ${after ? 'AND (created_at>? OR (created_at=? AND id>?))' : ''} ORDER BY created_at,id LIMIT ?`,
        this.ownerId,
        ...(after ? [after.createdAt, after.createdAt, after.id] : []),
        limit,
      );
    });
  }
  async photoBackupState(): Promise<PhotoBackupState> {
    return this.serialize(async () => {
      const pending = await this.db.first<{ count: number }>(
        "SELECT count(*) AS count FROM outbox WHERE owner_id=? AND entity_type='photo'",
        this.ownerId,
      );
      const uploaded = await this.db.first<{ count: number }>(
        "SELECT count(*) AS count FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.owner_id=? AND v.source='gps' AND v.deleted_at IS NULL AND (EXISTS (SELECT 1 FROM photo_backup_metadata m WHERE m.owner_id=p.owner_id AND m.photo_id=p.id AND m.uploaded_at IS NOT NULL) OR EXISTS (SELECT 1 FROM restore_photos r WHERE r.owner_id=p.owner_id AND r.id=p.id AND r.state='applied'))",
        this.ownerId,
      );
      return { pendingPhotos: pending?.count ?? 0, backedUpPhotos: uploaded?.count ?? 0 };
    });
  }
  private validatePhotoFingerprint(fingerprint: PhotoFingerprint): void {
    if (
      !fingerprint ||
      typeof fingerprint.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(fingerprint.sha256) ||
      !Number.isSafeInteger(fingerprint.byteLength) ||
      fingerprint.byteLength < 1 ||
      fingerprint.byteLength > 10 * 1024 * 1024 ||
      !['image/jpeg', 'image/png'].includes(fingerprint.mimeType)
    )
      throw new Error('사진 첨부본의 형식·크기·해시를 확인해 주세요. 기존 파일은 보존했습니다.');
  }
  private assertCurrentPhotoSession(stillCurrent: () => boolean): void {
    if (!stillCurrent())
      throw new Error('로그인 정보나 화면 상태가 바뀌어 사진 대기를 보존했습니다.');
  }
  private async livePhotoOperation(operation: QueuedPhotoOperation): Promise<Photo | null> {
    if (
      !operation ||
      operation.entityType !== 'photo' ||
      operation.operation !== 'upsert' ||
      typeof operation.id !== 'string' ||
      !uuidPattern.test(operation.id) ||
      typeof operation.entityId !== 'string' ||
      !uuidPattern.test(operation.entityId) ||
      typeof operation.serializedPayload !== 'string' ||
      !validTimestamp(operation.createdAt)
    )
      throw new Error('사진 전송 대기 내용을 확인해 주세요.');
    const queued = await this.db.first<{ id: string }>(
      "SELECT id FROM outbox WHERE owner_id=? AND id=? AND entity_type='photo' AND entity_id=? AND operation='upsert' AND payload=? AND created_at=?",
      this.ownerId,
      operation.id,
      operation.entityId,
      operation.serializedPayload,
      operation.createdAt,
    );
    if (!queued) return null;
    let photo: Photo;
    try {
      const value: unknown = JSON.parse(operation.serializedPayload);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== 4 ||
        Object.keys(value).some((key) => !['id', 'visitId', 'uri', 'createdAt'].includes(key))
      )
        throw new Error('invalid photo');
      photo = value as Photo;
      if (
        photo.id !== operation.entityId ||
        typeof photo.visitId !== 'string' ||
        !uuidPattern.test(photo.visitId) ||
        typeof photo.uri !== 'string' ||
        !photo.uri ||
        !validTimestamp(photo.createdAt)
      )
        throw new Error('invalid photo');
    } catch {
      throw new Error('저장된 사진 전송 내용을 확인할 수 없습니다. 기존 대기 작업을 보존했습니다.');
    }
    const stored = await this.db.first<Photo>(
      "SELECT p.id,p.visit_id AS visitId,p.uri,p.created_at AS createdAt FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.id=? AND p.owner_id=? AND v.source='gps' AND v.deleted_at IS NULL",
      photo.id,
      this.ownerId,
    );
    if (
      !stored ||
      stored.visitId !== photo.visitId ||
      stored.uri !== photo.uri ||
      stored.createdAt !== photo.createdAt
    )
      return null;
    const parentPending = await this.db.first<{ pending: number }>(
      "SELECT 1 AS pending FROM outbox WHERE owner_id=? AND entity_type='visit' AND entity_id=? LIMIT 1",
      this.ownerId,
      photo.visitId,
    );
    return parentPending ? null : photo;
  }
  private async storedPhotoFingerprint(photoId: string): Promise<StoredPhotoFingerprint | null> {
    return this.db.first<StoredPhotoFingerprint>(
      'SELECT owner_id,operation_id,serialized_payload,sha256,byte_length,mime_type FROM photo_backup_metadata WHERE photo_id=? AND owner_id=?',
      photoId,
      this.ownerId,
    );
  }
  private requireMatchingPhotoFingerprint(
    stored: StoredPhotoFingerprint,
    operation: QueuedPhotoOperation,
    fingerprint: PhotoFingerprint,
  ): void {
    if (
      stored.owner_id !== this.ownerId ||
      stored.operation_id !== operation.id ||
      stored.serialized_payload !== operation.serializedPayload ||
      stored.sha256 !== fingerprint.sha256 ||
      stored.byte_length !== fingerprint.byteLength ||
      stored.mime_type !== fingerprint.mimeType
    )
      throw new Error(
        '사진 첨부본이나 전송 작업이 바뀌었습니다. 기존 파일과 대기 작업을 보존했습니다.',
      );
  }
  async preparePhotoOperation(
    operation: QueuedPhotoOperation,
    fingerprint: PhotoFingerprint,
    stillCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    this.validatePhotoFingerprint(fingerprint);
    return this.transaction(async () => {
      await this.requireActiveAccount();
      this.assertCurrentPhotoSession(stillCurrent);
      const photo = await this.livePhotoOperation(operation);
      if (!photo) return false;
      const stored = await this.storedPhotoFingerprint(photo.id);
      if (stored) this.requireMatchingPhotoFingerprint(stored, operation, fingerprint);
      this.assertCurrentPhotoSession(stillCurrent);
      if (!stored)
        await this.db.run(
          'INSERT INTO photo_backup_metadata(photo_id,owner_id,operation_id,serialized_payload,sha256,byte_length,mime_type) VALUES (?,?,?,?,?,?,?)',
          photo.id,
          this.ownerId,
          operation.id,
          operation.serializedPayload,
          fingerprint.sha256,
          fingerprint.byteLength,
          fingerprint.mimeType,
        );
      this.assertCurrentPhotoSession(stillCurrent);
      const attempted = await this.db.run(
        "UPDATE outbox SET attempts=attempts+1 WHERE owner_id=? AND id=? AND entity_type='photo' AND entity_id=? AND operation='upsert' AND payload=? AND created_at=?",
        this.ownerId,
        operation.id,
        operation.entityId,
        operation.serializedPayload,
        operation.createdAt,
      );
      if (attempted.changes !== 1) throw new StalePhotoOperationError();
      this.assertCurrentPhotoSession(stillCurrent);
      return true;
    }).catch((error) => {
      if (error instanceof StalePhotoOperationError) return false;
      throw error;
    });
  }
  async acknowledgePhotoOperation(
    operation: QueuedPhotoOperation,
    fingerprint: PhotoFingerprint,
    acknowledgement: PhotoAcknowledgement,
    uploadedAt: number,
    stillCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    this.validatePhotoFingerprint(fingerprint);
    if (!validTimestamp(uploadedAt)) throw new Error('사진 전송 완료 시각을 확인해 주세요.');
    return this.transaction(async () => {
      await this.requireActiveAccount();
      this.assertCurrentPhotoSession(stillCurrent);
      const photo = await this.livePhotoOperation(operation);
      if (!photo) return false;
      const stored = await this.storedPhotoFingerprint(photo.id);
      if (!stored)
        throw new Error('사진 첨부본을 확인한 전송 기록이 없습니다. 대기 작업을 보존했습니다.');
      this.requireMatchingPhotoFingerprint(stored, operation, fingerprint);
      const remote = acknowledgement?.photo;
      const canonicalId = photo.id.toLowerCase();
      if (
        !remote ||
        acknowledgement.acknowledgedId !== operation.id.toLowerCase() ||
        remote.id !== canonicalId ||
        remote.visitId !== photo.visitId.toLowerCase() ||
        remote.createdAt !== photo.createdAt ||
        remote.sha256 !== fingerprint.sha256 ||
        remote.byteLength !== fingerprint.byteLength ||
        remote.mimeType !== fingerprint.mimeType ||
        !Number.isSafeInteger(remote.revision) ||
        remote.revision < 1 ||
        remote.originalPath !== `/api/visit-photos/${canonicalId}/original` ||
        remote.thumbnailPath !== `/api/visit-photos/${canonicalId}/thumbnail`
      )
        throw new Error('서버가 확인한 사진이 전송한 첨부본과 일치하지 않습니다.');
      this.assertCurrentPhotoSession(stillCurrent);
      const saved = await this.db.run(
        'UPDATE photo_backup_metadata SET revision=?,original_path=?,thumbnail_path=?,uploaded_at=? WHERE photo_id=? AND owner_id=? AND operation_id=? AND serialized_payload=? AND sha256=? AND byte_length=? AND mime_type=?',
        remote.revision,
        remote.originalPath,
        remote.thumbnailPath,
        uploadedAt,
        photo.id,
        this.ownerId,
        operation.id,
        operation.serializedPayload,
        fingerprint.sha256,
        fingerprint.byteLength,
        fingerprint.mimeType,
      );
      if (saved.changes !== 1) throw new StalePhotoOperationError();
      this.assertCurrentPhotoSession(stillCurrent);
      const deleted = await this.db.run(
        "DELETE FROM outbox WHERE owner_id=? AND id=? AND entity_type='photo' AND entity_id=? AND operation='upsert' AND payload=? AND created_at=?",
        this.ownerId,
        operation.id,
        operation.entityId,
        operation.serializedPayload,
        operation.createdAt,
      );
      if (deleted.changes !== 1) throw new StalePhotoOperationError();
      this.assertCurrentPhotoSession(stillCurrent);
      return true;
    }).catch((error) => {
      if (error instanceof StalePhotoOperationError) return false;
      throw error;
    });
  }
  private async writeSetting(key: string, value: unknown) {
    await this.db.run(
      'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      this.settingKey(key),
      JSON.stringify(value),
    );
  }
  private async diagnostics(): Promise<TrackingDiagnostics> {
    const row = await this.db.first<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      this.settingKey('diagnostics'),
    );
    const saved: Partial<TrackingDiagnostics> = row ? JSON.parse(row.value) : {};
    const numberOrNull = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    return {
      lastSampleAt: numberOrNull(saved.lastSampleAt),
      accuracyM: numberOrNull(saved.accuracyM),
      gapMs: numberOrNull(saved.gapMs),
      delayMs: numberOrNull(saved.delayMs),
      lastResetAt: numberOrNull(saved.lastResetAt),
      lastResetReason: typeof saved.lastResetReason === 'string' ? saved.lastResetReason : null,
      collectorMode:
        saved.collectorMode === 'foreground' || saved.collectorMode === 'background'
          ? saved.collectorMode
          : 'off',
    };
  }
  private async rememberReset(message: string, at: number) {
    const diagnostics = await this.diagnostics();
    await this.writeSetting('diagnostics', {
      ...diagnostics,
      lastResetAt: at,
      lastResetReason: message,
    });
  }
  async initialize(
    pack: { id: string; version: string; count: number },
    regions: { id: string; name: string }[],
  ) {
    await this.serialize(async () => {
      // This PRAGMA is ineffective inside BEGIN, so enable it while holding the queue first.
      await this.db.exec('PRAGMA foreign_keys = ON;');
      await this.inTransaction(async () => {
        await migrateSchema(this.db);
        await this.db.run(
          'INSERT INTO region_packs(id,version,count) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,count=excluded.count',
          pack.id,
          pack.version,
          pack.count,
        );
        for (const region of regions)
          await this.db.run(
            'INSERT INTO regions(id,pack_id,name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',
            region.id,
            pack.id,
            region.name,
          );
      });
    });
  }
  private async candidate(): Promise<Candidate | null> {
    return this.db.first<Candidate>(
      'SELECT id,region_id AS regionId,started_at AS startedAt,last_observed_at AS lastObservedAt,confirmed_at AS confirmedAt FROM candidates WHERE owner_id=?',
      this.ownerId,
    );
  }
  async snapshot(includeDevelopment: boolean): Promise<AppSnapshot> {
    return this.serialize(async () => {
      const visits = await this.db.all<Visit>(
        `SELECT id,session_id AS sessionId,region_id AS regionId,started_at AS startedAt,confirmed_at AS confirmedAt,source,deleted_at AS deletedAt FROM visits WHERE owner_id=? AND deleted_at IS NULL ${includeDevelopment ? '' : "AND source='gps'"} ORDER BY confirmed_at DESC`,
        this.ownerId,
      );
      const photos = await this.db.all<Photo>(
        `SELECT p.id,p.visit_id AS visitId,p.uri,p.created_at AS createdAt FROM photos p JOIN visits v ON v.id=p.visit_id AND v.owner_id=p.owner_id WHERE p.owner_id=? AND v.owner_id=? AND v.deleted_at IS NULL ${includeDevelopment ? '' : "AND v.source='gps'"}`,
        this.ownerId,
        this.ownerId,
      );
      const settings = await this.db.all<{ key: string; value: string }>(
        'SELECT key,value FROM settings WHERE key IN (?,?,?,?)',
        this.settingKey('recording'),
        this.settingKey('recordingMode'),
        this.settingKey('status'),
        this.settingKey('message'),
      );
      const setting = (key: string, fallback: unknown) => {
        const row = settings.find((s) => s.key === this.settingKey(key));
        return row ? JSON.parse(row.value) : fallback;
      };
      const pending = await this.db.first<{ count: number }>(
        'SELECT count(*) AS count FROM outbox WHERE owner_id=?',
        this.ownerId,
      );
      return {
        visits,
        photos,
        candidate: await this.candidate(),
        recording: setting('recording', false),
        recordingMode: setting('recordingMode', 'foreground'),
        status: setting('status', 'off'),
        message: setting('message', '기록을 켜고 새로운 지역을 채워 보세요'),
        pending: pending?.count ?? 0,
        diagnostics: await this.diagnostics(),
      };
    });
  }
  async setRecording(enabled: boolean, mode: 'foreground' | 'background' = 'foreground') {
    await this.transaction(async () => {
      if (await this.candidate())
        await this.rememberReset(
          enabled
            ? '기록 방식을 바꿔 체류 확인을 다시 시작합니다.'
            : '자동 기록을 꺼 체류 확인을 중단했습니다.',
          Date.now(),
        );
      await this.writeSetting('recording', enabled);
      await this.writeSetting('status', enabled ? 'waiting' : 'off');
      await this.writeSetting('recordingMode', mode);
      await this.writeSetting(
        'message',
        enabled ? '위치를 기다리고 있습니다' : '자동 기록을 껐습니다',
      );
      await this.db.run('DELETE FROM candidates WHERE owner_id=?', this.ownerId);
    });
  }
  async setCollectorMode(mode: TrackingDiagnostics['collectorMode']) {
    await this.transaction(async () => {
      await this.writeSetting('diagnostics', {
        ...(await this.diagnostics()),
        collectorMode: mode,
      });
    });
  }
  async setStatus(status: TrackingStatus, message: string) {
    await this.transaction(async () => {
      await this.writeSetting('status', status);
      await this.writeSetting('message', message);
    });
  }
  async interruptCandidate(message: string, at = Date.now(), shouldProcess?: () => boolean) {
    await this.transaction(async () => {
      if (shouldProcess && !shouldProcess()) return;
      await this.rememberReset(message, at);
      await this.db.run('DELETE FROM candidates WHERE owner_id=?', this.ownerId);
      await this.writeSetting('status', 'uncertain');
      await this.writeSetting('message', message);
    });
  }
  async expireCandidate(now = Date.now()): Promise<boolean> {
    return this.transaction(async () => {
      // Check the current row inside the transaction; a newer sample may already be saved.
      const candidate = await this.candidate();
      if (!candidate || now - candidate.lastObservedAt <= dwellPolicy.maxGapMs) return false;
      const message = '위치 관측이 끊겨 체류 시간을 다시 확인합니다.';
      await this.rememberReset(message, now);
      await this.db.run('DELETE FROM candidates WHERE owner_id=?', this.ownerId);
      await this.writeSetting('status', 'uncertain');
      await this.writeSetting('message', message);
      return true;
    });
  }
  async processObservation(
    process: (previous: Candidate | null) => {
      candidate: Candidate | null;
      confirmed: Candidate | null;
      status: TrackingStatus;
      message: string;
    },
    visitId: () => string,
    quality?: { timestamp: number; accuracy: number; receivedAt: number },
    shouldProcess?: () => boolean,
  ) {
    await this.transaction(async () => {
      if (shouldProcess && !shouldProcess()) return;
      const enabled = await this.db.first<{ value: string }>(
        'SELECT value FROM settings WHERE key=?',
        this.settingKey('recording'),
      );
      if (enabled?.value !== 'true') return;
      if (shouldProcess && !shouldProcess()) return;
      const previous = await this.candidate();
      const diagnostics = await this.diagnostics();
      if (shouldProcess && !shouldProcess()) return;
      const result = process(previous);
      const receivedAt =
        quality && Number.isFinite(quality.receivedAt) ? quality.receivedAt : Date.now();
      const isOlderSample =
        quality &&
        Number.isFinite(quality.timestamp) &&
        diagnostics.lastSampleAt !== null &&
        (diagnostics.delayMs === null || diagnostics.delayMs >= -dwellPolicy.futureToleranceMs) &&
        diagnostics.lastSampleAt <= receivedAt + dwellPolicy.futureToleranceMs &&
        quality.timestamp <= diagnostics.lastSampleAt;
      if (quality && !isOlderSample) {
        const timestamp = Number.isFinite(quality.timestamp) ? quality.timestamp : null;
        diagnostics.gapMs =
          timestamp !== null && diagnostics.lastSampleAt !== null
            ? Math.max(0, timestamp - diagnostics.lastSampleAt)
            : null;
        if (timestamp !== null) diagnostics.lastSampleAt = timestamp;
        diagnostics.accuracyM =
          Number.isFinite(quality.accuracy) && quality.accuracy >= 0 ? quality.accuracy : null;
        diagnostics.delayMs =
          timestamp !== null && Number.isFinite(quality.receivedAt)
            ? quality.receivedAt - timestamp
            : null;
      }
      if (previous && (!result.candidate || previous.id !== result.candidate.id)) {
        diagnostics.lastResetAt = receivedAt;
        diagnostics.lastResetReason = !result.candidate
          ? result.message
          : previous.regionId !== result.candidate.regionId
            ? '다른 지역으로 이동해 체류 확인을 다시 시작합니다.'
            : '위치 관측이 끊겨 체류 확인을 다시 시작합니다.';
      }
      await this.writeSetting('diagnostics', diagnostics);
      if (result.candidate) {
        const c = result.candidate;
        await this.db.run(
          'INSERT INTO candidates(owner_id,id,region_id,started_at,last_observed_at,confirmed_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET id=excluded.id,region_id=excluded.region_id,started_at=excluded.started_at,last_observed_at=excluded.last_observed_at,confirmed_at=excluded.confirmed_at',
          this.ownerId,
          c.id,
          c.regionId,
          c.startedAt,
          c.lastObservedAt,
          c.confirmedAt,
        );
      } else await this.db.run('DELETE FROM candidates WHERE owner_id=?', this.ownerId);
      if (result.confirmed) {
        const c = result.confirmed;
        const visit: Visit = {
          id: visitId(),
          sessionId: c.id,
          regionId: c.regionId,
          startedAt: c.startedAt,
          confirmedAt: c.confirmedAt!,
          source: 'gps',
          deletedAt: null,
        };
        const inserted = await this.db.run(
          'INSERT OR IGNORE INTO visits(id,owner_id,session_id,region_id,started_at,confirmed_at,source) VALUES (?,?,?,?,?,?,?)',
          visit.id,
          this.ownerId,
          visit.sessionId,
          visit.regionId,
          visit.startedAt,
          visit.confirmedAt,
          visit.source,
        );
        if (inserted.changes)
          await this.enqueue(visit.id, 'visit', visit.id, 'upsert', visit, visit.confirmedAt);
      }
      await this.writeSetting('status', result.status);
      await this.writeSetting('message', result.message);
    });
  }
  private async enqueue(
    id: string,
    type: string,
    entityId: string,
    operation: string,
    payload: unknown,
    timestamp: number,
  ) {
    await this.db.run(
      'INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,payload,created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      this.ownerId,
      type,
      entityId,
      operation,
      JSON.stringify(payload),
      timestamp,
    );
  }
  async developmentVisit(regionId: string, id: string, now: number) {
    await this.transaction(async () => {
      await this.db.run(
        'INSERT INTO visits(id,owner_id,session_id,region_id,started_at,confirmed_at,source) VALUES (?,?,?,?,?,?,?)',
        id,
        this.ownerId,
        id,
        regionId,
        now - 300000,
        now,
        'development',
      );
    });
  }
  async addPhoto(photo: Photo) {
    await this.transaction(async () => {
      const visit = await this.db.first<Visit>(
        'SELECT id,source FROM visits WHERE id=? AND owner_id=? AND deleted_at IS NULL',
        photo.visitId,
        this.ownerId,
      );
      if (!visit) throw new Error('먼저 이 지역의 방문을 기록해 주세요.');
      await this.db.run(
        'INSERT INTO photos(id,owner_id,visit_id,uri,created_at) VALUES (?,?,?,?,?)',
        photo.id,
        this.ownerId,
        photo.visitId,
        photo.uri,
        photo.createdAt,
      );
      if (visit.source === 'gps')
        await this.enqueue(photo.id, 'photo', photo.id, 'upsert', photo, photo.createdAt);
    });
  }
  async deleteVisit(id: string, operationId: string, now: number): Promise<string[]> {
    return this.transaction(async () => {
      const visit = await this.db.first<{ source: string }>(
        'SELECT source FROM visits WHERE id=? AND owner_id=? AND deleted_at IS NULL',
        id,
        this.ownerId,
      );
      if (!visit) return [];
      const photos = await this.db.all<{ id: string; uri: string }>(
        'SELECT id,uri FROM photos WHERE visit_id=? AND owner_id=?',
        id,
        this.ownerId,
      );
      for (const photo of photos)
        await this.db.run(
          'DELETE FROM outbox WHERE owner_id=? AND entity_type=? AND entity_id=?',
          this.ownerId,
          'photo',
          photo.id,
        );
      await this.db.run('DELETE FROM photos WHERE visit_id=? AND owner_id=?', id, this.ownerId);
      await this.db.run(
        'UPDATE visits SET deleted_at=? WHERE id=? AND owner_id=?',
        now,
        id,
        this.ownerId,
      );
      if (visit.source === 'gps')
        await this.enqueue(operationId, 'visit', id, 'delete', { id, deletedAt: now }, now);
      return photos.map((p) => p.uri);
    });
  }
}
