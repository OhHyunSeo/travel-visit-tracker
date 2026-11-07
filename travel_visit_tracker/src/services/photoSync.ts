import { AuthError, normalizeApiUrl, type Session } from './authClient';
import type { Photo } from '../domain/types';
import type {
  PhotoAcknowledgement,
  PhotoFingerprint,
  QueuedPhotoOperation,
} from '../storage/outbox';

export type PreparedPhotoFile = {
  fingerprint: PhotoFingerprint;
  body: Blob;
  dispose: () => Promise<void>;
};
export type PhotoTransport = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'body'>>;
const fileMessages = {
  unsupported: '아직 지원하지 않는 사진 형식입니다. 원본은 기기에 보관합니다.',
  missing: '기기에 저장된 사진 파일을 찾지 못했습니다. 전송 대기는 유지합니다.',
  tooLarge: '10MiB를 넘는 사진은 아직 전송하지 않습니다. 원본은 기기에 보관합니다.',
  invalid: '사진 파일을 확인하지 못했습니다. 원본과 전송 대기는 유지합니다.',
};
export class PhotoFileError extends Error {
  constructor(readonly reason: keyof typeof fileMessages) {
    super(fileMessages[reason]);
    this.name = 'PhotoFileError';
  }
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function parsePhotoOperation(operation: QueuedPhotoOperation): Photo {
  let value: unknown;
  try {
    value = JSON.parse(operation.serializedPayload);
  } catch {
    throw new AuthError('사진 전송 대기 정보를 확인할 수 없습니다. 대기 기록을 보존했습니다.');
  }
  if (
    operation.entityType !== 'photo' ||
    operation.operation !== 'upsert' ||
    !uuid(operation.id) ||
    !uuid(operation.entityId) ||
    !timestamp(operation.createdAt) ||
    !record(value) ||
    Object.keys(value).some((key) => !['id', 'visitId', 'uri', 'createdAt'].includes(key)) ||
    !uuid(value.id) ||
    value.id.toLowerCase() !== operation.entityId.toLowerCase() ||
    !uuid(value.visitId) ||
    typeof value.uri !== 'string' ||
    !value.uri ||
    value.uri.length > 4096 ||
    !timestamp(value.createdAt) ||
    value.createdAt !== operation.createdAt
  )
    throw new AuthError('사진 전송 대기 정보를 확인할 수 없습니다. 대기 기록을 보존했습니다.');
  return {
    id: value.id.toLowerCase(),
    visitId: value.visitId.toLowerCase(),
    uri: value.uri,
    createdAt: value.createdAt,
  };
}
export function validPhotoFingerprint(
  value: unknown,
): value is PhotoFingerprint & Record<string, unknown> {
  return (
    record(value) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) > 0 &&
    (value.byteLength as number) <= 10 * 1024 * 1024 &&
    ['image/jpeg', 'image/png'].includes(value.mimeType as string)
  );
}
export function validatePhotoAcknowledgement(
  value: unknown,
  operation: QueuedPhotoOperation,
  fingerprint: PhotoFingerprint,
): PhotoAcknowledgement {
  const expected = parsePhotoOperation(operation);
  const photo = record(value) ? value.photo : null;
  if (
    !record(value) ||
    value.acknowledgedId !== operation.id.toLowerCase() ||
    !record(photo) ||
    !validPhotoFingerprint(photo) ||
    photo.id !== expected.id ||
    photo.visitId !== expected.visitId ||
    photo.createdAt !== expected.createdAt ||
    photo.sha256 !== fingerprint.sha256 ||
    photo.byteLength !== fingerprint.byteLength ||
    photo.mimeType !== fingerprint.mimeType ||
    !Number.isSafeInteger(photo.revision) ||
    (photo.revision as number) <= 0 ||
    photo.originalPath !== `/api/visit-photos/${expected.id}/original` ||
    photo.thumbnailPath !== `/api/visit-photos/${expected.id}/thumbnail`
  )
    throw new AuthError('서버의 사진 저장 확인이 전송 내용과 다릅니다. 대기 기록을 보존했습니다.');
  return {
    acknowledgedId: value.acknowledgedId as string,
    photo: {
      id: photo.id as string,
      visitId: photo.visitId as string,
      createdAt: photo.createdAt as number,
      sha256: photo.sha256,
      byteLength: photo.byteLength,
      mimeType: photo.mimeType,
      revision: photo.revision as number,
      originalPath: photo.originalPath as string,
      thumbnailPath: photo.thumbnailPath as string,
    },
  };
}
export class PhotoSyncClient {
  constructor(
    private readonly send: PhotoTransport = fetch,
    private readonly development = false,
  ) {}
  async sendPhoto(
    session: Session,
    operation: QueuedPhotoOperation,
    file: PreparedPhotoFile,
  ): Promise<PhotoAcknowledgement> {
    if (!session.token) throw new AuthError('사진을 전송하려면 다시 로그인해 주세요.', 401);
    const apiUrl = normalizeApiUrl(session.apiUrl, this.development);
    const photo = parsePhotoOperation(operation);
    if (
      !validPhotoFingerprint(file.fingerprint) ||
      !file.body ||
      file.body.size !== file.fingerprint.byteLength ||
      file.body.type !== file.fingerprint.mimeType
    )
      throw new PhotoFileError('invalid');
    const form = new FormData();
    form.append('id', photo.id);
    form.append('visitId', photo.visitId);
    form.append('operationId', operation.id.toLowerCase());
    form.append('createdAt', String(photo.createdAt));
    form.append(
      'file',
      file.body,
      `${photo.id}.${file.fingerprint.mimeType === 'image/png' ? 'png' : 'jpg'}`,
    );
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const checkActive = () => {
      if (controller.signal.aborted) throw new Error('photo response timed out');
    };
    const json = async (response: Pick<Response, 'body'>): Promise<unknown> => {
      checkActive();
      reader = response.body?.getReader();
      if (!reader) throw new Error('missing photo response body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        checkActive();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 64 * 1024) throw new Error('oversized photo response');
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    const readResponse = async (): Promise<PhotoAcknowledgement> => {
      const response = await this.send(`${apiUrl}/api/visit-photos`, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${session.token}` },
        body: form,
      });
      if (controller.signal.aborted) {
        // A transport can settle after the deadline. Its response must never become an ACK.
        void response.body?.cancel().catch(() => {});
        checkActive();
      }
      if (!response.ok) {
        let code: unknown;
        if (response.status === 400 || response.status === 413) {
          try {
            const failure = await json(response);
            if (record(failure)) code = failure.code;
          } catch {
            // An incomplete rejection cannot classify a file as permanently unsupported.
          }
        }
        checkActive();
        if (response.status === 400 && code === 'INVALID_IMAGE')
          throw new PhotoFileError('invalid');
        if (response.status === 400 && code === 'INVALID_FILE_TYPE')
          throw new PhotoFileError('unsupported');
        if (response.status === 413 && code === 'FILE_TOO_LARGE')
          throw new PhotoFileError('tooLarge');
        throw new AuthError(
          response.status === 401
            ? '다시 로그인한 뒤 사진 백업을 확인해 주세요. 대기 기록을 보존했습니다.'
            : response.status === 409
              ? '사진 또는 부모 방문의 서버 상태와 충돌했습니다. 대기 기록을 보존했습니다.'
              : '사진을 전송하지 못했습니다. 원본과 대기 기록을 보존했습니다.',
          response.status,
        );
      }
      const value = await json(response);
      checkActive();
      return validatePhotoAcknowledgement(value, operation, file.fingerprint);
    };
    // Native text()/json() can remain pending after a response-body error. Read
    // the stream directly and bound the entire request even if abort is ignored.
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error('photo request timed out'));
        controller.abort();
      }, 30000);
    });
    try {
      return await Promise.race([readResponse(), deadline]);
    } catch (error) {
      if (error instanceof AuthError || error instanceof PhotoFileError) throw error;
      throw new AuthError('사진 저장 응답을 받지 못했습니다. 원본과 대기 기록을 보존했습니다.');
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if (reader) {
        // Never await native cancellation: a stuck cleanup must not pin the queue.
        void reader.cancel().catch(() => {});
        try {
          reader.releaseLock();
        } catch {
          /* A native reader may still be finishing its pending read. */
        }
      }
    }
  }
}
