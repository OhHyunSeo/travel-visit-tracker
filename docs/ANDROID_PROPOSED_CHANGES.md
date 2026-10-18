# Android 검증에서 공통 담당에 전달할 내용

갱신: 2026-10-18. 이 문서는 공통 코드에 적용할 내용과 Android에서 확인한 결과를 구분해 기록합니다. Android 채팅이 공통 파일을 직접 커밋하지 않습니다.

## 10월 18일 foreground 연결 복구 확인

Android `cf79090`에서 공통 **`51c96d249b2772517da3d9937cb03e568dc1b2d9`**의 필요한 14개 JS/TS만 임시 적용했습니다. 별도 native async 파일 DB·합성 계정과 고정 backend 사본의 실제 임시 HTTP를 사용한 연결 복구 13가지가 PASS입니다.

- 두 transport 예외 뒤 retry/check 시각을 저장하고 DB 재개방 후 보존. 확인 기한 전 요청 없이 무인증 GET health 뒤 긴 retry보다 먼저 같은 작업 UUID ACK. 사진 큐·URI·소수점 시각 유지.
- health HTTP 503은 확인 시각만 진행하며, health 응답 중 opt-out·foreground 이탈·token 변경은 두 시각·큐 보존.
- 실제 CAS transaction 중 foreground/token 변경·DB 오류는 rollback하며 일반 backoff로 덮어쓰지 않음. expected 시각이 바뀌었으면 새 시각을 유지.
- 실제 제어 HTTP 401/409는 pause, 500은 일반 retry를 유지하고 health로 우회하지 않음. 실제 지연 health의 약 3초 abort·무인증도 확인.

transport 예외·시계·경쟁 시점·오류 status는 합성 제어입니다. health·ACK는 실제 HTTP이고 DB 쓰기·rollback은 실제 native API입니다. 서버는 방문·고유 ID·영수증 각 1개였고 본 검사 health 10회 모두 GET·Authorization 없음이었습니다. 실제 OS Wi-Fi 단절·nonempty 사용자 UI·전송 중 프로세스 종료의 E2E로 확대하지 않습니다. 새 UI 문구와 이전 14개·장시간 시험은 이번에 다시 실행하지 않았습니다.

backend 합성 DBv3는 확인했지만 새 사진 API는 호출하지 않았습니다. 사진 서버 기반과 **아직 연결하지 않은 모바일 사진 업로드·동의·다운로드·복원**을 구분합니다. 사진 큐 보존은 사진 전송 성공이 아닙니다.

타입·lint·기존 Android worktree 90개 테스트가 PASS이며 공통 232/61개와 구분합니다. 원본 모든 owner 행·사진 바이트·guest 방문 4건·사진 파일 1개·대기 3건·기록 꺼짐·무결성을 유지했습니다. 시험 DB 12개·WAL·SHM 제거, 공통 파일 14개 복구와 자체 프로세스 종료도 확인했습니다. 새 설치·native build·의존성 변경·캐시 삭제는 없었고 iOS·iPhone·원래 checkout은 조작하지 않았습니다. 정확한 한계·소스·근거는 [진행 기록](ANDROID_PROGRESS.md)에 저장합니다.

## 10월 17일 새 방문 백업·Coordinator Android 확인

공통 `c95d6caa209086431b371a68cd2ac0d2222aa48b`의 필요한 14개 파일만 임시 적용했습니다. 실제 계정 화면에서 합성 계정 0건, 기본 자동 꺼짐, 수동 빈 전송 안내와 성공 시각 미생성, 동의창의 계정·서버·범위·사진 제한 표시, 취소, opt-in, 강제 재실행 뒤 같은 계정·opt-in 복구, 자동 끄기·로그아웃을 확인했습니다. UI 시험에서 원본 가져오기나 비어 있지 않은 방문 전송은 실행하지 않았습니다.

별도 native async 파일 DB·실제 임시 HTTP 서버로 Coordinator 14개 검사도 PASS였습니다. 수동 ACK·성공 시각, 사진 큐·URI·소수점 시각 보존, 서버 저장 뒤 응답 유실 모사 → 재개방 → 저장된 지연 시각 → 같은 작업 UUID 재전송·서버 중복 없음까지 확인했습니다.

공통의 경쟁 조건 수정이 `202a2e250420b10056c518d8d26454035f548615`로 도착한 뒤 repository·visitSync·visitBackup 세 파일만 바꿨습니다. **이 새 기준에서도 새 합성 계정·DB로 실제 HTTP 14개를 다시 실행해 모두 PASS**였습니다. 이어 별도 실제 native DB·합성 ACK로 다음 네 경우도 통과했습니다.

- 빈 큐 snapshot 뒤 방문·삭제가 추가되면 완료 시각을 쓰지 않고 다음 배치까지 처리.
- 같은 시점에 자동 백업을 끄면 새 두 작업을 보존하고 완료 시각을 만들지 않음.
- ACK transaction이 대기 중 같은 owner의 token이 바뀌면 rollback·Runner paused·큐 보존.
- 실제 DELETE 뒤 같은 owner의 token이 바뀌어도 rollback·ACK 0건·사진 연결·큐 보존.

`c95` UI 전체와 `202a` 독립 합성 검사를 구분합니다. 네 경쟁 조건은 HTTP ACK stub을 쓴 실제 native DB 시험이며, 두 단계의 14개 검사는 실제 HTTP입니다. 응답 유실·재시도 시계도 통제한 모사이므로 OS 단절·전송 중 앱 강제 종료·전체 앱 E2E의 결과로 확대하지 않습니다.

두 임시 소스의 타입 검사·lint·이 worktree의 기존 90개 테스트가 각각 PASS였습니다. 마지막 guest 방문 4건·사진 파일 1개·outbox 3건, 모든 owner 행·기존 사진 바이트·무결성은 원본과 같습니다. 합성 DB 여섯 개·WAL·SHM 제거, native 인증 항목 삭제, 공통 파일 원상 복구와 자체 서버·에뮬레이터 종료도 확인했습니다. 새 빌드·설치·의존성 변경·캐시 삭제는 없었으며 iOS·iPhone·원래 checkout은 조작하지 않았습니다.

공통 수정의 Android 해결 확인과 원본 근거·두 SHA·한계는 [진행 기록](ANDROID_PROGRESS.md)에 저장합니다. 실제 Android·Release·배터리·OS 백업/복원, 사진·다른 기기 복원·병합과 비어 있지 않은 UI 전송·중단 복구는 남아 있습니다.

## 10월 16일 APK 업데이트와 실제 비동기 SQLite 확인

보존한 새 APK와 현 설치 앱의 hash·서명·package·버전을 대조한 뒤 `install -r` 1회로 데이터 보존 업데이트했습니다. 설치된 APK의 hash가 검증한 파일과 같고, manifest와 컴파일된 XML의 SecureStore 백업 제외 세 규칙도 확인했습니다. 모든 owner의 방문·사진·outbox 전체 행과 기존 사진 바이트가 유지됐습니다. 최종 guest 방문 4건·사진 파일 1개·전송 대기 3건, 기록 꺼짐·무결성 `ok`입니다. 새 빌드·의존성 설치·uninstall·wipe는 없었습니다.

공통 `f4eb401`에 고정한 네 저장 소스의 원문·해시를 보존하고, production `database.ts`의 네 비동기 adapter 함수를 그대로 추출했습니다. 새 고유한 임시 파일 DB에서 실제 `openDatabaseAsync`, `execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`, `closeAsync`, `deleteDatabaseAsync`를 사용했습니다. A/B 격리, GPS만 가져오기, UUID·session·소수점 시각·사진 URI·outbox 보존, 비활성 owner의 import·attempt 쓰기·ACK 거절, 다른 계정 ACK의 삭제 방지와 재개방 보존이 PASS입니다. 임시 DB·WAL·SHM 제거와 원본 불변도 확인했습니다.

10월 15일 sync wrapper 시험의 남은 범위 중 네 async adapter 함수는 이번에 확인했습니다. production 연결 캐시·계정 화면·서버 전송 UI E2E 전체나 새로 준비 중인 백업 버튼·자동 전송 기능의 결과는 아닙니다. 실제 OS 백업·복원·기기 전송은 시작하지 않았고 실제 Android·Release·배터리 조건도 남아 있습니다.

사용자 용량 정리 요청에 따라 검증 프로세스 종료 후 본인 worktree의 재생성 가능한 중간 바이너리 3,265개(논리 크기 2.04GiB)를 제거했습니다. 실가용량 증가는 **154.19MiB**이며 2.04GiB를 확보했다고 표시하지 않습니다. APK·서명·로그·근거·AVD·DB·사진·outbox·백업은 보존했습니다. 정확한 경로·바이트 수와 근거는 [진행 기록](ANDROID_PROGRESS.md)에 있습니다. 공통 파일 overlay나 package/lock 변경은 없었고, 자체 8082·에뮬레이터는 종료했으며 iOS 8081·iPhone·원래 checkout은 조작하지 않았습니다.

## SecureStore 백업 제외의 Debug 빌드를 확인했습니다

Android `b32afc6`에 공통 `d51a8fe`의 `app.config.ts`만 임시 적용해 offline Android Debug 빌드를 마쳤습니다. 최종 APK manifest의 fullBackupContent·dataExtractionRules 참조가 실제 XML 리소스로 연결되며, 컴파일된 full-backup·cloud-backup·device-transfer 규칙 모두 `sharedpref/SecureStore`를 제외합니다. APK 서명 검증과 기존 APK와의 서명·package 일치도 PASS입니다.

10월 15일에는 새 APK를 보존하고 설치하지 않았습니다. 10월 16일 데이터 보존 업데이트와 설치 바이너리 확인까지 마친 결과는 위에 별도로 기록합니다. OS 백업·복원·기기 전송, 방문 DB·사진 백업, Release·실제 휴대폰을 확인한 결과는 아닙니다. `faceIDPermission: false`의 iOS 결과도 Android 범위 밖입니다. 공통 설정은 원문·해시를 대조해 복구했고 package/lock이나 의존성은 바꾸지 않았습니다.

## 합성 native SQLite에서 가져오기와 계정 분리를 확인했습니다

동일 공통 커밋의 저장 소스를 원본 DB와 다른 `:memory:` native 연결에서 실행했습니다. A/B 계정 분리, GPS 방문·연결 사진 행만 명시적으로 가져오기, 개발 방문 guest 잔류, UUID·session·소수점 시각·사진 URI·outbox 내용 보존이 PASS였습니다. 비활성 계정 가져오기·attempt 갱신 거절과 다른 계정 ACK의 삭제 방지도 확인했습니다. 시험 후 메모리 연결을 닫았습니다.

실제 사진 파일이나 앱 원본 DB에는 시험 자료를 쓰지 않았습니다. guest 방문 4건, 사진 파일 1개, 전송 대기 3건은 전체 행과 사진 바이트까지 변함없습니다. 이 결과는 동기식 native SQLite를 감싼 저장 계층 시험이며 앱 UI나 production 비동기 adapter, 서버 전송 E2E 전체의 결과가 아닙니다. 초기 Inspector 변환 문제와 최종 PASS 근거는 [진행 기록](ANDROID_PROGRESS.md)에 구분했습니다.

검증 프로세스 종료 후 이번 worktree에서 새로 생성된 중간 바이너리만 정리해 가용량이 2.18GiB 증가했습니다. 최종·기존 APK, signing 파일, 로그·증거, AVD와 원본 자료는 보존했고 전역 캐시·원본 checkout·iOS 8081은 조작하지 않았습니다. 정확한 경로·용량과 로컬 근거 목록도 진행 기록에 있습니다.

첫 배터리·지도 검증은 Android 기준 `7db23ae`에 공통 `712dc04`의 설정 화면과 native 지도 두 파일을 임시 적용했습니다. 해당 UI 내용은 `70805c4`와 같았습니다. 뒤로 가기 수정의 후속 검증은 Android 기준 `cdb023a`에 공통 담당이 수정한 지도 화면까지 총 세 파일을 임시 적용했습니다. 검증 후 모든 파일을 원래 Android HEAD로 복원했습니다.

## 배터리 안내와 초기 지도는 Android에서도 확인했습니다

10월 12일에는 절전이나 앱 배터리 제한을 설명하는 안내가 없었고, 초기 지도에서 제주 일부가 잘렸습니다. 공통 담당이 안내와 전체 경계 bounds를 반영했고, 10월 14일 Android 에뮬레이터에서도 아래 결과를 확인했습니다.

| 변경 | 현재 결과 |
| --- | --- |
| 설정의 배터리 안내 | 정상 전원과 합성 절전 상태에서 수신 지연, 2분 공백, 저장된 방문·사진 보존 설명이 표시됨 |
| 휴대폰 앱 설정 연결 | Android 앱 정보 화면이 열리고 뒤로 가면 원래 설정 화면으로 복귀함 |
| 제주 포함 초기 지도 | 지도 조작 전과 앱 프로세스 재실행 후 제주 전체가 표시됨 |

이 두 제안은 해당 UI에 대한 Android 표시·연결 확인까지 끝났습니다. 실제 휴대폰의 배터리 제한이나 제조사별 절전 동작, 작은 화면·큰 글자·스크린리더까지 통과했다는 의미는 아닙니다. 초기 지도 개선으로 기존 성능 측정치가 좋아졌다고 주장하지도 않습니다.

원본 근거는 Git 제외인 `docs/test-results/android-ui-20261014/`의 `battery-guidance-saver.*`, `android-app-settings.*`, `app-settings-back.*`, `settings-tab-back.png`, `cold-map-jeju.png`, `summary.json`입니다. 공개 PR에는 설명만 남깁니다.

## 지도 선택 카드의 뒤로 가기 수정도 확인했습니다

첫 UI 검증에서는 지역 상세에서 지도에 돌아온 뒤 선택 카드가 열린 상태로 뒤로 가면 앱이 화면 밖으로 나갔습니다. 공통 담당은 Android의 포커스된 지도에서만 선택 카드를 먼저 닫도록 수정했습니다. 선택이 없으면 기존 뒤로 가기 흐름을 유지합니다.

수정된 지도 화면을 기존 Debug 앱에 임시 적용한 후 아래 동작을 native에서 확인했습니다.

| 흐름 | 결과 |
| --- | --- |
| 선택 카드에서 첫 번째 뒤로 가기 | 카드만 닫히고 지도에 머묾 |
| 선택이 없는 지도에서 두 번째 뒤로 가기 | 기존 OS 흐름으로 앱이 화면 밖으로 나감 |
| 선택 후 상세 진입 → 뒤로 가기 | 선택이 유지된 지도에 복귀함 |
| 지도 선택이 남은 상태에서 설정 탭 → 뒤로 가기 | 지도에 복귀하고 선택 카드가 유지됨. 지도 전용 처리가 설정의 복귀를 가로채지 않음 |
| 선택 카드가 있는 지도에서 검색 모달 → 뒤로 가기 | 모달만 닫히고 선택 카드가 유지됨. 이후 지도에서 뒤로 가면 카드 닫힘 |

모든 흐름과 저장 보존이 PASS였고 새 crash와 ANR은 없었습니다. 따라서 이 제안은 **수정 후 Android 확인 완료**로 갱신합니다. 실제 적용 코드는 공통 담당의 `travel_visit_tracker/app/(tabs)/index.tsx`이며 Android PR에 넣지 않았습니다.

검증 시 공통 checkout HEAD는 `712dc04`였지만 새 지도 화면은 아직 미커밋 상태였습니다. 정확한 파일 해시는 [진행 기록](ANDROID_PROGRESS.md)과 로컬 `docs/test-results/android-back-20261014/validation-files.json`에 남겼습니다. 단계별 원본과 저장 대조는 같은 폴더의 `back-steps.json`, `first-back-closes-card.*`, `second-back-default-os.*`, `detail-back-keeps-selection.*`, `settings-back-keeps-selection.*`, `search-back-keeps-selection.*`, `final-state.json`, `summary.json`입니다. 원본 화면과 기기 로그는 공개하지 않습니다.

P4-06은 Android 뒤로 가기에 대한 부분 확인입니다. 작은 화면, 큰 글자, 스크린리더와 양쪽 실제 기기 검증은 남아 있습니다. 새 장시간 시험이나 native rebuild는 하지 않았습니다.

## 로그인 QA는 aa09aa0 기준으로 완료했습니다

Android에서는 승인된 인증 파일 10개를 임시 적용해 가입, 강제 재실행 복구·me 확인, 서버 오프라인, JWT 비밀값 교체에 따른 expired·토큰 제거, 재로그인, 가져오기 확인창 취소와 로그아웃을 확인했습니다. 최종 guest·기록 꺼짐·native 인증 항목 삭제와 기존 방문 4건·사진 파일 1개·전송 대기 3건의 행·사진 내용 보존이 PASS입니다. 공통 구현은 Android 커밋에 넣지 않았습니다.

이 결과는 기존 Debug APK·API 37 에뮬레이터와 자료 0건인 합성 계정 뷰의 시험입니다. 독립 비동기 Inspector 직접 읽기 진단은 미완료로 남겼고, 실제 앱 흐름과 native 저장 항목·서버 응답·원본 비교를 근거로 삼았습니다. 실제 게스트 가져오기나 이후 공통 전송 서비스를 검증한 결과가 아닙니다.

10월 14일 로그인 QA에는 SecureStore backup 제외 선언이 반영된 APK 근거가 없었습니다. 이후 10월 15일 새 Debug 빌드의 최종 manifest·XML에서 제외 규칙을 확인한 결과는 위에 별도로 기록합니다. OS 백업·복원, 실제 Android·Release와 iOS 계정 UI/DB 전환은 별도 확인이 필요합니다. 로그인 QA 종료 당시에는 사용자 지시에 따라 추가 시험을 시작하지 않았습니다. 자세한 상태와 로컬 근거 목록은 [진행 기록](ANDROID_PROGRESS.md)에 남겼습니다.

## 성능은 실제 기기에서 따로 판단해야 합니다

10월 12일 Debug·SwiftShader 환경에서 전체 앱 메모리는 시작 후 약 396~397MiB, 지도 이동·검색·선택 후 약 427MiB였습니다. Android 화면 렌더링 지연 지표도 높았습니다. 이번 UI 후속 검증에서는 같은 성능 시험을 반복하지 않았습니다.

이 결과만으로 경계를 단순화하거나 공통 지도 구조를 바꾸기보다, 실제 Android Release와 안정적인 GPU 조건에서 지도 표시 완료, 전체 앱 메모리와 프레임을 구분해 측정할 필요가 있습니다. P1-13/P4-07의 실제 기기 완료 조건은 그대로 남깁니다. 상세 수치와 측정 한계는 [Android 진행 기록](ANDROID_PROGRESS.md)에 보존했습니다.

## 실행 설명을 통합할 때 참고할 점

Android 담당 스크립트는 localhost 8082를 기본으로 쓰고 iOS의 8081은 거절합니다. 다른 포트는 `ANDROID_METRO_PORT`로, 외부 Node bin은 `TRIP_NODE_BIN`으로 지정할 수 있습니다. 루트·모바일 README와 RESUME의 실행 설명을 갱신할 때 이 방식에 맞추면 됩니다. 해당 문서와 backend 문서는 공통 담당 범위이므로 이번에는 수정하지 않았습니다.

실제 Android 기기, Release, 보안 잠금, 장시간 배터리 수용 시험이 완료되기 전에는 emulator의 화면 표시와 저장 보존 결과를 제품 전체 통과로 표시하지 않습니다.
