# Android 생성 controller의 파일 제한

`bounded_controller.py`는 시험 준비 도구가 기록하는 작은 파일의 허용 목록과 **논리 크기**를 제한합니다. `prepare_controller.py`는 이 writer를 실제 준비 흐름에 연결합니다. 선택한 크기의 새 일반 backing 파일을 zero-write로 초기화할 수 있으며 emulator/ADB, 이미지 형식화·마운트나 native 실행 기능은 없습니다.

## 구현한 범위

- 기존 workspace 바로 아래 `.build/controller-artifacts/run_<unique>`를 새로 만듭니다. 이전 run을 재사용하거나 기존 파일을 덮어쓰지 않습니다.
- 파일과 전체 예산을 디렉터리 생성 전에 검증합니다. 호출자는 기본 허용 목록을 줄일 수 있고 파일별 cap도 낮출 수 있습니다.
- 모든 기록은 처음 연 descriptor를 유지하면서 `write()`/`write_json()`으로 전달합니다. 쓰기 전에 최종 크기를 확인하며 append, 짧은 write와 부분 실패를 처리합니다.
- 파일과 디렉터리의 identity, 링크·권한·변경 시각, 미등록 파일을 확인합니다. 위반이나 쓰기 실패 뒤에는 같은 run의 추가 기록을 거절합니다.
- 삭제했지만 열려 있는 파일도 descriptor 기준 사용량에 남깁니다. 예약은 환급하지 않습니다.
- descriptor는 상속하지 않습니다. `close()`는 파일을 삭제하지 않고, 정리 실패는 `ControllerError.cleanup_report`와 `store.cleanup_report`에 남깁니다. 같은 FD 번호를 무조건 다시 닫지 않습니다.

| 기본 파일 | 논리 크기 cap |
| --- | ---: |
| `controller.sb` | 16KiB |
| `attach.plist` | 64KiB |
| `controller-events.json` | 64KiB |
| `result.json` | 64KiB |
| `output.txt` | 64KiB |
| `outside-canary` | 4KiB |

기본 예약 합계는 **276KiB**이며 설정 가능한 전체 논리 예산은 최대 **1MiB**입니다. 빈 파일은 생성되지만 최대 cap만큼 미리 데이터를 쓰거나 디스크를 채우지 않습니다.

선택적으로 `backing_bytes`를 주면 메타데이터와 별도로 최대64MiB, 512-byte 배수의 `capacity.raw`를 예약합니다. `initialize_backing()`은 최대64KiB zero buffer로 정확히 그 크기를 한 번만 순차 기록합니다. 임의 쓰기·추가 append·재초기화를 거절하고 중간 실패의 부분 파일과 예약을 보존합니다. 단순 일반 파일 초기화이며 ext4/HFS 등의 형식화와 다릅니다. backing 포함 전체 논리 예산은 최대65MiB입니다.

## 준비 도구에서 사용

같은 디렉터리의 Python 준비 도구에서 사용할 수 있습니다. `android_root`에는 기존 Android 도구 디렉터리의 절대 경로를 넘깁니다.

```python
from bounded_controller import ControllerArtifacts

with ControllerArtifacts.create(android_root) as artifacts:
    artifacts.write_json("controller-events.json", {"phase": "controller-only"})
    artifacts.write("output.txt", b"bounded controller output\n")
    artifacts.write_json("result.json", {"nativeAdmissionEnabled": False})
    report = artifacts.audit()
```

`audit()`는 열린 소유 파일의 논리 크기·할당량과 상태를 반환합니다. 예외 뒤에도 `audit()`로 부분 기록과 열린 삭제 파일의 사용량을 확인할 수 있습니다. `close()` 뒤에는 `audit()`/쓰기 API를 사용할 수 없고 정리 기록만 조회할 수 있습니다. 생성 자체가 실패한 경우에도 정리 실패가 있으면 예외의 `cleanup_report`로 전달합니다.

## 준비 흐름 실행

```sh
python3 -B qa/map-transport/android/prepare_controller.py --android-root "$PWD/qa/map-transport/android"
```

기본 실행은 backing 없이 제한된 events/canary/output/result를 기록합니다. 선택적인 `--backing-bytes 512`는 새512-byte 일반 파일만 초기화합니다. SDK나 AVD를 읽지 않습니다. 정상 controller 준비도 native 실행에는 **BLOCKED/exit2**이며, 실패는 exit1입니다. 임의 native 옵션은 쓰기 전에 거절합니다. 결과 파일의 cleanup은 기록 시점 `PENDING`, 반환 보고서는 그 뒤 실제 close 결과를 담습니다. 반환 `controllerAudit`는 `result.json`을 포함한 마지막 파일 상태이며 저장 보고서는 자기 자신의 최종 크기를 재귀적으로 약속하지 않습니다. 중간 실패의 예외와 CLI 결과는 보존한 `controllerRoot`와 최종 cleanup을 함께 전달하므로 다른 run의 경로를 추측할 필요가 없습니다.

## Producer 요청의 실행 전 검사

`producer_request.py`는 실제 생성기를 호출하지 않고 요청의 형식만 검사합니다. `prepare_controller.py`의 선택적 `--producer-request`로 연결했으며, 요청이 잘못되면 새 controller 디렉터리를 만들기 전에 거절합니다.

```sh
python3 -B qa/map-transport/android/prepare_controller.py --android-root "$PWD/qa/map-transport/android" --producer-request '{"schema":1,"operation":"create-empty-userdata","requestedBytes":512,"outputName":"userdata.img"}'
```

입력은 UTF-8 최대4,096 bytes의 JSON이며 위 네 필드만 받습니다. schema는 정수1, operation/outputName은 예시의 고정 문자열, requestedBytes는 bool이 아닌 양의 정수·512-byte 배수·최대32MiB입니다. 중복 키, 비유한 숫자, 임의 경로·실행 파일·argv·환경·호출자가 넣은 승인값은 거절합니다. CLI 옵션 축약도 받지 않습니다. API도 직렬화한 JSON만 새로 검사하며 이전 결과 dict를 승인 자료로 받지 않습니다.

유효한 요청은 bounded events/result에 `producerPreflight` 진단만 추가하고 **BLOCKED/exit2**로 끝납니다. 잘못된 요청은 FAILED/exit1, controllerRoot/cleanup은 null입니다. `userdata.img`를 만들거나 명령·승인 토큰을 반환하지 않습니다. `--backing-bytes`를 별도로 주지 않으면 backing도 만들지 않습니다. 두 크기 값은 독립적이며32MiB 요청+512-byte backing을 기록해도 용량이 맞거나 형식화할 수 있다는 뜻이 아닙니다.512 bytes는 입력 정렬의 하한이며 실제 formatter의 최소 용량은 미확인입니다.

요청 검사를 통과해도 `producerEntryVerified=false`, `allocationBoundProven=false`, `imageFormatted=false`, `nativeAdmissionEnabled=false`입니다. cached 생성기의 출처·고정 호출 인자와 guest 초기화 전 반환, OS 쓰기 보호·모든 child/mount 수명은 별도 검증해야 합니다. 기존 native gate와 버전 전용 도구는 변경하지 않았습니다.

## 검사

저장소 루트에서 실행합니다.

```sh
python3 -B -m unittest discover -s qa/map-transport/android -p 'test_*.py'
```

작은 합성 일반 파일만 쓰며 기기·SDK·형식화한 디스크 이미지를 열지 않습니다. controller/준비54개, 단일 writer helper36개와 요청 검사21개, 총111개 PASS입니다. 일반 회귀는 아래 OS profile을 적용하지 않습니다. backing 사례는512/1024 bytes만 사용하며 합성 쓰기/close 오류는 실제 OS 저장 공간 부족과 구분합니다.

## 명시적 macOS 단일 writer 구성요소

`single_writer_component.py`는 새512-byte 일반 파일 하나에만 `file-write-data`를 허용하는 고정 Python wrapper/worker입니다. fork와 다른 쓰기 권한은 추가하지 않으며 Python 실행 파일 literal만 exec 허용합니다. exec 전에 RLIMIT_FSIZE soft/hard512와 CORE0을 고정하고, exec 뒤 값·상속 FD의 EBADF·읽기 전용 stdin을 확인합니다. 고정 worker의 stdout/stderr 보관 합계는8KiB, 실행 기한은5초입니다. 정상 wait 뒤에는 PID 재사용 위험 때문에 신호를 보내지 않고 실패/기한 초과 때만 reap 전 소유 group을 정리합니다.

```sh
python3 -B qa/map-transport/android/single_writer_component.py --run-component --android-root "$PWD/qa/map-transport/android"
```

이는 별도의 명시적 macOS 검사입니다. 일반 host 회귀나 Linux CI가 자동으로 실행하지 않습니다. 실행 환경이 `sandbox_apply`를 거절하면 준비 실패로 남기며 통과로 세지 않습니다.2026-11-03의 권한이 허용된 실행에서 exact overwrite, write/ftruncate 확장의 EFBIG, hard limit 상향 거절, 외부 canary 쓰기·create/link/chmod/rename/unlink·fork 거절, 같은 PID 종료를 확인했습니다. 실제 데이터 파일은 논리512 bytes, 관측 할당4,096 bytes였고 controller의 실제 close도 CLOSED였습니다. 초기 적용 거절 시도의 새 파일은 zero512 그대로였고 제외 근거로 보존했습니다.

구성요소는 새 private temp fixture와 `.build/controller-artifacts/`의 소유 기록만 만듭니다. 부분 생성·실패에도 정확한 두 경로와 cleanup을 전달하고, 최종 controller audit가 READY가 아니면 성공을 반환하지 않습니다. 로컬 근거는 Git 제외 `docs/test-results/android-single-writer-20261103/completion-summary.json`에 있습니다. 원시 PID·경로·파일 지문은 커밋하지 않습니다.

이것은 **고정 worker에서 시험한 호출**의 결과입니다. Python exec literal이 argv·코드까지 OS로 강제하는 것은 아니고, literal 경로도 inode를 원자적으로 고정하지 않습니다. 모든 process 생성 수단·임의 formatter/native 자식·mount 수명의 증명이 아니며8KiB는 pipe 전체 송신량 상한이 아닙니다. RLIMIT_FSIZE의 [파일 크기 제한](https://docs.python.org/3/library/resource.html#resource.RLIMIT_FSIZE)도 preallocation 등을 포함한 할당량 상한이 아닙니다. 이 구성요소가 통과해도 native admission은 열리지 않습니다.

## 아직 증명하지 않은 범위

이것은 **신뢰하는 controller가 이 API로 쓰는 파일**의 논리 cap입니다. 다른 process의 직접 쓰기나 inode 교체와 동시에 발생하는 race를 원자적으로 차단하는 OS 보호 장치가 아닙니다. 실패 보고서의 사용량은 열린 소유 FD 관측값이며 미등록 외부 파일까지 제한했다는 값이 아닙니다.

실제 filesystem 할당량 상한, backing의 제한된 형식화, 외부 임시 파일 차단, 모든 native 자식·mount의 수명과 cached userdata producer의 별도 진입점은 남아 있습니다. `audit()`는 항상 `allocationBoundProven=false`, `imageFormatted=false`, `nativeAdmissionEnabled=false`를 반환합니다. 이 구성요소의 성공이나 276KiB 예약값으로 기존 공통 도구의 native gate를 열 수 없습니다. **65MiB**는 controller API의 논리 예산이며 전체 native 구성요소의 할당량 상한으로는 여전히 미구현 설계 ceiling입니다.

## 별도 8MiB ext4 형식화 구성요소

```sh
python3 -B qa/map-transport/android/ext4_component.py --sdk-root "$android_sdk"
```

macOS에서 해시가 고정된 SDK `bin64/mkfs.ext4`를 새 8MiB 일반 파일에 실행합니다. OS 프로필에서 이 파일의 데이터 쓰기만 허용하고 파일 크기 제한과 코어 덤프 제한을 적용합니다. 허용 밖의 별도 표식 파일 형식화와 한 블록 초과 형식화가 실패하는지도 확인합니다. 정상 출력의 identity, 논리 크기와 할당량, ext4 superblock을 검사합니다. 같은 SDK의 `fsck.ext4 -fn`은 쓰기가 금지된 상태에서 정상 이미지와 식별자가 손상된 합성 이미지를 검사합니다. 읽기 검사 전후 전체 이미지의 SHA-256을 대조한 뒤 임시 파일을 정리합니다. SDK 내장 userdata 생성기, 실제 AVD의 고정 용량과 첫 부팅은 별도 검증입니다. 이 명령은 에뮬레이터를 시작하지 않으며 실행 허용 상태를 바꾸지 않습니다.
