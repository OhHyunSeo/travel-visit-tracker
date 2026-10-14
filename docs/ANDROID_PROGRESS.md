# Android 개발·검증 기록

마지막 갱신: 2026-10-14, Asia/Seoul.

새 배터리 안내와 제주를 포함한 초기 지도를 Android 에뮬레이터에서 확인했습니다. 앱 설정, 설정 탭, 지역 검색, 지역 상세에서 뒤로 돌아오는 흐름도 정상입니다. 기존 방문, 사진, 서버 전송 대기 자료는 그대로 남았습니다.

현재 실제 Android 휴대폰은 없습니다. 이 문서의 결과는 기존 Debug 앱을 실행한 에뮬레이터 시험이며, 실제 휴대폰이나 출시용 Release 검증으로 보지 않습니다. 전체 체크리스트와 완료 수는 공통 담당 채팅에서 관리합니다.

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
| 지도 선택 카드의 뒤로 가기 | 개선 후보 | 카드가 열린 상태에서 뒤로 가면 카드만 닫히지 않고 앱이 화면 밖으로 나감. 데이터 손실은 없음 |
| 기존 자료 보존 | PASS | GPS 방문 3건, 전체 방문 4건(개발 입력 1건 포함), 사진 파일 1개, 전송 대기 3건 유지. 사진 연결과 DB 무결성 정상 |
| 새 crash와 ANR | 없음 | 시험 전후 진단 내용에 변화 없음 |
| 실제 기기, Release, 배터리 사용 시간 | BLOCKED / 미실행 | 실제 Android 휴대폰 없음. 이번 안내 확인으로 배터리 시험을 완료하지 않음 |

### 어떤 소스로 시험했는지

Android 작업 기준은 `7db23ae`입니다. 사용자가 지정한 공통 브랜치 `codex/common-ios`의 `712dc04`에서 아래 두 파일만 임시 적용했습니다. 두 파일은 동작 소스 `70805c4`의 내용과 같았습니다.

- `travel_visit_tracker/app/(tabs)/settings.tsx`: 새 배터리 안내.
- `travel_visit_tracker/src/ui/RegionMap.native.tsx`: 전체 경계 bounds에 맞춘 초기 지도.

공통 브랜치 전체를 합친 시험은 아닙니다. 검증 전 Android 파일의 원문과 해시를 로컬에 보존했고, 검증 후 두 파일을 원래 Android HEAD와 바이트 단위로 같게 복원했습니다. 이 공통 파일들은 Android 커밋에 넣지 않습니다. 루트, 모바일, backend README와 공통 진행 문서도 수정하지 않았습니다.

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
| `7db23ae` | 10월 14일 인계 기록. 이번 후속 UI 검증의 Android 시작 기준 |

10월 12일 최종 공개 단계가 사용량 한도로 중단돼 10월 14일에 기존 자료를 확인하고 커밋·푸시와 PR 설명 갱신을 마쳤습니다. 이번 후속 검증에서도 공통 UI 두 파일을 임시로만 사용했으며 Android PR에 중복 포함하지 않습니다.

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

기존 DB, 방문, 사진, 전송 대기 자료, APK, 소스와 스냅샷은 삭제하지 않았습니다. 10월 12일 시작 가용량은 약 48GiB, 이번 후속 시작 시 약 37GiB였습니다. 이번 채팅에서 캐시 정리나 자료 삭제는 하지 않았으며 확보량은 0입니다.

10월 12일에는 위치 권한 3개와 알림을 원래 허용 상태로 돌리고 알림의 user-fixed 플래그를 제거했습니다. 위치 공백용 test provider도 제거하고 mock_location을 원래 default deny로 복구했습니다. 이번에는 권한을 바꾸지 않았고 합성 전원만 복구했습니다.

이번 에뮬레이터와 자체 8082 서버는 종료했습니다. 종료 확인에서 emulator와 8082 리스너는 없었고, 공통 파일 두 개도 원래 내용으로 복원됐습니다. iOS 8081과 원래 checkout은 조작하지 않았습니다. 근거는 이번 로컬 증거 폴더의 `shutdown-status.json`과 `validation-files.json`에 남겼습니다. 공유 문서에는 개인 위치, 기기 식별자, 환경·서명 값을 넣지 않습니다.
