# Codex Cloud 준비 검증 — 2026-10-12

## 대상과 보존

- 원격: `https://github.com/OhHyunSeo/travel-visit-tracker`, 기존 공개 저장소. 기본·통합 브랜치 `master`, 작업 브랜치 `codex/<topic>`.
- 작업 시작 시 로컬과 원격은 `0d42b91`의 Flutter MVP 상태였으며 PC에 Expo 전환 및 백엔드 확장 미커밋 변경이 있었다. 이 소스와 참고 폴더를 함께 커밋 대상으로 준비했다.
- 생성된 현재 앱의 `ios/`, `android/`, 도구 런타임·스냅샷, 환경 값, DB, 업로드 사진과 기기 증거 파일은 Git에 포함하지 않는다. 기존에 추적되던 현재 앱의 iOS 생성 경로도 인덱스에서 제외한다. PC의 파일은 유지한다.
- 공유 문서의 실제 방문 지역명과 LAN 주소는 일반 표현으로 변경했다. 문서 원문은 로컬 `.snapshots/20261012-before-cloud-readiness-docs/`에 보존했다. 기존 기기 증거는 로컬 `docs/test-results/`에 유지한다.

## 실행 결과

macOS의 Node 24.21.0, npm 11.21.0에서 실행했다. 개인 파일을 제외한 소스 193개를 별도 임시 폴더에 복사했고, 실제 환경 파일 없이 `.env.example` 두 개만 포함했다. 이 숫자는 검증 문서·마지막 문서 수정 전의 복사본 기준이다.

| 검증 | 결과 |
| --- | --- |
| 기존 앱 `npm run check` | 타입 검사, ESLint, 6개 파일·90개 테스트 PASS |
| 깨끗한 소스 `bash scripts/setup-cloud.sh` | mobile 1,005개, backend 296개 패키지 `npm ci` 성공, lockfile 변경 없음 |
| 깨끗한 소스 `bash scripts/verify-cloud.sh` | 타입 검사, lint, 90개 테스트, backend syntax, 네이티브 모듈 로딩 PASS |
| Android·iOS JS/Hermes export | 둘 다 PASS, 실제 `.hbc` 번들 생성 |
| 임시 backend API smoke check | `/health`, 한국 GeoJSON·ETag, 합성 계정 가입·JWT·`/api/auth/me` PASS |
| 기존 backend DB 보존 | smoke check 전후 파일 해시 일치, 실제 DB로 서버 실행하지 않음 |
| ignore 규칙 | 환경 파일, DB, 인증서·키, 업로드, 생성 네이티브 경로, 기기 덤프·캡처 제외 확인, 예시 환경 파일 허용 |
| 후보 소스 비밀 값 점검 | GitHub/API 토큰과 private-key 패턴, Apple signing team 상수 없음. Android 에뮬레이터 표준 주소 주석은 개인정보가 아님 |
| CI 액션 버전 | 기존 `actions/checkout@v7`, `actions/setup-node@v7` 태그 존재 확인 |

CI는 Ubuntu에서 같은 설치·검증 스크립트를 실행하도록 보완했다. GitHub에서 실행되는 결과는 해당 커밋의 Actions run을 확인한다. 로컬 macOS 설치 성공은 Linux Cloud 설치 성공을 대신하지 않는다. 실제 Codex Cloud 환경 생성·게시·새 작업 시작은 사용자 계정 화면에서 완료해야 한다.

## 남은 제한

- 이번 검증에서 APK/AAB/IPA 생성·서명·설치 또는 휴대폰 시험을 다시 실행하지 않았다. export는 JS/Hermes 결과만 검증한다.
- 실제 GPS, 위치 권한 변화, 장시간 화면 잠금, 경계 이동, 사진, 배터리와 standalone Release는 별도 휴대폰 수용 시험 대상이다. 현재 앱에는 걸음 센서·건강 데이터 기능이 없으며 추가 시 센서와 OS 권한 시험이 필요하다.
- backend는 별도 자동 테스트 스크립트가 없다. 이번 smoke check는 합성 계정과 임시 DB를 사용하며 전체 API·보안·동기화 검증은 아니다.
- npm audit 읽기 전용 확인: mobile **29개** (moderate 10, high 19), backend **26개** (low 2, moderate 4, high 18, critical 2). 설치 과정에서도 구형 의존성 경고가 있었다. 호환성을 깨뜨리는 자동 수정·버전 전환은 수행하지 않았다. Cloud 준비 통과와 운영 배포 준비를 구분하며, 출시 전 의존성 검토가 남아 있다.
- Cloud 검사에 사용자 API 키·Apple 팀·기존 JWT 비밀 값은 필요하지 않다. backend 인증 작업 때만 새 테스트용 `JWT_SECRET`을 공급한다.
