# Trip Painting Backend

현재 Expo 앱의 로그인·백업을 연결하기 전에 준비하는 Express/SQLite 서버입니다. 앱은 아직 이 API를 호출하지 않습니다. 계정 인증, 사용자별 사진 소유권, 공개 개발 경계 팩과 이전 위치점 API를 제공합니다. 방문 UUID 기반 동기화·복원은 후속 작업입니다.

## 실행

Node 24.21.0을 사용합니다. 저장소 루트에서 설치·검증할 수 있습니다.

```sh
bash scripts/setup-cloud.sh
bash scripts/verify-cloud.sh
# backend만 검사
npm --prefix backend test
```

실제 서버를 켤 때에는 명시적인 JWT 비밀값이 필요합니다.

```sh
cd backend
cp .env.example .env
# .env에 새 임의 JWT_SECRET 값을 설정한 뒤
node --env-file=.env server.js
```

`JWT_SECRET`이 없거나 짧거나 이전 기본 문자열이면 DB·업로드 폴더를 만들기 전에 시작을 거절합니다. `.env`와 비밀값은 Git에 넣지 않습니다. 문자열 길이 검사는 임의성·비밀 관리의 대체가 아닙니다. 기존 개발 기본값으로 서명한 토큰은 사용할 수 없으며 다시 로그인해야 합니다.

| 환경 변수 | 의미 |
| --- | --- |
| `JWT_SECRET` | 필수. 새로운 임의 비밀값, 최소 32 UTF-8 바이트 |
| `PORT` | 기본 3000 |
| `HOST` | 기본 `127.0.0.1`. 외부 접속용 바인딩은 명시적으로 설정 |
| `DB_PATH` | 기본 `backend/data/database.sqlite`. 시험은 임시 DB를 사용 |
| `UPLOADS_DIR` | 기본 `backend/uploads`. 운영에서는 영속 저장소 사용 |
| `CORS_ORIGINS` | 허용할 브라우저 origin을 쉼표로 나열. 기본 브라우저 교차 origin 허용 없음. Origin 없는 네이티브 요청은 사용 가능 |

API 시험은 임시 폴더·임시 SQLite·루프백 서버와 합성 이미지에서 실행하며 실제 PC DB, 휴대폰 방문·사진은 읽거나 초기화하지 않습니다.

## API

인증이 필요한 모든 요청에 `Authorization: Bearer <access-token>`을 보냅니다. 사진 URL을 이미지 컴포넌트로 읽을 때에도 이 헤더가 필요합니다.

| 요청 | 동작 |
| --- | --- |
| `GET /health` | 공개 상태 확인 |
| `POST /api/auth/signup` | email, password, username으로 가입. 201, 계정과 토큰 반환 |
| `POST /api/auth/login` | email, password로 로그인. 200, 계정과 토큰 반환 |
| `GET /api/auth/me` | 토큰이 가리키는 실제 계정 확인 |
| `GET /api/geojson/:countryCode` | 공개 경계 팩. 대문자 2~3글자 코드, SHA-256 ETag, 조건부 304 |
| `POST /api/photos` | 인증 후 `multipart/form-data`의 file과 region_id를 받아 해당 사용자의 사진으로 저장 |
| `GET /uploads/:filename` | 토큰 사용자 소유의 원본만 조회 |
| `GET /uploads/thumbnails/:filename` | 토큰 사용자 소유의 썸네일만 조회 |
| `POST /api/trips/sync` | 이전 위치점 API. 인증 사용자 소유의 trip만 허용, 입력 검증 후 전체 배치 원자적 저장 |

새 계정 email은 공백 제거·소문자로 저장합니다. 새 비밀번호는 최소 8글자, bcrypt 입력 제한인 72 UTF-8 바이트 이하입니다. 기존 혼합 대소문자 계정과 이전 긴 비밀번호의 로그인·저장 내용은 보존합니다. JWT는 HS256, issuer, audience, subject, 유효기간과 실제 계정 존재를 검증합니다. 유효하지 않은 토큰은 401입니다.

사진은 JPEG/PNG 입력만 허용하고 10MB 파일 및 2,500만 픽셀 제한을 적용합니다. 정상 이미지는 회전 정보를 반영해 JPEG와 200×200 썸네일로 저장하며 확장자도 `.jpg`입니다. 응답은 id, url, thumbnail_url, region_id, uploaded_at을 포함합니다. 다른 사용자·없는 소유권 정보는 404, 인증 없음은 401입니다. 응답 파일은 `private, no-store`입니다.

이전 `uploads/`의 소유권 정보 없는 파일은 보존하지만 공개하지 않습니다. 기존 사용자에게 임의로 귀속시키거나 삭제하지 않으며, 복원 연결이 필요하면 별도 명시적 매핑 작업을 설계합니다. 저장 중 실패하면 해당 요청이 새로 만든 파일만 정리하고 기존 파일은 그대로 둡니다.

이전 `/api/trips/sync`의 `steps`는 GPS 위치점이며 걸음 수 기능이 아닙니다. 필수 latitude, longitude, local_id와 선택 trip_id, timestamp, accuracy, altitude, type을 받습니다. 최대 1,000개, 타인 trip은 배치 전체를 403으로 거절하고 SQL 실패는 전부 롤백합니다. 이 route에는 방문 UUID 멱등 동기화가 구현되지 않았으므로 Expo outbox를 연결하지 않습니다.

## 데이터 보존과 검증

- `src/database.js`: SQLite 접근 직렬화와 트랜잭션, 외래키, schema version 1. 기존 users/trips/steps를 보존하고 photos 소유권 테이블만 추가합니다. 더 새로운 DB 버전은 거절합니다.
- `src/auth.js`, `src/photos.js`: 인증과 사용자별 사진 접근.
- `src/app.js`, `src/http.js`: 앱 생성, legacy 위치 API, 입력 검증, Express 4의 비동기 오류 전달과 내부 오류 내용 비공개.
- `server.js`: 환경 설정, 루프백 기본 리스너, 종료 시 DB 닫기.
- `tests/`: 실제 HTTP, 임시 DB와 합성 이미지의 통합 검사. 인증, 사용자 격리, 구형 데이터 보존, 실패 파일 정리, 트랜잭션 롤백을 검증합니다.

서버 배포, HTTPS·영속 저장소·백업·복원, 운영 부하와 로그인 요청 제한은 후속 배포 검증 범위입니다. P3-07 이후 앱 로그인·SecureStore·게스트 가져오기와 방문 UUID·응답 유실·삭제 동기화를 연결합니다. 현재 자동 검사로 G3를 통과시키지 않습니다.

Express 오류 처리와 JWT 옵션은 [Express 공식 안내](https://expressjs.com/en/guide/error-handling/)와 [jsonwebtoken 공식 문서](https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback)를 참고했습니다. 설치된 Express 4에서는 Promise 거절을 catch(next)로 명시적으로 전달합니다.
