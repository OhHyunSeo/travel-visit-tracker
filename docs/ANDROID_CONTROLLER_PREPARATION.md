# Android 시험 파일을 준비하는 작은 단계

11월 2일 Android 채팅의 `899d98e`에서 다음 네 파일만 선택 통합했습니다. 기존 공통 README와 실행 보호 도구, 제품 소스는 덮어쓰지 않았습니다.

- `qa/map-transport/android/bounded_controller.py`
- `qa/map-transport/android/test_bounded_controller.py`
- `qa/map-transport/android/prepare_controller.py`
- `qa/map-transport/android/test_prepare_controller.py`

## 지금 할 수 있는 일

준비 controller가 쓰는 보고·출력·canary 등 여섯 메타데이터 파일의 허용 목록과 cap을 생성 전에 확인합니다. 기본 예약 합은276KiB이며 메타데이터 논리 예산은 최대1MiB입니다. 새 소유 폴더와 exclusive 파일, 열린 non-inheritable descriptor를 사용합니다. cap 초과는 쓰기 전에 거절하고, 파일·링크·디렉터리 교체와 변조를 감지하면 추가 기록을 막습니다. 삭제됐지만 열린 파일의 예약도 환급하지 않습니다.

선택적인 backing 예약은 메타데이터와 분리됩니다. 요청 크기는512-byte 배수·최대64MiB이며 `capacity.raw`를 작은 zero buffer로 정확한 크기까지 한 번 초기화합니다. 재초기화·임의 쓰기와 append는 거절하며, 실패한 부분 파일과 비용을 보존합니다. 이 파일은 아직 형식화하지 않은 일반 파일입니다.

`prepare()`는 실제 events/canary/output/result를 기록합니다. 저장 `result.json`은 기록 시점의 cleanup PENDING을 남기고, 마지막 반환 audit는 모든 기록 후 상태와 실제 close 결과를 전달합니다. 정리 실패를 성공으로 숨기지 않고, 잘못된 run을 추측하는 대신 정확한 `controllerRoot`와 보존 상태를 전달합니다.

## 확인한 범위

공통 checkout에서 기존64개와 새54개를 함께 실행한 host118개가 통과했습니다. 작은512/1024-byte 일반 파일, 경계·부분 write·0-progress·합성 EIO, 예약 보존, 순차 초기화, 실제 close, 논리/allocated 관찰값과 audit, CLI의 정상 BLOCKED/exit2와 실패/exit1을 확인했습니다. 소유권·교체·append와 실패 후 재사용 거절도 포함합니다. 합성 오류는 실제 OS 저장 장애가 아닙니다.

검사는 임시 소유 폴더의 합성 자료를 사용합니다. 개인 DB·사진·인증, 기존 SDK/AVD/cache/build/backup을 열거나 재해시·삭제하지 않았습니다. 다른 worktree의 진행 기록은 그 branch에 보존하며 자동 branch 동기화는 하지 않습니다.

## 실행 허용은 아직 닫혀 있습니다

정상 보고에도 `nativeAdmissionEnabled=false`, `allocationBoundProven=false`, `imageFormatted=false`가 남습니다. 최대65MiB는 API를 통한 metadata+backing의 논리 설계 범위이며 전체 native 할당량 상한의 증명이 아닙니다. descriptor·파일 변경 검사는 원자적인 OS sandbox가 아니므로 임의 process의 직접 쓰기나 경합까지 차단했다고 하지 않습니다.

형식화·mount, 실제 producer 진입 경계, 모든 native 자식·임시 파일·열린 FD와 mount 수명, 최소 생성·부팅 용량은 미검증입니다. 다음은 이 조건을 강제할 제한된 backend를 따로 준비하는 일이며, 현재 도구로 emulator나 ADB를 시작하지 않습니다. 과거 QCOW2 해시 차이의 원인도 미확정으로 유지합니다.

## 11월 3일 고정 작업자 두 파일 추가

Android6c165d6의 `single_writer_component.py`와 대응 검사만 검토 후 가져왔습니다. 기존 네 controller 파일은 바꾸지 않았습니다. 이 checkout에서 함께 실행한 host154개가 통과했으며 이 검사는 macOS OS profile을 적용하지 않습니다. 명시적 `--run-component`는 macOS의 작은 합성512바이트 일반 파일용입니다. Android branch의 실제 OS14관측은 이전 고정 소스의 근거이고 이번 통합의 새 실험으로 세지 않습니다.

저장 result.json은 최종 정리 전의 COMPONENT_PASS_ONLY/cleanup=PENDING일 수 있습니다. 최종 CLI 반환과 실제 audit/cleanup 보고서가 동반돼야 하며 사전 파일만 성공 근거로 사용하지 않습니다. 일반 파일의 RLIMIT 논리 cap과 관측 할당4096바이트는 전체 할당량·임의 native 프로세스의 제한 증명이 아닙니다. formatter·image/mount·AVD·실제 Android/Release는 실행하지 않으며 세 admission 플래그도false를 유지합니다.

## 실행할 내용을 받기 전에 검증

82c41b5의 요청 검증과 prepare 연결만 추가로 반영했습니다. raw JSON은4096 UTF-8바이트 이하이며 schema1/고정userdata 동작·파일명/512배수·32MiB 설계 상한만 받습니다. 중복 키·bool/float·경로·임의 명령과 승인 플래그는 파일 생성 전에 거절합니다. 유효해도 BLOCKED이고 실제 formatter 최소 크기·backing 예약·producer 실행 권한이 아닙니다. 반영 후 공통 전체host175개가 통과했습니다. Android 자체111개/앞선 OS14관측은 분리하며 새로운 OS·Android 실행을 하지 않았습니다.
