import { AuthError, normalizeApiUrl, type Session } from './authClient';
import { photoPage, remotePhoto, visitPage, type RemotePhoto } from '../storage/restore';

export class RestoreFileError extends Error {
  constructor(readonly reason: 'invalid' | 'storage') {
    super(
      reason === 'invalid'
        ? '사진 파일이 서버 정보와 맞지 않습니다.'
        : '사진을 기기에 저장하지 못했습니다.',
    );
  }
}
export type RestoreTransport = typeof fetch;
type ReadRestoreBody = (maxBytes: number, invalid?: Error) => Promise<Uint8Array>;
export class RestoreClient {
  constructor(
    private send: RestoreTransport = fetch,
    private development = false,
  ) {}
  private async request<T>(
    session: Session,
    path: string,
    read: (response: Response, readBody: ReadRestoreBody) => Promise<T>,
    timeout = 10000,
  ): Promise<T> {
    const origin = normalizeApiUrl(session.apiUrl, this.development);
    if (!session.token) throw new AuthError('다시 로그인한 뒤 복원을 눌러 주세요.', 401);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const checkActive = () => {
      if (controller.signal.aborted) throw new Error('restore request timed out');
    };
    const fetchAndRead = async () => {
      response = await this.send(`${origin}${path}`, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (controller.signal.aborted) {
        // Some native transports settle after abort. Never return their late data.
        void response.body?.cancel().catch(() => {});
        checkActive();
      }
      if (!response.ok)
        throw new AuthError(
          response.status === 401
            ? '다시 로그인한 뒤 복원을 눌러 주세요. 기기의 기록은 보관 중입니다.'
            : '서버 자료를 받지 못했습니다. 복원 대기는 보관 중이며 다시 눌러 이어받을 수 있습니다.',
          response.status,
        );
      const readBody: ReadRestoreBody = async (
        maxBytes,
        invalid = new Error('invalid restore response'),
      ) => {
        checkActive();
        reader = response!.body?.getReader();
        if (!reader) throw invalid;
        const chunks: Uint8Array[] = [];
        let count = 0;
        while (true) {
          const next = await reader.read();
          checkActive();
          if (next.done) break;
          count += next.value.byteLength;
          if (count > maxBytes) throw invalid;
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(count);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      };
      const value = await read(response, readBody);
      checkActive();
      return value;
    };
    // Abort alone does not bound native fetch/read/cancel promises.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('restore request timed out'));
        controller.abort();
      }, timeout);
    });
    try {
      return await Promise.race([fetchAndRead(), deadline]);
    } catch (error) {
      if (error instanceof AuthError || error instanceof RestoreFileError) throw error;
      throw new AuthError('서버 연결이나 응답을 확인하지 못했습니다. 복원 대기는 보관 중입니다.');
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Cleanup cannot keep the manual restore button busy indefinitely.
      if (reader) {
        void reader.cancel().catch(() => {});
        try {
          reader.releaseLock();
        } catch {
          /* Native reading may still be pending. */
        }
      } else {
        void response?.body?.cancel().catch(() => {});
      }
    }
  }
  private async json(readBody: ReadRestoreBody): Promise<unknown> {
    return JSON.parse(new TextDecoder().decode(await readBody(256 * 1024)));
  }
  visits(session: Session, after: number) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('잘못된 복원 위치');
    return this.request(session, `/api/visits?after=${after}&limit=100`, async (_, readBody) =>
      visitPage(await this.json(readBody), after),
    );
  }
  photos(session: Session, after: number) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('잘못된 복원 위치');
    return this.request(
      session,
      `/api/visit-photos?after=${after}&limit=100`,
      async (_, readBody) => photoPage(await this.json(readBody), after),
    );
  }
  download(session: Session, metadata: RemotePhoto): Promise<Uint8Array> {
    const photo = remotePhoto(metadata);
    return this.request(
      session,
      photo.originalPath,
      async (response, readBody) => {
        if (
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
          photo.mimeType
        )
          throw new RestoreFileError('invalid');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) !== photo.byteLength))
          throw new RestoreFileError('invalid');
        // Bounded streaming also protects against an incorrect/missing Content-Length.
        const bytes = await readBody(photo.byteLength, new RestoreFileError('invalid'));
        if (bytes.byteLength !== photo.byteLength) throw new RestoreFileError('invalid');
        return bytes;
      },
      30000,
    );
  }
}
