# 최신 병렬 개발 안내

2026-10-12 추가 갱신: 현재 채팅은 codex/common-ios의 공통·iOS, 별도 Android 개발·검증 채팅은 독립 worktree의 codex/android-native 담당이다. [역할·통합·캐시 보존 규칙](PARALLEL_DEVELOPMENT.md)을 먼저 읽는다. Android는 localhost 8082, iOS는 기존 8081을 유지한다. Android 원본 시험 자료는 해당 worktree에 있으며 전체 진행 문서는 공통 채팅에서 통합한다.

- 현재 체크리스트 19/54. P3-06 서버 인증·사진 소유권 기반 및 20개 backend 통합 검사 완료. 모바일 90개, 양쪽 생산용 JS/Hermes export PASS. 실제 앱 로그인·백업·UUID sync와 G3는 미완료다.
- iPhone 30분 잠금 시험은 진행 중이다. app/와 공통 src/의 라이브 변경은 시험 종료 뒤 적용해 reload 영향을 피한다. 사용자 DB·사진·원시 좌표 복사 없음.
- 확인된 inactive 프로젝트 Xcode 캐시와 완료된 임시 Cloud 의존성·생성물만 정리했다. 기존 앱/APK·백업·스냅샷·소스·개인 데이터·서명·로그를 보존했다. Time Machine snapshot은 삭제하지 않았다.
- Android 보고에서 절전 안내 누락과 초기 제주 viewport를 제안했으며 공통 담당이 준비·적용·검증한다. Android가 직접 공통 소스를 편집하지 않는다.
- 아래 18/54, 6분 잠금·이전 source 상태는 앞선 시점의 이력이다. 최종 30분 결과와 통합 커밋을 PROGRESS와 새 검사 기록에서 우선한다.

# 개발 재개 안내

> 2026-10-12 Cloud 준비 갱신: 설치·검증, GitHub 브랜치와 PC ↔ Cloud 전환은 [루트 README](../README.md)와 [Cloud 준비 검증](test-results/2026-10-12-cloud-readiness.md)을 우선한다. 기존 기기 증거는 원래 PC에만 남으며 Cloud에는 아래 요약과 소스를 공유한다. 이 문서 아래의 미커밋·Git 읽기 전용 설명은 준비 전 이력이다. 실제 방문 지역과 LAN 주소는 공유용 표현으로 바꾸었고 문서 원문은 로컬 스냅샷에 보존했다.

마지막 갱신: 2026-10-12 20시, Asia/Seoul. **최신 사용자 지시: 이 새 채팅에서 이전 작업을 이어가며, 연결된 iPhone으로 iOS 검증을 재개한다.** 사용자에게 이번 검증 동안 LAN 개발 서버 연결을 허용받았다. 최신 결과는 [iPhone 재개 검증](test-results/2026-10-12-iphone-resume.md)을 먼저 읽는다.

## 다음 작업의 우선순위

1. iPhone의 foreground 실제 301.532초 확정·중복 방지·프로세스 재실행 유지와 background 364.385초 잠금·총 체류 300.001초 확정·추가 관측 중 중복 없음·잠금 해제 유지 확인. P1-04, P2-08 완료, **18/54**. 현재 GPS 방문·outbox 각 5건이다.
2. 사용자 요청한 해당 지역 기록 목록 중복 표시는 초기 계획대로 지역당 카드 한 개로 정리했다. 개별 방문 내역·사진 연결은 상세에 보존했다. 실제 iPhone 목록 1카드·상세 5건 확인. 지역별 grouping·정렬·이전 사진 유지·삭제 영향 회귀 포함 최신 자동 검사 **90개 PASS**.
3. 다음 iOS 시험은 30분 잠금, 실제 경계 이동·재방문, 긴 종료·관측 공백·권한 변화, 배터리·standalone Release이다. 이번 6분 Debug+USB+읽기 전용 inspector 결과로 전체 수용 시험을 통과시키지 않는다. 개인 기록을 삭제하거나 실제 위치를 가상 위치로 덮어쓰지 않는다.
4. Android 에뮬레이터는 중단 상태다. 복구 시 API 37/CPU 4개/host 그래픽 재시작 실패를 먼저 확인한다. 새 건강 점검 코드의 권한/GPS·공백·알림 거부·절전 native 검증은 대기다.
5. 이번 foreground 체류 재시작은 사용자가 확인한 앱 전환/잠금과 DB 중단 사유가 일치했다. 더 오래된 ‘위치 시각은 갱신되는데 지도 초가 늘지 않는’ 보고의 원인은 미확정이며 이번에는 재현되지 않았다. G1~G4는 실제 Android 기기·전체 성능·나머지 시나리오가 남아 미통과다.

## 현재 개발 연결

- Metro LAN 8081, Mac 주소 `<현재 Mac LAN 주소>`. 동적 주소이므로 재개 때 다시 확인한다. 공개 터널 없음. 이번 검증 동안의 LAN 허용이다.
- 기존 서명 앱에 최신 JS 소스를 연결했다. native 재빌드·재설치 없음. 앱은 화면 잠금 기록(background), GPS 방문·outbox 각 5건, 기록 목록은 수집 지역 카드 1개다.
- 읽기 전용 inspector 조회로 좌표·지역 ID·UUID·사진 경로를 제외한 진단 요약만 저장했다. 개인 DB·사진 복사 없음. 화면 확인용 원본 캡처는 임시 파일이며 보존하지 않는다.
- 최신 자동 검사: typecheck·lint·90개 PASS. `.snapshots/20261012-iphone-background-region-source/`에 소스·문서와 압축 검증을 보존한다.
- 아래 ‘개발 서버와 가상 기기’와 오래된 iPhone 설명은 이전 중단 시점의 이력이다. 현재 지시와 상태는 위 내용 및 최신 검증 문서를 우선한다.

## 저장 상태와 확인된 기반

- 저장소: `/Users/oh/Projects/trip_painting`. 기존 미커밋 변경이 많다. 초기 복원은 `.snapshots/20261011-151329-before-expo-rebuild`, 오전 최종 소스는 `.snapshots/20261012-final-source`, 이번 Android 수정 소스는 `.snapshots/20261012-android-background-source`, 마지막 체크리스트·건강 점검 소스는 `.snapshots/20261012-checklist-health-source`. 기존 변경을 reset하거나 상위 프로젝트에 Git을 초기화하지 않는다.
- 최신 소스·문서 스냅샷: `.snapshots/20261012-iphone-background-region-source/`. 직전 260개 소스 스냅샷은 `.snapshots/20261012-iphone-resume-source/`에 보존했다.
- 현재 완료: P1-01, P1-02, P1-03, P1-05, P1-06, P1-08, P1-09, P1-10, P1-11, P1-12, P2-01, P2-03, P2-04, P2-06, P2-10, P2-02를 포함해 P1-04, P2-08을 추가해 총 18/54. G1~G4 통과 전. Android 실제 휴대폰은 없다.
- 현재 최신 자동 검사: typecheck·lint와 테스트 90개 PASS. 이전 87개는 Android 건강 점검 이후 결과다. 활성 화면의 권한/GPS/공백 점검과 SQLite 후보 만료 회귀 11개를 추가했다. 이전 76개와 native 검증 이력은 PROGRESS에 남겼다.
- Android Debug 재빌드: 캐시만 쓰는 `--offline`, `BUILD SUCCESSFUL in 4m 2s`, 작업 497개. APK의 RECEIVE_BOOT_COMPLETED와 POST_NOTIFICATIONS 선언 확인 및 업데이트 설치 성공. [빌드 증거](test-results/2026-10-12-android-background-build.json).
- background 위치 시작 후 첫 관측에서 앱이 죽던 원인은 persisted JobScheduler에 필요한 RECEIVE_BOOT_COMPLETED 누락이었다. 설정에서 고쳐 prebuild와 재빌드로 반영했다. 새 가상 지역에서 후보가 진행되고 서비스 알림이 표시됨을 확인했다. 화면 꺼짐 중 301.031초 확정과 중복 방지, 기록 끄기·재실행 복원까지 확인했다.
- 오전 Android 지도·방문·사진 재실행 복원과 가상 GPS 300.986초 확정은 완료했다. iOS 시뮬레이터에서는 이전에 사진 복원과 300.215초 가상 GPS 확정을 확인했다. 이 결과를 실제 여행 수용 시험으로 표시하지 않는다.
- iPhone 13 Pro / iOS 27.0.1 서명 빌드·설치·실행 성공 이력은 있다. 개발자 모드·Apple 로그인·프로필 신뢰는 사용자가 이미 완료했다. 지금 연결 여부는 다시 요구하지 않는다.

## 개발 서버와 가상 기기

이번 사용자 중단 요청으로 Metro와 시험 에뮬레이터를 종료했다. 8081 리스너 없음과 adb 기기 없음 확인. 직전 Android 개발 서버는 `127.0.0.1:8081`에 바인딩돼 있었다. adb reverse로 에뮬레이터 안의 같은 주소를 Mac에 연결하므로 핫스팟 IP가 바뀌어도 해당 연결에는 영향이 없다. 공용 인터넷 터널은 만들지 않았다.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker
PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH" npm run android:local
```

가상 기기를 먼저 실행한다. 이 명령은 기존 Metro가 있으면 중복 서버를 띄우지 않고 앱을 연결한다. 서버를 처음 시작했을 때는 개발 앱의 수동 주소에 `http://127.0.0.1:8081`을 입력한다. 명령은 에뮬레이터만 대상으로 한다.

| 대상 | 이번 실행과 로그 |
| --- | --- |
| Metro | 종료 확인. 이전 localhost 8081 로그 `/private/tmp/trip-painting-metro-android-local.log` |
| Android 가상 기기 | 종료 확인, adb 기기 없음. 재시작 실패 로그 `/private/tmp/trip-painting-android-health-emulator.log` |
| Android 재빌드 | 완료. `/private/tmp/trip-painting-android-background-fix-build.log` |
| iOS | 이번에는 빌드·설치·실기기 시험을 실행하지 않았다 |

프로세스와 임시 로그는 Mac 재부팅 이후 사라질 수 있으므로 중복 실행 전에 실제 상태를 조회한다. 사용자 승인한 LAN 접속은 유지하며 iPhone을 연결할 때 별도로 서버를 LAN 모드로 실행할 수 있다. 이전 Wi-Fi 주소 `<이전 Mac LAN 주소>`를 현재 핫스팟 주소로 가정하지 않는다.

## Android 재실행 명령

1. `android/app/build/outputs/apk/debug/app-debug.apk`는 기존 ARM 에뮬레이터에 `install -r`로 설치 성공했다. 앱을 실행해 개발 서버를 연결한다. APK 생성·설치 성공과 앱 화면·기능 실행 성공을 별도로 기록한다.
2. 지도·SQLite·사진 재실행 복원과 가상 위치 확정은 완료했다. 화면 꺼짐 중 연속 기록·서비스 알림·끄기 시험도 완료했다. 남은 권한 변경과 전체 경계 성능을 검증한다. 이미 진행 중인 기기 시험이 있다면 중복 실행하지 않는다.
3. 네이티브 변경으로 다시 빌드할 때는 다음 JDK 17 명령을 사용한다. 시스템 Java와 전역 셸 설정은 바꾸지 않았다.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker/android
JAVA_HOME="/Users/oh/Projects/trip_painting/.tooling/jdk17/jdk-17.0.20.1+1/Contents/Home" \
ANDROID_HOME="/Users/oh/Library/Android/sdk" \
PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH" \
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

Studio 내장 JDK 25에서는 Worklets Prefab/CMake 단계가 실패했다. Studio가 생성한 `gradle/gradle-daemon-jvm.properties`의 기준이 `JAVA_HOME`보다 우선했으므로 기준도 17로 변경했다. [Expo config plugin](../travel_visit_tracker/plugins/with-gradle-jdk.js)이 prebuild 때 `toolchainVersion=17`을 생성한다. JDK 선택 경로는 `.tooling/jdk17-home.txt`에 저장했다.

`android/local.properties`에 SDK 경로를 기록했고 생성 폴더 전체는 Git ignore 대상이다. 처음 설치된 API 37 시스템 이미지와 앱 compile/target SDK 36은 별개다. SDK 라이선스는 이미 사용자가 수락한 항목만 자동 설치에 이용했으며 `yes | sdkmanager --licenses` 같은 일괄 동의는 실행하지 않았다. 사용자는 Android 실기기를 보유하지 않아 에뮬레이터 결과를 실기기 결과로 쓰지 않는다.


CPU 1개 AVD 실행에서 지연이 있었으므로 다음에는 확인된 CPU 4개 옵션을 사용한다. AVD 기본 파일은 변경하지 않았다. 이전 시험 데이터가 남아 있으므로 foreground 자동 기록 설정도 재개 시 확인한다.

```sh
/Users/oh/Library/Android/sdk/emulator/emulator \
  -avd Medium_Phone_API_37.0 -no-snapshot -no-boot-anim \
  -cores 4 -gpu host -qt-hide-window -grpc-use-token
```

## iPhone 체류 재시작 현상 확인

- 사용자 확인: foreground 모드, 오후 4시경 방문 기록 유지, 새 체류 확인 진행. 새 진단 화면에서 실제 수집 방식 ‘앱을 화면에 연 동안’, 마지막 체류 재시작 ‘아직 없음’을 사용자에게 확인받았다. 진단 추가 전 현상을 소급해 설명하지 않는다. 사용자 위치 좌표는 필요하지 않다.
- 최신 사용자 답변: 기존 방문 2개 유지, 지도 초 증가 없음, 설정은 위치 수신 중이며 마지막 위치 시각이 오전 09:01:10 이후 계속 갱신, 오차 약 6m. 수신·후보 갱신·확정·지도 렌더링을 구분해 확인한다. 현재 원인은 미확정이다.
- 현재 정책: 연속 300초, 정확도 최대 50m, 관측 공백 최대 120초, 오래된 위치 최대 120초. 경계와 정확도 반경이 겹치거나 긴 공백이 생기면 후보를 초기화한다.
- 실내 GPS 불안정, foreground 모드에서의 실제 background 전환, 관측 공백과 경계 오차는 가능한 원인이다. 아직 현장 원인을 확정하지 않았다. 이미 저장한 방문은 체류 후보가 초기화돼도 남는다.
- 재현한 코드 문제: 오래된 중복 이벤트를 stale 검사보다 먼저 무시하도록 변경했고, iOS의 단순 `inactive`에서는 후보를 삭제하지 않도록 했다. 실제 background에서는 foreground 수집을 중단하며 시작·중단·생명주기 작업은 직렬 실행한다. 제거·교체된 수집기의 늦은 콜백과 저장 실패는 세대 검사로 SQLite 트랜잭션 안에서도 무시한다. 장치 시각 역행과 새로운 stale 이벤트 거절은 유지한다.
- 설정의 진단 정보에는 마지막 위치 시각·정확도·관측 간격·수신 지연, 마지막 초기화 이유·시각과 실제 수집 모드만 저장한다. 좌표·지역명은 저장하지 않으며 다음 정상 관측과 DB 재개방 후에도 초기화 이유를 유지한다. 이 정보로 현장 관측을 구분하고 [검증 기록](test-results/2026-10-11-foundation.md)에 추가한다.
- 실제 사진 선택, 30분 화면 잠금, 배터리 시험은 미완료다. [수용 시험](ACCEPTANCE_TESTS.md)의 실기기 결과를 가정으로 체크하지 않는다.

## iOS 빌드 주의

- 시뮬레이터 앱: `travel_visit_tracker/.build/ios/Build/Products/Debug-iphonesimulator/TripPainting.app`.
- iPhone 앱: `travel_visit_tracker/.build/device/Build/Products/Debug-iphoneos/TripPainting.app`.
- 로그: `/private/tmp/trip-painting-ios-build.log`, `/private/tmp/trip-painting-iphone-build.log`.
- Apple 서명 팀은 Git 제외·권한 0600인 앱 `.env.local`의 `APPLE_TEAM_ID`. 키·팀 정보를 문서나 공개 앱 환경 변수로 복사하지 않는다.
- 이번 Personal Team 프로필은 2026-10-18 만료, 이후 재서명·설치 필요.
- 느린 Maven 다운로드 때문에 이번 **Debug** pod 설치에 검증된 로컬 tarball을 일회성 선택했다. `RCT_TESTONLY_RNCORE_TARBALL_PATH`, `RCT_USE_LOCAL_RN_DEP`, `HERMES_ENGINE_TARBALL_PATH`는 저장된 실행 설정에 없다. **Release 빌드 전에는 해당 변수 없이 정상 pod install을 재실행**한다. 지금 Pods가 Debug 전용임을 잊지 않는다.

## 코드와 데이터의 현재 범위

Expo 57.0.27, RN 0.86.3, React 19.2.3, MapLibre 11.5.0, TypeScript 6.0.3. Node 24.21.0 / npm 11.21.0은 프로젝트 `.tooling`에만 설치했다. 이전 Expo 화면은 `prototype_reference/expo/`, 기존 Flutter 백업은 별도 폴더에 보존했다.

지도·지역 검색·상세·기록·수집·설정, 기기 SQLite, 사진 영속 저장, 연속 관측 판정, 권한과 foreground/background 수집 기반은 구현했다. 경계는 geoBoundaries 2020년 개발 자료 실제 228개이며 최신 출시 팩·안정적 지역 ID 검증은 남았다. 도로 지도 다운로드, 로그인·서버 동기화는 연결 전이다. npm audit 29개 경고는 SDK 호환성을 깨뜨리는 강제 downgrade 없이 남겨 두었고 출시 전 재검토한다.

파일을 저장한 상태이며 Git commit·push·배포는 하지 않았다. `.git`은 현재 읽기만 허용된다. 최신 계획과 실제 결과는 [PROJECT_PLAN](../PROJECT_PLAN.md), [PROGRESS](../PROGRESS.md), [종료 검증 기록](test-results/2026-10-12-validation.md)을 함께 확인한다.

직전 채팅 종료 때 Metro와 에뮬레이터는 종료했다. 당시 Android 자동 기록은 꺼져 있었고 새 Android native 시험은 완료하지 못했다. 이번에는 위의 iPhone 개발 서버를 재개했다. 앱·기기 데이터는 삭제하지 않았다. [최신 상태](test-results/2026-10-12-android-health.md)가 직전 실행 중 안내보다 우선한다.
