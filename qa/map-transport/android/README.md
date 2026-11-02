# Android 생성 controller의 파일 제한

`bounded_controller.py`는 시험 준비 도구가 기록하는 작은 파일의 허용 목록과 **논리 크기**를 제한합니다. emulator/ADB, 이미지 생성·형식화·마운트나 native 실행 기능은 없습니다. 공통 checkout의 기존 Android 도구를 이 worktree로 복사하거나 수정하지 않았습니다.

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

## 검사

저장소 루트에서 실행합니다.

```sh
python3 -B -m unittest discover -s qa/map-transport/android -p 'test_*.py'
```

작은 합성 일반 파일만 쓰며 기기·SDK·디스크 이미지를 열지 않습니다. 합성 쓰기/close 오류는 실제 OS 저장 공간 부족과 구분합니다.

## 아직 증명하지 않은 범위

이것은 **신뢰하는 controller가 이 API로 쓰는 파일**의 논리 cap입니다. 다른 process의 직접 쓰기나 inode 교체와 동시에 발생하는 race를 원자적으로 차단하는 OS 보호 장치가 아닙니다. 실패 보고서의 사용량은 열린 소유 FD 관측값이며 미등록 외부 파일까지 제한했다는 값이 아닙니다.

실제 filesystem 할당량 상한, backing 이미지의 생성·형식화, 외부 임시 파일 차단, 모든 native 자식·mount의 수명과 cached userdata producer의 별도 진입점은 남아 있습니다. `audit()`는 항상 `allocationBoundProven=false`, `nativeAdmissionEnabled=false`를 반환합니다. 이 구성요소의 성공이나 276KiB 예약값으로 기존 공통 도구의 native gate를 열 수 없습니다. 이전 **65MiB**는 여전히 전체 구성요소의 미구현 설계 ceiling입니다.
