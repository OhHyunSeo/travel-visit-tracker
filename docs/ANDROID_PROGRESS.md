# Android 전용 진행 기록

최종 정리: 2026-10-14, Asia/Seoul. **시험 날짜: 2026-10-12**. Android 실기기 없음. 모든 native 결과는 기존 API 37 에뮬레이터의 합성 위치 시험이다.

종료 상태: **이번 범위 완료, 사용자 지시로 새 개발·추가 장시간 시험을 시작하지 않음**. 화면 복귀·저장 복원·시험 설정 복구까지 완료했다. 공통 수정 제안과 실제 Android 기기 조건은 별도 통합/후속 검증으로 남긴다.

작업 ID: P2-07, P2-09, P2-11의 Android 중간 검증과 P1-13/P4-07의 에뮬레이터 측정. 공통 체크리스트의 실제 기기 조건과 완료 수는 이 채팅에서 변경하지 않는다.

## 기준과 담당 범위

- 기준 커밋: `0cf402ac63ff45a17f9a4dd9f72a88c267688763`. 최신 공통 소스와 병렬 역할 문서 포함. 시작 상태는 clean detached HEAD였다.
- 작업 브랜치: `codex/android-native`. 10월 12일 작업 시작 시 fetch 결과 `origin/master`는 `a0a4e52eb37b363de109806f871313fd5d2afea8`; 기준 커밋은 그 위의 역할 문서 커밋이다.
- 공통 소스, app config, package/lock, PROGRESS, 전체 체크리스트와 원래 checkout은 수정하지 않는다. 공통 수정 필요성은 `ANDROID_PROPOSED_CHANGES.md`로 전달한다.
- Node 24.21.0과 SDK/JDK 설치 바이너리만 재사용했다. 이 worktree의 모바일 `npm ci` 완료. backend/Pods/native 빌드 의존성 추가 설치 없음.

## 현재 결과

| 검증 | 상태 | 근거 |
| --- | --- | --- |
| API 37 실행 복구 | PASS | Emulator 37.2.12, CPU 4개, SwiftShader, cold boot 약 14.6초. wipe 및 스냅샷 삭제 없음 |
| 기존 APK 업데이트 | PASS | 원래 APK `install -r` Success. 기존 GPS 2건, 사진 1건, outbox 2건, integrity ok |
| 최신 JS 연결 | PASS | 독립 localhost Metro 8082, adb reverse 8082. 기존 iOS 8081 유지 |
| typecheck, lint, 90개 테스트 | PASS | `npm --prefix travel_visit_tracker run check` |
| Android 실행 스크립트 격리 검사 | PASS | 기본/별도 포트, 실행 중/새 Metro, 8081·잘못된 포트·실기기 거절 |
| 원격 Linux Cloud checks | PASS | 구현 커밋 `75b9d2f`의 [GitHub Actions](https://github.com/OhHyunSeo/travel-visit-tracker/actions/runs/38251886839) success. Android native 시험과 별개 |
| 위치 권한 회수 | PASS (앱 재개) | Android가 앱 프로세스를 종료. 재개 후 recording false, collector off, 권한 확인 안내, 확정 데이터 유지. background 권한만 회수하면 선택 모드는 유지하고 foreground로 전환 |
| GPS 끄기 | PASS (활성 화면) | background 기록 중 health poll이 recording false, collector off와 위치 서비스 중단 문구 표시 |
| 알림 거부 | PASS (시작·수신) | OS에서 Don’t allow, POST_NOTIFICATIONS false. foreground 위치 서비스 시작과 30초 후보 진행 |
| 120초 초과 위치 공백 | PASS | enabled 합성 GPS provider에서 업데이트 중단. 마지막 관측 후 123.160초에 후보 만료, uncertain 안내와 기존 저장 유지 |
| 절전 상태 수신·저장 보존 | PASS (짧은 활성 화면) | battery 15%, unplug, low_power=1에서 약 15초 관측 지속. 실제 배터리 절감·제조사 정책 검증 아님 |
| 절전 제한 안내 | FAIL (안내 누락) | 설정에 절전/앱 배터리 제한 설명 없음. 공통 수정 제안 파일 작성; 위치 장애 재현은 아님 |
| 기록 중지/재시작 | PASS | 정식 중지 버튼 후 위치 서비스 없음, collector off. background 재시작 후 15초 후보 진행, 저장 유지 |
| 전체 지도 표시·검색·선택 | PASS (에뮬레이터 실행) | 228개 경계 팩 도형, 이동, 검색 Gangnam→강남구 선택 표시. 새 crash/ANR 없음 |
| 지도 성능 측정 | PASS (측정), 실제 제품 성능 판정 대기 | 아래 수치 참고. Debug+SwiftShader의 높은 지연 지표를 제품 성능 통과로 해석하지 않음 |
| 30분 화면 꺼짐 | PASS (에뮬레이터) | 1800.589초, 31회 읽기. 301.100초에 한 번 확정, 이후 추가 방문 없음, 저장 유지 |
| 화면 복귀·중지·프로세스 재실행 | PASS | GPS 3건, 전체 active 방문 4건(개발 입력 1건 포함), 사진 1개·파일 존재·소유자 연결 정상, outbox 3건, integrity ok |
| 실제 Android·배터리·보안 잠금 수용 시험 | BLOCKED | 사용자는 실제 Android 휴대폰이 없음. 이번 emulator 결과로 완료 처리하지 않음 |

로컬 증거 폴더: `docs/test-results/android-native-20261012/` (Git 제외). emulator 원본 로그 `/private/tmp/trip-android-swiftshader-emulator.log`, Metro 로그 `/private/tmp/trip-android-worktree-metro.log`. 공유 문서에는 원본 로그의 기기 값·합성 좌표를 복사하지 않는다.

## 실행

```sh
# SDK 설치 경로가 기본값과 다르면 ANDROID_HOME을 지정한다.
bash travel_visit_tracker/scripts/android-emulator.sh
# worktree 외부 Node 설치의 bin 경로를 TRIP_NODE_BIN으로 지정할 수 있다.
TRIP_NODE_BIN="<Node 24.21.0 bin>" bash travel_visit_tracker/scripts/android-local.sh
python3 scripts/test-android-local.py
```

설치된 `-help-gpu`에서 auto, host, software, lavapipe, swiftshader, swangle 지원을 확인했다. 이전 host 재시작 실패 이력이 있어 이번에는 swiftshader를 선택했고 실제 부팅·앱 실행을 확인했다. 다른 GPU 모드의 성능 비교 결과로 일반화하지 않는다. 기존 AVD 설정 파일은 변경하지 않았다.

## 용량과 제한

- 시작 가용량 약 48GiB. 소스·DB·사진·로그·APK·스냅샷과 다른 checkout 자료 삭제 없음. 정리 경로 없음, 확보량 0.
- native APK는 기존 Debug 빌드 재사용이며 이번에는 최신 JS만 연결했다. 새 네이티브 빌드 또는 서명 Release 검증이 아니다.
- emulator 결과로 G1~G4, 양쪽 실기기 30분 잠금, 실제 이동/GPS 품질 또는 8시간 배터리 항목을 완료 처리하지 않는다.
- 구현 통합 커밋: `75b9d2fb80e18853fd99d308d2909894e997a71c` (7개 파일). 결과 문서 후속 갱신은 같은 `codex/android-native` 브랜치에 이어 커밋한다.
- master 대상 초안 [PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1). master 직접 반영 및 다른 checkout 병합 없음. master와 비교할 때 기준 역할 문서 커밋 `0cf402a`도 포함된다.

## 지도 측정 상세

기존 Debug APK, 최신 JS, Metro localhost 8082, CPU 4개, SwiftShader. 저장된 고유 방문 지역 2개, 사진 1개. 2020년 개발용 228개 경계이며 최신 공식 경계가 아니다.

| 항목 | 1회 | 2회 | 3회 |
| --- | --- | --- | --- |
| Android activity TotalTime | 2.526초 | 2.419초 | 2.469초 |
| 시작 요청→지도 accessibility 확인 상한 | 14.665초 | 12.152초 | 12.897초 |
| 전체 앱 PSS | 397.32MiB | 397.04MiB | 396.12MiB |
| Native Heap PSS | 204.23MiB | 203.84MiB | 202.81MiB |

시작 상한은 adb 호출과 UI dump 지연을 포함한다. 실제 도형 그리기 완료 이벤트를 계측한 값은 아니며 별도 스크린샷으로 전체 도형을 확인했다. 전체 앱 PSS에서 지도만의 메모리를 분리할 수 없다. 지도 이동·검색·선택 뒤 전체 PSS 427.45MiB.

Android gfxinfo는 시작 직후 102프레임, janky 67(65.69%), p50 40ms/p90 65ms/p95 101ms; 지도 이동·검색·선택 후 누적 239프레임, janky 204(85.36%), p50 34ms/p90 133ms/p95 200ms를 표시했다. legacy janky는 각각 94/102와 138/239다. 높은 지연이 있어 실기기 Release 계측과 동일 조건 GPU 비교 전 성능 완료로 표시하지 않는다. 이 값은 Android window/HWUI 누적 지표이며 MapLibre GL의 독립 FPS나 정확한 검색 응답 시간으로 사용하지 않는다. 전후 lastanr 및 crash buffer 내용 변화 없음.

증거: `map-profile.json`, `map-start-{0,1,2}.txt`, `map-memory-{0,1,2}.txt`, `map-full.png`, `map-panned.png`, `map-selected.png`, `gfx-before.txt`, `gfx-after.txt` (모두 로컬 증거 폴더).

## 테스트 설정 복구

- 위치 공백용 GPS test provider 제거, shell mock_location을 원래 default deny로 복구했다.
- 위치 권한 3개와 알림을 기존 granted 상태로 복구했다. 알림 거부로 생긴 user-fixed 플래그도 제거해 시작 시 권한 플래그와 일치했다.
- 합성 절전은 low_power=0과 battery reset으로 복구했다. AVD 기본 설정과 스냅샷 삭제 없음.

## 장시간 화면 꺼짐 시험 조건

30분 동안 매분 저장 요약을 수집했다. 시작 직후 OS는 Dozing, 60초부터 종료까지 매분 Asleep이며 KeyguardServiceDelegate showing=false. 보안 잠금 화면이 있는 실기기 시험과 구분한다. APK는 기존 Debug, Metro 연결 유지, 합성 고정 GPS, foreground location service, 알림 거부, low_power=0, AC powered=true 조건이다. 전원 연결·에뮬레이터 위치 환경으로 실제 배터리나 Doze/OEM 절전 동작을 입증할 수 없다.

매분 adb 진단은 화면을 켜지 않지만 CPU 활동에는 영향을 줄 수 있다. 따라서 화면 꺼짐 중 앱 작업·저장 관측 결과이며 진단 없이 깊은 절전 상태에 머문 시험으로 해석하지 않는다.

읽기 증거: `docs/test-results/android-native-20261012/long-lock-monitor.json`, 매분 `long-lock-00.json`~`long-lock-30.json`. 기기 상태를 읽는 동안 화면을 깨우거나 앱으로 전환하지 않았다. 화면 꺼짐 총 1800.589초, 매분 관측한 마지막 표본의 나이 최대 10.098초(모든 이벤트 간격을 연속 계측한 값 아님). 총 301.100초 체류에서 GPS 방문·outbox 2→3건, 이후 30분 종료·화면 복귀까지 각 3건 유지. 사진 1개·파일 존재·소유자 연결, DB integrity ok 유지.

시험 종료 후 화면 복귀, 정식 자동 기록 끄기, 앱 강제 종료·재실행에서도 GPS 3건·전체 active 방문 4건·사진 1개·outbox 3건 유지. candidate 제거, recording false, collector off, 위치 서비스 없음. 초기 대비 lastanr 및 crash buffer 변화 없음. `after-screen-return.{json,png,xml}`, `after-long-stop.json`, `after-long-restart.{json,png,xml}`, `after-long-stop-services.txt`, `restored-permissions.txt`, `crash-final.log`, `lastanr-final.txt`에 증거를 보존했다.

`python3 scripts/check-android-native-evidence.py docs/test-results/android-native-20261012`는 저장된 합성 시험 요약을 읽어 중단·복구, 후보 만료, 사진과 outbox 보존을 대조한다. 30분 미완료는 exit 2/PENDING으로 구분하며 가상 기기나 DB를 조작하지 않는다.

최종 대조: health 시나리오, 전체 30분, 화면 복귀·중지·재실행 **3개 항목 PASS** (`evidence-check.log`). Android launcher/에뮬레이터 격리 검사, 두 shell 스크립트 문법, Python 문법, `git diff --check` PASS. 모바일의 마지막 `npm --prefix travel_visit_tracker run check`는 typecheck, ESLint, 90 tests PASS (`final-check.log`). 구현 커밋의 원격 `setup-cloud.sh`/`verify-cloud.sh`도 PASS; 이 Mac에서는 범위 지시에 따라 backend 의존성/Pods를 설치하지 않았다.

## 수정 파일과 종료 인계

- `travel_visit_tracker/scripts/android-local.sh`: 8082 기본값, 8081·잘못된 포트 거절, 외부 Node bin 읽기 재사용.
- `travel_visit_tracker/scripts/android-emulator.sh`: 설치 도구 GPU/AVD 확인, 기존 emulator 중복 거절, CPU 4·SwiftShader·데이터/스냅샷 보존 실행.
- `travel_visit_tracker/scripts/android-test-state.py`: 읽기 전용 사진 파일 존재·소유자 연결·active 방문 수 확인.
- `scripts/test-android-local.py`, `scripts/test-android-emulator.py`: 가짜 도구로 실행 격리 조건 검사.
- `scripts/check-android-native-evidence.py`: 로컬 합성 native 증거의 보존·수집 전환·30분·재실행 대조.
- `docs/ANDROID_PROGRESS.md`, `docs/ANDROID_PROPOSED_CHANGES.md`: 공유 결과와 공통 수정 제안.

공통 채팅 전달: PR #2 head `70805c4`에서 iPhone 30분과 초기 제주 포함 지도를 확인했다고 알렸다. Android 검증은 기준 `0cf402a` 소스이며 그 공통 head를 새로 설치·검증한 결과는 아니다. 절전 안내·실제 기기 성능과 전체 체크리스트 갱신은 공통 채팅에서 관리한다.

정리 대상 삭제 없음(확보량 0). 자료·DB·사진·outbox·APK·스냅샷 보존. native 원본 JSON/로그/스크린샷은 Git 제외 확인. 공유 파일에는 개인 위치·기기 식별자·환경/서명 값 없음. 종료 시 자동 기록 끔과 권한·전원 복구 후 이번 emulator와 Metro 8082만 종료했다. 기존 iOS 8081은 조작하지 않았다. 종료 프로세스·포트 확인은 `shutdown-status.txt`에 보존한다.

10월 12일에는 사용량 한도로 마지막 커밋·푸시가 실행되지 못했다. 10월 14일 재개 시 저장된 최종 문서와 증거 대조 스크립트, 기존 `evidence-check.log`의 세 묶음 PASS를 확인했다. native 시험과 앱 실행은 반복하지 않았다. 현재 emulator·장시간 시험 runner·8082 리스너 없음, 8081 리스너도 없음 확인. 현재 종료 상태를 로컬 `shutdown-status.txt`에 저장했으며 어떤 iOS 또는 공통 프로세스도 조작하지 않았다. 최종 정리 커밋과 PR 설명 갱신만 처리한다.
