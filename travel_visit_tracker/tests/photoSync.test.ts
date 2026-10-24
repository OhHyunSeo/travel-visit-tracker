import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/services/authClient';
import { PhotoFileError, PhotoSyncClient, type PreparedPhotoFile } from '../src/services/photoSync';
import type { PhotoAcknowledgement, QueuedPhotoOperation } from '../src/storage/outbox';

const session: Session = {
  apiUrl: 'https://backup.example.test',
  token: 'synthetic-token',
  user: { id: 1, email: 'synthetic@example.test', username: '합성 계정' },
};
const photoId = '00000000-0000-4000-8000-000000000001';
const visitId = '00000000-0000-4000-8000-000000000002';
const operation: QueuedPhotoOperation = {
  id: '00000000-0000-4000-8000-000000000003',
  entityType: 'photo',
  entityId: photoId,
  operation: 'upsert',
  createdAt: 1700000000000.25,
  attempts: 0,
  serializedPayload: JSON.stringify({
    id: photoId,
    visitId,
    uri: 'visit-photos/private-device-path.png',
    createdAt: 1700000000000.25,
  }),
};
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function prepared(): PreparedPhotoFile {
  return {
    fingerprint: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      mimeType: 'image/png',
    },
    body: new Blob([bytes], { type: 'image/png' }),
    dispose: vi.fn(async () => {}),
  };
}
function ack(file = prepared()): PhotoAcknowledgement {
  return {
    acknowledgedId: operation.id,
    photo: {
      ...file.fingerprint,
      id: photoId,
      visitId,
      createdAt: operation.createdAt,
      revision: 1,
      originalPath: `/api/visit-photos/${photoId}/original`,
      thumbnailPath: `/api/visit-photos/${photoId}/thumbnail`,
    },
  };
}
const formEntries = (body: unknown) =>
  Object.fromEntries((body as { entries(): IterableIterator<[string, unknown]> }).entries());

describe('strict photo upload transport', () => {
  it('sends only fixed identifiers, time and the immutable attachment without a device URI', async () => {
    const file = prepared();
    const send = vi.fn<typeof fetch>(async () => Response.json(ack(file)));
    expect(await new PhotoSyncClient(send).sendPhoto(session, operation, file)).toEqual(ack(file));
    const [url, request] = send.mock.calls[0];
    expect(url).toBe(`${session.apiUrl}/api/visit-photos`);
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: 'Bearer synthetic-token' },
    });
    const form = formEntries(request?.body);
    expect(Object.keys(form).sort()).toEqual(['createdAt', 'file', 'id', 'operationId', 'visitId']);
    expect(form).toMatchObject({
      id: photoId,
      visitId,
      operationId: operation.id,
      createdAt: String(operation.createdAt),
    });
    const upload = form.file as Blob & { name: string };
    expect(upload.name).toBe(`${photoId}.png`);
    expect(new Uint8Array(await upload.arrayBuffer())).toEqual(bytes);
    expect(JSON.stringify(form)).not.toContain('private-device-path');
    expect(file.dispose).not.toHaveBeenCalled();
  });
  it('normalizes valid uppercase UUIDs without changing stored payloads or choosing a new operation', async () => {
    const op = {
      ...operation,
      id: operation.id.toUpperCase(),
      entityId: photoId.toUpperCase(),
      serializedPayload: JSON.stringify({
        id: photoId.toUpperCase(),
        visitId: visitId.toUpperCase(),
        uri: 'visit-photos/synthetic.png',
        createdAt: operation.createdAt,
      }),
    };
    const send = vi.fn<typeof fetch>(async () => Response.json(ack()));
    expect(await new PhotoSyncClient(send).sendPhoto(session, op, prepared())).toEqual(ack());
    expect(formEntries(send.mock.calls[0][1]?.body).operationId).toBe(operation.id);
  });
  it.each([
    { ...operation, id: 'not-a-uuid' },
    { ...operation, serializedPayload: '{' },
    {
      ...operation,
      serializedPayload: JSON.stringify({
        id: visitId,
        visitId,
        uri: 'file:///synthetic',
        createdAt: operation.createdAt,
      }),
    },
    {
      ...operation,
      serializedPayload: JSON.stringify({
        id: photoId,
        visitId,
        uri: 'file:///synthetic',
        createdAt: operation.createdAt + 1,
      }),
    },
    {
      ...operation,
      serializedPayload: JSON.stringify({
        id: photoId,
        visitId,
        uri: 'file:///synthetic',
        createdAt: operation.createdAt,
        ownerId: 'injected',
      }),
    },
  ])('rejects invalid operation metadata before network access %#', async (op) => {
    const send = vi.fn<typeof fetch>();
    await expect(new PhotoSyncClient(send).sendPhoto(session, op, prepared())).rejects.toThrow(
      '전송 대기 정보',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a mismatched file snapshot before network access', async () => {
    const file = prepared();
    file.fingerprint.byteLength++;
    const send = vi.fn<typeof fetch>();
    await expect(
      new PhotoSyncClient(send).sendPhoto(session, operation, file),
    ).rejects.toBeInstanceOf(PhotoFileError);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { acknowledgedId: visitId },
    { photo: null },
    { photo: { ...ack().photo, id: visitId } },
    { photo: { ...ack().photo, visitId: photoId } },
    { photo: { ...ack().photo, createdAt: operation.createdAt + 1 } },
    { photo: { ...ack().photo, sha256: 'b'.repeat(64) } },
    { photo: { ...ack().photo, byteLength: 1 } },
    { photo: { ...ack().photo, mimeType: 'image/jpeg' } },
    { photo: { ...ack().photo, revision: 0 } },
    { photo: { ...ack().photo, revision: 0.5 } },
    {
      photo: {
        ...ack().photo,
        originalPath: `https://other.example.test/api/visit-photos/${photoId}/original`,
      },
    },
    {
      photo: {
        ...ack().photo,
        thumbnailPath: `/api/visit-photos/${photoId}/thumbnail?token=synthetic`,
      },
    },
  ])('rejects unrelated or malformed acknowledgement metadata %#', async (change) => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ ...ack(), ...change }));
    await expect(
      new PhotoSyncClient(send).sendPhoto(session, operation, prepared()),
    ).rejects.toThrow('저장 확인');
  });
  it.each([401, 409, 500])('normalizes HTTP %s without exposing server text', async (status) => {
    const send = vi.fn<typeof fetch>(
      async () => new Response('private-token-or-file-path', { status }),
    );
    await expect(
      new PhotoSyncClient(send).sendPhoto(session, operation, prepared()),
    ).rejects.toMatchObject({ status });
    try {
      await new PhotoSyncClient(send).sendPhoto(session, operation, prepared());
    } catch (error) {
      expect((error as Error).message).not.toContain('private-token-or-file-path');
    }
  });
  it.each([
    { status: 400, code: 'INVALID_IMAGE', reason: 'invalid' },
    { status: 400, code: 'INVALID_FILE_TYPE', reason: 'unsupported' },
    { status: 413, code: 'FILE_TOO_LARGE', reason: 'tooLarge' },
  ])(
    'classifies only a known file rejection $status/$code as skippable',
    async ({ status, code, reason }) => {
      const send = vi.fn<typeof fetch>(async () =>
        Response.json({ code, error: 'private image path', message: 'private token' }, { status }),
      );
      try {
        await new PhotoSyncClient(send).sendPhoto(session, operation, prepared());
        expect.fail('expected a classified file rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(PhotoFileError);
        expect(error).toMatchObject({ reason });
        expect((error as Error).message).not.toContain('private');
      }
    },
  );
  it.each([
    { status: 400, code: 'INVALID_PHOTO' },
    { status: 400, code: 'FILE_TOO_LARGE' },
    { status: 413, code: 'INVALID_IMAGE' },
    { status: 401, code: 'INVALID_IMAGE' },
    { status: 409, code: 'INVALID_IMAGE' },
    { status: 500, code: 'INVALID_FILE_TYPE' },
  ])('keeps unrelated status/code $status/$code on the stop path', async ({ status, code }) => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ code, error: 'private server path' }, { status }),
    );
    try {
      await new PhotoSyncClient(send).sendPhoto(session, operation, prepared());
    } catch (error) {
      expect(error).not.toBeInstanceOf(PhotoFileError);
      expect(error).toMatchObject({ status });
      expect((error as Error).message).not.toContain('private server path');
    }
  });
  it('does not expose raw transport errors', async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new Error('file:///private-location?token=secret');
    });
    await expect(
      new PhotoSyncClient(send).sendPhoto(session, operation, prepared()),
    ).rejects.toThrow('응답을 받지 못했습니다');
  });
  it('aborts a stalled upload after thirty seconds and preserves the caller-owned file', async () => {
    vi.useFakeTimers();
    try {
      const file = prepared();
      const send = vi.fn<typeof fetch>(
        (_url, request) =>
          new Promise((_resolve, reject) => {
            request?.signal?.addEventListener('abort', () => reject(new Error('private timeout')));
          }),
      );
      const pending = expect(
        new PhotoSyncClient(send).sendPhoto(session, operation, file),
      ).rejects.toThrow('응답을 받지 못했습니다');
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
      expect(file.dispose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('reads ACK bytes without the native json/text path that can hang on a disconnected body', async () => {
    const response = Response.json(ack());
    const json = vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
    const send = vi.fn(async () => response);
    expect(await new PhotoSyncClient(send).sendPhoto(session, operation, prepared())).toEqual(
      ack(),
    );
    expect(json).not.toHaveBeenCalled();
  });
  it('rejects a response stream cut after partial ACK bytes without exposing the body', async () => {
    let reads = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (!reads++) controller.enqueue(new TextEncoder().encode('{"private-path":'));
          else controller.error(new Error('private response stream error'));
        },
      }),
    );
    await expect(
      new PhotoSyncClient(async () => response).sendPhoto(session, operation, prepared()),
    ).rejects.toThrow('응답을 받지 못했습니다');
  });
  it('bounds ACK bytes and cancels the response when the body exceeds 64KiB', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(65537));
        },
        cancel,
      }),
    );
    await expect(
      new PhotoSyncClient(async () => response).sendPhoto(session, operation, prepared()),
    ).rejects.toThrow('응답을 받지 못했습니다');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([400, 413])(
    'does not classify a truncated HTTP %s body as a permanent file rejection',
    async (status) => {
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('private truncated error body'));
          },
        }),
        { status },
      );
      await expect(
        new PhotoSyncClient(async () => response).sendPhoto(session, operation, prepared()),
      ).rejects.toMatchObject({ status });
    },
  );
  it('enforces the complete deadline even when a transport ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const file = prepared();
      const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const result = expect(
        new PhotoSyncClient(send).sendPhoto(session, operation, file),
      ).rejects.toThrow('응답을 받지 못했습니다');
      await vi.advanceTimersByTimeAsync(30000);
      await result;
      expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(file.dispose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not let pending body reads or cancellation extend the thirty-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const file = prepared();
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const response = new Response(new ReadableStream({ cancel }));
      const send = vi.fn<typeof fetch>(async () => response);
      const result = expect(
        new PhotoSyncClient(send).sendPhoto(session, operation, file),
      ).rejects.toThrow('응답을 받지 못했습니다');
      await vi.advanceTimersByTimeAsync(30000);
      await result;
      expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      expect(file.dispose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('discards a transport response that arrives after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (response: Response) => void;
      const send = vi.fn<typeof fetch>(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
      const result = expect(
        new PhotoSyncClient(send).sendPhoto(session, operation, prepared()),
      ).rejects.toThrow('응답을 받지 못했습니다');
      await vi.advanceTimersByTimeAsync(30000);
      await result;
      const late = Response.json(ack());
      const cancel = vi.spyOn(late.body!, 'cancel');
      resolve(late);
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
