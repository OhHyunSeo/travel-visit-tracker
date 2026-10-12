# Trip Painting / 발걸음 추적기

여행 중 실제로 머문 행정구역을 지도에 색칠하는 Android, iOS 앱입니다. 현재는 GPS 연속 관측으로 5분 체류를 판정하고 방문, 사진, 통계와 배지를 기기에 저장합니다. 걸음 수 센서, HealthKit, Health Connect 연동은 구현되어 있지 않습니다. 서버 로그인과 백업·동기화는 아직 활성 Expo 앱에 연결하지 않았습니다.

## 구조와 기술

| 경로 | 역할 |
| --- | --- |
| `travel_visit_tracker/` | 현재 앱: Expo 57.0.27, React Native 0.86.3, React 19.2.3, TypeScript 6.0.3 |
| `travel_visit_tracker/app/` | Expo Router 화면 |
| `travel_visit_tracker/src/` | Zustand 상태, 방문 판정, Expo SQLite, 위치·사진 서비스, MapLibre 지도 |
| `travel_visit_tracker/tests/` | Vitest: 판정, 권한, 저장·복원, 사진, 지역별 기록 |
| `travel_visit_tracker/plugins/` | 생성 네이티브 설정을 유지하는 Expo config plugin |
| `backend/` | Express API, SQLite, JWT/bcrypt 인증, Multer/Sharp 사진 업로드 |
| `prototype_reference/`, `travel_visit_tracker_flutter_backup/` | 이전 Expo/Flutter 참고 소스, 현재 실행 대상 아님 |
| `scripts/` | 클라우드 의존성 설치·검증 |
| `docs/`, `PROGRESS.md`, `PROJECT_PLAN.md` | 개발 정책, 상태, 수용 시험 |

Flutter MVP 설명은 이전 버전입니다. 현재 앱에 `flutter pub get`이나 `flutter test`를 실행하지 않습니다. 공개 경계 데이터 출처·라이선스는 [경계 자료 설명](travel_visit_tracker/src/data/README.md)에 있으며, 2020년 개발 자료의 실제 228개 지역을 사용합니다.

## 설치와 실행

Node **24.21.0** (`.nvmrc`)과 npm을 사용합니다. 저장소 루트에서 실행합니다.

```sh
git clone https://github.com/OhHyunSeo/travel-visit-tracker.git
cd travel-visit-tracker
# nvm을 사용하는 경우
nvm install
nvm use
bash scripts/setup-cloud.sh
bash scripts/verify-cloud.sh
```

원래 PC에서 프로젝트 전용 Node를 계속 사용하는 경우, 저장소 루트에서 `export PATH="$PWD/.tooling/node_modules/.bin:$PATH"`를 먼저 실행합니다. `.tooling/`은 Git으로 동기화되지 않습니다. 클라우드에는 Node 버전을 별도로 준비합니다.

| 작업 | 저장소 루트 명령 |
| --- | --- |
| 타입 검사·lint·90개 테스트 | `npm --prefix travel_visit_tracker run check` |
| 테스트만 | `npm --prefix travel_visit_tracker test` |
| 개발 클라이언트용 Metro | `npm --prefix travel_visit_tracker start` |
| Android 네이티브 생성·Debug 실행 | `npm --prefix travel_visit_tracker run android` |
| 설치된 Android 에뮬레이터와 localhost Metro 연결 | `npm --prefix travel_visit_tracker run android:local` |
| iOS 네이티브 생성·Debug 실행 (Mac/Xcode) | `npm --prefix travel_visit_tracker run ios` |
| 웹 화면 미리보기 | `npm --prefix travel_visit_tracker run web` |
| 전체 클라우드 검사·Android/iOS JS 번들 | `bash scripts/verify-cloud.sh` |

Expo Go 대신 개발 빌드를 사용합니다. Android는 SDK와 JDK 17, iOS는 macOS, Xcode, CocoaPods가 필요합니다. 실기기 iPhone 서명에는 Apple 계정·팀·인증서가 필요합니다. 권한 또는 네이티브 모듈이 바뀌면 개발 빌드를 다시 만듭니다. 생성되는 `ios/`, `android/`, `dist/`는 Git에서 제외합니다. 현재 Mac의 SDK/JDK 경로와 기기 연결은 [모바일 README](travel_visit_tracker/README.md), [개발 환경](docs/DEVELOPMENT_ENVIRONMENT.md)을 참고합니다.

백엔드는 앱의 자동 검사를 위해 실행할 필요가 없습니다. 직접 개발할 때만:

```sh
cd backend
cp .env.example .env
# .env의 JWT_SECRET에 새 임의 값을 넣은 후
node --env-file=.env server.js
# 다른 터미널에서: curl http://127.0.0.1:3000/health
```

환경 변수를 셸에 설정했다면 `npm --prefix backend start` 또는 `npm --prefix backend run dev`를 사용할 수 있습니다. 서버는 `.env`를 자동 로드하지 않습니다. 별도 빌드나 자동 테스트 스크립트는 없으며 `node --check backend/server.js`와 격리된 API smoke check로 검증합니다. 기본 JWT 문자열은 개발용 fallback이므로 실제 서비스에 사용하지 않습니다. 상세 API는 [백엔드 README](backend/README.md)를 참고합니다.

## Codex Cloud 설정

GitHub 저장소: [OhHyunSeo/travel-visit-tracker](https://github.com/OhHyunSeo/travel-visit-tracker). 기본·통합 브랜치는 **`master`**이며, 각 작업은 **`codex/<작업명>` → PR → master**로 반영합니다. 기존 저장소는 공개 상태입니다. 실제 환경 값과 개인 자료는 업로드하지 않습니다.

1. Codex 화면의 **Settings → Codex Cloud → Environments → Create environment**에서 GitHub를 연결하고 이 저장소를 선택합니다. 목록에 없다면 GitHub의 설치된 OpenAI/Codex 앱 설정에서 이 저장소 접근을 허용한 뒤 다시 선택합니다. 현재 채팅의 GitHub 커넥터 권한과 Cloud 환경의 저장소 권한은 별도로 확인합니다.
2. 기본 브랜치 `master`, Node `24.21.0`을 사용하고 **Install script**에 `bash scripts/setup-cloud.sh`를 설정하도록 요청합니다. 자동 준비 대화에는 “README와 AGENTS.md를 읽고 Node 24.21.0을 준비한 다음, 저장소 루트에서 설치·검증 스크립트를 실행해줘”라고 입력합니다.
3. 검증 명령은 `bash scripts/verify-cloud.sh`입니다. 앱 자동 검사에는 서비스 시작이 필요하지 않습니다. 준비 결과를 확인하고 환경을 **Publish**, 수정 후에는 **Republish**합니다. 새 작업 시작 시 GitHub의 최신 브랜치·커밋을 확인합니다.
4. 모바일에서도 같은 계정으로 이 Cloud 환경을 선택해 작업을 요청합니다. 예: “최신 master에서 codex/visit-history 작업 브랜치로 기록 화면을 수정해줘. AGENTS.md의 검증을 실행하고 master 대상 PR을 만들어줘.”

현재 Cloud UI의 준비·게시 절차는 [공식 Cloud 환경 문서](https://learn.chatgpt.com/docs/environments/cloud-environments)를 기준으로 합니다. 이전 UI에서 **Setup script** 필드가 보이면 같은 설치 명령을 쓰고, **Maintenance script**가 있다면 같은 명령으로 lockfile 변경을 반영합니다. 패키지 변경 후에는 준비 환경의 설치를 다시 실행하고 새 작업을 시작합니다. 캐시나 Cloud 작업 파일은 PC의 미커밋 변경을 자동으로 가져오지 않습니다.

### 환경 변수

**모바일 타입 검사, 테스트, JS 번들 생성에는 사용자 API 키나 필수 앱 환경 변수가 없습니다.** Cloud의 일반 환경 변수로 `CI=1`, `EXPO_NO_TELEMETRY=1`을 사용할 수 있습니다. 검증 스크립트도 설정합니다. 의존성 설치 중에는 `NODE_ENV=production`을 설정하지 않는 편이 좋습니다.

| 이름 | 용도 | Cloud 필요 여부 |
| --- | --- | --- |
| `CI`, `EXPO_NO_TELEMETRY` | 비대화형 검사·Expo 텔레메트리 비활성화 | 권장, 검증 스크립트에 포함 |
| `APPLE_TEAM_ID` | 로컬 iPhone 서명 팀, `travel_visit_tracker/.env.example` 참고 | 불필요, PC `.env.local`에서만 설정 |
| `PORT` | 백엔드 포트, 기본 3000 | 백엔드 실행 시 선택 |
| `NODE_ENV` | 백엔드 실행 모드 | 백엔드 실행 시 선택 |
| `JWT_SECRET` | 백엔드 JWT 서명용 임의 비밀 값 | 백엔드 인증 시험 시만 필요 |

백엔드 인증 시험에는 운영 비밀 값 대신 새 테스트용 `JWT_SECRET`을 사용합니다. 이는 프로세스가 직접 읽어야 하는 값이므로 현재 Cloud UI에서는 개인 **Environment variable**로 공급하며, HTTPS 프록시 치환용 **Network secret**에 넣지 않습니다. OpenAI API 키와 Expo/EAS 배포 토큰은 현재 검사에 필요하지 않습니다. 현재 Expo 앱은 `EXPO_PUBLIC_API_URL`도 읽지 않습니다. 향후 `EXPO_PUBLIC_*`에는 공개 가능한 값만 둡니다.

### 네트워크

Cloud 준비 시 **Package managers** 허용 설정을 사용합니다. 설치에는 npm registry와 백엔드 네이티브 바이너리 다운로드가 필요합니다. 부족한 도메인은 설치 로그에 따라 추가합니다.

| 도메인 | 용도 |
| --- | --- |
| `registry.npmjs.org` | npm lockfile 패키지 |
| `nodejs.org` | Node 런타임·네이티브 빌드 헤더 |
| `github.com`, `api.github.com` | 저장소·PR 및 Sharp/bcrypt/sqlite3 release 다운로드 |
| `release-assets.githubusercontent.com`, `objects.githubusercontent.com` | GitHub release 파일 리디렉션 |
| `codeload.github.com` | GitHub 소스 아카이브가 필요할 때 |

패키지 다운로드에는 HTTPS GET/HEAD가 필요합니다. PR 생성 등 직접 GitHub API 쓰기를 사용할 때만 해당 도메인의 필요한 쓰기 메서드를 허용합니다. `verify-cloud.sh` 자체는 `EXPO_OFFLINE=1`로 실행하며 외부 API·지도 다운로드 없이 검사합니다. 백엔드의 Linux 네이티브 모듈 fallback 빌드에는 Python 3, make, C/C++ 컴파일러가 필요할 수 있습니다. Android SDK, Maven, CocoaPods, Expo/EAS 관련 네트워크는 현재 Cloud 검사 범위에 포함하지 않습니다. 실제 지도 타일의 네트워크 검증은 휴대폰에서 수행합니다.

## PC ↔ Cloud 작업 전환

GitHub에는 커밋·푸시한 코드만 전달됩니다. PC의 `.env.local`, 서명 키, SDK, SQLite DB와 사진은 별도로 유지합니다. 같은 작업 브랜치의 파일을 PC와 Cloud에서 동시에 바꾸는 경우 충돌이 생길 수 있으므로 작업별 브랜치를 사용합니다.

### PC에서 시작하거나 Cloud로 넘길 때

```sh
git status --short --branch
# 수정 사항이 없는 상태에서 최신 통합 코드 받기
git switch master
git pull --ff-only origin master
git switch -c codex/my-task
# 개발 후
npm --prefix travel_visit_tracker run check
git diff
# 필요한 파일만 선택해 추가
git add <수정한-파일>
git diff --cached
git commit -m "Describe the change"
git push -u origin codex/my-task
```

Cloud에 **같은 브랜치 `codex/my-task`에서 이어 작업**하도록 요청하거나, 이 PR을 master에 반영한 후 최신 master에서 새 작업을 요청합니다. 이동 전에는 `git status`로 누락된 변경을 확인합니다. `.gitignore`를 우회해서 환경 파일이나 기기 자료를 올리지 않습니다.

### Cloud 결과를 PC에서 검토할 때 (PR 병합 전)

```sh
git status --short --branch
# 현재 수정 사항은 먼저 해당 작업 브랜치에 커밋하거나 임시 보관
git fetch origin
git switch --track origin/codex/cloud-task
# 이 브랜치가 이미 PC에 있다면 switch 후 git pull --ff-only 사용
bash scripts/setup-cloud.sh
bash scripts/verify-cloud.sh
```

PR diff와 자동 검사 결과를 확인하고, GPS·권한·네이티브 변경이 있으면 PC에 연결한 휴대폰에서 검증합니다. 이후 GitHub PR 화면에서 **base: master**와 변경 범위를 확인해 merge합니다. 모바일에서도 GitHub의 PR을 검토·병합할 수 있습니다.

### PR을 master에 반영한 후 PC에서 이어갈 때

```sh
git status --short --branch
# 현재 변경을 보존한 후
git switch master
git pull --ff-only origin master
bash scripts/setup-cloud.sh
npm --prefix travel_visit_tracker run check
git switch -c codex/next-task
```

미커밋 작업 때문에 전환이 막히면 현재 브랜치에서 WIP 커밋하거나 `git stash push -u -m "before switching workspace"`로 보관합니다. stash는 GitHub에 올라가지 않으므로 Cloud로 넘길 코드에는 커밋·푸시를 사용합니다. `pull --ff-only`가 분기로 실패하면 `git fetch origin` 후 양쪽 변경을 확인하고 merge 또는 rebase로 충돌을 해결합니다. `reset --hard`, `clean -fdx`, 강제 푸시는 사용하지 않습니다. 네이티브 의존성이나 app config가 바뀌었으면 Android/iOS 개발 빌드도 재생성합니다.

## 검증 범위와 자료 보존

최신 Cloud 준비 검증은 [2026-10-12 결과](docs/test-results/2026-10-12-cloud-readiness.md)에 기록합니다. JS/Hermes export는 서명된 APK/AAB/IPA 또는 실기기 실행 검증이 아닙니다. GPS 정확도·권한 거부/회수, 장시간 잠금·프로세스 종료, 실제 사진, 경계 이동·재방문, 배터리와 standalone Release는 [실기기 수용 시험](docs/ACCEPTANCE_TESTS.md)에 따라 별도 확인합니다. 향후 걸음 수·건강 데이터 기능도 실제 센서와 OS 권한 시험이 필요합니다.

`.gitignore`는 환경 파일, 인증서·키, DB·사진 업로드, 빌드 결과, 도구 캐시와 스냅샷을 제외합니다. 원래 PC의 `docs/test-results/` 진단 덤프·화면 캡처·기기 보고서는 로컬에 보존하고 이번 Cloud 준비 요약만 공유합니다. 이전 문서의 기기 증거 링크는 원래 PC에서만 열릴 수 있습니다. 공유 진행 문서의 실제 방문 지역과 LAN 주소는 일반 표현으로 바꾸었으며 원문은 로컬 `.snapshots/20261012-before-cloud-readiness-docs/`에 보존했습니다.

- [현재 진행 기록](PROGRESS.md), [계획과 54개 작업](PROJECT_PLAN.md)
- [항목별 완료 상태](docs/CHECKLIST_STATUS.md), [재개 안내](docs/RESUME.md)
- [방문 판정 정책](docs/VISIT_POLICY.md), [개발 규칙](AGENTS.md)
- [MIT License](LICENSE)
