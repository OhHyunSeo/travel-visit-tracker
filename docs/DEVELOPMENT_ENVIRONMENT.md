# 개발 환경과 버전 관리

작성일: 2026-10-11  
연결 작업: [P1-01~P1-05](../PROJECT_PLAN.md), [진행 기록](../PROGRESS.md)  
상태: iOS·Android Debug 빌드 성공, Android 실행과 양쪽 실기기 수용 시험 검증 중. 아래 최초 조사와 최신 구성 결과를 구분해 기록한다.

## 1. 추천 기준

React Native + Expo 개발 빌드 + TypeScript를 사용한다. Expo Go는 이번 앱의 네이티브 지도와 백그라운드 위치 검증 환경으로 사용하지 않는다.

| 항목                  | 시작 기준                                            | 확정 방법                                                             |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| Node.js               | 24 LTS                                               | 정확한 패치를 선택하고 `.nvmrc` 등으로 고정                           |
| 패키지 관리           | npm, 단일 lockfile                                   | 앱과 서버 각각 lockfile 보존, 이후 재현 설치에 `npm ci` 사용          |
| Expo                  | SDK 57 호환 최신 패치, Xcode 27 사용 시 최소 57.0.23 | 양쪽 개발 빌드 성공 후 고정                                           |
| React Native, React   | 해당 Expo SDK가 지정한 버전                          | 별도로 최신 버전을 섞지 않고 Expo 호환성 검사                         |
| MapLibre React Native | v11을 시작 후보로 사용                               | 새 아키텍처, Expo 플러그인, 실제 기기 렌더링 확인 후 정확한 버전 고정 |
| iOS                   | 현재 Xcode 27, Expo SDK 57 기준 최소 iOS 16.4        | 타깃과 모든 네이티브 의존성의 요구사항 확인                           |
| Android               | Android Studio, SDK 36, JDK 17을 시작 기준으로 준비  | 생성된 Gradle 설정과 실제 빌드 요구사항 확인                          |
| Android 최소 버전     | Expo SDK 57 기준 Android 7 이상                      | Expo와 지도 등 모든 의존성 중 높은 최소 조건 적용                     |
| 필수 기기             | iPhone 1대, Android 휴대폰 1대                       | OS, 모델, 절전 설정을 테스트 기록에 남김                              |

버전은 추천 시작점이며 호환성 검증 결과에 따라 조정할 수 있다. SDK를 바꿀 때는 지원 OS, 지도 모듈, 위치 작업, 빌드 도구를 함께 확인한다.

Xcode 27과 SDK 57 조합에서는 Expo의 scene 기반 생명주기 대응을 확인하고, 공식 안내에 따라 `expo-build-properties`의 `ios.enableSceneSupport` 설정을 적용한다. 기존 SDK 54 앱에 해당 설정만 추가하고 호환성이 확보됐다고 판단하지 않는다.

## 2. 최초 조사와 현재 구성

| 항목                 | 2026-10-11 확인 결과                            | 필요한 조치                                          |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Node                 | 25.2.1                                          | LTS 버전으로 전환하고 앱·서버 의존성 확인            |
| npm                  | 10.8.1                                          | 선택한 Node와 함께 버전 기록                         |
| 앱                   | Expo 54.0.30, React Native 0.81.5, React 19.1.0 | 기준 스냅샷 이후 새 골격 또는 단계적 업그레이드      |
| Xcode                | 27.0, 개발자 경로 확인                          | 라이선스와 런타임 준비                               |
| iOS 런타임 조회      | Xcode 라이선스 미동의로 실패                    | 사용자가 Xcode를 열어 약관 확인 후 동의, 이후 재검증 |
| Java                 | Zulu OpenJDK 23.0.2                             | JDK 17 설치 또는 선택, Gradle이 쓰는 경로 확인       |
| Android Studio       | 기본 설치 경로에서 미확인                       | 다른 경로 확인 또는 설치                             |
| Android SDK, adb     | 기본 SDK 경로와 현재 PATH에서 미확인            | SDK 위치 확인, PATH 설정, 기기 인식 확인             |
| watchman             | 현재 PATH에서 미확인                            | 필요 시 설치                                         |
| Android, iOS 앱 실행 | 미실행                                          | P1-04에서 실제 기기 증거 확보                        |

미확인은 전체 컴퓨터에 미설치됐다는 뜻이 아니다. 설치 경로를 확인하고 기록한다. Xcode 약관 동의는 사용자가 직접 진행한다.

### 2026-10-11 구성 이후

- 프로젝트 `.tooling`의 Node 24.21.0, npm 11.21.0을 사용하며 `.nvmrc`를 고정했다. 시스템 Node는 변경하지 않았다.
- 앱: Expo 57.0.27, React Native 0.86.3, React 19.2.3, MapLibre 11.5.0, TypeScript 6.0.3. `package-lock.json`에 설치 결과를 고정했다.
- 사용자 Xcode 약관 동의 후 iOS 27.0 런타임과 시뮬레이터 목록 조회 성공. `ios.enableSceneSupport` 적용.
- Expo Doctor 20/20, typecheck, lint, 자동 테스트 52개 통과. 양쪽 prebuild와 JavaScript/Hermes 번들 생성 통과.
- iOS CocoaPods Debug 설치와 시뮬레이터·실기기 Debug 빌드 성공. 시뮬레이터에서 지도와 방문·사진의 앱 재실행 복원 확인. iPhone 13 Pro / iOS 27.0.1에 Personal Team으로 설치했고, 사용자가 개발자 신뢰 설정 후 앱 화면 연결·자동 기록 켜기를 확인했다.
- Android Studio Rabbit 1(앱 버전 2026.2), 기본 SDK 경로 `~/Library/Android/sdk`, build-tools 35/36, NDK 27.1.12297006, ARM API 37 시스템 이미지와 `Medium_Phone_API_37.0` AVD 확인. 사용자가 초기 SDK 약관에 동의했다. 앱의 compile/target SDK는 36이다.
- 최초 검증한 Studio 내장 JDK 25.0.3 조합은 Worklets Prefab/CMake 단계에서 실패했다. `JAVA_HOME` 변경보다 Studio가 만든 daemon 기준 25가 우선해, 생성된 `gradle/gradle-daemon-jvm.properties`도 17로 변경했다.
- Gradle 9.3.1과 프로젝트 전용 JDK 17.0.20.1+1로 **Android Debug 빌드 성공**, 3분 12초·작업 497개. 로그는 `/private/tmp/trip-painting-android-jdk17-build.log`. 에뮬레이터 부팅과 APK 설치 성공, 앱 화면과 지도·SQLite·위치는 검증 대기다. 시스템 Java나 셸의 전역 설정은 변경하지 않았다.
- JDK 경로는 `.tooling/jdk17/jdk-17.0.20.1+1/Contents/Home`이며 `.tooling/jdk17-home.txt`에도 기록했다. [프로젝트 Expo config plugin](../travel_visit_tracker/plugins/with-gradle-jdk.js)이 prebuild 때 `toolchainVersion=17`을 다시 생성하므로 JDK 기준을 생성 폴더에만 두지 않는다.
- 재개 후 `npm run check`: typecheck·lint PASS, 테스트 5개 파일·67개 PASS. 개별 범위는 체류 판정 22개, SQLite 진단 포함 21개, 수집 생명주기 14개다. 로그는 `/private/tmp/trip-painting-check-resumed.log`. 초기 검사의 52개 PASS와 재개 후 결과를 구분한다.
- 느린 공식 Maven 다운로드를 반복하지 않도록 이번 로컬 iOS Debug 설치는 검증된 캐시의 `RCT_TESTONLY_RNCORE_TARBALL_PATH`, `RCT_USE_LOCAL_RN_DEP`, `HERMES_ENGINE_TARBALL_PATH`를 일회성으로 사용했다. Debug 바이너리만 선택하므로 **Release 빌드 전에 이 변수 없이 정상 `pod install`을 다시 수행한다**. 이 환경 변수는 앱 설정이나 실행 스크립트에 저장하지 않았다.

자세한 빌드 결과와 제한은 [검증 기록](test-results/2026-10-11-foundation.md)에 갱신한다.

사용자가 로컬 네트워크 Metro 접속을 허용했다. 현재 개발 서버는 Mac의 8081 포트를 사용한다. iPhone은 같은 Wi-Fi에서 개발 빌드로 접속한다. 공개 터널이나 클라우드 배포는 사용하지 않는다. Personal Team 개발 프로필은 이번 빌드 기준 2026-10-18 만료이므로 이후에는 재서명·설치가 필요하다.

## 3. 준비 순서

1. **P1-01:** 미커밋 작업, Flutter 백업, 필요한 로컬 DB·사진을 복구 가능한 스냅샷으로 보존한다. 저장 위치를 PROGRESS에 적는다.
2. **P1-02:** Node LTS, Xcode 라이선스·런타임, Android Studio·SDK·JDK, 실기기를 준비한다.
3. **P1-03:** 새 Expo 골격 또는 업그레이드 방식을 확정한다. 기존 샘플 화면을 복사하기 전에 라우팅과 검사 명령을 마련한다.
4. **P1-04:** 지도 한 장과 위치 수집만 연결한 개발 빌드를 양쪽 기기에서 실행한다. 짧은 화면 잠금 시험도 이때 수행한다.
5. **P1-05:** 빌드에 성공한 조합을 고정한다. 이 결과를 기준으로 나머지 일정을 다시 추정한다.

현재 README의 Flutter 실행 명령과 이전 작업 완료 표시는 이 순서의 완료 근거로 사용하지 않는다.

### 구성할 앱 모듈

- 빌드·이동: Expo Router, expo-dev-client.
- 지도: MapLibre React Native와 해당 Expo config plugin.
- 위치: expo-location, expo-task-manager. 작업 등록은 화면 생명주기 밖에서 수행.
- 저장: expo-sqlite, expo-file-system, expo-secure-store.
- 사진: expo-image-picker, 필요 시 expo-image-manipulator.
- 상태: Zustand. 영속 기록의 기준은 SQLite.
- 검사: TypeScript, ESLint, 방문 판정 테스트와 DB·API 통합 테스트 실행 도구.

Expo 모듈은 선택한 SDK에 맞춰 `npx expo install`로 설치한다. MapLibre는 공식 설치 및 플러그인 안내를 따른다. 위치 권한, Android service와 iOS background mode 설정을 app config에 기록한다.

### 검증 명령 예시

다음은 현재 고정한 프로젝트 런타임으로 실행하는 검사 명령이다. 최초 계획 당시 결과와 실제 수행한 결과는 검증 기록에서 구분한다.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker
export PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH"
node --version
npm --version
npx expo-doctor
npx expo install --check
npx tsc --noEmit
```

네이티브 모듈과 설정을 갖춘 후 개발 빌드를 만든다.

```sh
npx expo run:ios
export JAVA_HOME="/Users/oh/Projects/trip_painting/.tooling/jdk17/jdk-17.0.20.1+1/Contents/Home"
export ANDROID_HOME="/Users/oh/Library/Android/sdk"
npx expo run:android
npx expo start --dev-client
```

각 플랫폼의 기기 선택과 설치는 연결 상태에 맞게 진행한다. 지도·권한·네이티브 모듈을 변경하면 빌드를 다시 만든다. JavaScript 업데이트만으로 새로운 네이티브 기능을 추가할 수 없다.

Expo SDK 57의 prebuild 흐름은 네이티브 폴더를 재생성할 수 있으므로 기존 수정을 먼저 보존한다. 지속할 설정은 config plugin, 추가 코드는 로컬 Expo Module에 둔다. 생성 파일만 직접 고친 상태를 기준으로 개발하지 않는다.

## 4. 서버와 개발 연결

기존 Express 서버는 모듈별로 정리해 재사용한다. Node 전환 시 sharp, sqlite3, bcrypt 등 기존 네이티브 의존성의 설치·실행 호환성을 먼저 확인한다.

- 개발 API 주소는 실행 환경별로 기록한다. 실기기의 `localhost`는 Mac 서버 주소가 아니다.
- 개발 중에는 접근 가능한 Mac의 LAN 주소 또는 HTTPS 테스트 서버를 사용한다. 릴리스에는 HTTPS를 사용한다.
- 앱의 `EXPO_PUBLIC_API_URL`에는 공개 가능한 서버 주소만 둔다.
- JWT 비밀값, 서버 관리자 자격증명, Stitch API 키를 앱의 공개 환경 변수나 저장소에 넣지 않는다.
- 현재 서버의 개발용 JWT 기본값은 실제 배포 전에 제거하고 서버 환경 변수로 관리한다.
- SQLite DB와 사진은 서버 재시작·재배포 후에도 남는 저장소에 둔다. 복원 가능한 백업을 시험한다.

앱·서버의 `.env.example`은 값의 형식만 제공하고 실제 비밀값은 포함하지 않는다. 로그인·사진 API는 요청 사용자의 소유권을 검증한다.

## 5. 빌드와 증거 기록

로컬 개발 빌드부터 시작한다. 필요 시 EAS의 development, preview, production 프로필을 구성한다. 스토어 계정, 서명과 EAS 계정 설정은 실제 배포 작업에서 준비한다.

```md
검증일:
작업 ID: P1-04 / P1-05
기준 스냅샷 또는 커밋:
Node / npm:
Expo / React Native / React / MapLibre:
Xcode / iOS target:
JDK / Android SDK / Gradle:
기기 모델 / OS / 절전 설정:
빌드 프로필 / 앱 버전:
실행한 명령과 결과:
지도·위치·화면 잠금 결과:
로그 또는 빌드 파일 경로:
남은 문제:
```

## 6. 공식 자료

- [Expo 개발 빌드](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo SDK 지원 환경](https://docs.expo.dev/versions/latest/)
- [SDK 57와 Xcode 27 설정](https://expo.dev/changelog/sdk-57)
- [MapLibre 설치 요구사항](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/)
- [MapLibre Expo 설정](https://maplibre.org/maplibre-react-native/docs/setup/expo/)
- [Node LTS 상태](https://nodejs.org/en/about/previous-releases)
- [EAS 빌드 환경](https://docs.expo.dev/build-reference/infrastructure/)

## 2026-10-12 종료 시점

최신 `npm run check`는 typecheck·lint와 테스트 73개 PASS다. Android API 37 에뮬레이터를 CPU 4개·호스트 그래픽으로 실행해 지도·방문·사진 재실행 복원과 가상 GPS 300.986초 확정을 확인했다. Android·iOS 생산용 Hermes export도 성공했으며 서명 Release 빌드는 미실행이다. iPhone의 위치 시각 갱신 중 지도 타이머 정지는 미해결이다. Metro와 시험 에뮬레이터는 사용자 요청으로 종료했다. [현재 검증](test-results/2026-10-12-validation.md), [재개 절차](RESUME.md)를 따른다.

## Android 우선 개발과 핫스팟 연결

최신 사용자 지시는 Android Studio로 먼저 진행하고 iPhone 연결이 가능해지면 iOS 검증을 재개하는 것이다. Mac 인터넷은 iPhone 핫스팟이며 앱 개발 연결은 localhost Metro와 `adb reverse`를 사용한다. `npm run android:local`은 에뮬레이터에 8081 포트를 연결하고 기존 서버를 재사용한다. 이번 실제 Metro 리스너는 `127.0.0.1:8081`이다.

화면 잠금 기록의 첫 위치에서 TaskManager의 persisted job에 필요한 `RECEIVE_BOOT_COMPLETED`가 없어 앱이 종료되는 문제를 재현했다. app.config의 Android 권한 선언으로 수정했고 `--offline` Debug 재빌드와 APK 권한 확인, 업데이트 설치가 성공했다. Android 13 이상에서는 사용자 동작 시 기록 알림 권한을 요청하며, 거부해도 위치 기록을 막지 않는다. 관련 [Android 권한 공식 문서](https://developer.android.com/reference/android/app/job/JobInfo.Builder#setPersisted(boolean)), [알림 공식 문서](https://developer.android.com/develop/ui/compose/notifications/notification-permission)를 함께 확인했다.

새 GPS 방문은 화면이 꺼진 상태에서 301.031초 체류 후 저장됐다. 최종 시험과 남은 실제 기기 제약은 [진행 기록](../PROGRESS.md)에 추가한다. 자동 검사는 타입 검사·lint·76개 테스트 PASS이며 이번에는 iOS prebuild와 실기기 설치를 실행하지 않았다.

## iPhone 연결 재개 이후

실제 iPhone 13 Pro/iOS 27.0.1에서 기존 서명 Debug 앱에 최신 JS 소스를 연결했다. foreground 5분 확정·프로세스 재실행 유지, 항상 허용·background 수집과 364초 잠금·5분 확정·잠금 해제 유지 확인. 지역당 카드 하나인 기록 화면을 실제 기기에서 확인했고 최신 타입 검사·lint·90개 테스트 PASS. native 재빌드·재설치 없음. [검증](test-results/2026-10-12-iphone-resume.md).
