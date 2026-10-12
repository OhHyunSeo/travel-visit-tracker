# 병렬 개발 역할과 통합 규칙

갱신: 2026-10-12, Asia/Seoul. 사용자 승인: 현재 채팅에서 공통 기능과 iOS를 개발하고, 별도 Git worktree 채팅에서 Android 전용 작업을 진행한다. 플랫폼별 변경은 자동으로 동기화되지 않으며 통합 검증 후 반영한다.

## 담당 범위

| 담당 | 수정 담당 | 진행 기록 |
| --- | --- | --- |
| 공통·iOS 채팅 | `app/`, `src/domain/`, `src/storage/`, `src/store/`, 공통 `src/services/`, `app.config.ts`, `backend/`, 공통 검증 스크립트, iOS 설정, 루트 진행·계획·정책 문서 | `PROGRESS.md`, `docs/RESUME.md` |
| Android worktree 채팅 | Android 개발 실행 스크립트, Android 전용 config plugin·테스트, 에뮬레이터·권한·서비스·잠금 검증 | `docs/ANDROID_PROGRESS.md`, 로컬 Android 검증 증거 |

Android가 공통 파일의 수정 필요성을 발견하면 현재 파일을 직접 바꾸기 전에 별도 제안 파일과 근거를 남긴다. 현재 채팅에서 적용·회귀 검증 후 통합한다. `app.config.ts`, `package*.json`, 공통 tracking/repository와 루트 PROGRESS는 양쪽에서 동시에 수정하지 않는다. Android의 공유 진행 문서에는 개인 위치, 기기 식별자, 환경 비밀값을 넣지 않는다.

## 실행 환경

- 공통·iOS는 원래 checkout과 기존 개발 앱·데이터를 사용한다.
- Android는 독립된 소스 worktree와 자체 node_modules/native 생성 폴더를 사용한다. 원래 checkout의 node_modules와 native 빌드 디렉터리를 공유 쓰기하거나 심볼릭 링크하지 않는다.
- Node/JDK의 설치 바이너리와 기존 Android SDK는 읽기 전용으로 재사용할 수 있다. SDK 다운로드·전역 버전 변경은 임의로 하지 않는다.
- 원래 iPhone 연결 Metro 8081을 중지하거나 재사용하지 않는다. Android Metro는 localhost 8082와 `adb reverse tcp:8082 tcp:8082`를 사용한다.
- 기존 AVD 데이터는 보존한다. wipe-data, 사용자 DB 초기화·삭제, 사진 삭제는 하지 않는다. Android 에뮬레이터는 한 채팅만 조작한다.
- 실제 Android 휴대폰이 없으므로 에뮬레이터 결과를 실기기 결과로 기록하지 않는다.

## 통합

1. 각 작업은 기준 커밋, 수정 파일, 검사 결과, native 실행 결과를 남긴다.
2. 변경 범위와 공통 파일 충돌을 확인한다. 합칠 변경을 명시적으로 선택하고, 같은 파일의 서로 다른 변경은 검토해 해결한다.
3. 공통 타입 검사·lint·테스트를 실행한다. 네이티브 설정이 변경됐으면 해당 플랫폼 재빌드·기기 검증을 별도로 수행한다.
4. 검증 증거가 있는 항목만 전체 체크리스트에 반영한다. G1~G4와 실제 기기 조건을 유지한다.
5. 새 PR은 AGENTS.md에 따라 master 대상으로 만들고, 충돌 없는 코드 통합과 검증을 확인한 뒤 반영한다.

## 용량 보존 규칙

사용자는 개발 중 불필요한 캐시 정리를 허용했으며 중요한 자료를 임의로 삭제하지 말라고 지시했다.

- 정리 전 실제 용량, 경로, 재생성 가능성, 사용 중인 프로세스를 확인한다.
- 이번 프로젝트가 만든 사용하지 않는 build intermediate, module/index cache와 완료된 임시 검증의 의존성·생성물만 대상으로 삼는다. 삭제 경로와 확보량을 기록한다.
- 소스, `.snapshots/`, 사용자 DB·WAL·journal, 방문·사진·outbox, 증거·로그, 서명·환경 파일, 설치 가능한 앱/APK, 이전 Flutter 참고 소스는 보존한다.
- 시스템 전체 캐시나 다른 프로젝트 자료를 일괄 정리하지 않는다. 중요성 또는 재생성 가능성을 확정할 수 없는 자료는 그대로 둔다.
- active build나 Metro/기기 시험이 쓰는 폴더는 정리하지 않는다. 같은 캐시를 반복 삭제해 재다운로드와 재빌드 비용을 늘리지 않는다.
