# Trip Painting 모바일 앱

> PC와 Codex Cloud 공통 설치·검증, GitHub 동기화는 [루트 README](../README.md)를 따른다. 아래 `.tooling`과 SDK 경로는 원래 Mac 전용이다. 최신 구현 상태는 [PROGRESS](../PROGRESS.md)를 우선하며 기기 증거 파일은 원래 PC에만 보존한다.

React Native + Expo 개발 빌드 기반의 Android, iOS 앱입니다. 현재 지도, 기기 저장, 방문 판정의 첫 구현입니다. iPhone 빌드·설치·화면 연결과 Android Debug 빌드·설치는 확인했으며 Android 에뮬레이터의 지도·방문·사진 복원과 가상 GPS 확정을 확인했습니다. 실제 GPS와 양쪽 휴대폰 수용 시험은 남아 있습니다. 현재는 iPhone 연결이 어려워 Android Studio로 먼저 개발·검증하고, 연결 가능 시 iOS 타이머 정지 확인을 재개합니다. [재개 안내](../docs/RESUME.md)를 참고하세요.

## 실행

저장소 루트의 `.nvmrc`에 맞는 Node 24.21.0을 사용합니다. 시스템에 Node LTS를 설정하기 전에는 이번 작업에서 설치한 프로젝트 전용 런타임을 사용할 수 있습니다.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker
export PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH"
npm ci
npm run check
npm run ios
```

Android SDK와 프로젝트 전용 JDK 17.0.20.1+1로 Debug 빌드가 성공했습니다. 이 Mac에서는 다음 JDK를 선택해 실행합니다.

```sh
export JAVA_HOME="/Users/oh/Projects/trip_painting/.tooling/jdk17/jdk-17.0.20.1+1/Contents/Home"
export ANDROID_HOME="/Users/oh/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
npm run android
```

Studio 내장 JDK 25에서는 Worklets Prefab/CMake 단계가 실패했습니다. Studio의 Gradle daemon 기준도 `JAVA_HOME`보다 우선하므로 [Expo config plugin](plugins/with-gradle-jdk.js)이 `toolchainVersion=17`을 생성합니다. 선택한 JDK 경로는 저장소 루트의 `.tooling/jdk17-home.txt`에도 기록했습니다. 시스템 전역 Java는 변경하지 않았습니다.

네이티브 지도·위치 기능을 포함하므로 Expo Go에서는 실행하지 않습니다. 네이티브 모듈이나 권한 설정 변경 후에는 개발 빌드를 다시 만듭니다. 현재 상태와 다음 검증은 [재개 안내](../docs/RESUME.md)를 먼저 확인하세요.

iPhone 실기기 서명 팀은 로컬 `.env.local`의 `APPLE_TEAM_ID`로 선택할 수 있습니다. 계정과 인증서 준비는 Xcode의 Apple Accounts에서 진행합니다. 해당 파일과 생성된 서명 설정은 Git에 포함하지 않습니다.

웹은 화면·기록 저장 미리보기입니다. 자동 방문·사진·백그라운드 검증은 휴대폰 앱에서 수행합니다.

```sh
EXPO_OFFLINE=1 npm run web -- --localhost --port 8081
```

## 구현 구조

| 경로            | 역할                                                  |
| --------------- | ----------------------------------------------------- |
| `app/`          | 내 지도, 기록, 수집 현황, 설정, 지역 상세             |
| `src/domain/`   | 위치 판정, 경계 계산, 300초 체류, 수집 통계           |
| `src/storage/`  | SQLite 스키마, 소유자별 기록, 트랜잭션, 전송 대기 큐  |
| `src/services/` | 위치 작업, 권한·수집 모드, 사진 영속 보관             |
| `src/data/`     | 개발용 공개 경계 자료와 출처                          |
| `src/ui/`       | 디자인 토큰, 버튼, 플랫폼별 지도                      |
| `tests/`        | 판정, 저장·복원·중복 방지, 위치 권한과 수집 모드 검사 |
| `plugins/`      | prebuild에서 유지할 Android Gradle JDK 기준           |

화면 타이머로 방문을 확정하지 않습니다. 위치 관측 시각·정확도·지역 포함 여부를 판정하고 후보, 방문과 outbox를 SQLite 트랜잭션으로 기록합니다. 사진은 선택한 원본의 임시 경로 대신 앱 문서 폴더에 복사합니다.

‘기록 설정 → 지금 기록 상태’에서 선택한 방식과 실제 수집 방식, 최근 위치의 정확도·관측 간격·지연, 마지막 체류 재시작 사유와 방문 저장 시각을 확인할 수 있습니다. 진단에는 좌표·지역명을 저장하지 않습니다. 체류를 다시 확인해도 이미 저장한 방문은 남아 있습니다.

개발용 방문은 `development` 출처로 구분하며 서버 전송 큐에 넣지 않습니다. production 스냅샷은 개발 방문과 사진을 제외하고 개발 입력 화면도 숨깁니다.

## 현재 제약

- geoBoundaries의 2020년 자료이며 최신 한국 경계 팩이 아닙니다. 소스는 개수 229를 안내하지만 실제 파일은 228개입니다. 앱 수집 비율은 실제 포함된 228개를 기준으로 계산합니다.
- 번들에 포함된 경계는 연결 없이 표시할 수 있으나 배경 도로·타일 다운로드는 아직 구현하지 않았습니다.
- 방문과 사진은 기기에 저장하며 서버 백업·복원은 아직 연결하지 않았습니다. 앱 삭제 시 기록을 잃을 수 있습니다.
- 위치 정확도 50m, 최대 관측 공백 120초는 초기 보수적 설정이며 실기기 측정 후 조정해야 합니다.
- iOS scene 설정과 네이티브 권한은 app config에서 관리합니다. `ios/`, `android/`는 생성 결과이며 보존할 변경은 config plugin으로 작성합니다. 이 CNG 방식을 사용하므로 Expo Doctor의 native 폴더/app config 중복 경고 검사만 끕니다. SDK·패키지 검사는 유지합니다.

진행 상태는 [PROGRESS](../PROGRESS.md), 상세 범위는 [개발 계획](../PROJECT_PLAN.md), 데이터 출처는 [경계 자료 설명](src/data/README.md)을 확인하세요.

## Android Studio와 핫스팟 환경

현재는 Android 에뮬레이터에서 먼저 개발하고, iPhone 연결이 가능해지면 iOS 실기기 검증을 재개합니다. 인터넷이 iPhone 핫스팟이어도 Android 개발 서버는 Mac의 localhost에 연결합니다.

Android Studio에서 기존 가상 기기를 실행한 뒤 다음 명령을 사용하세요.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker
PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH" npm run android:local
```

이 명령은 `adb reverse tcp:8081 tcp:8081`을 설정하고 localhost Metro를 실행합니다. 이미 서버가 실행 중이면 중복 실행하지 않고 설치된 개발 앱을 해당 서버로 엽니다. 서버를 처음 시작했을 때는 개발 앱의 수동 주소 입력에 `http://127.0.0.1:8081`을 사용할 수 있습니다. iPhone이 나중에 직접 연결할 때는 별도로 LAN 서버 실행과 네트워크 구성을 확인합니다.

에뮬레이터 위치 시험 후 저장 상태를 확인하는 개발 보조 명령은 `python3 scripts/android-test-state.py`입니다. 실제 휴대폰에서는 실행되지 않으며 출력에는 위치 좌표를 포함하지 않습니다. 이는 실제 여행이나 실제 기기 검증 결과가 아닙니다.

## 최근 중단 상태 — 2026-10-12

초기 체크리스트는 근거를 대조해 **16/54 완료**로 갱신했습니다. 새 위치 건강 점검과 후보 만료 코드는 저장됐고 타입 검사·lint·87개 자동 검사는 통과했습니다. 에뮬레이터 실행 복구 후 권한·GPS 변경의 native 화면 검증부터 이어갑니다. 사용자 요청으로 Metro와 시험 에뮬레이터를 종료했으며 iOS는 iPhone 연결 가능 시 재개합니다. [재개 안내](../docs/RESUME.md), [항목별 실제 상태](../docs/CHECKLIST_STATUS.md)를 먼저 확인하세요.
