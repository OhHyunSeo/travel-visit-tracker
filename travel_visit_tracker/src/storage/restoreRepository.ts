import type { SqlConnection, SqlValue } from './repository';
import {
  emptyRestoreState,
  remotePhoto,
  remoteVisit,
  visitPage,
  photoPage,
  type RemotePhoto,
  type RemoteVisit,
  type RestorePage,
  type RestoreState,
} from './restore';

type Current = () => boolean;
type Row = { id: string; revision: number; payload: string; state: string };
type Read = <T>(operation: () => Promise<T>) => Promise<T>;
type Write = <T>(current: Current, operation: () => Promise<T>) => Promise<T>;
const immutableVisit = (v: RemoteVisit) =>
  JSON.stringify([v.sessionId, v.regionId, v.startedAt, v.confirmedAt, v.source]);
const immutablePhoto = (v: RemotePhoto) => JSON.stringify({ ...v, revision: 0 });
export class RestoreRepository {
  constructor(
    private db: SqlConnection,
    readonly ownerId: string,
    private read: Read,
    private write: Write,
  ) {}
  private async ensure() {
    await this.db.run('INSERT OR IGNORE INTO restore_state(owner_id) VALUES (?)', this.ownerId);
  }
  private async rows(table: 'visits' | 'photos', id: string) {
    return this.db.all<Record<string, SqlValue>>(
      `SELECT * FROM ${table} WHERE owner_id=? AND lower(id)=?`,
      this.ownerId,
      id,
    );
  }
  private async status(
    table: 'visits' | 'photos',
    id: string,
    state: string,
    problem: string | null,
  ) {
    await this.db.run(
      `UPDATE restore_${table} SET state=?,problem=? WHERE owner_id=? AND id=?`,
      state,
      problem,
      this.ownerId,
      id,
    );
  }
  private async scan(table: 'visit' | 'photo', revision: number) {
    await this.db.run(
      `UPDATE restore_state SET ${table}_scan=? WHERE owner_id=?`,
      revision,
      this.ownerId,
    );
  }
  async state(): Promise<RestoreState> {
    return this.read(async () => {
      const s = await this.db.first<{
        visitCursor: number;
        photoCursor: number;
        visitScan: number;
        photoScan: number;
      }>(
        'SELECT visit_cursor AS visitCursor,photo_cursor AS photoCursor,visit_scan AS visitScan,photo_scan AS photoScan FROM restore_state WHERE owner_id=?',
        this.ownerId,
      );
      const v = await this.db.first<{ count: number; blocked: number }>(
        "SELECT count(*) AS count,coalesce(sum(state='blocked'),0) AS blocked FROM restore_visits WHERE owner_id=? AND state!='applied'",
        this.ownerId,
      );
      const p = await this.db.first<{ count: number; blocked: number }>(
        "SELECT count(*) AS count,coalesce(sum(state='blocked'),0) AS blocked FROM restore_photos WHERE owner_id=? AND state IN ('pending','blocked')",
        this.ownerId,
      );
      return {
        ...emptyRestoreState,
        ...s,
        pendingVisits: v?.count ?? 0,
        pendingPhotos: p?.count ?? 0,
        blocked: (v?.blocked ?? 0) + (p?.blocked ?? 0),
      };
    });
  }
  async saveVisits(after: number, page: RestorePage<RemoteVisit>, current: Current) {
    const valid = visitPage(
      { visits: page.items, cursor: page.cursor, hasMore: page.hasMore },
      after,
    );
    await this.write(current, async () => {
      await this.ensure();
      const s = await this.db.first<{ cursor: number }>(
        'SELECT visit_cursor AS cursor FROM restore_state WHERE owner_id=?',
        this.ownerId,
      );
      if (s?.cursor !== after) throw Error('복원 조회 위치가 바뀌었습니다. 다시 이어받아 주세요.');
      for (const item of valid.items) {
        const old = await this.db.first<Row>(
          'SELECT * FROM restore_visits WHERE owner_id=? AND id=?',
          this.ownerId,
          item.id,
        );
        if (old) {
          const before = remoteVisit(JSON.parse(old.payload));
          if (
            item.revision <= old.revision ||
            (before.deletedAt !== null && item.deletedAt !== before.deletedAt) ||
            (before.sessionId !== null &&
              item.sessionId !== null &&
              immutableVisit(before) !== immutableVisit(item))
          )
            throw Error(
              '서버 방문의 변경 순서를 확인할 수 없습니다. 기존 복원 대기를 보존했습니다.',
            );
        }
        await this.db.run(
          "INSERT INTO restore_visits(owner_id,id,revision,payload,state) VALUES (?,?,?,?,'pending') ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,state='pending',problem=NULL",
          this.ownerId,
          item.id,
          item.revision,
          JSON.stringify(item),
        );
      }
      await this.db.run(
        'UPDATE restore_state SET visit_cursor=? WHERE owner_id=?',
        valid.cursor,
        this.ownerId,
      );
    });
  }
  async savePhotos(after: number, page: RestorePage<RemotePhoto>, current: Current) {
    const valid = photoPage(
      { photos: page.items, cursor: page.cursor, hasMore: page.hasMore },
      after,
    );
    await this.write(current, async () => {
      await this.ensure();
      const s = await this.db.first<{ cursor: number }>(
        'SELECT photo_cursor AS cursor FROM restore_state WHERE owner_id=?',
        this.ownerId,
      );
      if (s?.cursor !== after) throw Error('사진 조회 위치가 바뀌었습니다. 다시 이어받아 주세요.');
      for (const item of valid.items) {
        const old = await this.db.first<Row>(
          'SELECT * FROM restore_photos WHERE owner_id=? AND id=?',
          this.ownerId,
          item.id,
        );
        if (
          old &&
          (item.revision <= old.revision ||
            immutablePhoto(remotePhoto(JSON.parse(old.payload))) !== immutablePhoto(item))
        )
          throw Error('서버 사진의 내용이 바뀌었습니다. 기존 복원 대기를 보존했습니다.');
        await this.db.run(
          "INSERT INTO restore_photos(owner_id,id,revision,payload,state) VALUES (?,?,?,?,'pending') ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
          this.ownerId,
          item.id,
          item.revision,
          JSON.stringify(item),
        );
      }
      await this.db.run(
        'UPDATE restore_state SET photo_cursor=? WHERE owner_id=?',
        valid.cursor,
        this.ownerId,
      );
    });
  }
  private async localChanges(visitId: string) {
    return !!(await this.db.first(
      "SELECT 1 FROM outbox WHERE owner_id=? AND ((entity_type='visit' AND lower(entity_id)=?) OR (entity_type='photo' AND lower(entity_id) IN (SELECT lower(id) FROM photos WHERE owner_id=? AND lower(visit_id)=?))) LIMIT 1",
      this.ownerId,
      visitId,
      this.ownerId,
      visitId,
    ));
  }
  async applyVisits(current: Current, limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error('복원 처리 범위를 확인해 주세요.');
    return this.write(current, async () => {
      await this.ensure();
      const s = await this.db.first<{ scan: number }>(
        'SELECT visit_scan AS scan FROM restore_state WHERE owner_id=?',
        this.ownerId,
      );
      const rows = await this.db.all<Row>(
        "SELECT * FROM restore_visits WHERE owner_id=? AND state!='applied' AND revision>? ORDER BY revision LIMIT ?",
        this.ownerId,
        s?.scan ?? 0,
        limit,
      );
      let applied = 0;
      for (const row of rows) {
        const v = remoteVisit(JSON.parse(row.payload)),
          locals = await this.rows('visits', v.id),
          local = locals[0];
        let problem: string | null = null;
        if (locals.length > 1 || (local && local.source !== 'gps')) problem = 'conflict';
        else if (await this.localChanges(v.id)) problem = 'localChanges';
        else if (v.deletedAt !== null) {
          if (local && local.deleted_at === null)
            await this.db.run(
              'UPDATE visits SET deleted_at=? WHERE owner_id=? AND id=?',
              v.deletedAt,
              this.ownerId,
              local.id,
            );
        } else if (local) {
          const same =
            String(local.session_id).toLowerCase() === v.sessionId &&
            local.region_id === v.regionId &&
            local.started_at === v.startedAt &&
            local.confirmed_at === v.confirmedAt;
          if (local.deleted_at !== null) problem = 'localDeletion';
          else if (!same) problem = 'conflict';
        } else {
          const region = await this.db.first('SELECT 1 FROM regions WHERE id=?', v.regionId);
          const session = await this.db.first(
            'SELECT 1 FROM visits WHERE owner_id=? AND lower(session_id)=?',
            this.ownerId,
            v.sessionId,
          );
          if (!region) problem = 'region';
          else if (session) problem = 'conflict';
          else
            await this.db.run(
              "INSERT INTO visits(id,owner_id,session_id,region_id,started_at,confirmed_at,source) VALUES (?,?,?,?,?,?,'gps')",
              v.id,
              this.ownerId,
              v.sessionId,
              v.regionId,
              v.startedAt,
              v.confirmedAt,
            );
        }
        await this.status('visits', v.id, problem ? 'blocked' : 'applied', problem);
        await this.scan('visit', v.revision);
        if (!problem) applied++;
      }
      return { seen: rows.length, applied, lastRevision: rows.at(-1)?.revision ?? 0 };
    });
  }
  async rewindVisits(current: Current) {
    await this.write(current, async () => {
      await this.ensure();
      await this.scan('visit', 0);
    });
  }
  async nextPhotos(limit = 100): Promise<RemotePhoto[]> {
    return this.read(async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error('사진 복원 범위를 확인해 주세요.');
      const s = await this.db.first<{ scan: number }>(
        'SELECT photo_scan AS scan FROM restore_state WHERE owner_id=?',
        this.ownerId,
      );
      const rows = await this.db.all<Row>(
        "SELECT * FROM restore_photos WHERE owner_id=? AND state IN ('pending','blocked') AND revision>? ORDER BY revision LIMIT ?",
        this.ownerId,
        s?.scan ?? 0,
        limit,
      );
      return rows.map((r) => remotePhoto(JSON.parse(r.payload)));
    });
  }
  async rewindPhotos(current: Current) {
    await this.write(current, async () => {
      await this.ensure();
      await this.scan('photo', 0);
    });
  }
  private async disposition(
    photo: RemotePhoto,
  ): Promise<
    | { kind: 'download'; visitId: string }
    | { kind: 'blocked' | 'deleted' | 'existing'; problem: string | null }
  > {
    const r = await this.db.first<Row>(
      'SELECT * FROM restore_visits WHERE owner_id=? AND id=?',
      this.ownerId,
      photo.visitId,
    );
    if (r && remoteVisit(JSON.parse(r.payload)).deletedAt !== null)
      return { kind: 'deleted', problem: null };
    const parents = await this.rows('visits', photo.visitId),
      parent = parents[0];
    if (parent && parent.deleted_at !== null) return { kind: 'deleted', problem: null };
    if (!parent || parents.length !== 1 || r?.state !== 'applied' || parent.source !== 'gps')
      return { kind: 'blocked', problem: 'parent' };
    if (await this.localChanges(photo.visitId)) return { kind: 'blocked', problem: 'localChanges' };
    const photos = await this.rows('photos', photo.id);
    if (photos.length) {
      const p = photos[0];
      return photos.length === 1 &&
        String(p.visit_id).toLowerCase() === photo.visitId &&
        p.created_at === photo.createdAt
        ? { kind: 'existing', problem: null }
        : { kind: 'blocked', problem: 'conflict' };
    }
    return { kind: 'download', visitId: parent.id as string };
  }
  async photoDisposition(photo: RemotePhoto, current: Current) {
    const value = remotePhoto(photo);
    return this.write(current, async () => {
      const queued = await this.db.first<Row>(
        'SELECT * FROM restore_photos WHERE owner_id=? AND id=?',
        this.ownerId,
        value.id,
      );
      if (
        !queued ||
        queued.payload !== JSON.stringify(value) ||
        !['pending', 'blocked'].includes(queued.state)
      )
        return { kind: 'stale' as const };
      const result = await this.disposition(value);
      if (result.kind !== 'download') {
        await this.status('photos', value.id, result.kind, result.problem);
        await this.scan('photo', value.revision);
      }
      return result;
    });
  }
  async blockPhoto(photo: RemotePhoto, current: Current) {
    await this.write(current, async () => {
      const changed = await this.db.run(
        "UPDATE restore_photos SET state='blocked',problem='invalidFile' WHERE owner_id=? AND id=? AND payload=? AND state IN ('pending','blocked')",
        this.ownerId,
        photo.id,
        JSON.stringify(remotePhoto(photo)),
      );
      if (changed.changes === 1) await this.scan('photo', photo.revision);
    });
  }
  async completePhoto(photo: RemotePhoto, uri: string, current: Current): Promise<boolean> {
    const value = remotePhoto(photo);
    if (!/^visit-photos\/restored-[a-f0-9-]{36}\.(png|jpg)$/.test(uri))
      throw Error('복원 파일 경로를 확인할 수 없습니다.');
    return this.write(current, async () => {
      const queued = await this.db.first<Row>(
        'SELECT * FROM restore_photos WHERE owner_id=? AND id=?',
        this.ownerId,
        value.id,
      );
      if (
        !queued ||
        queued.payload !== JSON.stringify(value) ||
        !['pending', 'blocked'].includes(queued.state)
      )
        return false;
      const ready = await this.disposition(value);
      if (ready.kind !== 'download') {
        await this.status('photos', value.id, ready.kind, ready.problem);
        await this.scan('photo', value.revision);
        return false;
      }
      await this.db.run(
        'INSERT INTO photos(id,owner_id,visit_id,uri,created_at) VALUES (?,?,?,?,?)',
        value.id,
        this.ownerId,
        ready.visitId,
        uri,
        value.createdAt,
      );
      await this.status('photos', value.id, 'applied', null);
      await this.scan('photo', value.revision);
      return true;
    });
  }
  async fileReferenced(uri: string): Promise<boolean> {
    return this.read(
      async () => !!(await this.db.first('SELECT 1 FROM photos WHERE uri=? LIMIT 1', uri)),
    );
  }
}
