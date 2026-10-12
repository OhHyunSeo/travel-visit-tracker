# Android 전용 진행 기록

갱신: 2026-10-12, Asia/Seoul. Android 실기기 없음. 모든 native 결과는 기존 API 37 에뮬레이터의 합성 위치 시험이다.

## 기준과 담당 범위

- 기준 커밋: `0cf402ac63ff45a17f9a4dd9f72a88c267688763`. 최신 공통 소스와 병렬 역할 문서 포함. 시작 상태는 clean detached HEAD였다.
- 작업 브랜치: `codex/android-native`. fetch 결과 `origin/master`는 `a0a4e52eb37b363de109806f871313fd5d2afea8`; 기준 커밋은 그 위의 역할 문서 커밋이다.
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
| 위치 권한 회수 | PASS (앱 재개) | Android가 앱 프로세스를 종료. 재개 후 recording false, collector off, 권한 확인 안내, 확정 데이터 유지. background 권한만 회수하면 선택 모드는 유지하고 foreground로 전환 |
| GPS 끄기 | PASS (활성 화면) | background 기록 중 health poll이 recording false, collector off와 위치 서비스 중단 문구 표시 |
| 알림 거부 | PASS (시작·수신) | OS에서 Don’t allow, POST_NOTIFICATIONS false. foreground 위치 서비스 시작과 30초 후보 진행 |
| 120초 초과 위치 공백 | PASS | enabled 합성 GPS provider에서 업데이트 중단. 마지막 관측 후 123.160초에 후보 만료, uncertain 안내와 기존 저장 유지 |
| 절전 상태 수신·저장 보존 | PASS (짧은 활성 화면) | battery 15%, unplug, low_power=1에서 약 15초 관측 지속. 실제 배터리 절감·제조사 정책 검증 아님 |
| 절전 제한 안내 | FAIL (안내 누락) | 설정에 절전/앱 배터리 제한 설명 없음. 공통 수정 제안 파일 작성; 위치 장애 재현은 아님 |
| 기록 중지/재시작 | PASS | 정식 중지 버튼 후 위치 서비스 없음, collector off. background 재시작 후 15초 후보 진행, 저장 유지 |
| 전체 지도 표시·검색·선택 | PASS (에뮬레이터 실행) | 228개 경계 팩 도형, 이동, 검색 Gangnam→강남구 선택 표시. 새 crash/ANR 없음 |
| 지도 성능 측정 | PASS (측정), 실제 제품 성능 판정 대기 | 아래 수치 참고. Debug+SwiftShader의 높은 지연 지표를 제품 성능 통과로 해석하지 않음 |
| 30분 화면 꺼짐 | 진행 중 | 알림 거부 상태의 background 수집. 60초마다 OS 화면 상태·후보·방문·사진·outbox 읽기 |

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
- 통합 커밋: 작업 완료 후 기록. master 직접 반영 및 다른 checkout 병합 없음.

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
- 위치 권한 3개는 기존 granted 상태로 복구했다. 알림은 장시간 시험을 위해 거부 상태를 유지하고 시험 종료 후 기존 granted로 복구한다.
- 합성 절전은 low_power=0과 battery reset으로 복구했다. AVD 기본 설정과 스냅샷 삭제 없음.
