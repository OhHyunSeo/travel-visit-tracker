export type Account = { id: number; email: string; username: string };
export type Session = { apiUrl: string; user: Account; token: string | null };
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
export function normalizeApiUrl(value: string, development: boolean): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AuthError('올바른 서버 주소를 입력해 주세요.');
  }
  const local =
    /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(
      url.hostname,
    );
  if (
    (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    url.origin.length > 200
  )
    throw new AuthError(
      'HTTPS 서버의 기본 주소를 입력해 주세요. 개발 빌드의 로컬 서버만 HTTP를 허용합니다.',
    );
  return url.origin;
}
export function account(value: unknown): Account {
  const user = value as Partial<Account> | null;
  if (
    !user ||
    !Number.isSafeInteger(user.id) ||
    (user.id ?? 0) <= 0 ||
    typeof user.email !== 'string' ||
    !user.email ||
    user.email.length > 254 ||
    typeof user.username !== 'string' ||
    !user.username ||
    user.username.length > 80
  )
    throw new AuthError('서버의 계정 응답을 확인할 수 없습니다.');
  return { id: user.id!, email: user.email, username: user.username };
}
export function sessionFromJson(value: string, development: boolean): Session {
  let data: Partial<Session>;
  try {
    data = JSON.parse(value);
  } catch {
    throw new AuthError('저장된 로그인 정보를 읽을 수 없습니다.');
  }
  if (
    !data ||
    typeof data.apiUrl !== 'string' ||
    (data.token !== null &&
      (typeof data.token !== 'string' ||
        !data.token ||
        /\s/.test(data.token) ||
        data.token.length > 4096))
  )
    throw new AuthError('저장된 로그인 정보를 확인할 수 없습니다.');
  return {
    apiUrl: normalizeApiUrl(data.apiUrl, development),
    user: account(data.user),
    token: data.token,
  };
}
export const sessionOwner = (session: Session) => `account:${session.apiUrl}:${session.user.id}`;
export class AuthClient {
  constructor(private readonly send: typeof fetch = fetch) {}
  private async request(
    apiUrl: string,
    route: string,
    token?: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.send(`${apiUrl}/api/auth/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok)
        throw new AuthError(
          response.status === 401
            ? '로그인 정보가 만료됐거나 이메일과 비밀번호가 맞지 않습니다.'
            : response.status === 409
              ? '이미 등록된 이메일입니다.'
              : '로그인 요청을 처리하지 못했습니다. 입력과 서버 상태를 확인해 주세요.',
          response.status,
        );
      return await response.json();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('서버에 연결할 수 없습니다. 기기의 기록은 그대로 보관됩니다.');
    } finally {
      clearTimeout(timer);
    }
  }
  async signIn(
    apiUrl: string,
    email: string,
    password: string,
    username?: string,
  ): Promise<Session> {
    const response = (await this.request(
      apiUrl,
      username === undefined ? 'login' : 'signup',
      undefined,
      { email, password, ...(username === undefined ? {} : { username }) },
    )) as { token?: unknown; user?: unknown };
    if (
      !response ||
      typeof response.token !== 'string' ||
      !response.token ||
      /\s/.test(response.token) ||
      response.token.length > 4096
    )
      throw new AuthError('서버의 로그인 응답을 확인할 수 없습니다.');
    return { apiUrl, token: response.token, user: account(response.user) };
  }
  async me(session: Session): Promise<Account> {
    if (!session.token) throw new AuthError('다시 로그인해 주세요.', 401);
    const response = (await this.request(session.apiUrl, 'me', session.token)) as {
      user?: unknown;
    };
    const user = account(response?.user);
    if (user.id !== session.user.id) throw new AuthError('로그인 계정이 일치하지 않습니다.', 401);
    return user;
  }
}
