import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sessionOwner, type Session } from '../src/services/authClient';
import { PhotoBackupCoordinator, type PhotoBackupRepository } from '../src/services/photoBackup';
import { PhotoFileError, PhotoSyncClient, type PreparedPhotoFile } from '../src/services/photoSync';
import type { PhotoFingerprint, QueuedPhotoOperation } from '../src/storage/outbox';

const session: Session = {
  apiUrl: 'https://backup.example.test',
  token: 'synthetic-token',
  user: { id: 1, email: 'synthetic@example.test', username: '합성 계정' },
};
const ownerId = sessionOwner(session);
const consent = { ownerId, token: session.token! };
const epoch = 1700000000000.25;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function prepared(content = bytes): PreparedPhotoFile {
  return {
    fingerprint: {
      sha256: createHash('sha256').update(content).digest('hex'),
      byteLength: content.length,
      mimeType: 'image/png',
    },
    body: new Blob([content], { type: 'image/png' }),
    dispose: vi.fn(async () => {}),
  };
}
function harness(count = 1) {
  let current: Session | null = session,
    active = true,
    visits = 0;
  const rows: QueuedPhotoOperation[] = Array.from({ length: count }, (_, index) => ({
    id: id(index + 1),
    entityId: id(index + 1),
    entityType: 'photo',
    operation: 'upsert',
    serializedPayload: JSON.stringify({
      id: id(index + 1),
      visitId: id(9999),
      uri: `visit-photos/synthetic-${index}.png`,
      createdAt: epoch + index,
    }),
    createdAt: epoch + index,
    attempts: 0,
  }));
  const frozen = new Map<string, PhotoFingerprint>();
  const uploaded = new Set<string>();
  const repository: PhotoBackupRepository = {
    ownerId,
    visitBackupState: vi.fn(async () => ({
      autoEnabled: false,
      pendingVisits: visits,
      pendingPhotos: rows.length,
      lastSuccessAt: null,
      nextAttemptAt: null,
      connectionCheckAt: null,
      pauseReason: null,
    })),
    photoBackupState: vi.fn(async () => ({
      pendingPhotos: rows.length,
      backedUpPhotos: uploaded.size,
    })),
    pendingPhotoOperations: vi.fn(async (limit = 100, after) =>
      rows
        .filter(
          (row) =>
            !after ||
            row.createdAt > after.createdAt ||
            (row.createdAt === after.createdAt && row.id > after.id),
        )
        .slice(0, limit),
    ),
    preparePhotoOperation: vi.fn(async (operation, fingerprint, guard) => {
      if (guard && !guard()) throw new Error('stale login');
      const row = rows.find(
        (row) => row.id === operation.id && row.serializedPayload === operation.serializedPayload,
      );
      if (
        !row ||
        visits > 0 ||
        (frozen.has(row.id) && JSON.stringify(frozen.get(row.id)) !== JSON.stringify(fingerprint))
      )
        return false;
      frozen.set(row.id, { ...fingerprint });
      row.attempts++;
      return true;
    }),
    acknowledgePhotoOperation: vi.fn(
      async (operation, _fingerprint, acknowledgement, _at, guard) => {
        if (guard && !guard()) throw new Error('stale login');
        const position = rows.findIndex(
          (row) => row.id === operation.id && row.serializedPayload === operation.serializedPayload,
        );
        if (position < 0) return false;
        expect(acknowledgement.acknowledgedId).toBe(operation.id);
        rows.splice(position, 1);
        uploaded.add(operation.entityId);
        return true;
      },
    ),
  };
  const send = vi.fn<typeof fetch>(async (_url, request) => {
    const form = Object.fromEntries(
      (request?.body as unknown as { entries(): IterableIterator<[string, unknown]> }).entries(),
    );
    return Response.json({
      acknowledgedId: form.operationId,
      photo: {
        ...prepared().fingerprint,
        id: form.id,
        visitId: form.visitId,
        createdAt: Number(form.createdAt),
        revision: 1,
        originalPath: `/api/visit-photos/${form.id}/original`,
        thumbnailPath: `/api/visit-photos/${form.id}/thumbnail`,
      },
    });
  });
  const files: PreparedPhotoFile[] = [];
  const loader = vi.fn(async (_uri: string) => {
    const file = prepared();
    files.push(file);
    return file;
  });
  const before = vi.fn(async () => {});
  const factory = vi.fn(async () => repository);
  const backup = new PhotoBackupCoordinator(
    () => current,
    factory,
    new PhotoSyncClient(send),
    loader,
    before,
    () => active,
    () => epoch + 500000,
  );
  return {
    backup,
    repository,
    rows,
    files,
    loader,
    factory,
    before,
    send,
    frozen,
    uploaded,
    switchSession: (next: Session | null) => {
      current = next;
    },
    background: () => {
      active = false;
    },
    pendingVisits: (count: number) => {
      visits = count;
    },
  };
}

describe('manual account-confirmed photo backup', () => {
  it('backs up visits first, prepares each file before dispatch and keeps the source file outside cleanup', async () => {
    const h = harness(2);
    expect(await h.backup.run(consent)).toMatchObject({
      ownerId,
      acknowledged: 2,
      remaining: 0,
      skipped: 0,
      paused: false,
    });
    expect(h.before).toHaveBeenCalledWith(consent);
    expect(h.repository.preparePhotoOperation).toHaveBeenCalledTimes(2);
    expect(h.uploaded.size).toBe(2);
    for (const file of h.files) expect(file.dispose).toHaveBeenCalledTimes(1);
    expect(h.repository.acknowledgePhotoOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      epoch + 500000,
      expect.any(Function),
    );
  });
  it('retains the frozen operation after a partial ACK and retries it without a false local receipt', async () => {
    const h = harness();
    const original = { ...h.rows[0] };
    let reads = 0;
    h.send.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (!reads++) controller.enqueue(new TextEncoder().encode('{"acknowledgedId":'));
              else controller.error(new Error('synthetic interrupted ACK'));
            },
          }),
        ),
    );
    expect(await h.backup.run(consent)).toMatchObject({ acknowledged: 0, remaining: 1 });
    expect(h.rows[0]).toMatchObject({
      id: original.id,
      serializedPayload: original.serializedPayload,
      attempts: 1,
    });
    expect(h.frozen.get(original.entityId)).toEqual(prepared().fingerprint);
    expect(h.repository.acknowledgePhotoOperation).not.toHaveBeenCalled();
    expect(h.uploaded.size).toBe(0);
    expect(h.files[0].dispose).toHaveBeenCalledOnce();
    expect(await h.backup.run(consent)).toMatchObject({ acknowledged: 1, remaining: 0 });
    expect(h.uploaded.size).toBe(1);
    expect(h.repository.acknowledgePhotoOperation).toHaveBeenCalledOnce();
    expect((h.send.mock.calls[0][1]?.body as FormData).get('operationId')).toBe(original.id);
    expect((h.send.mock.calls[1][1]?.body as FormData).get('operationId')).toBe(original.id);
  });
  it('releases a deadline-expired run so the same queued photo can be retried', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const original = { ...h.rows[0] };
      h.send.mockImplementationOnce(() => new Promise(() => {}));
      const pending = h.backup.run(consent);
      await vi.advanceTimersByTimeAsync(30000);
      expect(await pending).toMatchObject({ acknowledged: 0, remaining: 1 });
      expect(h.rows[0].id).toBe(original.id);
      expect(h.repository.acknowledgePhotoOperation).not.toHaveBeenCalled();
      expect(h.files[0].dispose).toHaveBeenCalledOnce();
      expect(await h.backup.run(consent)).toMatchObject({ acknowledged: 1, remaining: 0 });
      expect(h.repository.acknowledgePhotoOperation).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    { ...consent, ownerId: 'account:other:2' },
    { ...consent, token: 'different-token' },
  ])('rejects stale consent without inspecting another account or its files %#', async (value) => {
    const h = harness();
    expect(await h.backup.run(value)).toMatchObject({
      ownerId: null,
      acknowledged: 0,
      remaining: 0,
      paused: true,
    });
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.before).not.toHaveBeenCalled();
    expect(h.loader).not.toHaveBeenCalled();
  });
  it('does not run in the background or after logout', async () => {
    const h = harness();
    h.background();
    expect(await h.backup.run(consent)).toMatchObject({ paused: true });
    h.switchSession(null);
    expect(await h.backup.run(consent)).toMatchObject({ ownerId: null, paused: true });
    expect(h.factory).not.toHaveBeenCalled();
  });
  it('does not inspect or upload photo files when parent visits remain pending', async () => {
    const h = harness();
    h.pendingVisits(1);
    expect(await h.backup.run(consent)).toMatchObject({
      acknowledged: 0,
      remaining: 1,
      message: expect.stringContaining('방문 전송'),
    });
    expect(h.loader).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('stops if the account changes while the prerequisite visit upload runs', async () => {
    const h = harness();
    h.before.mockImplementationOnce(async () =>
      h.switchSession({ ...session, token: 'new-token' }),
    );
    expect(await h.backup.run(consent)).toMatchObject({ paused: true });
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('coalesces matching consent but never returns that account result to another consent', async () => {
    const h = harness();
    let release!: () => void;
    h.before.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = h.backup.run(consent);
    expect(h.backup.run({ ...consent })).toBe(first);
    h.switchSession({ ...session, user: { ...session.user, id: 2 }, token: 'account-b-token' });
    const other = await h.backup.run({
      ownerId: sessionOwner({ ...session, user: { ...session.user, id: 2 } }),
      token: 'account-b-token',
    });
    expect(other).toMatchObject({ ownerId: null, acknowledged: 0, remaining: 0, paused: true });
    release();
    expect(await first).toMatchObject({ acknowledged: 0, paused: true });
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each(['token', 'background'])(
    'disposes the snapshot and does not prepare/send after %s changes while loading it',
    async (change) => {
      const h = harness();
      const file = prepared();
      h.loader.mockImplementationOnce(async () => {
        if (change === 'token') h.switchSession({ ...session, token: 'new-token' });
        else h.background();
        return file;
      });
      expect(await h.backup.run(consent)).toMatchObject({ paused: true, acknowledged: 0 });
      expect(file.dispose).toHaveBeenCalledTimes(1);
      expect(h.repository.preparePhotoOperation).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
    },
  );
  it('does not send after the foreground guard changes during preparation', async () => {
    const h = harness();
    vi.mocked(h.repository.preparePhotoOperation).mockImplementationOnce(async () => {
      h.background();
      return true;
    });
    expect(await h.backup.run(consent)).toMatchObject({ paused: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.files[0].dispose).toHaveBeenCalledTimes(1);
  });
  it.each(['token', 'background'])(
    'includes cleanup failure after a %s pause without acknowledging or exposing another account',
    async (change) => {
      const h = harness();
      const file = prepared();
      vi.mocked(file.dispose).mockRejectedValueOnce(new Error('private cache path'));
      h.loader.mockImplementationOnce(async () => {
        if (change === 'token') h.switchSession({ ...session, token: 'new-token' });
        else h.background();
        return file;
      });
      const result = await h.backup.run(consent);
      expect(result).toMatchObject({ ownerId, paused: true, acknowledged: 0, remaining: 1 });
      expect(result.message).toContain('임시 전송 파일 정리는 다시 확인');
      expect(result.message).not.toContain('private cache path');
      expect(h.rows).toHaveLength(1);
      expect(h.uploaded.size).toBe(0);
      expect(h.send).not.toHaveBeenCalled();
      expect(file.dispose).toHaveBeenCalledTimes(1);
      const stale = await h.backup.run({ ...consent, token: 'another-token' });
      expect(stale).toMatchObject({ ownerId: null, acknowledged: 0, remaining: 0 });
      expect(stale.message).not.toContain('임시 전송 파일');
    },
  );
  it('leaves the queue and remote metadata untouched after a cross-account late response', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => {
      h.switchSession({ ...session, user: { ...session.user, id: 2 }, token: 'new-token' });
      return Response.json({});
    });
    expect(await h.backup.run(consent)).toMatchObject({ acknowledged: 0, paused: true });
    expect(h.repository.acknowledgePhotoOperation).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(1);
    expect(h.uploaded.size).toBe(0);
    expect(h.files[0].dispose).toHaveBeenCalledTimes(1);
  });
  it('skips deleted or changed rows instead of sending a previously loaded file', async () => {
    const h = harness();
    h.loader.mockImplementationOnce(async () => {
      h.rows.splice(0, 1);
      return prepared();
    });
    expect(await h.backup.run(consent)).toMatchObject({
      acknowledged: 0,
      remaining: 0,
      skipped: 1,
    });
    expect(h.send).not.toHaveBeenCalled();
  });
  it('leaves the photo pending if a parent visit change appears while its file is loading', async () => {
    const h = harness();
    h.loader.mockImplementationOnce(async () => {
      h.pendingVisits(1);
      return prepared();
    });
    expect(await h.backup.run(consent)).toMatchObject({
      acknowledged: 0,
      remaining: 1,
      skipped: 1,
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.repository.acknowledgePhotoOperation).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(1);
  });
  it('does not restore a deleted photo when a valid upload response arrives late', async () => {
    const h = harness();
    const respond = h.send.getMockImplementation()!;
    h.send.mockImplementationOnce(async (...args) => {
      const response = await respond(...args);
      h.rows.splice(0, 1);
      return response;
    });
    expect(await h.backup.run(consent)).toMatchObject({
      acknowledged: 0,
      remaining: 0,
      skipped: 1,
    });
    expect(h.uploaded.size).toBe(0);
    expect(h.files[0].dispose).toHaveBeenCalledTimes(1);
  });
  it('scans beyond a full page of unsupported/missing/oversized files to reach eligible later photos', async () => {
    const h = harness(103);
    h.loader.mockImplementation(async (uri) => {
      const index = Number(uri.match(/synthetic-(\d+)/)?.[1]);
      if (index < 101)
        throw new PhotoFileError((['unsupported', 'missing', 'tooLarge'] as const)[index % 3]);
      const file = prepared();
      h.files.push(file);
      return file;
    });
    const result = await h.backup.run(consent);
    expect(result).toMatchObject({
      acknowledged: 2,
      remaining: 101,
      skipped: 101,
    });
    expect(result.message).toContain('미지원 형식 34건, 파일 없음 34건, 크기 제한 33건');
    expect(result.message).not.toContain('synthetic-');
    expect(h.repository.pendingPhotoOperations).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenCalledTimes(2);
  });
  it('limits each confirmed run to twenty server-confirmed files', async () => {
    const h = harness(25);
    expect(await h.backup.run(consent)).toMatchObject({
      acknowledged: 20,
      remaining: 5,
      skipped: 0,
    });
    expect(h.send).toHaveBeenCalledTimes(20);
    expect(h.loader).toHaveBeenCalledTimes(20);
  });
  it('skips twenty-one server-rejected images and still reaches a later valid photo', async () => {
    const h = harness(22);
    const respond = h.send.getMockImplementation()!;
    let attempts = 0;
    h.send.mockImplementation(async (...args) => {
      if (++attempts <= 21)
        return Response.json(
          { code: 'INVALID_IMAGE', error: 'private source path' },
          { status: 400 },
        );
      return respond(...args);
    });
    const result = await h.backup.run(consent);
    expect(result).toMatchObject({ acknowledged: 1, remaining: 21, skipped: 21, paused: false });
    expect(result.message).toContain('파일 확인 실패 21건');
    expect(result.message).not.toContain('private source path');
    expect(h.send).toHaveBeenCalledTimes(22);
    expect(h.rows).toHaveLength(21);
    expect(h.uploaded.has(id(22))).toBe(true);
    for (const file of h.files) expect(file.dispose).toHaveBeenCalledTimes(1);
  });
  it('retains the frozen fingerprint after response loss and rejects changed bytes before replaying the same operation', async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(new Error('private network message'));
    expect(await h.backup.run(consent)).toMatchObject({ acknowledged: 0, remaining: 1 });
    const frozen = { ...h.frozen.get(id(1)) };
    h.loader.mockImplementationOnce(async () => prepared(new Uint8Array([1, 2, 3])));
    expect(await h.backup.run(consent)).toMatchObject({
      acknowledged: 0,
      remaining: 1,
      skipped: 1,
    });
    expect(h.frozen.get(id(1))).toEqual(frozen);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(await h.backup.run(consent)).toMatchObject({ acknowledged: 1, remaining: 0 });
    const sentIds = h.send.mock.calls.map(
      ([, request]) =>
        Object.fromEntries(
          (
            request?.body as unknown as { entries(): IterableIterator<[string, unknown]> }
          ).entries(),
        ).operationId,
    );
    expect(sentIds).toEqual([id(1), id(1)]);
  });
  it.each([401, 409, 500])('stops after HTTP %s without touching the next file', async (status) => {
    const h = harness(2);
    h.send.mockResolvedValueOnce(new Response('private server details', { status }));
    const result = await h.backup.run(consent);
    expect(result).toMatchObject({ acknowledged: 0, remaining: 2 });
    expect(result.message).not.toContain('private server details');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.loader).toHaveBeenCalledTimes(1);
    expect(h.rows).toHaveLength(2);
  });
  it.each(['error', 'paused'])(
    'keeps already counted skip reasons in a later %s result without device paths',
    async (ending) => {
      const h = harness(2);
      h.loader.mockRejectedValueOnce(new PhotoFileError('invalid'));
      if (ending === 'error') h.send.mockRejectedValueOnce(new Error('private device path'));
      else
        h.loader.mockImplementationOnce(async () => {
          h.background();
          return prepared();
        });
      const result = await h.backup.run(consent);
      expect(result).toMatchObject({ acknowledged: 0, skipped: 1, paused: ending === 'paused' });
      expect(result.message).toContain('파일 확인 실패 1건');
      expect(result.message).not.toContain('미지원 형식');
      expect(result.message).not.toContain('private device path');
      expect(result.message).not.toContain('synthetic-');
    },
  );
  it('retains pending work when ACK persistence fails and disposes only the transmission snapshot', async () => {
    const h = harness();
    vi.mocked(h.repository.acknowledgePhotoOperation).mockRejectedValueOnce(
      new Error('private SQLite path'),
    );
    const result = await h.backup.run(consent);
    expect(result).toMatchObject({ acknowledged: 0, remaining: 1 });
    expect(result.message).not.toContain('private SQLite path');
    expect(h.uploaded.size).toBe(0);
    expect(h.files[0].dispose).toHaveBeenCalledTimes(1);
  });
  it('does not undo a successful ACK or retry it when disposal fails', async () => {
    const h = harness();
    const file = prepared();
    vi.mocked(file.dispose).mockRejectedValueOnce(new Error('private cache path'));
    h.loader.mockResolvedValueOnce(file);
    const result = await h.backup.run(consent);
    expect(result).toMatchObject({ acknowledged: 1, remaining: 0 });
    expect(result.message).toContain('임시 전송 파일');
    expect(result.message).not.toContain('private cache path');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.uploaded.size).toBe(1);
  });
});
