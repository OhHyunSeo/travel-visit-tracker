# Android 개발·검증 기록

마지막 갱신: 2026-10-15, Asia/Seoul.

10월 15일 새 Debug APK의 최종 manifest와 컴파일된 XML에서 SecureStore 백업 제외를 확인했습니다. 공통 저장 소스로 메모리 전용 native SQLite 시험도 통과했고, 기존 방문 4건, 사진 파일 1개, 전송 대기 3건은 행과 사진 내용까지 보존됐습니다. 이전 배터리 안내, 제주 포함 지도, 뒤로 가기와 P3-07 로그인 QA 결과는 아래에 유지합니다.

현재 실제 Android 휴대폰은 없습니다. 결과는 Debug APK의 정적 검사와 API 37 에뮬레이터 시험이며, 실제 휴대폰이나 출시용 Release 검증으로 보지 않습니다. 전체 체크리스트와 완료 수는 공통 담당 채팅에서 관리합니다.

## 10월 15일 SecureStore 백업 제외와 native SQLite

### 최종 APK의 백업 선언 확인

Android 시작 기준은 `b32afc6`, 공통 소스 기준은 `d51a8fefc8603327ad13bf2dba67045372eefa0a`입니다. 공통 `app.config.ts` 한 파일만 정확한 커밋 내용으로 임시 적용했습니다. 차이는 `expo-secure-store` 플러그인의 `configureAndroidBackup: true`, `faceIDPermission: false` 선언입니다. 원문과 양쪽 해시를 보존했고, 검증 후 원래 Android HEAD와 바이트 단위로 같게 복구했습니다. package/lock과 의존성은 바꾸지 않았습니다.

Node 24.21.0, JDK 17, 기존 Android SDK로 Android만 prebuild하고 아래 빌드를 실행했습니다. Expo는 offline, dotenv 비활성 조건이었습니다.

```sh
# travel_visit_tracker/에서
EXPO_OFFLINE=1 EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 CI=1 npx expo prebuild --platform android --no-install
# travel_visit_tracker/android/에서, 기존 JDK/SDK 환경 사용
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --offline --max-workers=2 --no-daemon --console=plain
```

빌드는 **2분 42초, 497개 task로 성공**했습니다. 기존 APK의 최종 manifest에는 아래 두 참조가 없었습니다. 새 `travel_visit_tracker/android/app/build/outputs/apk/debug/app-debug.apk`에서는 SDK의 `aapt`로 참조 ID와 컴파일된 XML을 대조했습니다.

| 최종 APK 검사 | 결과 |
| --- | --- |
| `android:fullBackupContent` | `@xml/secure_store_backup_rules` 리소스로 연결됨 |
| `android:dataExtractionRules` | `@xml/secure_store_data_extraction_rules` 리소스로 연결됨 |
| 기존 full-backup 규칙 | `sharedpref` 도메인의 `SecureStore` 제외 |
| cloud-backup 규칙 | `sharedpref` 도메인의 `SecureStore` 제외 |
| device-transfer 규칙 | `sharedpref` 도메인의 `SecureStore` 제외 |
| APK 서명 검증, 기존 APK와 서명·package 비교 | 모두 PASS |

새 APK는 109,406,499 bytes이며 로컬에 보존합니다. **설치하지 않았으므로 에뮬레이터에 남은 기존 APK의 백업 정책이 바뀐 것은 아닙니다.** 이번 PASS는 최종 Debug 바이너리에 제외 규칙이 들어간다는 근거입니다. OS 백업·복원·기기 전송 실행, 방문 DB·사진의 OS 백업 보존, Release나 실제 휴대폰 시험은 수행하지 않았습니다. `faceIDPermission: false`의 iOS native 결과도 이번 Android 검사 범위가 아닙니다.

### 원본과 분리한 저장 계층 시험

기존 설치 Debug APK의 Hermes와 `expo-sqlite` native 함수를 사용했습니다. 공통 `d51a8fe`의 repository/schema/dwell 원문과 해시를 별도로 보존하고, 저장소 파일을 덮어쓰지 않은 채 Inspector의 격리된 함수로 불러왔습니다. 새 연결의 **`:memory:` DB**만 사용했으며 `PRAGMA database_list`의 빈 파일 경로를 확인했습니다. 기존 앱의 DB 연결과 구분되며 종료 시 `closeSync()`로 모든 시험 자료를 해제했습니다.

| 합성 native SQLite 검사 | 결과 |
| --- | --- |
| A/B 계정 조회 분리 | A가 가져온 방문·사진을 B가 볼 수 없음 |
| 명시적 게스트 가져오기 | GPS 방문 1건과 연결 사진 행 1건만 이동, 개발 방문은 guest에 남음 |
| 비활성 계정 가져오기 | 현재 계정과 다르면 거절됨 |
| 식별자·시각·사진 연결 | 방문 UUID, session ID, 소수점 시각, 사진 URI와 visit 연결 보존 |
| 전송 대기 자료 | owner 변경 외 ID, entity, operation, payload, 생성 시각, attempts 보존 |
| 계정 전환 후 전송 보호 | 비활성 A의 attempt 갱신 거절, B의 ACK로 A의 대기 자료가 삭제되지 않음 |
| 무결성·종료 | integrity `ok`, 메모리 DB 닫힘 |
| 원본 앱 대조 | guest 방문 4건, 사진 파일 1개, 전송 대기 3건의 전체 행·사진 바이트 불변, guest·기록 꺼짐 유지 |

사진은 합성 URI 문자열과 연결 행만 만들었고 실제 사진 파일을 만들지 않았습니다. 위치 관측 결과를 합성한 저장 계층 시험이므로 GPS 수신·체류 판정이나 앱 UI, 서버 전송 E2E의 통과 근거로 사용하지 않습니다. 동기식 native SQLite 호출을 Repository 연결 형태로 감싸 실행했으며 production의 비동기 adapter 전체를 검증한 결과도 아닙니다.

초기 Inspector 시험은 native async/await로 변환한 검증 코드에서 방문 생성 후속 단계가 실패했습니다. 같은 공통 원문을 TypeScript ES2015 Promise 흐름으로 변환한 뒤 전체 항목이 PASS였습니다. 제품 소스는 수정하지 않았고, 초기 실패와 최종 결과를 함께 보존합니다. 이전 credentials 직접 probe의 미완료 상태를 이번 결과로 소급 변경하지 않습니다.

### 용량 정리와 종료

빌드와 Inspector, 자체 Metro 8082, 에뮬레이터 종료를 확인한 뒤 이번 빌드에서 새로 생성한 중간 바이너리만 정리했습니다. 각 디렉터리·파일 생성 시각, 이 worktree 안의 실제 경로, 열린 파일 부재를 확인했습니다. `.so`, `.o`, `.a`, `.dex`, `.class`, `.jar`, `.flat`, `.bc` 파일 **1,236개, 논리 크기 2,570,324,503 bytes**를 제거했습니다. 디렉터리와 로그·리포트·XML·JSON은 유지했습니다.

정리 직전 가용량은 23,472,234,496 bytes(21.86GiB), 직후는 25,807,925,248 bytes(24.04GiB)였습니다. **즉시 측정한 확보량은 2,335,690,752 bytes(2.18GiB)**입니다. 빌드 전 기록값은 29,941,760,000 bytes(27.88GiB), 빌드 직후는 25,053,179,904 bytes(23.33GiB)였습니다. 각 시점의 파일시스템 가용량이며 다른 프로세스 사용량을 분리한 값은 아닙니다.

정리한 경로는 다음과 같습니다. 아래 package 이름은 각 행의 접두·접미 경로에 그대로 대응합니다.

| 경로 | 해당 디렉터리 |
| --- | --- |
| 앱 | `travel_visit_tracker/android/app/build/intermediates`, `travel_visit_tracker/android/app/.cxx` |
| `travel_visit_tracker/node_modules/<package>/android/build/intermediates` | `expo`, `expo-constants`, `expo-dev-client`, `expo-dev-launcher`, `expo-dev-menu`, `expo-dev-menu-interface`, `expo-json-utils`, `expo-manifests`, `expo-modules-core`, `expo-updates-interface`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-svg`, `react-native-worklets`, `@expo/log-box`, `@maplibre/maplibre-react-native`, `@react-native-masked-view/masked-view` |
| `travel_visit_tracker/node_modules/<package>/android/.cxx` | `expo-modules-core`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-screens`, `react-native-worklets` |

기존·신규 APK와 debug signing 파일은 정리 전후 해시가 같습니다. 원본 checkout, 전역 Gradle 캐시, SDK, AVD, DB·사진·outbox, 기존 증거·백업·로그는 유지했습니다. 공통 임시 설정은 복구했고 iOS 8081 프로세스는 그대로입니다. 자체 8082 연결만 제거했으며 다음 빌드 때 삭제한 중간 바이너리는 다시 생성해야 합니다.

이번 원본은 Git 제외인 `docs/test-results/android-backup-20261015/`에 보존합니다. 공유 가능한 결과는 이 문서에 기록하며 APK, 원본 로그, 서명 값, DB와 기기 식별자는 공개하지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 기준 소스·복구 | `validation-files.json`, `original-*.txt`, `restoration-result.json`, `synthetic-source-manifest.json`, `*-source.ts` |
| 빌드·APK 검사 | `prebuild.log`, `assemble-debug.log`, `old-apk-summary.json`, `apk-backup-result.json`, `new-apk-manifest.txt`, `secure_store_*-compiled.txt` |
| 격리 SQLite와 원본 대조 | `synthetic-native-probe.js`, `make-sqlite-probe.cjs`, `run-sqlite-probe.mjs`, `synthetic-native-attempt*.json`, `synthetic-native-result.json`, `synthetic-native-summary.json`, `app-before-synthetic.json`, `app-after-synthetic.json` |
| 정리·종료 | `cleanup-candidate-inspection.json`, `cleanup-removed-files.json`, `cleanup-summary.json`, `shutdown-status.json`, `metro.log`, `emulator.log` |

이번 변경은 Android 결과 문서만 포함합니다. 공통 진행표·체크리스트는 수정하지 않았고 실제 기기·Release·배터리 수용 조건도 완료로 올리지 않았습니다.

## 10월 14일 P3-07 Android 로그인 QA 결과

**이번 native 흐름은 PASS입니다.** 실제 backend의 `createBackend`를 읽기 전용으로 재사용하되 별도 루프백 서버, 임시 DB·업로드 폴더와 합성 계정만 사용했습니다. 실제 backend의 data/uploads나 환경 비밀값은 사용하지 않았습니다. 공개 문서에는 합성 계정 값, 토큰, 서버 주소와 원본 JSON을 적지 않습니다.

| 시험 | 실제 결과 |
| --- | --- |
| 가입 | 실제 가입 API 성공 후 계정 뷰로 전환. 계정 로컬 자료는 0건, 게스트 자료는 별도로 유지 |
| 저장·강제 재실행 복구 | native SecureStore에 AES 암호화 항목 저장 확인. 앱 강제 종료·재실행 후 세션 복구와 실제 me 확인 성공 |
| 서버 오프라인 | offline 상태로 바뀌어도 토큰과 같은 계정의 로컬 뷰 유지. 게스트로 임의 전환하지 않음 |
| JWT 비밀값 교체 | 실제 me 요청이 401로 거절된 뒤 expired·토큰 없음으로 변경. 같은 계정 뷰와 게스트 자료 유지 |
| 재로그인 | 같은 합성 계정으로 실제 로그인 API 성공, signed-in·토큰 있음으로 복귀 |
| 게스트 가져오기 | 확인창을 열었다 취소하는 것만 확인. 기록 이동이나 가져오기 실행 없음 |
| 로그아웃 | guest·세션 없음·토큰 없음·기록 꺼짐으로 복귀. 해당 native SecureStore 인증 항목도 삭제됨 |
| 원본 보존 | 모든 단계에서 게스트 방문 4건, 사진 파일 1개, 전송 대기 3건 유지. 행 전체와 사진 내용의 원본 비교도 일치, DB 무결성 정상 |

계정 뷰 유지 시험은 **로컬 계정 자료가 0건인 조건**입니다. 계정 소유자가 유지되고 게스트 4건이 노출·이동되지 않는 것을 확인했으며, 비어 있지 않은 계정의 방문·사진 복원까지 검증했다는 뜻은 아닙니다. 가져오기 원자성은 공통 담당의 임시 SQL 검사 결과이고 이번 native 시험에서는 실제 가져오기를 하지 않았습니다.

### 기준 소스와 검사 범위

Android 시작 기준은 `0bc330d`, 공통 검증 소스는 **`aa09aa0`**입니다. 계정 화면, 설정 화면, authClient/sessionManager/credentials 두 플랫폼 파일, database/repository, useAuthStore/useAppStore의 승인된 10개 파일만 임시 적용했습니다. 파일 해시로 `aa09aa0`와의 일치를 확인했고 시험 중 다시 동기화하지 않았습니다. 이후 공통 전송 서비스 개발은 이번 native 결과에 포함하지 않습니다.

새 의존성 설치, APK 재설치, native rebuild나 장시간 시험은 하지 않았습니다. 기존 APK의 SecureStore 클래스·등록 참조와 설치 파일 일치는 준비 단계에서 읽기 전용으로 확인했습니다. 임시 UI 상태의 Android 타입 검사, ESLint와 기존 **90개 테스트**가 PASS였습니다. 공통 채팅의 112개 또는 이후 검사 수를 이 worktree의 실행 결과로 바꾸지 않습니다.

독립 비동기 Inspector의 credentials.read 진단은 완료 응답을 얻지 못해 직접 API probe의 PASS로 표시하지 않습니다. 실제 흐름 확인은 가입·로그인 UI, 강제 재실행과 me 성공, 동기식 앱 상태 읽기, native 암호화 항목의 존재·로그아웃 후 삭제와 DB·사진 원본 대조로 수행했습니다. 초기 연결·화면 자동 입력 문제는 인증 실패로 분류하지 않으며, 원본 예외도 로컬에 보존했습니다.

10월 14일에는 새 app.config의 SecureStore backup 제외 선언을 동기화하지 않았습니다. 10월 15일 새 Debug APK에서 native 제외 규칙을 확인한 결과는 위에 별도로 기록합니다. 기존 설치 APK는 그대로이며 OS 백업·복원, 실제 Android 휴대폰·Release와 iOS 실제 계정 UI/DB 전환은 이 로그인 QA의 완료 범위가 아닙니다.

### 근거와 종료 상태

원본 근거는 Git 제외인 `docs/test-results/android-auth-20261014/`에 보존했습니다. 아래 파일에는 상태·개수 중심의 요약 또는 비공개 원본이 있으므로 공개 PR에는 이 설명만 공유합니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 승인 소스 일치·원상 복원 | `validation-files.json`, 원래 존재한 파일의 `original-*.txt` |
| 검사 결과 | `common-auth-check.log` |
| 단계별 앱·DB 상태 | `after-signup`, `restored-online`, `server-offline`, `invalid-token`, `after-relogin`, `final-guest` 이름의 `*-session.json`, `*-db.json` |
| native 인증 저장 항목 | 단계별 `*-credential.json` (존재·암호화 여부만 기록) |
| 확인창 취소 | `guest-import-confirmation.*`, `guest-import-cancelled.*` |
| 실제 임시 서버 응답·최종 요약 | `server-summary.json`, `summary.json` |
| 종료 확인 | `shutdown-status.json`, `loopback-remove.log` |

최종 상태는 guest, recording off, collector off, 방문 4건·사진 1개·전송 대기 3건, 인증 세션 없음입니다. 임시 서버와 전용 연결, 자체 Metro와 에뮬레이터를 종료했습니다. 공통 overlay 10개는 원래 Android HEAD로 복원했고, 이번에만 생긴 공통 파일은 해시를 확인한 뒤 제거했습니다. 원래 common checkout, iOS와 기록·사진·증거·백업은 보존했습니다. 이번 종료 커밋은 Android 결과 문서만 포함합니다.

### 다음 native 시험의 연결 도구

준비 단계에서 추가한 `android-auth-loopback.sh`는 임시 서버의 health 응답을 확인한 뒤 인증 전용 포트를 에뮬레이터에 연결합니다. 공통 서버·Metro 포트와 실제 휴대폰을 거절하고 `--remove`는 해당 연결만 제거합니다. 서버·계정·앱을 만드는 도구는 아니며 임시 DB·합성 계정 격리는 실제 서버 설정에서 별도로 확인해야 합니다. 가짜 adb/curl로 검사한 `test-android-auth-loopback.py`는 PASS입니다.

```
bash travel_visit_tracker/scripts/android-auth-loopback.sh
bash travel_visit_tracker/scripts/android-auth-loopback.sh --remove
```

설치 APK 준비 근거는 `docs/test-results/android-auth-prep-20261014/`에 따로 보존했습니다. 원본 APK·기기 경로, bytecode, 계정·토큰과 키 값은 GitHub에 올리지 않습니다.

## 10월 14일에 확인한 내용

이번 작업은 P2-07의 배터리 안내, 초기 지도 범위, P4-06의 Android 뒤로 가기 일부를 확인하는 작업입니다.

| 확인한 흐름 | 결과 | 실제로 확인한 내용 |
| --- | --- | --- |
| 배터리 안내 | PASS | 정상 전원과 합성 절전 상태에서 위치 수신 지연, 2분 공백, 저장한 방문·사진 보존 설명이 표시됨 |
| 휴대폰 앱 설정 열기 | PASS | Android 앱 정보 화면이 열리고, 뒤로 가면 앱 설정 화면으로 돌아옴 |
| 초기 지도 | PASS | 지도를 움직이기 전과 앱 프로세스 재실행 후에도 제주 전체가 지도 영역 안에 표시됨 |
| 설정 탭의 뒤로 가기 | PASS | 내 지도로 돌아옴 |
| 지역 검색의 뒤로 가기 | PASS | 검색 모달이 닫히고 지도에 복귀함 |
| 지역 상세의 뒤로 가기 | PASS | 선택했던 지역이 있는 지도 화면으로 복귀함 |
| 지도 선택 카드의 뒤로 가기 | PASS (후속 수정 확인) | 첫 번째 뒤로 가기는 카드만 닫고 지도 유지. 두 번째는 기존 OS 흐름으로 앱이 화면 밖으로 나감 |
| 선택이 남아 있는 다른 화면의 뒤로 가기 | PASS | 상세·설정 탭·검색 모달에서 뒤로 가면 선택이 유지된 지도에 복귀. 그다음 지도에서 뒤로 가면 카드 닫힘 |
| 기존 자료 보존 | PASS | GPS 방문 3건, 전체 방문 4건(개발 입력 1건 포함), 사진 파일 1개, 전송 대기 3건 유지. 사진 연결과 DB 무결성 정상 |
| 새 crash와 ANR | 없음 | 시험 전후 진단 내용에 변화 없음 |
| 실제 기기, Release, 배터리 사용 시간 | BLOCKED / 미실행 | 실제 Android 휴대폰 없음. 이번 안내 확인으로 배터리 시험을 완료하지 않음 |

### 어떤 소스로 시험했는지

첫 배터리·지도 검증의 Android 기준은 `7db23ae`입니다. 사용자가 지정한 공통 브랜치 `codex/common-ios`의 `712dc04`에서 아래 두 파일만 임시 적용했습니다. 두 파일은 동작 소스 `70805c4`의 내용과 같았습니다.

- `travel_visit_tracker/app/(tabs)/settings.tsx`: 새 배터리 안내.
- `travel_visit_tracker/src/ui/RegionMap.native.tsx`: 전체 경계 bounds에 맞춘 초기 지도.

지도 선택 카드의 뒤로 가기 개선 후보를 전달한 뒤, 공통 담당이 `travel_visit_tracker/app/(tabs)/index.tsx`에 Android의 포커스된 지도에서만 선택을 해제하는 처리를 추가했습니다. 후속 검증은 Android 기준 `cdb023a`에 이 새 지도 화면과 위 두 파일, 총 세 파일만 임시 적용했습니다. 공통 checkout HEAD는 `712dc04`였고 새 `index.tsx`는 아직 미커밋 검증본이었습니다. 해당 파일 SHA-256은 `087b8c738c873716b376d585fdb24be0cf9eea38c670947ce78e94ab40ecc36d`입니다. 나머지 두 파일은 기존 공통 커밋의 내용과 같았습니다.

공통 브랜치 전체를 합친 시험은 아닙니다. 검증 전 Android 파일의 원문과 해시를 로컬에 보존했고, 각 검증 후 임시 공통 파일을 원래 Android HEAD와 바이트 단위로 같게 복원했습니다. 이 공통 파일들은 Android 커밋에 넣지 않습니다. 루트, 모바일, backend README와 공통 진행 문서도 수정하지 않았습니다.

Emulator 37.2.12, API 37, CPU 4개, SwiftShader와 기존 APK를 사용했습니다. 앱을 재설치하지 않았고 새 native 의존성이나 빌드를 추가하지 않았습니다. Android 개발 서버는 localhost 8082만 사용했습니다.

합성 절전은 전원을 연결하지 않은 상태와 배터리 15%, low_power=1로 만들었습니다. 안내와 앱 설정 연결을 확인한 뒤 low_power=0, AC 전원 연결, 배터리 100%로 복구했습니다. 자동 기록은 시험 내내 꺼져 있었으며 새 위치나 방문을 만들지 않았습니다.

### 이번 검증의 근거

검증용 UI 상태에서 `npm --prefix travel_visit_tracker run check`를 실행해 타입 검사, ESLint, 90개 테스트가 통과했습니다. 이후 앱 재실행 전후의 저장 요약을 대조했고 방문, 사진 파일과 연결, 전송 대기 수가 모두 일치했습니다.

원본 근거는 로컬 `docs/test-results/android-ui-20261014/`에 보존합니다. GitHub에는 이 설명만 공유하며 원본 화면, 사진, DB, 기기 로그와 식별자는 올리지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 소스 적용·복원 확인 | `validation-files.json`, `original-0.txt`, `original-1.txt` |
| 자동 검사 | `common-ui-check.log` |
| 배터리 안내·앱 설정 복귀 | `battery-guidance-saver.*`, `android-app-settings.*`, `app-settings-back.*` |
| 제주 포함 지도 | `settings-tab-back.png`, `cold-map-jeju.png` |
| 뒤로 가기 | `search-before-back.*`, `search-after-back.*`, `region-detail.*`, `region-detail-back.*`, `map-selected-back.*` |
| 저장 보존·진단 요약 | `baseline.json`, `after-back-flows.json`, `final-state.json`, `summary.json` |

`*`는 같은 이름의 PNG와 화면 구조 XML입니다. 첫 로딩 캡처도 보존했지만 지도 통과 근거로 쓰지 않았습니다. 실제 지도 확인은 위의 로딩 완료 화면을 사용했습니다. 앱 설정의 배터리 제한을 변경하거나 위치·알림 권한을 회수하지 않았습니다.

### 지도 뒤로 가기 수정의 후속 근거

후속 원본은 `docs/test-results/android-back-20261014/`에 보존합니다. 첫 카드 닫기와 두 번째 OS 복귀, 상세에서 지도 복귀, 선택이 남아 있는 설정 탭·검색 모달 복귀, 마지막 카드 닫기까지 모두 PASS였습니다. 다른 화면에 머무는 동안 지도 전용 뒤로 가기가 동작을 가로채지 않았습니다. 이 결과로 앞서 발견한 선택 카드의 개선 후보를 해결 확인 이력으로 갱신합니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 세 파일 임시 적용·복원 | `validation-files.json`, `original-0.txt`~`original-2.txt` |
| 타입 검사·lint·90개 테스트 PASS | `common-back-check.log` |
| 첫 카드 닫기·두 번째 OS 복귀 | `selected-before-back.*`, `first-back-closes-card.*`, `second-back-default-os.*` |
| 상세·설정·검색의 포커스 회귀 | `detail-back-keeps-selection.*`, `settings-back-keeps-selection.*`, `search-back-keeps-selection.*`, `final-back-closes-card.*` |
| 단계별 대조·저장·진단 | `back-steps.json`, `baseline.json`, `final-state.json`, `summary.json` |

사진 파일·연결, GPS 방문 3건, 전체 방문 4건, 전송 대기 3건, DB 무결성이 모두 유지됐으며 새 crash와 ANR은 없었습니다. 새 장시간 시험, 위치 주입, APK 재설치나 native rebuild는 하지 않았습니다. P4-06의 Android 뒤로 가기 부분 확인이며 작은 화면, 큰 글자, 스크린리더와 양쪽 실제 기기 검증은 계속 남아 있습니다.

## 10월 12일에 완료한 위치 기록 시험

이 시험은 Android 소스의 최초 기준 `0cf402a`에서 진행했습니다. 기존 AVD 데이터를 유지하면서 SwiftShader로 부팅을 복구했고, 최신 JS를 8082 개발 서버에 연결했습니다. 당시 부팅은 약 14.6초였고 기존 APK의 데이터 보존 업데이트 설치가 성공했습니다.

| 시험 | 결과와 의미 |
| --- | --- |
| 위치 권한 회수 | 앱 재개 후 기록 중단과 권한 확인 안내. 화면 잠금 권한만 회수하면 foreground 수집으로 전환 |
| GPS 끄기 | 활성 화면에서 기록 중단과 위치 서비스 확인 안내 |
| 알림 거부 | 알림을 거부해도 위치 foreground 서비스 시작과 후보 진행 확인 |
| 긴 위치 공백 | 권한·위치 서비스는 켜둔 채 새 위치를 멈춤. 마지막 관측 후 123.160초에 후보 만료, 저장한 방문 유지 |
| 짧은 절전 시험 | 합성 배터리 15%와 절전 상태에서 약 15초 관측 지속. 실제 배터리 절감 결과는 아님 |
| 기록 중지·재시작 | 중지 버튼으로 위치 서비스 종료, 재시작 후 정상 수신 |
| 30분 화면 꺼짐 | 1800.589초 동안 31회 읽기. 총 301.100초 체류에서 한 번 확정, GPS 방문·전송 대기 2→3건. 추가 확정 없음 |
| 화면 복귀·중지·앱 재실행 | GPS 3건, 전체 방문 4건, 사진 파일 1개, 전송 대기 3건과 DB 무결성 유지 |

30분 시험의 시작 직후 화면 상태는 Dozing, 60초부터 끝까지 매분 Asleep이었습니다. 보안 키가드는 표시되지 않았습니다. 고정된 합성 GPS, AC 전원, Debug 앱, Metro와 매분 adb 진단이 있는 조건이므로 깊은 절전, 제조사별 제한, 보안 잠금이나 실제 배터리 검증으로 해석하지 않습니다. 매분 관측한 마지막 위치의 나이는 최대 10.098초였으며, 모든 이벤트 간격을 연속 측정한 값은 아닙니다.

당시 배터리 제한 안내는 없었지만, 위의 10월 14일 공통 UI 시험에서 안내 표시와 설정 연결을 확인했습니다. 누락 발견 이력은 남기되 현재 미해결 안내 문제로 취급하지 않습니다.

10월 12일 원본 근거는 `docs/test-results/android-native-20261012/`에 있습니다. `long-lock-monitor.json`, `long-lock-00.json`~`long-lock-30.json`, `after-screen-return.*`, `after-long-stop.json`, `after-long-restart.*`, `restored-permissions.txt`, `crash-final.log`, `lastanr-final.txt`를 보존합니다. 저장된 증거를 대조하는 아래 명령의 세 묶음은 모두 PASS였습니다.

```sh
python3 scripts/check-android-native-evidence.py docs/test-results/android-native-20261012
```

타입 검사, ESLint와 90개 테스트, Android 실행 스크립트의 격리 검사, shell/Python 문법 검사도 통과했습니다. [최종 인계 커밋의 Linux Cloud 검사](https://github.com/OhHyunSeo/travel-visit-tracker/actions/runs/38489319781)도 성공했습니다. 이 Mac에서는 backend 의존성이나 iOS Pods를 설치하지 않았습니다.

## 지도 성능은 별도로 남아 있습니다

아래는 **10월 12일, 초기 지도 수정 전** Debug·SwiftShader 측정입니다. 10월 14일 제주 표시 개선을 성능 개선 수치로 바꾸지 않습니다. 경계 팩은 geoBoundaries의 2020년 개발 자료 228개이며 최신 공식 경계가 아닙니다.

| 측정 항목 | 1회 | 2회 | 3회 |
| --- | --- | --- | --- |
| Android activity 시작 시간 | 2.526초 | 2.419초 | 2.469초 |
| 시작 요청에서 지도 화면 구조 확인까지의 상한 | 14.665초 | 12.152초 | 12.897초 |
| 전체 앱 PSS 메모리 | 397.32MiB | 397.04MiB | 396.12MiB |
| Native Heap PSS | 204.23MiB | 203.84MiB | 202.81MiB |

화면 구조 확인 시간에는 adb와 UI dump 지연이 포함되며 도형 그리기 완료 시각을 직접 측정한 값은 아닙니다. 전체 앱 메모리에서 지도만의 사용량을 분리할 수 없습니다. 지도 이동, 검색, 선택 후 전체 PSS는 427.45MiB였습니다.

Android HWUI 누적 지표는 시작 직후 102프레임 중 janky 67(65.69%), p50 40ms/p90 65ms/p95 101ms였습니다. 조작 후에는 239프레임 중 janky 204(85.36%), p50 34ms/p90 133ms/p95 200ms였습니다. legacy janky는 각각 94/102와 138/239였습니다. 지연이 높으므로 실제 Android Release와 같은 조건의 GPU 비교 전에는 성능 완료로 표시하지 않습니다. 이 값은 MapLibre GL의 독립 FPS나 검색 응답 시간도 아닙니다. 당시 새 crash와 ANR은 없었습니다.

근거: 10월 12일 증거 폴더의 `map-profile.json`, `map-start-{0,1,2}.txt`, `map-memory-{0,1,2}.txt`, `map-full.png`, `map-panned.png`, `map-selected.png`, `gfx-before.txt`, `gfx-after.txt`.

## 작업 범위와 통합

Android 채팅은 Android 실행·진단 스크립트, 전용 검사와 이 문서를 담당합니다. 공통 화면, 기록 판정·저장, app config, package/lock, backend와 전체 체크리스트는 공통 담당이 관리합니다. 남은 제안은 [공통 변경 제안](ANDROID_PROPOSED_CHANGES.md)에 정리합니다.

작업 브랜치는 `codex/android-native`, 통합 대상은 master의 [초안 PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1)입니다. 병합이나 원래 checkout 수정은 하지 않았습니다.

| 커밋 | 내용 |
| --- | --- |
| `0cf402a` | 최초 공통 소스·역할 문서 기준. 당시 origin/master는 `a0a4e52` |
| `75b9d2f` | Android 실행 격리, 데이터 보존 emulator 실행, 사진 파일·연결 진단과 검사 |
| `55ed305` | 30분 증거 대조 스크립트와 최종 결과 |
| `7db23ae` | 10월 14일 인계 기록. 첫 배터리·지도 UI 검증의 Android 시작 기준 |
| `cdb023a` | 배터리 안내·제주 포함 지도·뒤로 가기 첫 검증과 읽기 쉬운 설명. 선택 카드 수정 검증의 Android 시작 기준 |
| `6b0c042` | 포커스된 지도 선택 카드의 Android 뒤로 가기 후속 검증 |
| `0bc330d` | 합성 인증 서버용 Android 루프백 연결과 SecureStore 검사 준비 |
| `b32afc6` | 10월 14일 native 로그인 QA·원본 보존·종료 결과. 10월 15일 백업 설정 빌드의 Android 시작 기준 |

10월 12일 최종 공개 단계가 사용량 한도로 중단돼 10월 14일에 기존 자료를 확인하고 커밋·푸시와 PR 설명 갱신을 마쳤습니다. 이번 후속 검증에서도 공통 UI는 임시로만 사용했으며 Android PR에 중복 포함하지 않습니다.

### 재개할 때 쓰는 명령

Node 24.21.0을 사용합니다. 외부 설치를 읽기 전용 재사용할 때는 `TRIP_NODE_BIN`에 해당 bin 경로를 지정합니다.

```sh
bash travel_visit_tracker/scripts/android-emulator.sh
TRIP_NODE_BIN="<Node 24.21.0 bin>" bash travel_visit_tracker/scripts/android-local.sh
python3 scripts/test-android-local.py
python3 scripts/test-android-emulator.py
```

기본 GPU는 설치 도움말과 실제 부팅에서 확인한 SwiftShader입니다. auto, host, software, lavapipe, swiftshader, swangle 지원을 확인했지만 다른 모드의 성능 비교까지 마친 것은 아닙니다. 이전 host 재시작 실패 이력이 있어 이번 조건을 유지했습니다. 스크립트는 기존 AVD와 설치 도구를 사용하며 데이터를 wipe하거나 스냅샷을 삭제하지 않습니다. Android Metro 기본 포트는 8082이고 iOS용 8081은 거절합니다.

## 자료와 실행 환경 보존

기존 DB, 방문, 사진, 전송 대기 자료, APK, 소스와 스냅샷은 삭제하지 않았습니다. 10월 12일 시작 가용량은 약 48GiB, 10월 14일 후속 시작 시 약 37GiB였습니다. 10월 14일까지는 캐시 정리나 자료 삭제를 하지 않았고 확보량은 0이었습니다. 10월 15일의 새 중간 바이너리 정리 경로와 확보량은 위의 별도 기록을 따릅니다.

10월 12일에는 위치 권한 3개와 알림을 원래 허용 상태로 돌리고 알림의 user-fixed 플래그를 제거했습니다. 위치 공백용 test provider도 제거하고 mock_location을 원래 default deny로 복구했습니다. 이번에는 권한을 바꾸지 않았고 합성 전원만 복구했습니다.

각 검증의 에뮬레이터와 자체 8082 서버는 종료했습니다. 임시 적용한 공통 파일은 첫 검증 두 개, 뒤로 가기 수정 검증 세 개 모두 원래 내용으로 복원했습니다. iOS 8081과 원래 checkout은 조작하지 않았습니다. 근거는 각 로컬 증거 폴더의 `shutdown-status.json`과 `validation-files.json`에 남겼습니다. 공유 문서에는 개인 위치, 기기 식별자, 환경·서명 값을 넣지 않습니다.
