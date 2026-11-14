# Android 개발·검증 기록

마지막 갱신: 2026-11-14, Asia/Seoul.

## 11월 14일 P3-02 후속: 합성 래스터 타일 한 장 요청과 렌더링

보관한 서명 APK의 기존 요청 정책이 `/resource/tile/0_0_0`을 허용해 APK를 새로 빌드하지 않았습니다. 합성 HTTPS 서버와 중계기, 캡처 대조기에 래스터 시험을 추가했습니다. Mac 루프백 검사에서 512×512 PNG의 색을 확인했고 다른 타일 경로는 404였습니다. 새 중계 JAR은 같은 도구로 다시 빌드해 바이트 일치를 확인했습니다.

전용 API 37·arm64 에뮬레이터에서 APK 설치본과 원래 파일의 SHA-256이 일치했습니다. Mac 서버의 스타일 1건(370바이트)과 줌 0 타일 1건(1,880바이트), TLS 중계 2개 연결(6,593바이트), 앱 장부의 스타일 1건·타일 1건(총 예약 8,192바이트)을 한 실행에서 대조했습니다. 같은 PID의 완전 프레임 신호와 720×1280 전면 캡처의 중앙 25/25 지점에서 타일 색을 확인했습니다. 첫 시도는 2GiB 게스트에서 스타일 응답 뒤 중계기가 `Killed`로 종료됐습니다. 종료 원인은 확정하지 않았고 3GiB 게스트의 새 실행에서 시험을 통과했습니다.

기기 준비 131개, 캡처 검사 38개, Java 중계 검사 3개가 통과했습니다. 기존 합성 배경 캡처도 다시 대조했습니다. 최종 원문은 Git 제외 `docs/test-results/android-map-transport-20261114-checkpoint/raster.Fm2mou/`에 있습니다. 전용 볼륨과 시험 연결은 제거했습니다. 제품 앱 연결, 팩 다운로드와 재실행, 실제 공급원, 실기기와 Release는 미실행입니다.

## 11월 14일 P3-02 후속: 격리 Android에서 합성 지도 렌더링 확인

보관한 수정 초안을 적용해 설치 전 읽기 조회의 일시적인 연결 실패를 재시도하고, 올바른 스트림의 빈 ADB 확인 응답을 처리했습니다. 새 고정 10GiB 볼륨을 사용하는 API 37·arm64-v8a 시험 환경에서 첫 부팅, 일회용 키 인증, 시험 APK 설치를 확인했습니다. 호스트와 설치본 SHA-256이 일치했고 제품 패키지는 설치 전 검사에서 없었습니다.

같은 시험 앱 PID에서 스타일 로드 뒤 `FRAME_RENDERED fully=true`를 확인했습니다. 전면의 720×1280 캡처에서 중앙 25개 지점 모두 합성 배경색과 일치했습니다. Mac 루프백 HTTPS 서버는 스타일 본문 124바이트를 한 번 반환했고, 중계기는 2,197바이트를 전달했습니다. 앱 장부에는 스타일 시도 1건, 타일 시도 0건, 본문 예약 4,096바이트가 기록됐습니다. 기기 실행과 캡처 검증 모두 종료 코드 0이었습니다. 로컬 근거는 Git 제외 `docs/test-results/android-map-transport-20261114-checkpoint/resume.OtSxHU/`에 있습니다.

저장한 캡처를 별도 명령으로 재검증했고, Android 준비 131개와 기기 수집 34개도 통과했습니다. 전용 에뮬레이터와 루프백 서버를 종료하고 시험 볼륨을 제거했습니다. 이 결과는 합성 스타일 1건의 Android 에뮬레이터 검사입니다. 실기기와 Release, 제품 앱 연결, 타일 요청·팩 다운로드·재실행과 실제 공급원은 미실행입니다.

## 11월 14일 사용자 요청으로 Android 작업 중지

마지막 통과는 `72ad84c`의 격리 APK 설치와 설치본 해시 대조입니다. 후속 지도 시험 세 번에서 전용 Android 부팅과 디버그 속성 조회는 확인했으나, 설치 경로에서 연결이 두 번 끊겼고 한 번은 예상 밖 응답을 받았습니다. 서버 로그에는 세 번 모두 준비 신호만 남았습니다. 응답 처리 수정 뒤 시작한 마지막 시도는 사용자 요청 시점에 이미 실행 중이었으며 부팅 대기 중 종료했습니다. 그 시도의 부팅 완료와 설치, 모든 후속 시도의 지도 실행·렌더·화면·장부 대조는 미실행입니다.

다음 재개용 수정 초안, 합성 중계 JAR과 서버 로그는 Git 제외 `docs/test-results/android-map-transport-20261114-checkpoint/`에 보관했습니다. 초안은 `72ad84c` 위에 적용할 수 있고 최종 초안의 실제 설치·렌더 검증은 남았습니다. 이번에 소유한 에뮬레이터와 서버를 종료하고 시험 볼륨과 임시 작업 폴더를 제거했습니다.

## 11월 14일 P3-02 후속: 격리 Android 시험 APK 설치

새 전용 볼륨을 연 에뮬레이터만 로컬 디버그 연결 대상으로 확인했습니다. 게스트 부팅 표식 직후 첫 연결이 준비되지 않아, 최대 35초 동안 새 전송으로 다시 확인하게 했습니다. 일회용 키 인증으로 `sys.boot_completed=1`을 읽었습니다. API 37·arm64-v8a, 제품과 시험 패키지 부재를 확인하고 기존 서명 시험 APK를 설치했습니다. 설치된 `base.apk`의 SHA-256은 호스트 시험 APK `24dc68cfb9d213e2da83afbe297577f7d73bc408cf0484589b7711ab9334e60f`와 일치했습니다. 개인 ADB 서버와 설정을 사용하지 않았고 전용 볼륨을 제거했습니다. 이 단위의 지도 실행·화면 대조는 미실행입니다. Android 준비 129개, 기기 수집 34개가 통과했습니다. [AOSP ADB 전송 규격](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/protocol.md)

## 11월 14일 P3-02 후속: 전용 Android 첫 부팅 완료

새 10GiB 볼륨의 초기 상태에서 커널 시작, 게스트 `init`의 `sys.boot_completed=1` 실행, 에뮬레이터의 새 `bootcompleted.ini` 일반 파일을 모두 확인했습니다. 에뮬레이터가 보고한 첫 부팅은 133,164ms였고 검사 종료 코드는 0이었습니다. 별도 logcat 파일은 0바이트였으므로 시스템 속성과 에뮬레이터 표식을 대조했습니다. Android 전용 프로세스를 종료하고 소유 볼륨을 제거했습니다. 이 실행에는 ADB 연결, APK 설치와 지도 표시는 없었습니다. [AOSP 에뮬레이터 부팅 표식 초기화](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-35-3-release/android/emulator/main-emulator.cpp#894)

## 11월 14일 P3-02 후속: 격리 환경 Android 커널·시스템 서비스 시작

QEMU의 커널 직렬 출력과 Android 로그 출력을 분리하자 중복 오류가 사라졌습니다. 전용 10GiB 볼륨에서 Linux 6.12 커널, `/data` 암호화 정책 적용, zygote와 `system_server` 동작을 관측했습니다. `netsimd`는 계속 차단됐고 에뮬레이터가 이전 네트워크 방식으로 전환했습니다. 호스트 제한 150초 안에 별도 게스트 로그 파일은 0바이트였으며 부팅 완료를 확인하지 못했습니다. 시험 전용 프로세스를 종료하고 볼륨을 제거했습니다. ADB, APK 설치와 Android 지도 표시는 미실행입니다. [AOSP 에뮬레이터 콘솔 구성](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp#2893)

Android 준비 회귀 125개와 기기 수집 준비 회귀 34개가 통과했습니다. Gradle 실행이 없는 상태에서 Android `app/build`의 재생성 가능한 중간 파일 25,833,472바이트를 정리했고 기존 APK 세 개의 SHA-256이 같았습니다. 정리 직후 파일시스템의 가용량 증가는 관측되지 않았습니다.

## 11월 14일 P3-02 후속: 10GiB 격리 환경 첫 부팅 시도

기록에서 1GiB는 앞선 저장공간 시험의 설계 목표였습니다. 사용자 지정 상한으로 확인되지 않았고 설치된 에뮬레이터의 일반 첫 설정 요구량은 약 7.2GiB입니다. Mac 가용량 약 45GiB에서 새 고정 10GiB 볼륨을 사용했습니다. 실제 backing 할당량과 파일시스템 용량은 각각 10,737,418,240바이트, 초기 가용량은 10,708,770,816바이트였습니다. 시험 프로필로 안쪽 쓰기 성공과 바깥 표식 읽기·쓰기 거절을 확인했습니다. 개인 홈의 SDK 외 경로 읽기를 차단하고 AVD·Android 설정·임시 파일을 새 볼륨에 고정했습니다.

첫 ADB 준비는 홈 경로가 없어 실패했습니다. ADB 없는 별도 첫 부팅 시도에서는 SDK의 용량·시스템 검사까지 통과했으나 SwiftShader Vulkan ColorBuffer 초기화가 실패해 에뮬레이터가 종료됐습니다. 게스트 커널·부팅 완료 신호는 관측하지 못했습니다. 새 볼륨은 해제·삭제했고 기존 AVD·SDK·공통 폴더를 보존했습니다. 이 시도에서 기기 연결, APK 설치 및 지도 렌더링은 미실행입니다.

공식 `-feature -Vulkan`을 적용하자 그래픽 초기화를 지나 QEMU 시작 속성까지 도달했습니다. QEMU 내부가 `-serial stdio` 중복으로 코드 1을 기록했지만 바깥 실행기는 0으로 끝났습니다. `netsimd` 실행도 현 프로필에서 거절됐습니다. 게스트 부팅 신호가 없어 검증은 실패로 분류했고 시험 볼륨을 제거했습니다. [Android Emulator 문제 해결](https://developer.android.com/studio/run/emulator-troubleshooting)

## 11월 14일 P3-02 후속: 디스크 준비와 에뮬레이터 실행 분리 검증

`58a8009`에서 재개했습니다. Mac 가용 공간은 약 49GiB였으며 전용 USB Android 기기, 실행 중인 ADB, 보관된 전용 AVD·userdata 및 마운트된 소유 시험 볼륨은 확인되지 않았습니다. 보관 시험 APK는 발견했습니다.

기존 userdata 준비의 실제 macOS 읽기·쓰기 프로필에서 해시 고정 SDK `qemu-img --version`은 두 번 성공했습니다. 동일 프로필에서 SDK 에뮬레이터, arm64 QEMU, ADB의 버전 호출은 각각 운영체제의 `Operation not permitted`로 거절됐습니다. SDK 경로와 실행 파일 존재를 먼저 확인했고, 여섯 실행 거절 외에 임시 파일이 생기지 않았습니다. 재현 옵션은 `avd_userdata_component.py --verify-exec-boundary`입니다. 공통의 읽기 전용 기기 준비 검사도 `BLOCKED`, `nativeLaunchAllowed=false`, 준비 표식 미발급을 반환했습니다.

이 단위는 이미지 준비 도구의 실행 범위를 확인합니다. 고정 볼륨을 다시 만들지 않았고, 개인 AVD·SDK 및 공통 폴더를 보존했습니다. Android 게스트 첫 부팅·암호화, APK 설치, 실제 맵 프레임과 서버·장부 대조는 미실행입니다. 별도 기기 또는 검증 가능한 전용 실행 경로가 필요합니다.

## 11월 13일 Android 저장 지점: AVD 준비 파일과 보관 APK의 공간 대조

768MiB 전용 볼륨에 전용 AVD 설정, 독립 512MiB userdata와 해시를 대조한 보관 APK 19,438,330바이트를 배치했습니다. 모두 배치한 뒤 가용량은 230,080,512바이트였습니다. 시험 볼륨과 배치 사본은 해제·제거하고 원래 APK를 보존했습니다. 이 값은 첫 부팅 전 가용량입니다.

배치 파일의 해시 불일치 및 덮어쓰기 거절을 포함해 최종 Android 준비 검사 125개가 통과했습니다. 연결된 소유 시험 볼륨은 0개였고 Mac 가용 공간은 약 26GiB였습니다. 300분 공유 한도 잔여 19%를 확인해 현재 배치 검증까지만 저장했습니다.

Android를 부팅하지 않았으며 실제 SDK 앱 설치·렌더·서버·장부 대조는 미실행입니다. 다음은 사용자 데이터 암호화와 첫 부팅의 전체 쓰기 범위를 검증하거나 별도 전용 Android 기기에서 확인하는 것입니다. 일반 첫 부팅 경로의 약 7.2GiB 가용량 요구와 이번 1GiB 시험 범위를 함께 적용해 기존 AVD를 사용하지 않았습니다.

## 11월 13일 P3-02 후속: QCOW2 외부 데이터와 스냅샷 거절

독립 이미지 검사에서 backing 참조 외에도 외부 데이터 플래그와 스냅샷 테이블을 거절하도록 보강했습니다. 실제 SDK 변환본은 세 조건을 모두 통과했고 전용 AVD 조립과 제거까지 확인했습니다. 외부 데이터와 스냅샷을 넣은 합성 헤더 회귀를 포함해 Android 준비 검사 123개가 통과했습니다. [QCOW2 형식](https://www.qemu.org/docs/master/interop/qcow2.html)

## 11월 13일 P3-02 후속: 전용 AVD에 독립 userdata 조립

`avd_config_component.py --prepare-userdata`로 한 고정 볼륨 안에서 전용 AVD 탐색과 독립 userdata 형식 검사를 순서대로 실행했습니다. 전용 AVD 한 개가 표시됐고, 같은 AVD 폴더에는 `config.ini`와 새 512MiB `userdata-qemu.img`만 남는 것을 확인했습니다. 변환 대조본을 제거한 뒤 볼륨 전체를 해제·삭제했습니다. 설치된 API 37 이미지에는 사용자 데이터 암호화가 켜져 있습니다. 실제 부팅과 암호화 호환성은 아직 확인하지 않았고 `nativeAdmissionEnabled=false`를 유지합니다.

## 11월 13일 P3-02 후속: 전용 AVD만 탐색되는지 확인

768MiB 전용 볼륨 안에 새 AVD 등록과 설정을 만들었습니다. SDK에 설치된 해시 고정 에뮬레이터의 `-list-avds`를 쓰기 범위가 그 볼륨에 한정된 상태에서 실행했고 생성한 AVD 이름 하나만 표시됐습니다. 설정 외 게스트 파일은 생성되지 않았고, 소유 볼륨을 해제·제거했습니다. 개인 Android 폴더는 읽기를 차단했습니다. 설정 탐색만 확인했고 부팅·ADB·APK 설치는 실행하지 않았습니다. [Android Emulator 명령](https://developer.android.com/studio/run/emulator-commandline)

## 11월 13일 P3-02 후속: 고정 볼륨 안의 독립 userdata 이미지 준비

SDK에 설치된 해시 고정 도구로 768MiB 전용 볼륨 안에 512MiB ext4를 새로 만들고 QCOW2로 변환했습니다. 원본 논리·할당량은 536,870,912바이트였고, QCOW2 게스트 용량은 동일하며 호스트 논리·할당량은 모두 917,504바이트였습니다. 헤더와 `qemu-img info`에서 외부 backing이 없음을 확인했습니다. `fsck.ext4 -fn`, `qemu-img check`, raw/QCOW2 가상 내용 비교가 통과했고 새 볼륨과 두 이미지를 제거했습니다. Android 준비 회귀 122개도 통과했습니다. [QEMU 디스크 도구](https://www.qemu.org/docs/master/tools/qemu-img.html)

AOSP의 일반 시작 코드에는 기존 userdata가 있는 경우와 새로 만드는 경우가 나뉩니다. 이 결과는 독립 파일의 형식과 일치 검증이며, 그 파일이 API 37에서 첫 부팅·암호화·APK 설치를 감당한다는 근거는 아직 없습니다. 외부 backing과 개인 AVD를 사용하지 않았고 에뮬레이터를 시작하지 않았습니다. [AOSP userdata 선택](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp#2244)

## 11월 13일 P3-02 후속: 전용 Android 설치 전 호환성 확인

이미 확인된 연결에서 부팅 완료, Android API 36 이상, arm64-v8a, 제품 앱과 이전 시험 앱의 부재를 읽기 전용으로 확인하는 검사를 추가했습니다. 호환되지 않으면 설치 전에 중단하며 패키지 출력이 비정상이거나 원래 앱이 있으면 거절합니다. 합성 명령을 포함한 기기 준비·수집 회귀 34개가 통과했습니다. 실제 기기에서의 준비 검사와 설치·실행은 남아 있습니다.

## 11월 13일 P3-02 후속: 게스트에 설치된 APK의 해시 대조 준비

시험용 패키지의 `pm path`에서 단일 `base.apk`만 확인하고, 게스트에서 그 파일의 SHA-256을 수집 전후로 대조하도록 했습니다. 호스트의 고정 해시와 같아야 하고, 경로와 PID가 수집 중 바뀌면 결과를 거절합니다. 관련 없는 패키지 경로와 변경된 해시를 포함한 합성 명령 회귀 31개가 통과했습니다. 실제 게스트 명령 및 렌더 수집은 보류입니다.

## 11월 13일 P3-02 후속: 설치된 에뮬레이터의 첫 부팅 용량 분기

설치된 Emulator 37.2.12의 arm64 QEMU(SHA-256 `8dcdec74dc2d2cf4d9cfbf8146506b48e13d389ae59ef5be1966ff72d44af033`)를 실행하지 않고 역어셈블했습니다. `_main`의 `0x1001af13c`는 6,442,450,944바이트를 설정하고 `0x1001af150`에서 설정 파일 갱신 함수를 호출합니다. 새 userdata 파일이 없을 때 이어지는 비교는 `1.2` 배율과 사용 가능 바이트를 비교하며, 부족하면 `Not enough space to create userdata partition` 분기로 갑니다. AOSP 소스에서 이 분기가 API 24 이상 또는 Play Store 이미지의 새 설정에 적용되는 것을 대조했습니다. [AOSP 첫 부팅 용량 분기](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp#2428)

설치된 이미지는 API 37 Play Store입니다. 일반 첫 부팅의 요구 가용량은 약 7.2GiB로, 실제 대조한 768MiB 볼륨의 가용량 786,399,232바이트를 넘습니다. 1GiB 시험 범위에서 이 조합의 일반 첫 부팅을 실행하지 않았습니다. 기존 SDK·개인 AVD는 보존했습니다. 전용 Android 기기 또는 이 요구량을 피할 수 있는 지원되는 별도 이미지 경로가 필요합니다.

## 11월 13일 P3-02 후속: 전용 볼륨의 실제 다중 파일 쓰기 한도

새 768MiB HFS+ 볼륨에서 OS 쓰기 범위를 마운트 내부로 제한한 고정 작업자를 실행했습니다. 바깥 표식 쓰기가 거절됐고 내용이 유지됐습니다. 볼륨 내부에는 파일 47개에 총 785,383,424바이트를 쓰고 `ENOSPC`를 받았습니다. 소유 파일을 지운 뒤 새 파일 쓰기가 다시 성공했습니다. backing 논리 크기·할당량 모두 805,306,368바이트를 유지했고 소유 볼륨은 해제·제거했습니다.

이 검사는 제한된 호스트 작업자의 실제 파일시스템 한도입니다. Emulator/QEMU/ADB 전체 쓰기 제한과 Android 첫 부팅·APK 실행은 보류입니다.

## 11월 13일 P3-02 후속: 768MiB 전용 볼륨의 실제 용량 확인

`bde1a8d`에서 재개했고 전용 Android 연결은 확인되지 않았습니다. 새 HFS+ 고정 이미지를 만들고 논리 크기·호스트 실제 할당량·마운트된 파일시스템 용량이 모두 805,306,368바이트인지 대조했습니다. 최초 가용량은 786,399,232바이트였습니다. 이미지와 연결 장치를 대조해 소유 볼륨만 해제하고 제거했습니다. 현재 macOS의 빈 이미지 생성에서는 `-format UDRW`가 입력 원본을 요구해 실패했고, `-type UDIF`로 다시 실행해 성공했습니다.

이 단계는 독립된 고정 용량 볼륨의 실제 확인입니다. AVD/QEMU 쓰기 제한, userdata 생성과 첫 부팅은 보류이며 `nativeAdmissionEnabled=false`입니다. 개인 AVD·앱·SDK 및 공통 폴더를 보존했습니다.

## 11월 13일 Android 저장 지점과 다음 기기 시험

실행 준비 소스 `16c645f`, 렌더 콜백이 들어간 서명 APK 소스 `9302e4b`입니다. 최종 APK와 인증서, 이전 중계 JAR이 보관되어 있고 APK 해시와 캐시 정리를 재확인했습니다. Mac 가용 공간은 확인 시 약 29GiB입니다. 시험 서버·중계나 ADB·에뮬레이터는 실행 중인 소유 프로세스가 없습니다.

다음은 별도 허용된 Android 환경에서 시험 APK 설치, HTTPS 중계, 렌더 완료 뒤 화면·요청·장부 대조입니다. 전용 기기 연결 또는 기존 개인 AVD와 분리된 검증된 실행 환경이 필요합니다. 현 단위에서 실제 Android 앱 시작·JNI·화면·장부 수집, 전체 AVD 쓰기 상한과 첫 부팅, 팩 귀속 및 공급원 다운로드는 미실행입니다. 체크리스트의 기기 항목은 유지합니다.

## 11월 13일 P3-02 후속: 수집 시 시험 APK 고정

수집 시작 전에 사전 검사에서 고정한 APK SHA-256과 현재 호스트 파일을 대조하고, 최종 증거와 함께 다시 비교합니다. 시작 전에 다른 APK가 주어지면 게스트 명령을 보내지 않습니다. 수집 중 APK 바이트가 바뀌면 결과를 거절하고 기존 증거만 보존합니다. 두 경우를 포함해 호스트 수집·대조 29개가 통과했습니다. 이 확인은 호스트 APK 파일에 적용되며 실제 게스트의 설치 APK 대조와 실행은 보류입니다.

## 11월 13일 P3-02 후속: 손상된 합성 ext4를 읽기 전용으로 거절

임시 8MiB 이미지에서 ext4 superblock 식별자 두 바이트만 바꿨습니다. 쓰기가 금지된 SDK `fsck.ext4 -fn`이 `Bad magic number`로 실패했고, 검사 전후 손상 상태의 전체 파일 SHA-256이 일치했습니다. 최초의 가용 블록 카운터 변경은 SDK 도구가 오류로 반환하지 않아 오류 검증에서 제외했습니다. 같은 최종 검사에서 정상 이미지와 범위 밖·초과 쓰기 거절이 통과했고 임시 파일을 제거했습니다. Android 또는 사용자 데이터 복구 검사는 보류입니다.

## 11월 13일 P3-02 후속: SDK의 읽기 전용 ext4 무결성 검사

정상 형식화 뒤 해시를 고정한 SDK `fsck.ext4 -fn`으로 임시 8MiB 파일 전체의 파일시스템을 검사했습니다. 쓰기 권한이 없는 OS 프로필과 파일 쓰기 상한 0을 적용했고 종료값 0 및 검사 전후의 전체 이미지 SHA-256 일치를 확인했습니다. 범위 밖 쓰기와 초과 형식화의 거절도 이어서 통과했습니다. 검사 뒤 두 임시 파일을 제거했습니다. [e2fsck 읽기 전용 옵션](https://man7.org/linux/man-pages/man8/e2fsck.8.html)

## 11월 13일 P3-02 후속: SDK 형식화 쓰기 거절 대조

같은 SDK 실행 파일로 허용 밖의 합성 표식 경로를 형식화하려 하자 OS가 `Operation not permitted`로 거절했고 표식 바이트가 유지됐습니다. 허용 파일에 한 블록을 더 요청하자 short write로 실패했고 파일 identity, 논리 8MiB와 실제 할당량은 유지됐습니다. 사이에 실행한 정상 형식화의 ext4 헤더도 검증했습니다. 초과 실패 뒤 이미지 내용의 원자적 복구는 이 시험 범위에 포함하지 않습니다. 두 소유 임시 파일은 제거했습니다. 이 결과로 에뮬레이터 실행을 허용하지 않습니다.

## 11월 13일 P3-02 후속: 새 APK의 인증서로 배포 SDK 요청 재현

새 APK의 SHA-256·서명·포트·인증서를 검사한 뒤, 배포 MapLibre Java 요청에서 Mac 중계·합성 HTTPS 서버와 파일 장부까지 연결하는 재현 명령을 추가했습니다. 실제 APK의 인증서로 정상 스타일 200·124바이트 한 건을 받았고 거절 로그는 0건입니다. 중계 2,452바이트, 요청 1회·타일 0회·예약 4,096바이트, 장부 52바이트를 대조했습니다. 소유 서버와 임시 파일을 정리했습니다.

이 검사의 SDK Java 요청은 JNI 포인터 0으로 호출합니다. 보관 APK의 앱 시작·실제 기기 화면·JNI는 아직 보류입니다.

## 11월 13일 P3-02 후속: 합성 스타일 서버의 요청 헤더와 실패 기록

합성 스타일 서버는 고정 User-Agent와 identity 인코딩의 스타일 GET만 받습니다. 인증·쿠키·범위·조건부 헤더가 있는 요청은 거절하고 값 없이 고정 사유만 로그에 기록합니다. 서버의 실패 로그가 하나라도 있으면 화면·장부 검증을 통과하지 못합니다.

새 시험 인증서로 Mac HTTPS를 실행했습니다. 정상 124바이트 응답 1회, 헤더 위반 400 세 건, 쿼리 404 한 건, POST 405 한 건을 대조했습니다. 중계의 TLS·한도·시간 제한 검사와 수집·증거 회귀 27개도 통과했습니다. 서버와 임시 파일을 정리했습니다. Android 기기에서의 서버 요청·화면 대조는 보류입니다.

## 11월 13일 P3-02 후속: SDK ext4 도구의 단일 파일 제한 검사

macOS에서 설치된 Android SDK `bin64/mkfs.ext4`의 SHA-256을 고정하고 새 8MiB 일반 파일만 형식화했습니다. OS 프로필은 그 파일의 데이터 쓰기만 허용했습니다. 파일 크기 상한과 코어 덤프 제한을 설정하고 상속 FD를 닫은 상태에서 고정 명령을 실행했습니다. 완료 뒤 파일 identity·링크·다른 출력 파일의 부재를 확인했습니다. ext4 superblock은 4,096바이트 블록 2,048개였고 논리·할당 크기 모두 8,388,608바이트였습니다. 소유 임시 파일을 제거했습니다.

Android 준비 회귀 116개와 실제 macOS 구성요소 실행이 통과했습니다. 이 도구는 SDK의 별도 `mkfs.ext4`입니다. QEMU 내부 userdata 생성, 전체 쓰기 제한, 첫 부팅과 APK 실행은 검증되지 않아 `nativeAdmissionEnabled=false`를 유지합니다.

## 11월 13일 P3-02 후속: 화면 수집 명령의 연결 고정과 출력 상한

검증된 ADB 전송 ID에 명령을 고정하고 호출 전후로 기존 연결을 재확인하는 수집용 어댑터를 추가했습니다. 명령별 stdout과 stderr 상한을 넘으면 결과를 반환하지 않고, 기한 안에 종료하지 않으면 시작한 로컬 명령 그룹을 종료합니다. 연결이 바뀌거나 명령이 실패하면 화면과 장부 수집에 그 결과를 전달하지 않습니다.

로컬 자식 명령에서 정확한 상한, 초과, 비정상 종료, 유휴와 출력 종료 뒤 대기를 검사했습니다. 전송 ID 및 연결 변경 검사는 대역을 사용했습니다. 수집·증거 검사와 합쳐 26개가 통과했습니다. 이 어댑터는 기기를 선택하거나 실행을 허용하지 않으며 실제 Android 수집은 보류입니다.

## 11월 13일 P3-02 후속: 격리 기기 화면과 장부 수집 순서

검증된 전송 연결을 받아 사용하는 읽기 전용 수집기를 추가했습니다. 서버·중계 로그를 먼저 대조하고 현재 시험 PID의 완전 프레임 로그를 확인합니다. 시험 Activity가 전경에 있는지 화면 앞뒤로 확인하고 PID가 바뀌면 화면이나 장부 저장을 거절합니다. 장부는 시험 앱의 정확한 경로만 요청합니다. 새 private 디렉터리에만 기록하고 실패 시 이미 쓴 증거를 보존합니다. [Android 화면 캡처 명령](https://developer.android.com/tools/adb)

합성 명령과 증거 검사 18개가 통과했습니다. 수집기는 기기를 선택하거나 부팅하지 않으며 연결 검증·시간·출력 제한은 호출자가 공급해야 합니다. 실제 `logcat`·화면·장부 수집은 격리 기기에서 남아 있습니다.

## 11월 13일 P3-02 후속: 실제 프레임 확인 신호와 새 시험 APK

`ea5c77a`에서 재개했습니다. 보관 APK의 SHA-256·서명과 서버 키를 대조했고 기존 인증서는 11월 13일 21:11 KST까지 유효했습니다. 격리 Android 연결은 확인되지 않았습니다. 읽기 전용 준비 검사에서 고정 용량과 쓰기 제한, 첫 부팅과 userdata 생성이 미입증인 상태를 확인했습니다.

별도 APK는 시험 배경 레이어를 로드한 뒤 MapLibre가 보고한 첫 완전 프레임을 기록합니다. 화면·장부 대조기는 `--require-render-event`에서 그 순서를 요구하고, 초기 APK는 이 옵션 없이도 대조할 수 있습니다. 새 순서와 누락·중복 거절을 포함한 합성 증거 검사 11개, Android 36 Java·DEX 검사, `assembleDebug` 35개 task를 통과했습니다. 최종 APK DEX에서 프레임 리스너와 로그를 확인했습니다. [MapLibre 렌더 콜백](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/maps/MapView.java)

새 APK의 SHA-256은 `24dc68cfb9d213e2da83afbe297577f7d73bc408cf0484589b7711ab9334e60f`이고 새 합성 인증서는 11월 27일 10:16 KST까지 유효합니다. 서명·APK 정렬·권한·배포 라이브러리와 새 인증서를 대조했습니다. APK와 키는 Android 작업 폴더의 Git 제외 영역에 보존하고 이번 전용 Gradle 캐시를 정리했습니다. 기존 APK, 개인 AVD·앱·SDK와 공통 폴더를 보존했습니다. APK 설치, JNI 실행, 실제 화면·장부는 보류입니다.

## 11월 12일 P3-02 후속: 복제한 Kotlin 시작 코드와 공급자 위임 검증

`1d8889d`에서 재개했습니다. 생성된 Kotlin `MainApplication`을 임시 폴더에 복제하고 시험 전용 패키지에 `FixtureReactBootstrap.install(this)`를 넣었습니다. Kotlin 2.2.21로 Android 36 API, 배포 MapLibre 13.6.1, 실제 RN MapLibre 11.5.0 변환기와 함께 컴파일했습니다. RN·Expo의 나머지 시작 API는 컴파일용 대역을 사용했습니다. JVM 바이트코드에서 `super.onCreate()` → 시험 공급자 설치 → `loadReactNative()` 호출 순서를 확인했습니다.

호스트에서 같은 초기화 함수의 포트·인증서 입력 경로를 호출하고 등록된 SDK 공급자로 실제 요청을 보냈습니다. RN 변환기가 바꾼 허용 주소로 요청 1회가 도착했습니다. 고정 User-Agent, Range·ETag, 예약 4바이트를 대조했고 변환기가 추가한 인증 헤더는 제거됐습니다. 쿼리와 다른 포트는 전송 전에 거절됐습니다. 임시 Kotlin 시험 함수가 Java 패키지 내부 타입을 노출한다는 컴파일 경고 두 건이 있었으며 제품 코드는 변경하지 않았습니다. 실제 Android `onCreate()` 실행, APK 설치와 렌더링은 보류입니다. 개인 AVD·앱·SDK와 공통·iOS 폴더를 보존했습니다.

## 11월 12일 P3-02 후속: React Native 시작과 실제 요청 변환 조사

생성된 Kotlin `MainApplication`은 `super.onCreate()` 뒤 `loadReactNative(this)`를 실행합니다. 설치된 MapLibre React Native 11.5.0의 eager `MLRNMapViewModule`은 UI 스레드에서 `MapLibre.getInstance()`를 호출합니다. Node 24.21.0의 Expo `withMainApplication`을 메모리 사본에서 실행해 두 호출 사이의 삽입, 반복 적용 중복 방지, 앵커 누락·중복 거절을 확인했습니다. 생성 파일이나 제품 소스는 편집하지 않았습니다.

RN의 `MLRNTransformRequestModule`은 `HttpRequestUtil.setOkHttpClient()`를 통해 SDK 기본 `HttpRequestImpl`의 클라이언트를 바꿉니다. 별도 공급자가 같은 변환이 필요하면 실제 변환기를 연결하고 그 결과에 주소·헤더 제한을 적용해야 합니다. 설치된 `TransformRequestInterceptor.kt`를 Kotlin 2.2.21로 호스트에 컴파일해 확인했습니다. Android 빌드 버전과 로그 API만 호스트 대역을 썼습니다. 허용 주소의 변환, 고정 User-Agent·identity와 어댑터의 Range·ETag 유지, RN이 추가한 인증 헤더 제거를 확인했습니다. RN이 추가한 query와 다른 포트는 모두 전송 전에 차단됐습니다. 서버 1회·예약 4바이트였습니다. 최신 시험 앱 Java/DEX의 Android 36 검사도 통과했습니다.

설치된 SDK로 읽기 전용 준비 점검을 다시 실행했고, fresh AVD의 고정 용량, 전체 쓰기 제한, 첫 부팅 용량, userdata 생성 경계가 미입증이라 실행 허용은 `false`입니다. 이번에 새로 실행한 Android 기기 시험은 없습니다. 다음 실제 단계는 검증된 격리 환경에서 보관 APK·중계·합성 서버를 시작해 기기 화면과 앱·서버·장부를 대조하는 것입니다. 개인 AVD·앱·SDK와 공통·iOS 폴더는 보존했고 P3-02를 완료 처리하지 않았습니다.

## 11월 12일 P3-02 후속: HTTP/2 스트림 거절과 503 후속 전송 차단

합성 서버에서 첫 타일 스트림을 `REFUSED_STREAM`으로 종료했습니다. 다음 Call에는 `Retry-After: 0`인 503을 반환했고, 자동 후속 시도는 서버에 보내기 전에 전송 제한으로 차단됐습니다. 직접 새로 시작한 같은 타일 Call은 완료됐습니다. 준비 요청을 포함해 같은 TLS 연결에서 기록 네 개, 타일 시도 3회, 본문 예약 16바이트를 대조했습니다. 배포 클래스와 HTTP/2 호스트 사례 네 개를 모두 통과했습니다.

## 11월 12일 P3-02 후속: HTTP/2 조건부 요청과 바이트 범위 대조

배포 MapLibre 요청 인터페이스에 합성 어댑터를 연결했습니다. 같은 TLS/HTTP/2 연결에서 ETag 우선순위·빈 304와 HTTP 날짜·단일 바이트 범위의 206을 확인했습니다. 요청하지 않은 304와 다른 범위의 206은 거절했고, 접미 범위는 서버에 도착하지 않았습니다. 준비 요청을 포함해 5회·예약 20바이트를 대조했습니다. HTTP/2 호스트 사례 세 개가 배포 인터페이스와 호스트 서명 사본에서 각각 통과했습니다.

## 11월 12일 P3-02 후속: Android 합성 HTTP/2 수신 중 취소

TLS/HTTP/2 타일의 첫 바이트를 받고 나머지를 기다리는 동안 같은 연결의 다른 스타일 요청을 완료했습니다. 타일을 두 번 취소하자 진행 중인 읽기가 IOException으로 끝났고, 새 Call의 같은 타일은 완료됐습니다. 같은 연결의 순번 0~3과 서버 요청 4회·타일 2회·예약 16바이트를 대조했습니다. 취소 뒤 서버의 보류된 writer 종료 로그가 있었고, 취소와 재요청은 모두 검증 기준을 통과했습니다.

기존 HTTP/2 대기·취소·상한과 이 수신 중 취소 사례를 함께 실행해 통과했습니다. Mac JVM의 공유 연결 검사입니다. 기본 시험 APK는 기존 HTTP/1.1이며 실제 Android 기기 실행과 OS 수신량 측정은 보류입니다.

## 11월 12일 P3-02 후속: Android 합성 전송의 HTTP/2 공유 연결 호스트 검사

JDK 17과 MockWebServer 4.12.0에서 TLS/HTTP/2를 협상했습니다. 연결 하나에서 콜백 네 개가 본문을 보유하는 동안 두 요청이 대기했습니다. 그중 하나는 전송 전에 취소됐고 다른 하나는 자리가 난 뒤 완료됐습니다. 준비 요청을 포함해 같은 연결의 순번 0~6, 서버 요청 7회·타일 2회·예약 28바이트를 대조했습니다. 예약을 넘는 본문도 거절했고 이미 기록한 예약은 남았습니다. [MockWebServer 배포 소스](https://github.com/square/okhttp/blob/parent-4.12.0/mockwebserver/src/main/kotlin/okhttp3/mockwebserver/MockWebServer.kt)

별도 HTTP/2 호스트 검사와 기존 배포 MapLibre JAR 호스트 18묶음이 모두 통과했습니다. 시험 APK의 기존 HTTP/1.1 경로를 유지하며 Android 게스트에서 HTTP/2는 보류입니다. 다음은 수신 도중 한 스트림의 취소와 같은 연결의 후속 요청을 확인하는 것입니다.

## 11월 12일 P3-02 후속: 배포 MapLibre Java 요청·중계·장부 연결

보관 APK의 포트와 인증서를 사용하고, MapLibre OpenGL 13.6.1 배포 JAR의 `NativeHttpRequest`에서 실제 공급자와 OkHttp 경로를 호출했습니다. Mac의 두 loopback 포트로 중계를 대체해 서버의 응답 1회·124바이트와 HTTP 200을 확인했습니다. 중계가 전달한 TLS 데이터는 합계 2,452바이트였고, 새 장부의 스타일 예약 1회·타일 0회·예약 4,096바이트와 52바이트 장부 파일을 대조했습니다. 소유 임시 서버·파일은 검사 뒤 정리했습니다.

이 검사는 Mac의 배포 SDK Java 경로입니다. JNI 포인터는 0으로 두었고 게스트 별칭·기기 설치·지도 렌더링은 보류입니다. 공통의 Android 실행 보호 코드는 호스트 할당량과 쓰기 제한이 입증되기 전에는 계속 실행을 거절합니다.

## 11월 12일 P3-02 후속: 실제 시험 입력과 인증서 유효기간 대조

시험 시작 전 APK SHA-256·서명·패키지·arm64/API 36, 고정 포트, APK와 서버의 공개 인증서, 대응 개인 키의 서명, IP SAN과 남은 인증서 유효기간을 한 번에 확인하도록 했습니다. 실제 보관 APK와 TLS 자료가 통과했습니다. 잘못된 APK 해시, 다른 인증서, 같은 인증서만 들어 있고 개인 키가 없는 PKCS#12는 모두 거절했습니다.

이 합성 인증서의 유효기간은 11월 13일 21:11 KST까지입니다. 시험 전 15분 이상 남아야 하며, 만료 이후에는 새 인증서를 적용한 별도 APK가 필요합니다. 보관한 APK와 기존 TLS 자료는 유지했습니다. 이 단계에서 게스트나 서버를 시작하지 않았습니다.

## 11월 12일 P3-02 후속: Android 화면·로그·장부 대조 준비

별도 검증기가 APK 안의 포트, Mac 서버 응답 1회·124바이트, 중계 완료, 같은 PID의 시작·스타일 로그와 장부의 스타일 예약 1회·4,096바이트를 대조합니다. PNG 중심 25개 지점에서 합성 지도 배경색을 비교해 스타일 로그가 있어도 빈 화면을 거절합니다. 앱 로그에 실패·다른 PID가 섞였거나 장부 길이·CRC·설정 또는 서버 횟수가 다르면 실패합니다.

합성 증거 회귀 9개가 통과했습니다. 보관한 실제 APK와 Java 장부가 쓴 52바이트 파일도 검증기에 입력해 합성 로그·PNG와 대조했습니다. 설치된 API 37 소스에서 `unix:nlink` 속성의 구현과 배포 JAR에서 내부 캐시 경로 선택을 확인했습니다. 장부는 호스트 기록이고 화면은 합성 입력입니다. Android 앱 실행·렌더링·기기 장부 검사는 보류입니다.

## 11월 12일 P3-02 후속: 보관 APK에 맞춘 에뮬레이터 HTTPS 중계 준비

`08dc4f1`에서 재개했습니다. 보관한 `c1381c3` APK의 SHA-256과 서명이 일치했고, APK에 포함된 인증서와 포트를 대조했습니다. 연결된 격리 Android는 확인되지 않았고 기존 AVD는 실행하지 않았습니다.

게스트의 `127.0.0.1`에서 APK가 사용하는 포트만 받아 Mac의 에뮬레이터 loopback 별칭 `10.0.2.2`로 그대로 전달하는 별도 중계를 준비했습니다. TLS는 앱과 Mac 서버 사이에서 종단하며, 중계는 연결 하나·방향별 65,536바이트·30초로 제한합니다. 합성 서버가 응답 뒤 연결을 닫도록 했습니다. [Android 에뮬레이터 주소](https://developer.android.com/studio/run/emulator-networking-address)

호스트에서 보관 APK의 실제 공개 인증서로 인증·호스트명 확인을 거쳐 124바이트 스타일을 받았습니다. 초과 전송과 무응답 연결 종료도 통과했습니다. Android 36 도구로 중계를 DEX JAR로 만들고 진입 클래스를 확인했습니다. 이 검사에서는 양쪽 호스트 소켓으로 중계를 검증했습니다. 실제 게스트의 별칭, `app_process`, APK 설치와 렌더링은 보류입니다. 기존 APK, SDK, AVD 및 공통·iOS 작업 폴더를 보존했습니다.

## 11월 11일 P3-02 후속: 조건부·범위 요청을 포함한 최종 시험 APK

Android `c1381c3`의 소스로 arm64 Debug 시험 APK를 다시 빌드했습니다. `assembleDebug` 35개 task와 서명·권한·APK 정렬·MapLibre 라이브러리 해시·합성 자원 검증을 통과했습니다. 최종 APK의 DEX에서 MapLibre 요청 클래스와 시험 앱 시작·공급자·조건부·범위 클래스 6개를 확인했고, 네이티브 라이브러리의 ELF load segment 세 개는 모두 16KiB 정렬입니다. APK는 19,438,326바이트, SHA-256 `3a7bb48d487b151ddf6c418a521b836b30f9ea27ac17def3b1a332057a19c40f`입니다.

최종 APK와 합성 인증 자료는 Git 제외 Android 시험 폴더에 보존했습니다. 교체한 시험 APK와 다시 생성된 전용 Gradle 캐시는 정리했습니다. Android 기기 설치·실행, JNI·렌더링, 오프라인 팩 귀속과 OS 실제 수신량은 보류입니다. 다음 실행 단위는 격리된 Android 환경에서 인증서가 고정된 합성 서버로 스타일 요청을 보내고 기기의 렌더링·장부를 대조하는 것입니다. 이 APK를 제품 실행이나 P3-02 완료로 집계하지 않습니다.

## 11월 11일 P3-02 후속: Android 단일 바이트 범위와 팩 귀속 조사

합성 어댑터는 요청별 예약 안의 단일 닫힌 범위만 전송합니다. 시작·끝·전체 길이와 일치하는 단일 `Content-Range`, 정확한 고정 길이와 206, 또는 검증자를 보낸 요청의 빈 304만 받습니다. 서버가 범위를 무시하고 돌려준 200, 범위나 길이가 다른 206, multipart, 범위를 보내지 않은 206은 거절했습니다. 합성 서버의 요청 7회, 타일 1회, 예약 28바이트를 대조했습니다. 예약을 넘는 범위와 열린 범위, 접미 범위, 다중 범위, 역순·오버플로는 전송하지 않았습니다. 배포 AAR Java 호스트 18묶음과 Android 36 소스·DEX 검사가 통과했습니다.

배포 클래스의 `OfflineRegion`은 ID·메타데이터를 제공합니다. Java HTTP 요청에는 요청 포인터, URL, 범위·검증자와 오프라인 용도의 불리언 값이 전달됩니다. 이 인터페이스만으로는 어떤 팩의 요청인지 결정할 수 없어 장부를 시험 세션 단위로 유지합니다. 팩 귀속에는 별도 연결과 검증이 필요합니다. [MapLibre Java 요청 인터페이스](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/HttpRequest.java)

## 11월 11일 P3-02 후속: Android 조건부 HTTPS 요청

MapLibre Android 13.6.1의 ETag 우선순위를 따릅니다. 합성 어댑터가 검증한 단일 ETag 또는 GMT HTTP 날짜만 요청에 추가하고, 변환기가 추가한 임의 조건부 헤더는 제거합니다. 조건부 304는 빈 본문으로 전달합니다. 조건 없는 304, 양수 길이의 304, 잘못된 태그와 날짜는 거절합니다. 합성 서버에 도착한 5회는 응답 수락 여부와 관계없이 각각 4바이트를 예약했습니다. [MapLibre 기본 요청 구현](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/module/http/HttpRequestImpl.java)

배포 AAR Java 호스트 17묶음과 Android 36 소스·DEX 검사가 통과했습니다. 보존한 서명 APK는 직전 패키징 단위의 기본 스타일 실행용입니다. 이번 변경의 APK 재패키징·기기 설치, JNI callback과 팩 귀속은 보류입니다. 다음은 단일 닫힌 바이트 범위와 206의 정확한 범위를 검사하는 것입니다.

## 11월 11일 P3-02 후속: 서명된 Android 시험 APK와 합성 스타일 서버

Android `4233323`에서 별도 `app.trippainting.maptransportqa.sdk` arm64 Debug APK를 만들었습니다. 기존 Android 36 도구와 JDK 17, Gradle 9.3.1, 별도 시험 프로젝트의 AGP 9.1.1을 사용했습니다. 최종 `assembleDebug` 35개 task가 통과했습니다. APK 서명과 16KiB ZIP 정렬, 패키지 ID와 진입 클래스, 네트워크 권한과 패키지 전용 서명 권한, 백업·평문 통신 비활성화, 공개 인증서·포트, AAR 및 APK의 MapLibre 라이브러리 SHA-256을 대조했습니다. 위치 권한은 합쳐진 manifest에서 제외됐습니다. [AGP 호환성](https://developer.android.com/build/releases/agp-9-1-0-release-notes)

Mac loopback 서버는 고정 TLS 인증서로 124바이트의 지도 스타일을 한 번 반환했고, 잘못된 경로와 query에는 404, POST에는 405를 반환했습니다. 이 서버는 검사 종료 시 닫았습니다. 생성한 APK 중 처음 빌드한 중복본과 전용 Gradle 캐시 525MiB를 정리했고, 검증된 19MiB APK와 합성 TLS 자료를 보존했습니다. 그 사이 디스크 가용량은 약 547MiB 늘었습니다. 기존 SDK·AVD와 개인 앱 자료는 보존했습니다.

APK와 Mac 서버까지 확인했습니다. Android 기기 설치·실행, JNI 초기화, 렌더링과 기기 측 실제 저장은 보류입니다. 다음 런타임 시험은 별도 Android 환경에서 앱의 loopback이 합성 서버에 도달하는 경로가 필요합니다. 기존 AVD 시작이나 native admission 변경은 하지 않았습니다.

## 11월 11일 P3-02 후속: 별도 Android 시험 앱 시작 코드 컴파일

격리 시험 앱에 별도 패키지 ID를 적용했습니다. Application에서 주소와 인증서를 고정하고 앱 전용 장부를 연 뒤 MapLibre 공급자를 설치합니다. MapLibre 리소스 경로가 앱 내부 파일 디렉터리 안인지 확인합니다. Activity는 합성 스타일의 `fixture-background` 레이어가 로드되면 예약 합계를 기록합니다.

JDK 17, 기존 Android 36 API, MapLibre OpenGL 13.6.1 배포본으로 시작 소스를 컴파일했습니다. DEX에서 Application·Activity·공급자 클래스 3개를 확인했고, 같은 의존성 검증을 쓰는 호스트 검사 16묶음도 통과했습니다. 다음은 별도 APK를 패키징하고 ID·권한·자원과 서명을 확인하는 단계입니다. 이 단위의 검증 범위는 Android API 컴파일과 호스트 Java입니다.

## 11월 11일 P3-02 후속: 배포 SDK NativeHttpRequest의 Java 전송 경로

`4a514b0`에서 배포 JAR의 `NativeHttpRequest` Java 객체를 포인터 0으로 만들어 공급자 선택과 취소를 실행했습니다. 사설 HTTPS 서버에 변환된 스타일 1회와 같은 타일 2회가 도착했습니다. 첫 타일의 본문 수신 중 두 번 취소하자 dispatcher가 비었고 예약은 남았습니다. 두 번째 타일에 새 예약을 쓰고 한도 초과와 HTTP downgrade를 거절했습니다. 합계 3회·타일 2회·12바이트였습니다.

배포 JAR 호스트 16묶음이 통과했습니다. 실제 SDK Java 경로를 거쳤으며 JNI callback은 포인터 0으로 건너뛰었습니다. 다음은 별도 Android 시험 앱의 초기화·저장 격리와 실제 Android API로 컴파일할 수 있는지 확인하는 단계입니다. [SDK NativeHttpRequest 소스](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/NativeHttpRequest.java)

## 11월 11일 P3-02 후속: 배포 JAR로 ModuleProvider와 로더 위임 확인

Android `bf4b0f5`에서 재개했습니다. RN 로컬 설정의 OpenGL 13.6.1에 맞춰 Maven Central AAR 15,598,638바이트를 Android 작업 폴더의 Git 제외 공간에 받았습니다. 배포 SHA-1을 대조한 뒤 AAR SHA-256 `0a8ea4f5bfd268e050c72025d0f2952b60861863eba6caf84e19b8da583f3a42`, `classes.jar` SHA-256 `ac36e99396ebb01ff781e090c7b9b1557b4d1ccecac653ef511c775a3570136b`를 고정했습니다. 네이티브 `.so`는 추출하지 않았습니다. [Maven 배포본](https://repo.maven.apache.org/maven2/org/maplibre/gl/android-sdk-opengl/13.6.1/android-sdk-opengl-13.6.1.aar)

격리 QA용 `FixtureModuleProvider`가 MapLibre 인스턴스 생성 전에 설치되고, 리소스마다 어댑터를 새로 만들며 이전 공급자의 라이브러리 로더를 위임합니다. 배포 JAR의 실제 `LibraryLoader` Java 초기화에서 이전 공급자 호출을 확인했습니다. 공급자를 통한 합성 HTTP 요청 1회·예약 4바이트, 중복 설치 거절, 합성 초기화 상태에서 늦은 설치 거절도 통과했습니다. JDK 17에서 실제 AAR 클래스+기존 Android 36 `android.jar`로 15묶음, 기존 호스트 서명 모드로 14묶음이 통과했습니다. 300분 잔여는 시작 95%, 배포 검사 후 81%였습니다.

이 결과는 배포 SDK의 Java 클래스 및 localhost 전송까지입니다. 다음은 실제 `NativeHttpRequest` Java 경로의 공급자 선택·취소를 확인하는 것입니다. JNI 로드·렌더링·Android 기기 검증은 보류입니다. [MapLibre 공급자](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/ModuleProvider.java) · [SDK 요청 연결](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/NativeHttpRequest.java)

## 11월 11일 5시간 잔여 18% 저장·중지

최종 실행 소스는 `a40ad55`입니다. 저장 뒤 300분 잔여를 18%로 확인해 추가 항목을 시작하지 않고 중지합니다. Java 호스트 14묶음과 추가 HTTPS 본문 대기·활성 취소·프로세스 종료 사례 3개가 통과했습니다. 전용 임시 서버·자식과 인증서·키·컴파일 폴더는 runner에서 정리했습니다. 고정 소스 SHA와 최종 검사 범위는 Git 제외 `docs/test-results/android-host-transport-20261111/completion-summary.json`에 저장합니다.

다음 새 재개에서는 실제 MapLibre Android ModuleProvider에 연결할 어댑터 소스와 라이브러리 loader 위임을 먼저 확인합니다. 현재 host-contract 서명 검증 뒤에는 실제 SDK·JNI·RN 연결, 조건부·range 요청, offline pack 귀속, Android·실기기·HTTP/2와 OS 실제 수신량 검증이 남아 있습니다. userdata 생성 전용 진입점과 native admission의 미입증 조건도 유지합니다. 체크리스트 전체 수는 공통 담당의 기존 24/54·P3-02 부분 완료·G1~G4 미완료를 따릅니다. 이번 Android는 공통/iOS·기존 SDK/AVD·개인 자료와 공유 생성 폴더를 편집하지 않았으며 새 native build·push/PR/CI는 실행하지 않았습니다.
## 11월 11일 P3-02 후속: HTTPS 프로세스 종료와 장부 복구

`71096f6`에서 인증서가 고정된 HTTPS 본문 수신 중 자식을 강제 종료했습니다. exit 137과 wait 완료 뒤 장부가 이전 1회·타일 1회·4바이트를 복원했습니다. 새 client가 같은 타일을 받아 총 2회·8바이트가 됐고 세 번째 Call은 전송되지 않았습니다. 해당 서버 도착은 정확히 2회였습니다. 기존 HTTP의 전송 전·본문 중 종료 사례도 통과했습니다.

최종 Java 호스트 14묶음과 추가 HTTPS 사례 3개가 모두 통과했습니다. 이번 단위의 300분 잔여는 시작 22%, 검사 후 20%였습니다. 다음은 실제 MapLibre Android SDK의 ModuleProvider 연결을 별도 소스로 준비하고, 조건부·range 요청과 오프라인 pack 귀속을 지원할 범위를 확인하는 것입니다. 현재 공개 인터페이스 서명으로 검사한 합성 어댑터와 실제 SDK 바이너리 실행을 구분합니다.
## 11월 11일 P3-02 후속: 끝나지 않는 TLS 협상의 기한·취소

`761c30e`에서 TLS ClientHello만 받은 채 응답하지 않는 localhost 연결을 만들었습니다. 첫 연결은 실제 5초 call deadline으로 InterruptedIOException을 반환했고, 두 번째는 ClientHello 도착 후 중복 취소로 종료됐습니다. 두 경우 모두 HTTP 단계에 들어가지 않아 시도·본문 예약은 0이었습니다. 연결 두 개와 callback 종료 뒤 세션 close를 확인했습니다. `FixtureTlsDeadlineTest`를 포함한 Java 호스트 14묶음 및 HTTPS 추가 사례가 통과했습니다. 300분 잔여는 시작/검사 후 24%였습니다. 다음은 HTTPS 본문 수신 중 프로세스 종료 후 같은 장부의 복구입니다.
## 11월 11일 P3-02 후속: HTTPS 본문 대기와 취소

`ca295ed`의 인증서 고정 HTTPS에서 기존 본문 대기와 활성 취소 시나리오를 실행했습니다. 본문 4개·대기 2개에서 대기 취소 1개는 전송·예약 없이 끝났고 총 서버 도착 5회·예약 20바이트였습니다. 활성 본문 취소에서는 callback 반환까지 자리를 유지한 뒤 다섯 번째를 처리했고 취소된 시도의 예약을 남겼습니다. 같은 검사들의 HTTP 결과도 통과했습니다. Java 호스트 13묶음과 추가 HTTPS 두 사례 통과, 300분 잔여 29%→28%였습니다. 다음은 TLS 협상이 끝나지 않는 연결의 기한과 취소입니다.
## 11월 11일 P3-02 후속: 사설 HTTPS 호스트 경로

`3798ef5`에서 연결별 사설 인증서 신뢰와 공개키 pin을 추가했습니다. 합성 HTTPS client는 HTTPS origin만 허용하고 HTTP/1.1, 기존 예약과 응답 제한을 함께 사용합니다. 임시 keytool 인증서와 localhost 서버에서 TLSv1.3·HTTP/1.1 본문 수신을 확인했습니다. 다른 인증서와 IP SAN 불일치는 HTTP 요청 전에 거절됐고, HTTP downgrade도 전송되지 않았습니다. 정상 서버 요청 1회·예약 4바이트, 거절 서버 요청과 거절 시 HTTP 예약은 0회였습니다.

Java 호스트 13묶음 통과, 검사 후 300분 잔여는 32%였습니다. runner는 소유 임시 폴더에 시험 인증서와 키를 만들고 종료 때 정리합니다. TLS handshake의 송수신 바이트와 OS 전체 수신량, HTTP/2·Android SDK·실기기는 별도 범위입니다. 다음은 HTTPS 본문 취소와 공유 대기열을 같은 경로에서 대조하는 것입니다.
## 11월 11일 P3-02 후속: 리소스 완료와 취소의 경쟁

`1ae4d52`에서 16개 합성 응답의 마지막 바이트 반환과 어댑터 취소를 두 스레드에서 동시에 시작했습니다. 취소 반환 뒤 responder 호출 수는 늘지 않았고, 전달 결과는 완전한 본문의 0회 또는 1회였습니다. 실패·중복 전달은 없었습니다. 서버 요청과 예약은 각각 16회, 64바이트였습니다. `FixtureAdapterRaceTest`와 기존 검사를 포함해 Java 호스트 12묶음이 통과했습니다. 이는 이번 16개 경쟁 시점의 관측이며 실제 SDK 수용은 보류입니다.
## 11월 11일 P3-02 후속: 장부 실패의 HTTP 전송 차단

`250d5be`에서 새 시험 장부에 부분 tail, 수정 시각 변경, 권한 변경을 각각 만들었습니다. 실제 client와 리소스 어댑터가 첫 시도와 그다음 시도를 모두 거절했고 responder는 각 한 번의 실패를 받았습니다. 세 경우의 HTTP 요청은 0회, 성공으로 보고한 예약도 0이며 실패 파일 bytes를 유지했습니다. 이는 소유 시험 파일의 변경 사례입니다. 실제 디스크 ENOSPC나 force 실패를 주입한 결과로 확대하지 않습니다. Java 호스트 11묶음이 통과했습니다.
## 11월 11일 P3-02 후속: 리소스 어댑터의 취소·완료 소유권

`d9434e1`에서 합성 `FixtureMapLibreRequest`를 추가했습니다. MapLibre Native 13.6.1의 공개 HttpRequest/HttpResponder 서명으로 호스트 컴파일하고, 요청 객체 한 번 실행·본문 전체 확인·동기화된 완료/취소 소유권을 검증했습니다. 전송 전 취소, 진행 중 중복 취소의 responder 호출은 0회였고 정상 결과는 한 번만 전달됐습니다. 같은 타일을 새 객체로 다시 요청하면 기존 취소 예약을 남긴 채 총 3회·타일 2회·12바이트가 됐습니다. 조건부·range 입력은 합성 경로에서 요청 전에 거절했습니다.

Java 호스트 10묶음이 통과했습니다. 실제 SDK 바이너리·ModuleProvider·JNI·RN과 Android 실행은 보류입니다. 호스트용 API 서명은 `sdk-contract`에 두고 출처와 BSD-2-Clause 고지를 보존했습니다. 다음은 영속 예약 실패가 실제 요청 송신을 막는지, 어댑터 완료 경쟁에서 callback 수가 유지되는지 검증하는 것입니다. [공개 요청 인터페이스](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/HttpRequest.java) · [공개 응답 인터페이스](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/HttpResponder.java)
## 11월 11일 P3-02 후속: 종료 지연 시 장부 lock 보존

`53082d1`에서 활성 읽기를 취소한 callback을 보류했습니다. 세션 close는 5초 뒤 lock 보존 오류를 반환했고, 새 writer와 추가 예약을 거절했습니다. callback을 반환시킨 뒤 close를 다시 호출하자 lock이 해제됐고, 장부를 재개방해 기존 1회·4바이트를 복원했습니다. `FixtureSessionCloseTest`를 포함해 Java 호스트 9묶음이 통과했습니다. 다음은 취소된 리소스 요청에 늦은 성공 callback이 전달되지 않도록 요청 소유권을 연결하는 단계입니다.
## 11월 11일 P3-02 후속: 공유 동시 수와 client 종료 소유권

`ddaee5c`에서 네 자리의 dispatcher를 다운로드 예산 객체가 소유하도록 연결했습니다. 같은 예산의 client들은 비동기 자리와 예약을 공유합니다. client 종료는 자기 Call만 취소하며 다른 client의 executor를 끝내지 않습니다. 다운로드 세션 종료는 새 예약을 차단하고 callback이 끝난 뒤 장부 lock을 해제합니다.

첫 client의 본문 4개가 열려 있을 때 두 번째 client의 요청이 대기했습니다. 두 번째 client 종료가 첫 네 본문을 취소하지 않았고, 남은 client의 다음 요청이 계속 완료됐습니다. 서버 도착과 예약은 각각 5회, 20바이트였으며 종료된 client의 대기 요청은 차감되지 않았습니다. `FixtureSharedSessionTest`를 포함한 Java 호스트 8묶음이 통과했습니다. 다음은 callback 종료가 지연될 때 장부 lock을 보존하는 종료 경계 검증입니다.
## 11월 11일 P3-02 후속: 실제 자식 종료 뒤 예약 복구

`1268ff4`에서 고정 Java 자식의 전송 전·본문 수신 중 두 경우를 검사했습니다. 두 경우 모두 예약 4바이트를 기록한 자식을 강제 종료하고 exit 137과 wait 완료를 확인했습니다. 자식 생존 중에는 다른 프로세스의 writer lock을 거절했고 종료 뒤 새 장부 연결이 기존 1회·타일 1회·4바이트를 복원했습니다. 같은 타일을 새 Call로 받으면 총 2회·8바이트가 됐고 그다음 호출은 전송되지 않았습니다. 서버 도착은 전송 전 종료 사례 1회, 본문 수신 중 종료 사례 2회였습니다.

`FixtureCrashRecoveryTest`의 두 사례와 기존 Java 호스트 검사 6묶음이 통과했습니다. 실행 중인 서버·자식과 소유 임시 파일은 검사 종료 때 정리했습니다. 이는 호스트 프로세스 강제 종료의 결과입니다. 전원 손실·Android 프로세스와 실제 SDK 동작은 별도 범위입니다. 다음은 같은 다운로드를 공유하는 client들의 전역 동시 수와 종료 소유권입니다.
## 11월 11일 P3-02 후속: 예약 장부 저장과 재개방

`0a19f88`에서 선택적 호스트 파일 장부를 연결했습니다. 새 private 디렉터리의 고정 `budget.journal`에 설정과 순차 예약을 기록합니다. 전송 전에 기록·force를 마치며, 최초 파일은 부모 디렉터리도 동기화합니다. 같은 파일의 두 번째 writer는 OS lock으로 거절합니다. 설정이 바뀌거나 일부 record·checksum·파일 identity·권한/크기가 어긋나면 실패 상태를 유지하고 기존 bytes를 보존합니다. 최대 파일 논리 크기는 요청 상한 10,000회에서 240,028바이트입니다.

서버가 각 요청을 받을 때 선행 record가 존재했습니다. 장부 재개방 뒤 이전 2회·타일 1회·8바이트를 복원했고 같은 타일의 다음 시도가 이어서 차감됐습니다. 설정 확대, 동시 writer, 잘린 장부, checksum 손상과 링크를 거절했습니다. 동시 예약 12개 중 한도 4개만 저장됐고 재개방 후에도 16바이트였습니다. Java 호스트 6묶음 통과, 이 단위 중 조회한 300분 잔여는 70%였습니다.

이 장부는 예약 합계를 보존합니다. 외부의 악의적 rollback 방지, 전원 손실, Android 파일 API와 SDK 팩 귀속은 별도 범위입니다. 다음은 실제 별도 프로세스의 강제 종료 뒤 예약과 lock 복구를 검증하는 것입니다.
## 11월 11일 P3-02 후속: 예약과 응답 스트림 연결

`09db74e`에서 `FixtureBody.guard`를 network 응답에 연결했습니다. callback에 전달하기 전에 고정 길이·인코딩·요청별 예약 크기를 검사하고, 읽는 스트림도 선언된 길이까지만 전달합니다. 길이가 모자라거나 넘치는 메모리 입력의 거절도 유지했습니다. 예약 1바이트의 실제 서버 응답 2바이트는 callback 본문 수락 전에 거절됐고 타일 시도 1회·예약 1바이트는 유지됐습니다. 취소·대기·자동 follow-up을 포함한 Java 호스트 5묶음 통과, 300분 잔여 79%→77%였습니다.

예산은 현재 메모리 세션에 있습니다. 다음은 예약을 전송 전에 파일에 보존하고 재개방·저장 실패를 검증하는 것입니다. 이 스트림 계측의 범위는 callback에 전달되는 본문이며 OS 전체 수신량 검증은 보류입니다.
## 11월 11일 P3-02 후속: Call별 선행 예약과 세션 예산

`717aee9`에서 `FixtureBudget`을 전송 직전 network interceptor에 연결했습니다. 새 Call마다 전체 시도, 타일 시도, 고정 본문 예약을 함께 증가시키며 완료와 실패로 환급하지 않습니다. 같은 타일 경로의 두 Call도 두 번 차감합니다. 호스트 합성 서버에서 세 번째 타일, 전체 시도 초과, 스타일·글꼴로 소진된 바이트 예산의 후속 요청이 전송되지 않는 것을 확인했습니다. Java 검사 5묶음 통과, 300분 잔여 88%→83%였습니다.

이번 예산은 메모리 세션 범위입니다. 재실행 보존과 여러 client의 전역 동시 수, callback이 읽는 본문의 예약 강제는 다음 단계입니다. 다음에는 응답 스트림을 예약에 연결한 뒤 영속 저장을 검증합니다.
## 11월 11일 P3-02 재개: 전송 중 취소와 자리 반환

사용자가 공통 채팅에서 재개해 Android `2321002`부터 이어갔습니다. 300분 잔여는 시작 93%였습니다. 새 `FixtureCancellationTest`에서 네 callback이 본문 첫 바이트를 읽은 상태에 다섯 번째를 대기시켰습니다. 활성 Call을 두 번 취소하자 해당 읽기가 IOException으로 끝나고 Response가 닫혔습니다. 취소 callback을 잠시 보류하는 동안 다섯 번째는 대기했고, callback 반환 후에만 서버에 도착해 본문을 완료했습니다. 총 서버 요청 5회, Call별 callback 한 번과 자동 재전송 부재를 확인했습니다.

JDK 17과 해시가 고정된 기존 의존성으로 `host-transport/run-tests.sh`의 Java 검사 4묶음이 통과했습니다. 이 단위는 호스트 HTTP/1.1 구성요소 검증입니다. SDK/Android·실기기와 실제 OS 수신량은 보류입니다. 다음은 새 Call의 반복에도 유지되는 다운로드별 예약을 연결하는 단계입니다.

## 11월 10일 P3-02 후속: 응답 본문 상한과 사용량 중지

`2c2e824`에서 합성 HTTP 응답을 고정 길이로 읽는 `FixtureBody`를 추가했습니다. HTTP 200, identity 인코딩, 단일 `Content-Length`, 예약 범위와 실제로 읽은 길이를 확인하며 검사를 끝낸 바이트만 전달합니다. 서버에서 보낸 정상 1바이트는 수락했고 예약 초과·chunked·gzip 헤더는 거절했습니다. 별도 메모리 입력으로 선언보다 짧거나 긴 본문도 거절했습니다. JDK 17 및 캐시 의존성으로 Java 호스트 검사 3묶음이 통과했습니다. OS 수신량은 여기서 측정하지 않습니다.

300분 사용량은 이 단위 전 22%, 검사 후 19%였습니다. 사용자 지시에 따라 이 단위를 로컬에 저장하고 중지합니다. 테스트가 연 임시 서버와 컴파일 폴더는 스크립트에서 정리했습니다. 공급원 전송, MapLibre/Android 실행, 실제 기기, TLS/HTTP2와 영속 예산은 보류입니다. 다음 안전한 항목은 전송 중 취소 시 본문과 자리가 반환되는지 호스트 합성 서버에서 대조하는 것입니다. userdata 생성 전용 진입점은 새 증거가 있을 때 다시 검토합니다. P3-02와 체크리스트 완료 수는 기존 상태를 유지합니다.

## 11월 10일 P3-02 후속: 비동기 본문 동시 처리와 대기 취소

`be7165f`에서 전용 OkHttp dispatcher의 전체 및 호스트별 비동기 동시 요청을 4개로 설정했습니다. 합성 스타일·타일·글꼴·스프라이트의 callback 네 개가 본문의 첫 바이트를 읽은 상태에서 나머지 바이트를 보류했습니다. 대기 호출은 2개였고 서버에 도착한 요청은 4개였습니다. 대기 중 하나를 취소하고 본문을 풀자 다섯 번째 호출이 완료됐습니다. 취소한 경로는 서버에 도착하지 않았습니다. `FixtureBodyQueueTest`와 기존 Java 호스트 검사 두 묶음이 통과했습니다. 300분 잔여는 시작 25%, 검사 후 23%였습니다.

이 결과는 전용 client의 비동기 callback이 본문을 읽고 닫는 구간에 해당합니다. 동기 호출, callback에서 다른 작업으로 본문을 넘기는 경우, 진행 중 취소와 늦은 callback, 제품 MapLibre와 Android 실기기, OS 실제 수신량은 별도 검증 범위입니다. 다음 호스트 단위는 고정 길이와 실제 읽은 바이트의 상한 확인입니다.

## 11월 10일 P3-02 후속: OkHttp 실제 합성 전송 경계

`abdb4b4`에서 전용 HTTP/1.1 client를 추가했습니다. URL 변환 뒤 출처와 리소스를 검사하고 헤더를 고정합니다. 각 Call에 한 번의 전송 시도를 허용하고, 리다이렉트와 추가 HTTP 교환을 막습니다. 변환 과정에서 Call의 내부 상태를 잃은 요청은 연결 전에 거절합니다.

JDK 17과 해시가 확인된 캐시 의존성으로 localhost 서버 두 개를 사용했습니다. `503 Retry-After: 0`에서 OkHttp 대조군은 실제 요청 2회, 보호 client는 1회였습니다. URL 변환의 두 번째 `proceed`도 전송되지 않았습니다. 정상 변환에서는 고정 User-Agent와 identity encoding이 도착했고 인증·쿠키는 없었습니다. 변환으로 다른 포트를 가리키거나 302를 반환했을 때 해당 서버 도착은 0회였습니다. `FixtureHttpClientTest`와 앞선 `FixtureRequestPolicyTest`가 통과했습니다. 300분 잔여는 시작 35%, 검사 후 27%였습니다. [실행 방법](../qa/map-transport/android/host-transport/README.md)

이 시험의 한 번 제한은 OkHttp Call별 HTTP 교환에 적용됩니다. 별도의 MapLibre 새 Call, TLS/HTTP2, 예약·바이트 상한과 실제 Android/MapLibre 실행은 보류입니다. 다음은 비동기 callback이 본문을 닫기까지 자리를 유지하며 최대 4개인지 합성 서버와 대조하는 단계입니다.

## 11월 10일 P3-02 후속: 합성 지도 요청 주소와 헤더 검사

사용자가 Android도 중지 지시 또는 300분 잔여 20% 미만까지 진행하라고 지시했습니다. `53ff46e`에서 재개해 userdata 생성기 보류와 분리하고 P3-02의 호스트 작업을 이어갔습니다. 이 단위의 300분 잔여는 시작 42%, 검사 후 35%였습니다.

`host-transport/FixtureRequestPolicy.java`는 변환이 끝난 OkHttp 요청에서 선택한 `127.0.0.1` 포트와 합성 스타일·타일·글꼴·스프라이트만 허용합니다. 기존 요청 헤더를 고정 User-Agent와 identity encoding으로 교체합니다. OkHttp 4.12.0·Okio 3.6.0·Kotlin 2.2.21 캐시 파일 해시 3/3을 기존 manifest와 대조한 뒤 JDK 17에서 `FixtureRequestPolicyTest`를 실행해 통과했습니다. 4종 분류, 거절 입력과 정확한 헤더 목록을 확인했습니다.

이 단계는 요청 객체 검사입니다. MapLibre RN 11.5.0의 헤더 등록 시 기본 HTTP client 교체와 별도 `ModuleProvider` 경로는 소스로만 검토했습니다. 다음 단계는 이 정책을 전용 OkHttp에 연결하고 localhost에서 변환 뒤 전송 및 재전송을 관찰하는 것입니다. SDK/Android·실기기 실행과 공급원 전송은 보류이며 P3-02와 전체 완료 수를 유지합니다. [Android HTTP 확장 경로](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/ModuleProvider.java)

## 11월 10일 캐시된 userdata 생성 경로 읽기 전용 확인

Android 소스 `82c41b505bf8361188d13b03f8dd2adea2a5eebc`에서 재개했고, 공통의 버전 전용 probe는 `bda9fff0d6cce8256db6f6f67eb03e101a2b6f6a` 기준으로 읽었습니다. 300분 사용량 잔여는 시작 61%, 저장 전 55%였습니다.

- **설치본 식별.** SDK launcher·macOS arm64 QEMU·`source.properties`의 SHA-256이 10월 31일 버전 조회 근거와 3/3 일치했습니다. 그때 조회한 버전은 `37.2.12.0`, 빌드는 `16428233`, 소스 변경 번호는 `CL:N/A`였습니다. 공식 릴리스는 버전을 확인하는 근거입니다. 배포 빌드에 대응하는 정확한 소스 커밋은 확인되지 않았습니다. [공식 릴리스 기록](https://developer.android.com/studio/releases/emulator#37.2.12)
- **설치본의 호출 경로.** `nm`과 `llvm-objdump`로 동일 QEMU를 읽었습니다. `_main`은 내부 `createUserData`를 호출한 뒤 기능 플래그를 확인하고 조건에 따라 암호화 파티션 준비로 진행합니다. `createUserData` 안에는 `empty_data_disk` 문자열과 내장 `android_createEmptyExt4Image` 호출이 있습니다. 일반 시작 코드에는 `enter_qemu_main_loop`를 스레드에 넘기는 경로가 있고, 이어지는 `_run_qemu_main`·`_main_impl`에는 보드 초기화 호출이 있습니다. 공개 AOSP 소스에서도 userdata 생성은 일반 시작 과정에 들어 있습니다. [AOSP 생성 분기](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp#476) · [AOSP 시작 과정](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp#2504) · [AOSP QEMU 루프 진입](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp#3558)
- **전용 진입점 보류.** 검토한 실행 인터페이스에서 생성까지 도달하고 보드·게스트 초기화 전에 성공으로 반환하는 별도 경로와 고정 인자를 확인하지 못했습니다. 기존 고정 인자 `-version`은 버전 출력에서 반환합니다. `NO_VERIFIED_PRODUCER_ONLY_ENTRY`와 native admission 차단을 유지합니다. [AOSP 버전 출력 경로](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android/android-emu/android/main-common.c#1692) · [공식 실행 옵션](https://developer.android.com/studio/run/emulator-commandline)
- **이번 검사.** `python3 -B -m unittest discover -s qa/map-transport/android -p 'test_producer_request.py'`로 호스트 회귀 21개 통과했습니다. 생성기·formatter·이미지/마운트·AVD·emulator/ADB·Android 실행은 보류입니다. 체크리스트 완료 수에는 반영하지 않습니다. 해시와 정적 관측 위치, 실행 결과는 Git 제외 `docs/test-results/android-producer-entry-20261110/completion-summary.json`에 남겼습니다.

다음 증거는 설치 빌드에 연결되는 배포 출처와 생성 전용 진입점의 정확한 고정 호출 규약입니다. 해당 진입점의 성공 및 오류 경로가 보드·게스트 초기화 전에 반환함을 먼저 확인해야 합니다. 이번 변경은 이 진행 기록만 로컬에 저장합니다.

## 11월 3일 후속 재개: producer 요청 사전 검사 구현

사용자의 iOS/Android 동시 재개 지시와 공통의 새 사람 재개 전달로 **`6c165d6326feac02c13ef503172f637824d285b4`**에서 시작했습니다. 공통은 전달 기준d81cba6/실행3b139cd에서 iPhone SDK HTTPS queue를 맡으며, Android는 현재 worktree의 작은 source/host 단위만 맡았습니다. 공통/iOS·제품·의존성은 편집하지 않았습니다.300분 잔여는 시작90%→구현 전85%→검사 후77%였고20% 미만 저장·중지 규칙을 유지합니다.

**구현:** 새 `qa/map-transport/android/producer_request.py`가 직렬화한 JSON 요청을 검사하고 `prepare_controller.py`가 artifact 생성 **전**에 이를 호출합니다. UTF-8 최대4,096 bytes, 정확한 네 키, schema 정수1, 고정 operation `create-empty-userdata`/outputName `userdata.img`, bool을 제외한 양의 정수·512-byte 정렬·최대32MiB만 받습니다. 중복/비유한 숫자·잘못된 인코딩/깊은 JSON, 임의 경로·executable/argv/env·승인값 추가를 거절합니다. CLI의 새 옵션은 `--producer-request`이며 옵션 축약을 받지 않습니다.

유효 요청도 bounded events/result의 `producerPreflight` 진단만 기록하고 BLOCKED/exit2입니다. invalid는 controller 생성 전에 FAILED/exit1, controllerRoot/cleanup null입니다. 명령·실행 가능한 인자·승인 토큰은 만들지 않으며 `producerEntryVerified`, `allocationBoundProven`, `imageFormatted`, `nativeAdmissionEnabled`는 모두false입니다. 요청 크기와 별도 flat backing 크기를 용량 검증으로 해석하지 않습니다.512 bytes는 정렬 하한일 뿐 실제 formatter 최소 크기가 아니며32MiB도 기존 설계 ceiling입니다.

**검사 PASS:** `python3 -B -m unittest discover -s qa/map-transport/android -p 'test_*.py'` — 기존90+새21, **111개**,1.722초/exit0입니다. 새21개는 요청 경계/주입/수정된 dict 재입력 거절, invalid 때 create 미호출·빈 디렉터리 보존, 정상 metadata-only·READY audit/CLOSED cleanup, request32MiB+별도512-byte backing의 독립과 CLI 축약/native 옵션 무생성 거절을 확인했습니다. 각 테스트는 새 소유 temp root만 쓰고 정리했습니다. OS profile·formatter·native·SDK/기기는 실행하지 않았습니다. 독립 읽기 검토에서 차단 필요 결함은 발견되지 않았습니다.

실제 새 userdata 생성, cached producer 출처/고정 argv/guest 진입 전 반환, OS 할당량 상한과 formatter 보호, 전체 자식/열린 FD/mount 수명, 새 image·mount·AVD·emulator/ADB·실제 Android·Release는 **NOT RUN**입니다. 기존 단일 writer의 OS PASS를 이번 native 통과로 재사용하지 않습니다. 공통 전체 verifier·iPhone의 결과도 자체111개와 합산하지 않습니다.

선택 통합 후보는 새 `producer_request.py`, 수정 `prepare_controller.py`, 새 `test_producer_request.py` 세 파일입니다. prepare가 새 module을 import하므로 함께 가져와야 합니다. Android README는 필요한 절만 합치며 전체 branch/README를 덮어쓰지 않습니다. 고정 소스 SHA와 실행 명령/결과는 Git 제외 `docs/test-results/android-producer-request-20261103/completion-summary.json`에 저장합니다. source 외 개인 경로·원시 device 자료는 공유하지 않습니다.

이번 단위에서 새 빌드/다운로드·대형 파일·기존 캐시/SDK/AVD/개인 DB·사진·인증·백업 삭제는 없습니다. 관측한 데이터 볼륨 가용량은20,400,000KiB(약20.9GB)였으며 별도 동시 작업이 있어 이 단위의 확보량으로 표시하지 않습니다. 새 app 전체 verifier/push/PR/CI는 실행하지 않았고 소유 지속 서비스도 없습니다. 로컬 코드·근거·문서를 저장하고 이 단위를 완료합니다. 다음은 실제 cached producer-only entry의 출처·고정 호출과 guest 초기화 전 반환을 증명할 수 있는지 확인하는 별도 범위이며, 확인 전 임의 formatter나 full emulator로 대체 실행하지 않습니다. 전체24/54·P3-02 부분 완료/G1~G4 미완료와 native 차단을 유지합니다.

## 11월 3일 재재개: 단일 writer 코드와 작은 OS 구성요소 완료

공통에서 전달한 새 사람 “이어서 진행해줘” 요청으로 **`5a8a4ecf0bd8514623ca2b0c1196bd94317b00d4`**부터 재개했습니다. 공통 기준은 중단 문서7fd18eb/실행5063f5e와 그 실행의 CI SUCCESS라는 공통 보고를 따릅니다. 공통/iOS는 별도 담당이며 이 Android 작업에서 그 파일은 편집하지 않았습니다. 전용300분 한도 조회는 단계 전환 때 잔여93%→63%→55%→53%→42%→36%였으며20% 미만 중지 규칙을 유지했습니다. Mac 가용 약21.9GB는 전달받은 값이고 대형 이미지·AVD·빌드 없이 진행했습니다.

**구현:** 새 `qa/map-transport/android/single_writer_component.py`와 대응 `test_single_writer_component.py`를 추가했습니다. 새 private temp fixture의 일반 파일512 bytes와 소유 canary/contract만 사용합니다. 고정 wrapper가 FSIZE soft/hard512, CORE0을 설정하고 sandbox-exec→고정 Python worker로 exec합니다. profile은 target literal의 file-write-data와 Python literal exec만 추가하며 fork·넓은 쓰기·Mach/socket 예외는 추가하지 않았습니다. 부모는 close_fds/빈 pass_fds, 읽기 전용 stdin, bounded pipe와 기한을 고정합니다.

**이번 실제 OS 구성요소 PASS:** 권한 조건이 허용된 명시 실행에서14개 관측이 모두 true였습니다. exec 후 실제 hard/soft 값, 상속 canary FD의 EBADF, stdin 읽기 전용, core0,512-byte overwrite, write/ftruncate 확장의 EFBIG, hard limit 상향 거절, 외부 canary 쓰기·create/link/chmod/rename/unlink·fork 거절을 확인했습니다. receipt PID와 실행 PID가 같고 wait로 종료를 확인했습니다. target은 같은 dev/inode·단일 링크·소유 권한을 유지했고 내용은 예상한 Q512와 대조했습니다. 논리512 bytes, **관측** 할당4,096 bytes였습니다. 부모 metadata audit READY와 실제 descriptor close CLOSED도 확인했습니다. 이는 공간 부족을 만들거나 디스크 이미지를 형식화한 결과가 아닙니다.

**준비 실패 구분:** 첫 OS 호출은 `sandbox_apply: Operation not permitted`로 restricted worker 전에 거절됐습니다. 그 새 target은 zero512 그대로였고 실패 경로와 근거를 보존해 통과에서 제외했습니다. 권한이 허용된 실행에서만 위 PASS를 확인했습니다. 초기 helper 회귀에서는 이미 끝난 group에 보내는 종료 신호가 거절됐습니다. 정상 wait 뒤 신호를 보내지 않고, 실패/timeout 때만 reap 전 group 정리와 wait를 수행하도록 수정했습니다. 정상 종료 후 PID 재사용 대상에 신호를 보내지 않는 회귀와 leader 종료 뒤 pipe 유지 자식의 timeout 회귀도 통과했습니다.

**Host PASS:** `python3 -B -m unittest discover -s qa/map-transport/android -p 'test_*.py'`의 기존54+새36, **90개**가 통과했습니다. 이 회귀는 OS profile을 적용하지 않고 작은 합성 파일과 고정 Python child만 씁니다. identity/링크/권한·contract, 엄격한 bool/int/PID·중복 JSON 거절, FD/stdin,8KiB 경계·출력 초과·timeout, CLI 무쓰기 거절과 실패 전달을 확인했습니다. 독립 검토가 찾은 부분 fixture 경로 소실, controller constructor의 cleanup 전달 누락, audit FAILED의 PASS 반환을 수정하고 대응 회귀를 추가했습니다. 검토자는 수정 해결도 읽기만으로 확인했습니다.

로컬 전용 근거는 `docs/test-results/android-single-writer-20261103/completion-summary.json`, 소유 `.build/controller-artifacts/` 결과와 새 private fixture입니다. 실제 실행 소스의 SHA가 현재 파일과 같음을 확인했습니다. 원시 PID/경로/지문은 커밋하지 않습니다. 테스트가 만든 소유 임시 파일만 각 테스트가 정리했으며 실제 구성요소의 작은 PASS/제외 근거는 보존했습니다. 지속 서비스·emulator·Metro는 시작하지 않았습니다.

**한계/NOT RUN:** RLIMIT 논리 크기와 실제 시험한 syscall 결과는 filesystem 할당량 cap이 아닙니다. literal도 inode 교체를 원자적으로 막지 않으며 Python exec literal이 argv·코드를 강제하지 않습니다.8KiB는 보관 출력 cap이고 모든 송신량 상한이 아닙니다. 임의 native writer·모든 자식 생성 수단·formatter·이미지/mount 수명·cached producer entry·fresh AVD/실제 Android·Release는 미검증입니다. `allocationBoundProven=false`, `imageFormatted=false`, `nativeAdmissionEnabled=false`를 유지하고 공통 native gate는 열지 않습니다.

이번 변경은 위 Python 두 파일, Android README와 진행/제안 두 문서입니다. 제품·의존성·SDK·원래 AVD·개인 DB/사진/인증·캐시·빌드·백업은 수정·삭제하지 않았습니다. app 전체 verifier/새 CI는 이 Python 단위에서 반복하지 않았습니다. 로컬 커밋을 공통 담당이 읽기 전용 검토하도록 남기고 이번 단위를 완료합니다. 다음 formatter/이미지/AVD/native로는 범위를 넓히지 않습니다. 다음 검토는 제한된 formatter/producer 호출 경계와 전체 writer·mount 수명이며, 전체24/54와 수용 게이트는 유지합니다.

## 11월 3일 재개·한도 중단: 단일 writer의 OS 보호 계약

공통 채팅에서 사용자가 “이어서 진행해줘 아이폰은 연결해두었어”라고 직접 재개했습니다. Android 시작점은 **`e1312c9916e3f3068e8644338dbd7f808b6740e8`**(실행 소스899d98e)이며 공통은 전달받은1d710c7/실행6c0921e를 기준으로 iOS를 맡습니다. Android는 기존 worktree에서 소스·작은 host 준비만 맡고 공통/iOS 파일을 편집하지 않았습니다. Mac 가용 공간 약22GB는 공통의 전달값이며 이 채팅에서 새 용량 측정이나 정리를 하지 않았습니다.

**새 운영 조건:** 사용자의 “5시간 한도가20% 미만으로 남으면 하던 작업까지만 하고 저장 후 중지”를 적용합니다. 전용 `get_usage_limits`의 codex primary300분 창을 단계 전환 때 확인했습니다. 최초 확인 used76%/remaining24%, 다음 확인 **used84%/remaining16%**였으므로 새 구현·검사에 착수하지 않고 이미 진행한 읽기 전용 검토만 저장합니다. 계정 공유 한도이며 reset·구매·모델 전환·자동 재개는 하지 않습니다. 새 사람 재개 때도 실제 한도를 확인해야 합니다.

현재 마친 항목은 **고정 Python 단일 writer의 작은 OS 보호 구성요소 계약**입니다. 기존 profile/runner, 로컬 지원 여부와 `sandbox(7)` 설명을 읽었고 독립 검토도 읽기만 했습니다. 이 Mac은 darwin/Python3.11.7이며 sandbox-exec와 RLIMIT_FSIZE/CORE가 존재한다는 지원 조회만 했습니다. 새 profile·worker·launcher 코드는 아직 작성하지 않았고 OS 보호를 적용하거나 실험하지 않았습니다.

| 다음 구현 계약 | 검증해야 할 조건 |
| --- | --- |
| 단일 기존512-byte 일반 파일만 쓰기 | profile은 그 파일 literal의 file-write-data만 허용. create/unlink/rename/link/chmod와 process-fork는 허용하지 않음. 실행 파일도 Python literal로 좁히되 argv/코드까지 OS가 보장한다고 주장하지 않음 |
| exec 전 resource 제한 | RLIMIT_FSIZE soft/hard 모두512, RLIMIT_CORE 모두0. exec 뒤 실제 값을 다시 대조하고 SIGXFSZ 처리를 고정해 확장 시 EFBIG를 관측 |
| 상속 FD 차단 | close_fds=True/빈 pass_fds, 읽기 전용 stdin, stdout/stderr pipe. 다른 open 전에 시험 canary FD의 EBADF를 확인. 이미 열린 writable FD는 profile 경로 제한만으로 보호됐다고 가정하지 않음 |
| 수명·identity | 고정 wrapper→고정 worker exec, 제한 시간 안 단일 PID 종료, 전후 dev/inode·링크·크기 및 canary 대조. literal 경로가 inode를 원자적으로 고정한다는 주장은 하지 않음 |
| 출력·크기 주장 | 보관 출력8KiB cap은 pipe 전체 송신량 상한이 아님.512-byte 논리 cap도 preallocation 등을 포함하는 filesystem 할당량 cap이 아님 |

다음 최소 실제 관측은 exact overwrite, EFBIG와 크기 유지, 지정 외 쓰기·create/unlink/rename/link/chmod/fork 거절, FD 폐쇄와 단일 PID 종료입니다. 작은 합성 일반 파일만 사용하며 formatter·디스크 이미지·mount·SDK·emulator·ADB로 확대하지 않습니다. 그 결과도 `allocationBoundProven=false`, `imageFormatted=false`, `nativeAdmissionEnabled=false`를 유지해야 합니다. producer entry와 전체 child/mount 수명은 별도 미확인입니다.

**이번 상태:** 새 구현/host 회귀/OS 구성요소/formatter/이미지·mount/native는 모두 **NOT RUN/미구현**입니다. 이전 자체54개·공통118개를 새 통과로 재사용하지 않습니다. 코드·개인 DB/사진/인증·기존 SDK/AVD/캐시/빌드/백업/근거를 수정·삭제하지 않았습니다. 이 채팅이 시작한 지속 서비스나 실행 중인 소속 subagent는 없습니다. 진행·제안 두 문서만 로컬 커밋하고 추가 작업을 중지합니다. 다음은 새 사람 재개와 한도 확인 뒤 위 작은 profile/launcher부터 구현하는 것입니다. 전체24/54와 수용 게이트는 유지합니다.

마지막 공통 전달에서 같은300분 창의 후속 잔여12%와 저장·중지 전환을 확인했습니다. 공통iOS는 실행 소스5063f5e의 signed Debug SDK pinnedHTTPS1개와 전체 verifier PASS를 별도 보고했고, 소유 QA앱·서버·임시 키를 정리했으며 원래 설치 정보는 같고 개인 DB/사진/auth는 열지 않았습니다. 이를 Android의 새 결과로 합산하지 않습니다. 공통 source push는12% 조회 직전 이미 시작돼 완료 여부만 확인하고, 이후 중단 문서는 로컬 저장만 한다는 공통 상태를 따릅니다. Android에서는 새 push/CI를 시작하지 않습니다.

## 11월 2일 최신 요청: 여기까지 저장하고 전체 중단

공통·iOS 채팅의 최신 사용자 요청 **“여기까지”**를 전달받아 프로젝트 공통 중단 규칙을 적용합니다. Android 실행 소스는 **`899d98e053ad125b227b570ada31f6f5f94199ba`**, 선택 통합한 공통 실행 소스는 로컬 **`6c0921e`**입니다. Android 코드·기존 근거는 보존하고 이 중단 기록만 두 문서에 로컬 저장합니다. 새 개발·조사·검사·빌드·기기/formatter/이미지/mount/native·설치·다운로드·삭제·push/PR/CI는 시작하지 않습니다.

중단 전 공통은 Android Python 네 파일을 명시적으로 선택 통합했고 이 worktree와 bytes가 같은 것도 확인했습니다. 같은 공통 checkout의 Android118개, Mac TLS 장부8개(실제 SIGKILL/새process 예약 유지 포함)와 기존 HTTP13/TLS기본7, 모바일609/서버61/fixture23/report13 및 양쪽 JS-Hermes를 포함한 최종 verifier exit0 PASS를 확인했습니다. 물리 iPhone·새 signed app/SDK HTTPS·Android formatter/부팅의 결과로 확대하지 않습니다. 새 공통 소스의 push/CI는 NOT RUN입니다.

Android 작업 폴더는 중단 기록 추가 전 깨끗했습니다. 이 채팅은 Android용 지속 서버·Metro·emulator를 시작하지 않았고 실행 중인 소속 subagent도 없습니다. 공통 시험 process/서버/키/인증서/장부/binary는 suite 종료 때 정리됐다는 공통 저장 기록을 따릅니다. 이 중단 요청 뒤 추가 삭제·검사를 하지 않으며 개인 자료와 기존 SDK·AVD·캐시·빌드·백업·근거를 보존합니다.

다음 **새 사람 재개** 때 두 Git checkpoint와 local/remote 차이를 먼저 확인합니다. 공통은 제한된 SDK HTTPS 설정·인증서 전달을 안전한 QA 경로에서 설계하고, Android는 OS 강제 formatter/native backend·producer 진입·child/mount 수명 준비를 검토합니다. 논리 cap/작은 일반 파일 준비를 전체 native 할당량 제한으로 바꾸지 않습니다. 새 재개 요청 전에는 위 다음 항목이나 이전 자율 진행으로 다시 시작하지 않습니다. 전체24/54, P3-02 부분 완료/G1~G4 미완료와 공급원 다운로드 OFF를 유지합니다.

## 11월 2일 양쪽 재개: Android 준비 흐름 연결과 host54개

사용자가 “다음 단계를 진행해 ios 안드로이드 모두”라고 직접 요청했습니다. Android 시작점은 `b5c7f613e9477ca3ec157563b3ade93a194bd16d`입니다. 현재 채팅이 iOS TLS/장부 초안을 병렬로 준비하던 중, 공통·iOS 담당 채팅이 실제 공통 checkout의 초안6개를 이어받아 검토·검증하겠다고 역할을 조정했습니다. iOS subagent의 새 수정을 보류하고 초안과 staging 근거를 보존했습니다. 이는 전체 중단이 아니며 Android 구현은 계속했습니다. 최종 iOS 결과와 공통 커밋은 공통 `PROGRESS.md`/`docs/RESUME.md`를 따릅니다.

**새 구현:** `prepare_controller.py`가 기존 bounded writer로 실제 events/canary/output/result를 기록하고 마지막 파일 상태와 실제 close 결과를 반환합니다. 선택적인 backing 예약은 메타데이터 예산과 분리하며512-byte 배수, 최대64MiB를 생성 전에 확인합니다. 새 `capacity.raw`는 최대64KiB zero buffer로 정확한 요청 크기를 한 번만 순차 기록하고 임의 쓰기/append/재초기화를 거절합니다. 실패한 부분 파일과 예약을 보존합니다. ext4/HFS 형식화, mount나 native 실행은 하지 않습니다.

보고서가 자기 자신의 최종 크기를 재귀적으로 약속하지 않도록 저장 `result.json`과 마지막 반환 audit를 분리했습니다. 저장본 cleanup은 기록 시점 PENDING, 반환은 실제 CLOSED 또는 실패를 전달합니다. 독립 검토에서 발견한 중간 실패의 근거 경로·실제 cleanup 누락도 수정했습니다. 생성/초기화/기록 오류의 예외와 CLI 결과가 정확한 새 소유 `controllerRoot`와 cleanup을 전달하며 다른 run을 추측하지 않습니다.

**PASS:** `python3 -B -m unittest discover -s qa/map-transport/android -p 'test_*.py'`에서 기존34개+새20개, **Android 전용 host54개**가 통과했습니다.512/1024-byte 합성 일반 파일의 실제 zero 본문·순차 write·정확한 크기, 예약 분리, 중복/임의 쓰기 거절, 부분 EIO·0-progress와 비용 보존, 최종 파일별 logical/allocated 값과 audit의 대조, 실제 close, CLI BLOCKED/exit2와 실패/exit1, 임의 native 옵션의 무쓰기 거절을 확인했습니다. 합성 오류는 실제 OS 디스크 장애 결과가 아닙니다. 공통의 기존64개와 합산하지 않으며 새 mobile/iPhone/native 통과 수도 아닙니다.

정상 controller 준비도 native에는 **BLOCKED**입니다. `allocationBoundProven=false`, `imageFormatted=false`, `nativeAdmissionEnabled=false`와 formatter/native write confinement/producer-only entry/모든 child·mount 수명 blocker를 유지합니다. API를 통한 backing+metadata 논리 예산은 최대65MiB이지만 전체 native 할당량 상한의 증명은 아닙니다. 실제 최소 producer·fresh boot는 NOT RUN입니다.

수정 파일은 Android `bounded_controller.py`, 새 `prepare_controller.py`와 `test_prepare_controller.py`, Android README와 진행/제안 두 문서입니다. 이전 `test_bounded_controller.py`34개도 그대로 회귀에 포함합니다. 공통의 기존 준비 도구나 제품 코드는 이 Android 변경에서 수정하지 않았습니다. 다음 통합은 공통 담당이 이 코드/회귀 네 Python 파일을 명시적으로 검토해 가져오는 단계이며 자동 branch 동기화·merge는 하지 않습니다. 이후 제한된 formatter/native backend와 producer 진입점을 별도로 검증해야 합니다. 개인 자료·기존 SDK/AVD/캐시/빌드/백업 열기·재해시·삭제, 새 기기 조회/설치/실행·다운로드·push/PR/CI는 없습니다. 전체24/54, P3-02 부분 완료와 G1~G4 미완료는 유지합니다.

## 11월 2일 후속 구현: controller 파일 제한과 host 회귀 34개

사용자가 “이어서 해달라고”라고 정정해 문서 검토에서 실제 Android 코드 구현으로 이어갔습니다. 시작점은 `c693c5bbdbf83f17ac9e0913d2241fe3234b6eea`입니다. 새 `qa/map-transport/android/bounded_controller.py`, 대응 `test_bounded_controller.py`와 `README.md`를 추가했습니다. 공통 checkout의 Android 도구·제품·루트 문서와 의존성은 수정하거나 복사하지 않았습니다.

**구현:** 신뢰하는 준비 controller가 쓰는 메타데이터 파일 여섯 개의 허용 목록과 논리 cap을 생성 전에 검증합니다. 기본 예약 합은276KiB, 전체 논리 예산 최대1MiB이며 cap을 낮추거나 허용 목록을 줄일 수 있습니다. 새 고유 소유 디렉터리와 파일을 exclusive하게 생성하고 열린 descriptor를 유지합니다. cap 초과는 bytes를 바꾸기 전에 거절하며 append·짧은 write·부분 실패를 처리합니다. 링크·inode/디렉터리 교체·같은 크기의 외부 수정·미등록 파일을 감지하면 그 run의 추가 쓰기를 막습니다. 삭제했지만 열린 파일도 사용량과 기존 예약에 남습니다.

close는 근거 파일을 삭제하지 않습니다. 독립 검토에서 발견한 정리 오류의 은폐를 수정해, 불확실한 close는 공개 `cleanup_report`와 `ControllerError`로 전달하고 같은 FD 번호를 무조건 다시 닫지 않습니다. 생성 중 실패와 context 종료에도 정리 실패의 근거를 전달합니다. JSON 직렬화 실패도 이전 보고서를 보존하고 실패 상태로 끝납니다.

**이번 실제 검사 PASS:** 저장소 루트에서 `python3 -B -m unittest discover -s qa/map-transport/android -p 'test_*.py'`를 실행해 **새 host 회귀34개**가 통과했습니다. 테스트는 임시 디렉터리의 작은 합성 일반 파일만 만들며 실제 cap 경계/append/truncate, 초과 전 보존, symlink/hardlink/교체·변조, 열린 삭제 파일의 비용 유지, 동시 기록, 짧은/중단된 write, 생성·close 실패와 실패 후 재사용 거절을 확인했습니다. EIO·불확실한 close는 정확한 합성 호출에만 주입했습니다. 실제 디스크 공간 부족이나 OS I/O 장애 결과가 아닙니다. 기존 공통64개와 합쳐 native/통합 통과 수로 세지 않습니다.

**한계:** 이것은 controller API를 통한 **논리 파일 크기 제한**입니다. 임의 native process의 직접 쓰기, mount·inode 교체와 동시인 race의 원자적 차단이나 filesystem 할당량 상한은 증명하지 않습니다. `audit()`는 `allocationBoundProven=false`, `nativeAdmissionEnabled=false`를 항상 유지합니다. backing 이미지 생성·형식화/backend, 모든 native 자식/임시 파일의 OS 강제, cached producer 진입 경계와 최소 용량·fresh boot는 미구현/NOT RUN입니다. 이전65MiB는 전체 backend의 미구현 설계 ceiling입니다.

다음 구현은 이 writer를 생성 controller의 보고·출력 경로에 연결하면서 backing 생성/형식화의 별도 제한 backend를 준비하는 일입니다. 공통 기존 도구와의 통합 검토 전에 새 모듈만으로 그 도구의 gate를 열지 않습니다. 이번 이미지·AVD·emulator·ADB·기기 조회·native·설치·다운로드·개인 자료 열기/재해시·캐시/백업 삭제는 없습니다. 앱/서버/JS-Hermes 전체 verifier는 제품·의존성 변경이 없는 이번 Python 구성요소 검사로 반복하지 않았으며 새 통과로 표시하지 않습니다. Android 전용 코드·회귀·README와 진행/제안 두 문서만 로컬 저장하고 push/PR/CI는 시작하지 않습니다. 전체24/54와 G1~G4는 유지합니다.

## 11월 2일 재개: 생성 전 controller 제한을 먼저 준비

사용자가 “이어서 진행해줘 아이폰 연결이 필요하니?”라고 재개했습니다. **현재 Android 준비에는 iPhone이 필요하지 않습니다.** 기기 연결·조회 없이 Android `96aeb23d41ab5f41aa8418636bdf5c3754879c88`과 공통 `01eedd67327564999f0ab155280cf76b4fe03833`의 저장 상태를 확인했습니다. 공통 실행 소스는 `da941fc`, 마지막 커밋은 중단 문서이며 `eaa88af..01eedd6` 사이 Android 준비 코드 diff는 없습니다. 공통 `docs/RESUME.md`와 `docs/PARALLEL_DEVELOPMENT.md`의 역할에 따라 이번에도 공통은 읽기 전용, Android 변경은 진행·제안 두 문서뿐입니다.

이전의 “producer 하나”를 바로 실행하기보다 **이미지를 만들기 전의 controller 파일 제한이 첫 구현 단위**여야 합니다. `bounded_storage_fixture.py:250–256`은 `hdiutil create`를 worker 제한 밖에서 실행한 뒤 크기를 확인합니다. mount가 아직 없는 이 단계의 임시 파일을 그 mount로 돌릴 수는 없습니다. 생성 단계부터 바깥 쓰기를 제한할 방법과 형식화 도구가 그 조건에서 동작하는지는 아직 미확인입니다.

공통 담당이 구현할 수 있도록 다음 계약을 구체화했습니다. 아래는 제안이며 구현·실행 PASS가 아닙니다.

| 순서 | 최소 구현 계약 | 허용할 수 없는 대체 근거 |
| --- | --- | --- |
| 1. 생성 controller | backing 한 개와 유한한 바깥 진단 파일만 생성. 경로뿐 아니라 inode·열린 FD까지 고정하고, 파일별 사전 cap과 전체 바깥 예산을 함께 강제. 예상 밖 temp가 필요하면 생성 전/즉시 실패 | `RLIMIT_FSIZE`만 추가하거나 생성 후 폴더 크기가 작다는 결과. 파일별 limit은 파일 수를 제한하지 않음 |
| 2. writer 수명 | 가능하면 producer profile에서 fork를 허용하지 않고 wrapper→고정 producer를 exec. fork가 필요하면 그 사실을 blocker로 남기고 전체 자식 감독을 별도 구현 | `killpg`만으로 새 session으로 이탈한 자식도 종료됐다고 간주 |
| 3. producer 연결 | cached 경로와 동일한 생성기라는 출처, 고정 인자, guest 초기화 전 반환을 먼저 증명한 뒤 새 출력 한 개만 준비 | `-version`, 임의 `mkfs.ext4`, 전체 emulator를 시작하고 파일 생성 직후 중단 |

**바깥 파일 배분 예시:** backing의 cap 64MiB와 별도로 `controller.sb` 16KiB, `attach.plist`/`controller-events.json`/`result.json`/`output.txt` 각 64KiB, canary 4KiB를 제안합니다. 진단 여섯 파일의 논리 cap 합은 **276KiB**이며 이전 바깥 예산 1MiB 안에 둡니다. 추가 임시 파일·atomic-replace 사본·삭제했지만 열린 파일도 예산에서 사라진 것으로 처리하면 안 됩니다. 허용 경로를 반복 교체해 새 inode를 만드는 우회도 거절해야 합니다. 파일시스템별 실제 할당량과 생성 도구의 쓰기를 강제할 backend는 미구현이므로 **65MiB는 여전히 설계 ceiling**입니다. 같은 제한 안으로 옮길 수 있는 profile·출력은 mount 안에 두어 바깥 허용 목록을 더 줄이는 편을 우선합니다.

다음 host 회귀의 관측 조건도 제안 문서에 남겼습니다. 초과·미등록 temp·열린 삭제 파일·링크/교체·자식 이탈은 거절하고, 보고서 기록/cleanup 실패도 성공으로 바꾸지 않아야 합니다. host mock은 계약 거절만 증명하며 실제 제한된 생성·형식화·할당량과 mount 수명은 별도 구성요소 관측이 필요합니다. 현재 존재하는 `-version` 전용 API와 unconditional native 거절 경로는 그대로 유지합니다.

이번 새 결과는 **읽기 전용 검토와 구현 순서·관측 조건의 구체화**입니다. subagent의 독립 검토도 소스 읽기만 했습니다. host 64개와 32MiB/버전 구성요소는 이전 기록이며 재실행하지 않았고 새 통과 수는 0개입니다. 실제 생성기/최소 용량/fresh AVD/QEMU/ADB/host-guest guard는 모두 NOT RUN입니다. 개인 이미지·DB·사진·인증, SDK·캐시·빌드·백업은 열거나 재해시·삭제하지 않았습니다. 두 문서만 로컬 커밋하고 push/PR/CI는 시작하지 않습니다. 전체 24/54와 수용 게이트는 변경하지 않습니다.

## 11월 2일: fresh QA userdata 준비의 정적 검토 완료, 실행 차단 유지

Android 시작점은 **`90318b4853439c79a76d2526034835e47d1e3b4d`**, 읽기 전용 공통 기준은 **`eaa88af9f96dc937370cec28f7dce5b79bb459d7`**입니다. 공통 `AGENTS.md`, `docs/RESUME.md`, `qa/map-transport/android/README.md`와 준비·보호 도구를 읽었습니다. 이번 변경은 이 문서와 `docs/ANDROID_PROPOSED_CHANGES.md`뿐이며 기존 Android 제품 소스와 10월 28일까지의 근거는 보존합니다. 공통 checkout에는 쓰지 않았고 merge/rebase/cherry-pick, 설치·다운로드·새 빌드는 하지 않았습니다.

### 확인 결과와 실행 구분

| 항목 | 상태와 근거 |
| --- | --- |
| 숫자 marker로 native 검사 허용 방지 | 정적 검토 PASS. `bounded_avd_storage.py:180–191`은 인자·환경 우회 없이 항상 거절하며 `run-validation.py:35–41`은 host/guest 명령 전에 이를 호출 |
| 32MiB Python worker/child, cached emulator `-version` | 기존 구성요소 PASS 기록 재사용. 이번에 재실행하지 않음. `-version` 고정 호출은 userdata 생성·QEMU 초기화·ADB를 실행한 근거가 아님 |
| Android host 회귀 64개 | 공통 기준의 기존 PASS 기록 재사용. 문서 검토이므로 이번 새 실행·통과 수는 0개 |
| fresh userdata producer, fresh AVD 생성·부팅, full QEMU, ADB, 실제 host/guest guard | 모두 NOT RUN. ≤1GiB native admission도 계속 차단 |

cached `data/empty_data_disk`의 **107 bytes**는 앞선 공통 점검의 작은 생성 표식 기록입니다. `bounded_avd_storage.py:118–127,153–161`은 이를 제한된 메타데이터로 다루고 internal empty-ext4를 후보로만 표시합니다. `userdata.img` 부재나 표식 크기를 SDK 손상으로 해석하지 않습니다. cached binary의 실제 producer와 최소 생성·부팅 용량은 미확인입니다. 과거 개인 AVD QCOW2 해시 차이의 원인은 계속 **UNCONFIRMED**이며 이번에 개인 이미지 본문을 읽거나 재해시하지 않았습니다.

### 남은 결손

1. **producer 호출 경계:** `emulator_bootstrap_probe.py:89–119`에는 `-version`만 있습니다. cached producer에 도달하면서 machine/guest 초기화 전에 반드시 반환하는 별도 진입점이 확인되지 않았습니다. 전체 emulator를 시작해 파일이 생기는 순간 종료하는 방식이나 별도 `mkfs.ext4` 성공을 installed QEMU `createUserData()`의 통과로 바꿀 수 없습니다.
2. **controller까지 포함한 파일 상한:** `bounded_storage_fixture.py:220–266,331–333`은 mount 밖에서 backing 이미지 생성, `tool-temp`, attach 기록·profile·보고서를 다룹니다. 현재의 이미지 사후 크기 검사와 64KiB pipe 한도는 이 바깥 파일들의 합계에 대한 사전 강제가 아닙니다. `emulator_bootstrap_probe.py:122–164`의 바깥 profile/version 출력도 같은 예산에 포함해야 합니다.
3. **자식·FD·마운트 수명:** `command():141–195`의 `close_fds`, 읽기 전용 stdin, 출력·시간 한도와 process-group 종료는 기반입니다. 실제 producer의 모든 자식, 새 session으로 이탈한 자식, 열린 쓰기 FD에 대한 보호·종료와 해제 전 writer 부재는 아직 증명하지 않았습니다. mount/backing의 전후 identity 확인도 전체 실행 중 교체 방지의 증거는 아닙니다.
4. **나중의 native 연결:** `qa_avd_guard.py:214–277`은 host PID/포트/시작 시각과 guest명·transport를 대조하지만 전체 파일 제한을 구현하지 않습니다. 향후 시험이 만드는 ADB key/log/temp와 server 수명도 제한에 결합해야 합니다. marker의 `verifiedIncrementalBoundBytes`는 여전히 선언값입니다.

제한 대상은 **시험 때문에 만들어지는 파일·임시 파일·출력과 자식/열린 쓰기 FD의 파일 쓰기**입니다. Mac 전체의 swap, 시스템 로그, 다른 앱 증가량을 새 수용 조건으로 요구하지 않습니다.

### 다음 최소 단위와 설계 예산

다음 단위는 **별도 producer-only adapter로 새 userdata 출력 한 개를 만들고 종료하는 구성요소**입니다. AVD 생성·선택, boot, ADB, 앱 검사는 포함하지 않습니다. 먼저 cached producer와의 출처·호출 경계 및 guest 진입 전 반환을 증명해야 하며, 그런 경계가 없으면 실행하지 않고 결손으로 남깁니다. 별도 helper 빌드는 그 helper의 근거일 뿐 installed binary의 producer 통과가 아닙니다.

후보 예산은 기존 **32MiB 파일시스템** 안의 새 출력 하나, backing 파일의 논리 크기·할당량 각각 **64MiB 이하**, 바깥 controller/임시/로그/보고서 전체 **1MiB 이하**, 합계 **65MiB(68,157,440 bytes) 이하**입니다. 내부 출력은 backing과 중복 합산하지 않습니다. 이는 다음 도구의 **설계 ceiling**이며 현재 강제되거나 실제 producer가 들어간다는 결과가 아닙니다. 생성 요청 크기·최소 크기는 미확인이고, 수용되지 않으면 자동 확대나 full emulator 우회 없이 중단합니다.

실행 전에는 backing 생성·형식화 단계부터 바깥 임시 파일까지 이 ceiling을 OS/FD 수준에서 강제해야 합니다. 사후 합산이나 polling만으로 허용하지 않습니다. 관측 조건은 고정 producer 인자·출처, mount/backing identity, 새 출력의 bounded ext4 헤더·크기·소유권, 바깥 쓰기·상속 FD 거절, 모든 자식 종료, writer 부재 뒤 소유 mount만 해제, 불명확한 cleanup 시 보존입니다. 이 구성요소가 나중에 통과해도 native gate는 열지 않습니다. full fresh boot와 ≤1GiB 전체 제한은 별도 단계입니다.

이번에는 emulator/ADB, 이미지 생성·마운트·디스크 채우기, native 실행, SDK/AVD/cache/백업 삭제를 모두 하지 않았습니다. 추가 AOSP 조사나 새 실험도 하지 않았습니다. 문서 diff와 공백 오류를 확인해 두 문서만 로컬 커밋하며 push/PR은 하지 않습니다. 공통 최신 **24/54, P3-02 부분 완료, G1~G4 미완료**를 유지합니다.

**중단·재개 규칙:** 사용자의 “그만/멈춰/중단/여기까지 저장” 요청은 항상 현재 작업까지만 마무리하고 진행 상황·미완성 내용·근거·다음 항목을 저장한 뒤 모든 추가 작업을 중지하는 뜻으로 적용합니다. 이번 검토도 문서 두 개의 로컬 커밋 뒤 중단합니다. 새 사람 재개 지시 전 자동으로 다시 시작하지 않습니다. 다음 재개 항목은 위 producer-only 진입 경계와 전체 파일 ceiling의 구현 가능성 확인이며, 실제 producer 실행은 아직 허용할 수 있는 상태가 아닙니다.

## 10월 28일: 통제된 파일 오류와 반복 사본 누적5개 완료

사용자 재개로 Android **`019f03ef0926a2efe6629ac204f6572a8ed454ca`**에서 시작했고 제품 동작은 **`ef799c490595f2380630d30918870a291c21f45f`** 그대로 고정했습니다. 기존 AGENTS/진행/재개 기록과 native-validation 절차를 읽고 새 고유 QA DB/auth/cache, 합성 PNG 경로와 원래 모든 DB/설정/사진/인증/APK/package-lock/network 및 임시63개 소스의 원문/존재 여부/해시 기준을 저장했습니다. 기본 개인 v1 DB를 새 QA repository로 열지 않았고 공통 live 소스/iOS8081은 수정하지 않았습니다.

기존 API37 Debug 에뮬레이터/APK의 실제 Expo File/Directory, Crypto, SQLite와 제품 native producer/cleanup/repository ACK guard로 **새5개가 PASS**입니다. 정상 임시 백엔드에 실제 AppStore로 방문1개와70-byte 사진1개를 백업해 ACK를 먼저 만들었습니다. 이어 같은 PNG의 별도 첨부본1개는 미전송 대기에 두었습니다. 제품 변경, 새 빌드/설치/의존성 추가나 export는 없습니다.

| 통제한 사례 | 실제 Android 결과 |
| --- | --- |
| QA snapshot root Directory.create의 synthetic ENOSPC | 그 root 호출1회만 가로채고 다른 경로는 native에 전달. prepare가 현행 PhotoFileError(reason=invalid)로 끝나고 DB/원본/빈 cache/active registry를 보존. finally에 관측 기능 복구 후 정상 새 producer 생성과 dispose 성공 |
| QA ownership.json File.write의 synthetic ENOSPC | QA root 안 marker 쓰기1회만 가로챔. 이미 만든 부분 사본/marker는 native dispose로 정리됐고 원본/DB는 같음. 관측 기능 복구 후 새 producer와 dispose 성공 |
| 지정 QA duplicate File.bytes의 synthetic EIO | 정확히 그 사본 읽기1회만 실패. cleanup examined1/removed0, ACK guard 호출0이며 같은 marker/본문을 보존. finally 복구 후 같은 사본을 다음 정상 pass에서1개 제거 |
| 지정 QA duplicate File.delete의 synthetic EACCES | 정확히 그 사본 삭제1회만 실패. cleanup examined1/removed0, repository guard에서 예외1회. 같은 QA DB의 실제 native exec BEGIN IMMEDIATE→ROLLBACK 반환을 관측했고 DB/큐/marker/본문은 동일. 관측 기능 복구 후 같은 사본을 정상 pass에서 제거하고 BEGIN IMMEDIATE→COMMIT 반환도 관측 |
| 보존 backlog25개와 새 ACK 사본36개의 반복 누적 | 미표시8개, 다른 owner9개, ACK 없는 pending8개를 보존 대상으로 준비. 실제 native producer 기반 ACK 사본12개씩3묶음 추가. 묶음별 수동 pass 제거 수는0→12,0→12,1→11로 합계36개, 각 pass examined20 이하. 세 묶음 뒤에도25개 전체 파일/marker/지문과 미전송 큐를 그대로 유지 |

파일 오류4회는 **지정 QA 경로에서만 주입한 합성 예외**입니다. 실제 디스크를 채우거나 OS ENOSPC/EIO/EACCES를 발생시킨 검사가 아닙니다. 모든 다른 호출은 원래 native 기능에 전달했고 각 fault의 finally에서 해제했습니다. 실패한 삭제의 ROLLBACK과 다음 정상 COMMIT 관측도 QA DB 경로에만 한정했으며 원래 SQLite 호출은 그대로 전달했습니다. File/Directory/SQLite prototype의 원래 함수와 own-property 존재 여부/descriptor를 최종 복구했습니다.

두 producer 오류의 reason=invalid는 현행 계약이며 별도 저장 공간 안내나 UI 오류 흐름을 새로 검증한 결과가 아닙니다. 이번 전송은 정상 ACK fixture 준비였고 부분 HTTP 응답/native Response 노출 검사를 추가하지 않았습니다. 앞선 응답 기한/20개/64MiB 한도 결과는 별도 이력이며 이번5개로 재합산하지 않습니다.

반복 사본은 native producer의 실제 현재-session/context/지문을 대조한 뒤 attempt ID/이전-session marker를 합성한 것입니다. 앱이나 native session을 실제로 재시작하거나 수일이 지난 결과가 아닙니다. 같은 실행 안에서 진행한3묶음의 짧은 반복이며, 새 사본이 보존 backlog 뒤에서도 진행되는 범위만 확인했습니다. 제품이 남긴25개는 근거를 보관한 뒤 시험 도구가 소유 경로만 정리했습니다.

### 보존, 재사용한 검사와 저장 상태

모든 cleanup pass에서 QA DB의 방문/사진/outbox/metadata/settings와 원본 SHA가 같았습니다. 합성 PNG는70 bytes 한 장과 별도 첨부본 한 개뿐입니다. 사진/사본의 준비 시점 관측 합계 최대17,748 bytes, 순차 producer 임시 파일/marker까지 포함한 보수적 상한21,914 bytes를 구분했습니다. 최종 안정 QA DB3파일 합407,696 bytes를 더한429,610 bytes도200MiB 미만입니다. 이 값들을 순간 최고 사용량의 실제 측정값으로 표시하지 않습니다.

공통이 추가한 회귀10개와 모바일559개/서버61개, 전체 verify-cloud/Android+iOS JS-Hermes 통과는 전달받은 별도 공통 근거를 재사용했습니다. 현재 공통의 핵심 native cleanup/manifest/repository가 고정 ef799c4와 같은 bytes임을 대조하고 테스트 diff만 로컬 참고 자료로 보관했습니다. 이번 Android 실행에서 host/전체 검사를 반복하거나 공통559개/iPhone5개를 새 Android 통과 수로 합산하지 않았습니다. 복구한 Android 브랜치 CI도 고정 QA 제품/native5개와 구분합니다.

새 최종 대조에서 원래 모든 개인 DB행/스키마/설정, 모든 owner의 사진 bytes와 QA 외 인증이 같습니다. QA는 guest/credential 부재와 SQLite v5 integrity/FK 정상이며, 안정된 최종 DB/WAL/SHM 사본이 native 최종 행/설정과 같았습니다. 합성 방문1개/사진2개/미전송 사진 대기1개/사진 ACK1개를 유지했고 서버 방문/영수증1개씩, 사진/영수증1개씩과 원본 SHA/크기도 대조했습니다.

기기에서 정리하기 전 남은25개 cache marker/본문과 원본2개를 보관했고, 보관본의 모든 SHA/크기가 native 최종 증거와 같은 것을 별도로 검증했습니다. 안정 DB의 기준은 앱 force-stop 후 DB/WAL/SHM을 함께 보관한 `private-qa-final.tar`이며, `private-owned-final.tar`는 사진/cache 기준 자료입니다. 검증 후 QA DB3파일/사진2개와 이번 cache만 정리했습니다. 기존 cache/SDK/AVD/build/백업/증거는 삭제하지 않았습니다.

source63개(기존15개, 새48개)와 QA DB/auth/cache 상수, auth transport/app.config.ts의 원문/부재/해시를 복구했습니다. Package/lock과 설치/보존 APK, 무선 설정/같은 emulator boot ID를 대조했고 자체8082/3002/3003, Metro reverse와 에뮬레이터를 종료했습니다. HTTP reverse는 없었습니다.

로컬 Git 제외 근거는 `docs/test-results/android-snapshot-storage-ef799c4-20261028/`의 `validation-files.json`, `source-reuse-proof.json`, `storage-summary.json`, `private-state-after-*.json`의 fault/guard/SQL/전후 행과 파일, `private-owned-final.tar`, `private-qa-final.tar`, `archive-preservation-proof.json`, `shutdown-status.json`입니다. 개인 값/수량/해시, 인증/token과 raw diagnostics는 커밋하지 않습니다.

승인한5개 묶음을 마쳤고 추가 제품 결함/수정 제안은 없습니다. 실제 공간 부족/수일 누적/새 실제 restart/실제 Android 휴대폰/Release/손가락 UI/전체 수용은 별도입니다. 전체23/54, P3-12/P3-13 부분 완료와 G1~G4를 유지하며 추가 검사 없이 다음 지시를 기다립니다.

## 10월 27일: 준비 사본 정리의20개/64MiB native 한도2개 완료

사용자 재개 후 Android **`95060bf460caac24b1b0f43351fa6ea6f082279a`**, 공통 체크포인트 **`d4349d110f6616182729c71e17bfe2bd61d9d98a`**를 확인했습니다. 제품은 **`ef799c490595f2380630d30918870a291c21f45f`**를 고정했습니다. 최신 차이는 iOS의 `usePrecompiledModules:false` 선언이며 이 Android 작업에서 새 native 빌드/설치를 하지 않았습니다. 새 고유 QA DB/auth/cache와 합성 PNG 세 개, 원래 DB/설정/사진/인증/APK/package-lock/무선 상태 및 임시63개 소스 원문/부재/해시를 먼저 저장했습니다. 기본 개인 DB를 새 소스로 열지 않았고 공통 live 소스/iOS8081은 수정하지 않았습니다.

기존 API37 Debug APK의 실제 Expo File/Directory, Crypto와 SQLite, 제품 `preparePhotoFile`/`cleanupPreparedPhotoFiles` 및 repository ACK 트랜잭션 경로에서 **새 native 한도2개가 PASS**입니다. 서버는 정상 응답만 사용했습니다. 실제 AppStore가 합성 방문1개와 사진3개를 백업해 서버/로컬 ACK를 먼저 만들었고, 이후 사진1개는 미전송 대기에 두어 ACK guard를 확인했습니다.

| 흐름 | 실제 결과 |
| --- | --- |
| 소형 사본21개와20개 검사 제한 | 실제 native producer의70-byte PNG 사본을 바탕으로 소유권 marker가 있는 합성 이전-session 사본21개 준비. 첫 수동 pass는 examined20/removed20, bytesRemoved1,400, native 이미지 읽기4,200 bytes. 정렬 순서와 cursor가20번째에서 끝났고21번째 전체 파일/marker가 유지됨. 다음 pass는 그21번째만 examined1/removed1, bytesRemoved70, native 이미지 읽기210 bytes. DB/대기/설정과 원본 bytes는 두 pass 모두 동일 |
|64MiB 읽기 한도와 다음 pass, ACK guard |7,456,540 bytes 사본2개와7,456,541 bytes 사본1개를 앞에 배치. 각 사본의 async 사본 읽기+삭제 직전 원본/사본 sync 읽기3회를 실제 File 메서드로 계측. 첫 pass는5개를 examined,3개만 제거했고 실제 이미지 읽기67,108,863 bytes로64MiB보다1byte 작음. 뒤의 정상 ACK 사본70 bytes와 미확인 사본70 bytes는 본문을 읽지 않고 그대로 보존. 다음 수동 pass는 examined2/removed1, 이미지 읽기280 bytes. 정상 ACK 사본은 처리됐고 미확인 사본은 실제 repository ACK 검사 false로 전체 marker/본문과 대기 그대로 유지 |

64MiB는 삭제한 파일 크기 합이 아니라 **사본의 첫 읽기와 최종 원본/사본 비교를 합한 읽기 예산**입니다. 첫 큰 pass의 삭제량은22,369,621 bytes, 읽기는 그3배였습니다. 한도 때문에 건너뛴 사본에는 첫 pass에서 File.bytes/bytesSync 호출이 없었음을 관측했습니다. 두 번째 pass는 ACK 있는 사본3회 읽기210 bytes와 미확인 사본의 async 읽기70 bytes이며, ACK guard가 false라 미확인 원본/사본 sync 비교나 삭제는 없었습니다. 각 pass 전후 전체 QA 방문/사진/outbox/metadata/settings와 원본 SHA가 같았습니다.

이번 marker는 실제 native producer의 현재-session/context/지문을 확인한 뒤 attempt ID와 이전-session 값만 바꾼 **합성 fixture**입니다. 이번에 앱을 재시작해 native session 교체를 증명한 것이 아닙니다. 실제 재시작/시작 wiring 근거는 앞선4bd7ea3의 별도 이력이며 이번 한도2개와 합산하지 않습니다. 최종 미확인 사본은 제품이 보존한 결과를 근거에 보관한 뒤 시험 도구가 소유 경로만 정리했습니다.

완성된 fixture 시점의 기기 파일 합계는37,285,577 bytes입니다. 순차 생성 중 producer 임시 사본 하나와 marker를 더한 보수적 상한은44,746,214 bytes로200MiB 이내입니다. observer의 raw `peakNativeFixtureBytes` 필드는 준비 완료 시점 합계를 측정한 것이며 실제 순간 최고 측정값으로 쓰지 않습니다. raw 근거는 유지하고 요약/정리 보고에 이 구분을 기록했습니다. 기존 cache/SDK/AVD/백업/증거는 삭제하지 않았습니다.

### 검증 재사용과 최종 복구

핵심 `photoFile.native.ts`, `photoSnapshot.ts`, `repository.ts`가 기존4bd7ea3 검사 소스와 같은 bytes인 것을 Git object로 대조했습니다. 공통의 모바일549개/서버61개와 전체 verify-cloud, [기존 제품 CI](https://github.com/OhHyunSeo/travel-visit-tracker/actions/runs/40335429980) 통과는 재사용한 이력이며 이번에 새로 실행한 수로 표시하지 않습니다. 이번에는 host/전체 검사, native 빌드, 설치, 의존성 추가나 export를 반복하지 않았습니다. Android 결과 브랜치 CI도 임시 고정 제품/native 결과와 구분합니다.

새 종료 대조에서 원래 모든 DB 테이블/스키마/설정, 모든 owner의 사진 bytes와 QA 외 인증이 같았습니다. QA는 guest/credential 부재, SQLite v5 integrity/FK 정상이며 안정된 최종 DB 사본이 native 최종 행/설정과 같았습니다. 합성 방문1개/사진4개/사진 대기1개/사진 ACK3개가 유지됐고 서버 방문/영수증1개씩, 사진/영수증3개씩과 원본 파일 SHA/크기를 대조했습니다.

QA DB/WAL/SHM3개와 이번 원본4개, 보존된 미확인 cache를 로컬 근거로 보관한 뒤 시험 소유 자료만 기기에서 정리했습니다. source63개(기존15개, 새48개), auth transport와 QA 상수, app.config.ts의 원문/부재/해시를 복구했습니다. package/lock, 설치/보존 APK와 무선 설정/같은 emulator boot ID를 대조했습니다. 자체8082/3002/3003과 Metro reverse, 에뮬레이터는 종료했고 HTTP reverse는 없었습니다.

근거는 Git 제외 `docs/test-results/android-snapshot-budget-ef799c4-20261027/`의 `validation-files.json`, `source-reuse-proof.json`, `budget-summary.json`, `private-state-after-*.json`의 실제 File 읽기/ACK 결정/cursor/전후 파일·DB, `private-owned-final.tar`, `private-qa-final.tar`, `measurement-clarification.json`, `shutdown-status.json`입니다. 개인 값/수량/해시, 인증/token과 raw diagnostics는 커밋하지 않습니다.

승인한 한도 묶음은 완료했고 추가 제품 결함/수정 제안은 없습니다. Storage-failure/장기 누적/Release/손가락 UI/실제 Android 휴대폰이나 새로운 재시작 검사는 시작하지 않습니다. 전체23/54, P3-12/P3-13 부분 완료와 G1~G4는 유지하며 다음 지시를 기다립니다.

## 10월 26일 재개: 가입 응답 기한과16KiB 경계3개 완료

새 사용자 재개 승인에 따라 **`daed98caec111d96a9956c5245cd266315453dba`**에서 시작했고 제품은 **`e52352c8543bab6726fde7ceec00c22483bab48b`** 그대로 고정했습니다. 직전 중단 준비와 별개의 새 QA DB, 인증 key/service, cache root와 합성 사진 경로를 만들었습니다. source62개를 고정 Git object에서 준비하고 원문/부재/해시를 저장했으며 기본 개인 DB를 새 소스로 열지 않았습니다. 기존 API37 Debug APK, 실제 AppStore/AuthStore의 AuthClient→native authFetch와 SQLite/SecureStore를 사용했습니다. 제품 수정, 새 빌드/설치/의존성 변경은 없습니다.

이번 범위의 **새 native3개가 PASS**입니다. 앞선 `834ba6b`의 계정 확인/다른 로그인/대기 로그아웃3개와 아래 중단 준비의 요청0건은 별도 이력입니다. 초기 정상 A 로그인과 합성 방문/사진 준비는 시험 설정이며 추가 native 시나리오 수로 합산하지 않습니다.

| 요청과 조건 | 실제 Android 결과 |
| --- | --- |
| 실제 AppStore 신규 가입, 서버 저장 뒤 일부 응답 | 서버가 신규 합성 계정을 저장한 뒤 정상 응답16/349 bytes만 보냄. 요청은10,016ms에 AuthError(status0)로 종료, AppStore busy 해제와 오류 안내. 기존 A credential/session/owner와 기록·사진·큐 유지. 실제 abort/cancel/release 전달 유지. 기한 전 native Response와 reader bytes는0이며 서버 prefix16과 구분. 기한 뒤 tail 전송 시 연결은 이미 닫혔고 인증/owner가 바뀌지 않음. 같은 이메일의 다음 가입은409, 서버 계정 수3개 그대로. 이후 정상 로그인으로 이미 생성된 계정을 사용했고 A 행/사진/큐는 보존 |
| 실제 AppStore B 로그인, 정확히16KiB | Content-Length 없는 chunked 정상 JSON에 공백을 붙여16,384 bytes. 서버 기록과 native Content-Length 부재 대조. 실제 native reader가16,384 bytes를3번의 read로 수신했고541ms에 로그인 성공. B credential/owner로 정상 전환, A 행/사진/큐와 원본 bytes 보존 |
| 실제 AppStore B 로그인,16KiB+1byte | 같은 방식의 Content-Length 없는16,385 bytes. 실제 native reader5번으로16,385 bytes를 관측한 뒤744ms에 AuthError(status0), busy 해제와 오류 안내. 기존 B credential/session/owner 및 A 행/사진/큐 보존. 다음 정상 계정 확인 성공 |

크기 경계 두 경우의 실제 native reader cancel과 releaseLock은 각각1회였고 abort 전달도 유지했습니다. 취소/정리를 무시하도록 바꾼 요청은 없습니다. 정확한 경계와1바이트 초과의 native 읽기/판정 결과이며 큰 본문 전체 부하나 새 손가락 UI 검증으로 확대하지 않습니다. AppStore 공개 액션을 관측 도구로 호출한 Debug 에뮬레이터 결과입니다.

모든 계정 전환과 최종 guest에서 A의 합성 방문1개, 사진1개와 대기2개, 사진 URI와7,090,841-byte PNG SHA를 보존했습니다. Guest import와 방문/사진 전송, 서버 방문/사진/영수증은0개입니다. 서버 계정3개 중2개는 host 준비,1개만 이번 native 가입으로 생성됐으며 중복 가입은 새 계정을 만들지 않았습니다.

### 검사와 최종 복구

Node24.21.0의 **`npm --prefix travel_visit_tracker run check` PASS**: 타입, ESLint,21파일의 모바일549개입니다. 같은 고정 제품의 앞선 전체 verify-cloud/JS-Hermes와 서버61개를 이번에 새로 실행한 것으로 합산하지 않습니다. Android 브랜치 CI는 복구한 브랜치 기준이며 임시 고정 제품의549개/native3개와 구분합니다.

새 시작/종료 대조에서 원래 모든 DB 테이블/설정/스키마, 모든 owner의 사진 bytes와 QA 외 인증이 같았습니다. 최종 guest/QA credential 부재와 QA SQLite v5의 integrity/FK, A 행/큐 보존도 확인했습니다. QA 최종 DB와 사진 근거는 로컬에 보관한 뒤 QA DB/WAL/SHM3개와 이번 사진만 기기에서 제거했고 빈 QA cache root의 부재를 확인했습니다.

앱과 자체 서비스를 멈춘 뒤 source62개의 원문/부재/해시, 새 auth transport2개와 QA 상수를 복구했습니다. package/lock과 설치/보존 APK, 원래 무선 설정과 같은 emulator boot ID를 대조했습니다. 자체8082/3002/3003과 Metro reverse, 에뮬레이터는 종료했고 HTTP reverse는 없었습니다. iOS8081과 공통 live 소스/namespace, 기존 cache/SDK/AVD/백업은 수정하거나 삭제하지 않았습니다. 이번에는 production export를 생성하지 않았습니다.

근거는 Git 제외 `docs/test-results/android-auth-boundary-e52352c-20261026-resume/`의 `validation-files.json`, `auth-boundary-summary.json`, `private-state-after-*.json`, native transport reader/credential 지문, server gate/release와 크기별 기록, `private-synthetic-final.tar`, `private-qa-final.tar`, `verification.log`, `shutdown-status.json`입니다. 개인 값/수량/해시, 인증/token과 raw diagnostics는 커밋하지 않습니다.

승인한 가입과16KiB 경계 묶음은 완료했고 다음 새 검사는 시작하지 않습니다. 공통 제품 결함이나 수정 제안은 없습니다. 실제 Android 휴대폰/Release, 손가락 UI, 전원/OS 비정상 종료와 전체 수용은 별도이며 전체23/54, P3-12/P3-13 부분 완료와 G1~G4는 유지합니다.

## 10월 26일 중단 재확인과 준비 환경 복구

기존 중단 체크포인트 `36ddb6d`에서 새 가입/16KiB 검사 준비를 시작한 오류를 바로잡았습니다. 중단 지시를 재확인한 즉시 다음 요청이나 재시도 없이 이번 준비만 정리했습니다. **새 native 완료0개, 앱 HTTP 요청0건, 가입과16KiB 경계 검사는 NOT RUN**입니다. 서버의 합성 계정2개는 host 준비 자료이며 native 가입 결과가 아닙니다. 기존 `e52352c` 계정3개와 결과 커밋 `834ba6b`, 해당 CI PASS는 그대로 유효합니다.

기존 APK/API37을 실행해 새 QA 이름을 적용하고 합성 파일을 준비했지만 관측 연결 준비에서 timeout이 발생했습니다. 가입, 로그인, 계정 확인이나 크기 경계 요청은 보내지 않았습니다. 새 빌드/설치/의존성 변경도 없습니다. 실패한 연결 준비와 미실행 시나리오를 통과로 합산하지 않습니다.

최종 대조에서 원래 모든 DB 테이블/설정/스키마, 모든 owner의 사진과 QA 외 인증이 보존됐습니다. QA credential은 없었고 QA DB/WAL/SHM3개와 이번 합성 사진은 로컬 근거로 보관한 뒤 기기에서 정리했습니다. 빈 QA cache root도 부재를 확인했습니다. source62개의 원문/존재 여부/해시와 package/lock, 설치/보존 APK, 무선 설정과 같은 emulator boot ID를 대조했습니다. 자체8082/3002/3003과 관측 도구, Metro reverse와 에뮬레이터는 모두 종료했고 iOS8081/공통 live 소스는 수정하지 않았습니다. 기존 캐시, SDK, AVD 자료와 Time Machine 백업은 이번에 삭제하지 않았습니다.

로컬 근거: `docs/test-results/android-auth-boundary-e52352c-20261026/shutdown-status.json`. 사용자 재개 지시와 고정 범위가 새로 정해지기 전에는 추가 준비나 검사를 시작하지 않습니다. 재개가 승인되면 새 보존 기준과 고유 QA 이름부터 준비합니다. 이번 저장은 완료 수와 수용 게이트를 바꾸지 않습니다.

## 10월 26일 사용자 요청으로 저장하고 중단

중단 요청 도착 시 Android의 고정 `e52352c8543bab6726fde7ceec00c22483bab48b` 계정 native3개와 QA/원본 보존 대조, 임시 소스/환경 복구는 이미 완료돼 있었습니다. 결과 커밋은 `834ba6b42b1ce7766b08930524fa98427cd69b35`, 해당 CI도 PASS입니다. **진행 중 요청0개, 새 시나리오/재시도0개**이며 이번 중단 저장으로 완료 수를 늘리지 않습니다.

현재 source62개의 원래 존재 여부/해시를 다시 대조했고 자체8082/3002/3003과 에뮬레이터가 꺼진 것을 재확인했습니다. 종료 시 원래 모든 DB/설정/사진/인증, APK/package/lock/무선 상태 보존과 QA 인증 삭제/guest, 시험 DB/사진/cache/reverse 정리는 완료됐으며 근거를 보관했습니다. 이를 확인하려고 기기나 서버를 다시 실행하지 않았습니다.

완료 범위는 아래 계정 확인/다른 로그인/대기 로그아웃3개입니다. Native signup,16KiB stress, 새 손가락 UI와 실제 Android/Release는 계속 미실행입니다. 공통 채팅의 전달에 따르면 **이번 iPhone 자동 복귀는 locked로 앱 실행이 거절돼 baseline/준비만 했고 NOT RUN**입니다. Android가 그 iPhone 상태를 직접 검증한 것은 아니며, 이전 iPhone 계정3개와 이번 자동 복귀 미실행을 구분합니다.

재개 지점: Android e52352c 계정 검사는 완료 상태로 보존합니다. 새 사용자 재개 요청과 공통의 고정 소스/범위가 정해진 뒤에만 새 원본 기준값과 고유 QA 이름으로 다음 작업을 시작합니다. 이번 미실행 iPhone 자동 복귀는 공통/iOS 채팅의 별도 재개 항목입니다. 로컬 중단 근거는 `docs/test-results/android-auth-deadline-e52352c-20261026/stop-checkpoint-20261026.json`입니다. 전체 완료 수와 수용 기준은 유지합니다.

## 10월 26일: 계정 요청 기한, 계정 보존과 대기 로그아웃

공통 제품 **`e52352c8543bab6726fde7ceec00c22483bab48b`**를 고정했고 Android 시작 기준은 `9d72292`입니다. 독립10초/16KiB AuthClient stream, 새 authTransport.native.ts/.web.ts와 useAuthStore의 authFetch 연결을 포함합니다. 임시62개 파일 모두 고정 Git object에서 준비해 공통/iOS의 live QA namespace를 복사하지 않았습니다. 새 QA DB, 인증 key/service와 cache root, 합성 PNG 경로를 사용했고 기본 개인 DB/캐시를 새 소스로 열거나 스캔하지 않았습니다. 기존 API37 Debug APK, 실제 AppStore/AuthStore, SQLite/SecureStore와 Expo native HTTP이며 새 빌드, 설치나 의존성 변경은 없습니다.

**새 Android native3개가 PASS**입니다. 앞선8d01be8 자동 복귀2개/방문 기한3개나 iPhone 계정3개를 이 결과로 대신하지 않습니다. 실제 AuthStore의 AuthClient.send가 native authFetch와 같은 것을 요청마다 대조했습니다.

| 요청과 조건 | 실제 Android 결과 |
| --- | --- |
| 실제 AppStore 계정 확인의 부분 /me | 서버가 정상200 응답16/153 bytes만 보낸 뒤 유지. AuthClient 요청은 약10.008초에 AuthError(status0)로 실패하고 AppStore busy 해제. 기존 QA A 계정/credential 값, active owner, 방문/사진/큐와 원본 bytes 보존. 상태는 offline이며 다음 정상 확인에서 같은 A 계정 signed-in 복귀 |
| 실제 AppStore의 다른 시험계정 로그인 | B 계정의 정상 로그인 응답16/354 bytes 뒤 유지. 약10.012초에 실패와 busy 해제, AppStore 오류 안내. 옛 A 계정/credential/owner와 모든 기록 유지. 다음 정상 B 로그인은 성공하고 owner가 B로 바뀌었지만 A의 원래 행과 사진/큐는 그대로, guest import0회 |
| Held /me 하나만 abort forwarding 생략, 같은 Manager의 로그아웃 대기 | B 계정의 AppStore 확인 뒤 실제 AuthStore.logout을 같은 SessionManager에 대기. 전용 요청만 signal 전달 생략, cancel/release는 실제대로 유지. 요청은 약10.007초에 독립 실패, 확인과 대기 로그아웃 모두 약10.229초에 완료. logout이 기한 전에는 대기한 상태였고 같은 Manager 식별자를 확인. Guest, credential 삭제와 owner guest 상태 완료. 열린 서버 연결에 늦은 tail을 보내자 native Response는 나타났지만 reader를 만들지 않고 body cancel1회, 계정/인증/owner가 되살아나지 않음 |

세 경우 모두 기한 전에 native Response와 reader bytes는 노출되지 않았습니다. **서버 prefix16 bytes와 native reader0 bytes를 구분**합니다. 기본 두 경우는 abort/cancel/release를 억제하지 않았고 기한 뒤 tail 전송 시 연결은 이미 닫혀 있었습니다. 추가 독립 /me는 source signal의 aborted를 확인했으나 그 요청 하나에만 전달하지 않았습니다. 추가 cancel/release 억제는 필요하지 않았습니다. 실제 늦은 Response 이후에도 reader 생성/본문 읽기는0회였고 body cancel1회만 관측됐으므로 iPhone의 늦은 두 번째 read와 동일한 경로로 표시하지 않습니다.

세 번째는 AppStore checkAccount가 진행되는 동안 같은 AuthStore/SessionManager의 공개 logout을 큐에 넣은 native 검사입니다. 실제 같은 Manager에서 직렬 실행과 해제를 확인했습니다. 새 손가락 조작이나 이 소스의 앱 재시작, 물리 Android, Release 증거로 확대하지 않습니다.

모든 경우에 같은 소유자의 방문1개, 사진1개와 방문/사진 대기2개, 사진 URI와7,090,841 bytes PNG의 SHA가 유지됐습니다. 정상 계정 전환과 최종 guest에서도 A의 행이 이동하거나 삭제되지 않았고 guest import는0회입니다. 서버는 합성 계정2개만 준비했고 방문/사진 POST와 서버 방문/사진/영수증은 모두0개였습니다. Native signup과16KiB 초과 경계 stress는 새 검사에 포함하지 않았습니다.

### 자동 검사와 원본 복구

Node24.21.0 `bash scripts/verify-cloud.sh`가 PASS입니다. 타입, ESLint,21개 파일의 **모바일549개**, 이 Android verifier의 backend syntax/native dependency load와 양쪽 production JS/Hermes export를 포함합니다. 공통 서버61개와 공통의 실제 임시 auth HTTP/SQLite 검사를 여기서 반복한 것으로 표시하지 않습니다. 브랜치 CI도 이 임시 고정 QA 소스의549개/native3개와 구분합니다.

새 시작/종료 기준으로 원래 모든 저장 테이블, 설정, 스키마, 모든 owner의 사진 bytes와 QA 외 인증을 대조해 보존했습니다. 추가 늦은 응답 뒤에도 QA credential 부재, guest와 원래 QA 행/큐 보존을 확인했습니다. 최종 QA DB와 대기 PNG를 근거로 보관한 뒤 QA DB/WAL/SHM3개, 시험 PNG1개만 정리했고 QA cache root의 부재도 확인했습니다.

앱과 자체 서비스를 먼저 멈추고 **source62개(기존14개, 새48개)**의 원문/부재/해시를 복구했습니다. AuthClient/AuthStore와 새 authTransport 두 개, DB/인증/cache 상수를 포함합니다. package/lock, 설치와 보존 APK, 원래 무선 설정과 emulator boot ID가 같습니다. 자체8082/3002/3003, Metro reverse와 에뮬레이터를 종료했고 HTTP reverse는 없었습니다. iOS8081, 공통의 live source/namespace와 기존 legacy 캐시/백업은 수정하지 않았습니다. 이번 생성 JS/Hermes40개, 논리8,826,580 bytes만 사용 후 정리했으며 즉시 가용량 증가는 관측되지 않았습니다.

근거는 Git 제외 `docs/test-results/android-auth-deadline-e52352c-20261026/`의 `validation-files.json`, `auth-deadline-summary.json`, `private-state-after-*.json`, native request/Manager/credential 지문과 서버 gate/release 상태, `private-synthetic-final.tar`, `private-qa-final.tar`, `verification.log`, `shutdown-status.json`입니다. 원래 개인 수량/값/해시, credential, token과 raw diagnostics는 공개하지 않습니다. 추가 제품 수정 제안은 없으며 전체 완료 수, P3-12/P3-13과 G1~G4는 변경하지 않습니다.

## 10월 25일 후속: P3-13 OS 연결 복귀 뒤 자동 방문 백업

제품은 **`8d01be8b8e3bf4896fbc76264b442b9dfe415d55`** 그대로 고정했고 Android 시작 기준은 `419c062`입니다. 기존 API37 Debug 앱에서 새 QA DB, 인증과 cache root를 사용했습니다. 이번에는 응답 지연이나 fetch 예외, abort 생략, 과거 시계나 재시도 시각 편집을 사용하지 않았습니다. 실제 에뮬레이터 OS의 비행기 모드 ON, Wi-Fi/모바일 데이터 OFF와 native HTTP 실패를 확인한 뒤 합성 방문1개와 PNG1개의 큐를 준비했습니다. 고유 QA 계정의 실제 AppStore 자동 방문 백업 opt-in을 켰습니다.

**새 실제 OS 자동 복귀2개가 PASS**입니다. 연결 복구 뒤 시험 도구는 AppStore.backupVisits나 Coordinator.run을 직접 호출하지 않았습니다. 계측은 실제 앱 호출을 그대로 전달해 기록했고, helper에는 별도 백업 실행 단계가 없습니다. opt-in ON 액션은 처음 오프라인 준비 때 한 번뿐입니다.

| 흐름 | 실제 결과 |
| --- | --- |
| 같은 foreground에서 OS 연결 복구 | 자연스러운 자동 실패2회를 기다려 약30초,60초 재시도를 관찰. 두 번째 실패의 health 시각은 긴 nextAttemptAt보다 약30초 이르게 저장됨. QA SQLite/WAL 사본을 읽기 전용으로 열어 nextAttemptAt, connectionCheckAt와 마지막 성공 시각이 native 상태와 같음을 확인. 원래 OS 연결 설정으로 복구한 뒤 앱의4초 foreground 주기만으로 health→방문 ACK 완료. health는 원래 긴 재시도 시각보다27.884초, ACK 성공은26.791초 먼저 발생. AppState는 내내 active, 서버 방문/영수증 각각1개, 같은 operation/payload 유지 |
| Background에서 OS 복구 후 foreground 복귀 | 별도 합성 방문을 오프라인 대기에 남기고 실제 HOME으로 background 진입. 그 상태에서 원래 OS 연결을 복원하고 자연 재시도 시각이 지난 뒤까지 기다림. 관측한 background 약32.316초 동안, 연결 복구부터 foreground 복귀 사이 서버 요청0회. 같은 PID와 JS instance로 앱에 돌아오자 버튼/도구의 백업 호출 없이 방문 자동 ACK 완료. 서버 방문/영수증 최종 각각2개, 사진 전송0회 |

첫 흐름은 **OS 네트워크 이벤트 listener를 새로 구현한 결과가 아닙니다.** 연결만 복구됐고 AppState 전환은 없었으며, 기존 foreground 주기 health가 상태를 확인해 재시도를 앞당겼습니다. 두 번째는 실제 background→active 전환 이후 기존 앱의 foreground 진입/주기 요청 경로에서 완료된 범위입니다. OS의 background 전송 서비스나 위치/GPS 수집, 배터리, 앱/OS 강제 종료 내구성으로 확대하지 않습니다.

실패 중 방문의 operation ID와 payload, 방문 행은 그대로이고 attempts만2회로 증가했습니다. 두 실패 간격은 실제 현재 wall clock과 제품의 failure count가 만들었으며 timestamp를 바꾸지 않았습니다. 서버에 도착한 sync POST는 방문마다1회, 전체2회였고 operation ID도 각각 유일했습니다. 전체 서버 방문 내용을 기기 합성 방문과 직접 대조했습니다.

사진은 두 흐름 내내 대기1건, 같은 payload/URI와7,090,841 bytes PNG의 크기/SHA가 유지됐습니다. photo metadata 생성, 사진 POST, 서버 사진과 사진 영수증은 모두0개입니다. 방문의 마지막 성공 시각과 대기 수는 실제 AppStore/DB 상태에서 확인했으며 새 손가락 UI 표시는 검사하지 않았습니다. 최종 대기 사진과 DB는 근거에 보존한 뒤 시험 소유 자료만 정리했습니다.

### 원본 보존과 체크포인트

새 시작/종료 기준으로 원래 개인 DB의 모든 저장 행, 설정, 스키마, 사진 bytes와 QA 외 인증 보존 대조를 통과했습니다. QA 로그인과 로그아웃, 시험 인증 삭제도 확인했습니다. source59개(기존14개, 새45개)의 원문/부재/해시, cache root와 visitTransport 두 개를 복구했습니다. package/lock, 설치와 보존 APK, 원래 비행기/Wi-Fi/데이터 설정과 emulator boot ID도 같습니다. 새 빌드, 설치와 의존성 변경은 없습니다.

최종 QA DB와 대기 PNG 사본을 보관한 뒤 QA DB/WAL/SHM3개, 시험 소유 PNG1개와 cache root의 부재를 확인했습니다. 자체8082/3002/3003, Metro reverse와 에뮬레이터를 종료했고 HTTP reverse는 없었습니다. iOS8081, iPhone, 원래 checkout, legacy/기본 캐시나 백업은 조작하지 않았습니다.

같은8d01be8의 타입/린트, 모바일537개와 양쪽 JS/Hermes의 앞선 통과를 재사용했으며, 제품 변경이 없어 이 단계에서 반복하지 않았습니다. 이번 결과는 새 native2개와 원본/환경 보존이며 브랜치 CI와도 구분합니다. P3-13의 이 Android 자동 복귀 범위가 확인됐지만 전체 P3-13, 실제 Android 휴대폰/Release와 G1~G4, 완료 수는 변경하지 않습니다. 추가 공통 수정 제안은 없습니다.

근거는 Git 제외 `docs/test-results/android-auto-reconnect-8d01be8-20261025/`의 `auto-reconnect-summary.json`, `network-events.json`, native AppState/호출/Coordinator/전후 DB 상태, `private-db-foreground-natural-backoff.tar`, `private-db-background-pending.tar`, 서버 전후 상태, `artifact-audit.json`, `private-synthetic-final.tar`, `private-qa-final.tar`, `shutdown-status.json`입니다. raw OS 진단, 개인 원본 수량/값/해시, 인증과 fixture 비밀값은 공개하지 않습니다.

## 10월 25일 후속: 방문 ACK와 foreground 연결 확인의 독립 기한

공통 **`8d01be8b8e3bf4896fbc76264b442b9dfe415d55`**를 고정했습니다. `cb61e47`의 VisitSyncClient 독립 기한과 bounded stream에 더해 새 `visitTransport.native.ts`/`.web.ts`, AppStore의 Expo 스트림 연결을 포함합니다. Android 시작 기준은 `4a770eb`입니다. source59개를 임시 적용하고 DB, 인증과 photo snapshot root를 새 QA 이름으로 격리했습니다. 기본 개인 DB, 기존 legacy/기본 캐시는 새 소스로 열거나 스캔하지 않았습니다. 기존 Debug APK/API37과 실제 AppStore 액션, 비동기 SQLite와 native HTTP를 사용했으며 새 빌드, 설치와 의존성 변경은 없습니다.

**새 native3개가 PASS**입니다. 이전 캐시 정리19개, 다른 SHA의 사진/복원 기한 결과와 합산하지 않습니다. 제품의 실제 VisitSyncClient가 `visitFetch`를 사용하는 것을 호출 시 대조했고, 기본 두 검사에서는 원래 abort를 그대로 전달했습니다.

| 새 검사 | 실제 결과 |
| --- | --- |
| 수동 방문 백업의 저장 후 부분 ACK | 실제 AppStore 수동 방문 백업에서 서버 commit 뒤 ACK16/60 bytes만 보내고 유지. VisitSyncClient가 약10.015초에 VisitConnectionError로 반환했고 AppStore backupBusy도 해제. 기한 전 native 응답 객체와 reader 바이트는 노출되지 않음. 같은 operation/payload와 방문, 로컬 대기 보존, 성공 시각 미생성. attempts의 정상 증가만 허용. 기존 QA DB를 재개방해 같은 작업을 정상 수동 재시도, 서버 방문/영수증 각각1개와 요청 본문 완전 동일. 반복 빈 전송에서 추가 POST 없음 |
| foreground 자동 백업의 부분 health | 실제 AppStore 자동 경로와 현재 wall clock 사용. 제품 repository API로 nextAttemptAt를 현재+120초, connectionCheckAt를 현재-1ms로 준비해 backoff 중 연결 확인을 재현. 서버가 실제 health 본문16 bytes만 보낸 상태에서 connectionAvailable이 약3.016초에 false 반환. 기한 전 native 응답 객체/reader 바이트 미노출. 큐와 마지막 성공 시각, nextAttemptAt 유지, connectionCheckAt만 정책대로 다음 확인 시각으로 연기. health 실패 중 방문 POST 없음. 진행 상태 해제 뒤 정상 수동 요청 성공 |
| held ACK만 abort 전달 생략한 독립 기한과 늦은 응답 | 자동 백업 opt-in OFF, 해당 수동 ACK 요청 하나의 transport signal 전달만 생략. 원래 AbortSignal은 aborted가 됐지만 native에 전달하지 않은 상태에서 약10.010초에 반환. 기한 전 native 응답 객체/reader0 bytes. 서버 연결이 열린 상태에서 늦은 tail을 실제 전송하자 native 응답 객체가 뒤늦게 노출됐고, 제품은 body reader를 만들지 않은 채 cancel. 늦은 ACK 미적용, 큐와 성공/재시도 상태 유지. DB 재개방 후 같은 작업을 정상 수동 재시도, 서버 중복 없음 |

기본 ACK와 health는 기한 뒤 tail 시도 때 소켓이 이미 닫혀 있었습니다. 추가 독립 ACK는 원래 signal을 **해당 held 요청에만** 전달하지 않은 통제 조건이며, 열린 연결에 실제 늦은 tail을 보낸 뒤 native Response 반환과 reader 미생성/cancel을 구분해 확인했습니다. 서버가 보낸16 bytes를 기본 두 경우의 native reader가 소비한 것으로 표시하지 않습니다. 늦은 native Response가 나타났다는 사실도 JS reader가 본문을 읽거나 파싱했다는 주장으로 확대하지 않습니다.

자동 health에는 과거 합성 시계를 사용하지 않았습니다. 현재 시각에서 제품 API로 저장한 backoff만 통제했고 실제 앱의 foreground Coordinator 하나가 처리했습니다. 자동 interval과 직접 액션은 같은 AppStore/Coordinator를 사용했습니다. 후속 독립 ACK 전에 autoEnabled=false를 저장해 다른 자동 전송이 같은 큐를 처리하지 않도록 했습니다. 연결 실패 뒤 connectionCheckAt가 연기되는 것은 정상 동작이며 nextAttemptAt/lastSuccessAt 보존과 구분합니다.

DB 재개방은 실제 앱을 닫고 기존 QA DB를 다시 여는 방식이며 큐를 reseed하거나 재주입하지 않았습니다. QA 인증도 복구됐습니다. 새 손가락 UI, OS force-stop 내구성, 무선 전환이나 전원 장애의 증거로 사용하지 않습니다. AppStore busy 해제와 실제 다음 액션 실행을 확인한 범위입니다.

초기 계측기의 메서드 연결 오류로 정상 health만 실행되고 방문 POST가 없는 준비 실패가 있었습니다. 메서드별 wrapper를 분리한 뒤 같은 QA DB/작업으로 진행했으며 제품 파일은 바꾸지 않았습니다. 앱 재실행 때 Inspector 주소가 유지되는 환경의 준비 대기도 보완했습니다. 이미 끝난 실제 기한 요청은 도구 재개 때 다시 보내지 않고 저장한 상태에서 재개방/재시도를 이어갔습니다. 이 준비 관찰은 제품 결함이나 native 통과 수로 계산하지 않습니다.

### 자동 검사와 최종 보존

Node24.21.0 `bash scripts/verify-cloud.sh`가 PASS입니다. 타입, ESLint, 20개 파일의 **모바일537개**, 이 Android verifier의 backend syntax/native dependency load, 양쪽 production JS/Hermes export를 포함합니다. 공통 서버61개와 공통 HTTP 검사는 이 Android 단계에서 반복한 것으로 표시하지 않습니다. health4KiB/ACK64KiB의 초과 본문은 새 native 검사로 별도 실행하지 않았으며 host 회귀와 구분합니다. Android 브랜치 CI도 임시 QA 소스의537개/native3개와 별도입니다.

원래 DB의 모든 저장 테이블, 설정, 스키마와 사진 bytes, QA 외 인증의 새 시작/종료 대조가 통과했습니다. QA 로그인/복구와 로그아웃, 시험 인증 삭제도 확인했습니다. 최종 합성 DB를 보관했고 서버 방문/영수증3개를 기기의 동일 방문 내용과 직접 대조했습니다. 각 시나리오의 중간 서버1개/2개/3개와 전체 종료 수량을 구분합니다. 최종 QA DB/WAL/SHM3개만 지웠고 QA cache root의 부재도 확인했습니다.

앱과 자체 서비스를 먼저 멈춘 뒤 **source59개(기존14개, 새45개)**의 원문, 부재와 해시를 복구했습니다. 새 visitTransport 두 개와 cache root 상수도 복구 목록에 포함했습니다. package/lock, 설치와 보존 APK, 원래 무선 상태는 같습니다. 자체8082/3002/3003, reverse와 에뮬레이터를 종료했고 HTTP reverse는 없었습니다. iOS8081, iPhone, 원래 checkout과 기존 캐시/백업은 조작하지 않았습니다. 이번 생성 JS/Hermes40개, 논리8,820,611 bytes만 사용 후 정리했으며 즉시 가용량 증가는 관측되지 않았습니다.

근거는 Git 제외 `docs/test-results/android-visit-deadline-8d01be8-20261025/`의 `validation-files.json`, `visit-deadline-summary.json`, `private-state-after-*.json`, 서버 gate/release/retry 상태, DB 재개방 직전 사본과 `private-qa-final.tar`, `verification.log`, `shutdown-status.json`입니다. 개인 원본 수량, 값, 해시와 인증/fixture 비밀값은 공개하지 않습니다. 추가 제품 수정 제안은 없습니다. 실제 Android 휴대폰, Release와 전체 G1~G4는 별도입니다.

## 10월 25일 후속: 전송 준비 사본의 안전한 자동 정리 검증

공통 **`4bd7ea3670d148a3df8c35bb49066e4dbfc4d10e`**를 고정했습니다. Android 시작 기준은 `6301c8e`입니다. 새 `photoSnapshot.ts`를 포함한56개 파일을 임시 적용했고 DB 이름, 인증 key/service와 **snapshotRoot 상수**를 고유 QA 값으로 격리했습니다. 기본 개인 DB와 기본 전송 캐시 root를 새 소스로 열거나 스캔하지 않았습니다. 기존 Debug APK/API37, 실제 SQLite, 파일, native HTTP이며 새 빌드, 설치나 의존성 변경은 없습니다.

**native19개가 PASS**입니다. 실제 앱 종료/재실행을 포함한 전송2개, 시작 wiring1개, 명시한 합성 marker 변형16개로 구분합니다. 앞선55b7bda/c2c871f 검사와 합산하지 않습니다.

| 실제 실행 흐름 | 관찰과 결과 |
| --- | --- |
| 업로드 일부 수신 중 앱 force-stop, 재실행 | 실제 앱의 수동 사진 백업 액션 → PhotoBackupCoordinator → preparePhotoFile의 owner/operation/photo context로 marker 생성. Backend multipart16,384 bytes와 사진 부분15,727 bytes 수신 상태에서 PID 종료. 새 PID/JS와 실제 Constants.sessionId, QA 인증 복구 확인. 기존 DB의 작업, payload, fingerprint와 원본 SHA, marker/사본 보존. ACK 전 cleanup0개, 서버 사진/영수증0개. 동일 작업 재시도에서 로컬 ACK 확정 뒤 실제 수동 백업 완료 wiring이 옛 사본만 제거, 서버 사진/영수증 각각1개 |
| 서버 저장 후 ACK 일부 대기 중 앱 force-stop, 재실행 | 서버가 두 번째 사진과 영수증을 저장하고 ACK32 bytes를 보낸 상태에서 종료. 새 실제 session과 인증 복구 뒤 로컬 ACK 미확인, 같은 큐와 원본, 옛 marker/사본 유지. ACK 전 cleanup0개. 같은 작업을 재시도해 로컬 ACK 확정 뒤 완료 wiring에서 옛 사본 제거. 서버 사진과 영수증은 각각2개로 유지 |
| 이미 로컬 ACK가 있는 사본의 실제 시작 wiring | 실제 native preparePhotoFile에 ACK와 맞는 context를 제공해 만든 사본을 현재 session/active 상태에서 보존. 앱만 force-stop, 재실행해 새 Constants.sessionId와 QA 인증 복구 확인. 새 실행에서 **수동 cleanup을 호출하지 않고 initialize의 시작 정리로 사본 제거**. DB 사진/ACK 행, 원본 바이트와 다른 사진의 미전송 대기1건 유지 |

세 번 모두 PID 소멸 뒤 새 PID/JS와 **실제 Constants.sessionId 변화**를 별도 근거로 보존했고 emulator boot ID는 같았습니다. DB 재주입이나 reseed 없이 기존 QA DB와 실제 QA SecureStore 로그인 상태를 재개방했습니다. 첫 두 경우의 사본은 실제 제품 Coordinator가 생성했습니다. 시작 wiring의 사본은 실제 prepare API가 생성했습니다. 앱 액션을 native에서 직접 실행한 검증이며 새 화면 확인창 조작, OS 재부팅, 전원 손실, 에뮬레이터 비정상 종료나 실제 Android 휴대폰 결과로 확대하지 않습니다.

### native 파일과 실제 DB의 marker 변형16개

변형은 실제 preparePhotoFile이 만든 marker와 bytes를 이번 QA 소유 디렉터리에 복사한 합성 자료입니다. 이전 session UUID나 개별 필드를 바꾼 경우를 위 실제 앱 재시작의 session 변화와 구분합니다. 활성 registry 검사는 실제 producer가 등록한 사본을 유지한 채 marker session만 과거 값으로 바꿔 registry 보호를 별도로 확인했습니다. 현재 session 검사는 활성 registry에 없는 별도 사본입니다.

| 기대 결과 | 확인한 조건 |
| --- | --- |
| 보존15개 | 실제 active registry, 현재 native session, 이번 시험의 legacy 무표시 사본, 새 root 안 marker 없음, 로컬 ACK 없음, 다른 owner, 다른 operation, 다른 photo, fingerprint 불일치, 합성 원본 누락, 원본 변경, 사본 변경, 추가 파일, 깨진 JSON, 미지원 marker 형식 |
| 제거1개 | 이전 session으로 표시한 유효 사본, 같은 owner/operation/photo/fingerprint의 실제 로컬 ACK, 현재 원본과 사본 바이트 일치. 제품의 실제 repository 트랜잭션과 native 최종 동기 비교를 거쳐 이 사본만 제거. 재실행 cleanup0개 |

각 cleanup 전후 QA DB의 방문, 사진, metadata와 outbox 행, 원본 바이트/부재 상태가 그대로였습니다. 원본 변경/누락 조건은 이 시험 소유 파일에만 만들었고 관찰 뒤 합성 원래 바이트로 복구했습니다. 제품이 보존한15개는 결과와 파일/marker 해시를 기록한 **뒤 하네스가 정확한 시험 소유 경로만 정리**했습니다. 제품이15개를 자동 삭제한 것으로 표시하지 않습니다. 원래 legacy 캐시와 기본 snapshot root는 읽거나 삭제하지 않았습니다.

준비 계획의 파일 읽기 오류 주입과20개/64MiB 상한 stress를 새 native 항목으로 실행하지 않았습니다. 이 한계는 공통 host 회귀와 구분합니다. 실제 디스크 부족, OS 권한 오류나 장기 캐시 누적을 검증한 결과가 아닙니다. 시작 관찰기의 Directory URI 끝 슬래시 비교는 사본을 다시 만들거나 제품을 바꾸지 않고 정규화한 뒤 이어갔습니다.

### 자동 검사와 최종 보존

Node24.21.0 `bash scripts/verify-cloud.sh`가 PASS입니다. 타입, ESLint, 19개 파일의 **모바일525개**, 이 Android verifier의 backend syntax/native dependency load와 양쪽 production JS/Hermes export를 포함합니다. 공통 서버61개와 공통 HTTP 검사는 이번 Android 단계에서 다시 실행한 것으로 표시하지 않습니다. Android 브랜치 CI는 이 고정 QA 소스와 별도 기준입니다.

모든 개인 원본 저장 행, 설정, 스키마, 사진 바이트와 QA 외 인증을 시작/종료 대조해 보존했습니다. QA 로그아웃과 SecureStore 삭제도 확인했습니다. 최종 QA DB와 합성 원본3개를 로컬에 보관한 뒤, 시험 소유 원본과 managed/legacy 사본, QA root와 QA DB/WAL/SHM3개만 정리했습니다. 합성 미전송 대기는 임의로 ACK 처리하지 않고 최종 DB 근거에 남겼습니다. 서버의 두 확인 사진/영수증과 모든 사진 bytes/SHA도 대조했습니다.

앱과 자체 서버를 먼저 멈춘 뒤 **임시 소스56개(기존14개, 새42개)**의 원문/부재/해시와 cache root 상수를 복구했습니다. package/lock과 설치·보존 APK가 같고 원래 무선 상태도 유지됐습니다. 자체8082/3002/3003, reverse와 에뮬레이터를 종료했습니다. HTTP reverse, iOS8081과 iPhone, 원래 checkout 변경은 없습니다. 이번 생성 JS/Hermes 출력40개, 논리8,814,174 bytes만 사용 후 정리했으며 즉시 가용량 증가는 관측되지 않았습니다. 추가 전역 캐시, Time Machine나 프로젝트 백업 삭제는 하지 않았습니다.

근거는 Git 제외 `docs/test-results/android-photo-snapshot-4bd7ea3-20261025/`의 `validation-files.json`, `snapshot-lifecycle-summary.json`, `snapshot-preservation-summary.json`, `snapshot-startup-wiring-summary.json`, `private-process-proof-*.json`, 실제 종료 직후 DB/전후 상태, `private-synthetic-final.tar`, `private-qa-final.tar`, `verification.log`, `shutdown-status.json`입니다. 개인 원본 수량/값/해시, 인증 상태와 fixture 비밀값은 공개하지 않습니다. 원래 불명확 사본을 회수했다는 주장은 하지 않습니다. 실제 Android, Release, OS 자동 회수와 전체 G1~G4는 별도입니다.

## 10월 25일: 전송 중 앱 강제 종료와 복원 응답 기한

Android 시작 기준은 `e3f922d`입니다. 공통 소스 두 개를 순서대로 고정해 각각 새 QA DB와 인증 이름, 원본 보존 기준을 만들었습니다. 기존 API 37 에뮬레이터와 Debug APK, 실제 비동기 SQLite, 파일과 HTTP를 사용했고 새 native 빌드, 설치, 의존성 변경은 없습니다. 원래 개인 v1 DB를 새 소스로 열지 않았습니다.

### 55b7bda: 실제 앱 프로세스 강제 종료 3개 PASS

고정 소스는 **`55b7bdae804d74ef0776ef37c7aeb91d50b40493`**입니다. 세 번 모두 실제 앱을 force-stop해 기존 PID가 사라진 것을 확인한 다음, 새 PID와 새 JS instance에서 기존 합성 DB를 열었습니다. 재개방 시 큐를 재주입하거나 reseed하지 않았습니다. 에뮬레이터 boot ID는 같았고 OS 재시작, 에뮬레이터 충돌, 전원 장애나 무선 설정 변경은 없습니다.

| 종료 시점 | 실전송 근거와 재실행 결과 |
| --- | --- |
| multipart 일부가 backend에 도착한 뒤 | backend 본문 21,900 bytes, 사진 부분 21,243 bytes를 받은 상태에서 종료. 재실행 뒤 서버 사진과 영수증은 없고, 원본 SHA, 작업 ID, payload와 fingerprint, 전송 대기가 그대로임. 같은 작업을 명시적으로 재시도해 사진과 영수증 각각 한 번만 저장 |
| 서버 저장 완료, ACK 일부만 보낸 뒤 | 서버 사진과 영수증 저장 후 ACK 32 bytes를 보내고 유지한 상태에서 종료. 재실행 뒤 로컬 ACK는 미적용이며 같은 작업과 fingerprint 보존. 같은 작업 재시도에서 기존 영수증을 확인하고 서버 중복 없음 |
| 복구 사진 본문 일부를 실제로 읽은 뒤 | native reader가 PNG 16,384 bytes를 읽은 상태에서 종료. 새 파일 생성이나 부분 사진 등록 없이 복구 대기, 조회 위치, 출처와 기존 URI, 0바이트 파일 유지. 재시도에서 전체 SHA와 크기가 맞는 새 사본만 연결, 이전 파일 보존과 반복 중복 없음 |

살아 있는 앱에 fetch 예외를 주입한 결과가 아닙니다. 호스트 프록시는 실전송 시점을 제어했으며, PID 소멸 확인 뒤에만 남은 연결을 정리했습니다. 새 실행에 합성 세션을 다시 제공한 독립 native Coordinator 검사이므로 인증 자동 복구나 새 UI 전체 검증으로 표시하지 않습니다.

**별도 자원 정리 관찰:** 강제 종료된 두 업로드가 만들었던 준비용 캐시 사본 두 개가 정상 재시도 뒤에도 남았습니다. 각 7,090,841 bytes, 합계 14,181,682 bytes이며 합성 원본과 SHA가 같았습니다. 종료 시에는 finally 정리가 실행되지 않는 경로입니다. 큐 보존과 중복 방지 통과와 구분하며, 시작/복구 시 활성 전송과 원본을 보호하는 고아 준비 캐시 정리를 공통 개선으로 제안합니다. 제품 코드는 바꾸지 않았고 OS 자동 회수나 장기 누적은 미검증입니다. 최종 근거에 보관한 후 정확히 기록한 시험 소유 캐시 경로만 지웠습니다.

원본 DB의 모든 저장 행, 설정, 스키마, 사진 바이트와 인증 보존 대조를 통과했습니다. 합성 DB 두 개와 사진 네 개, 잔여 캐시를 로컬에 보관한 뒤 시험 소유분과 QA 앱 DB/WAL/SHM 세 개를 정리했습니다. 자체 서버와 Metro를 멈추고 임시 소스54개(기존14개, 새40개)의 존재 여부와 해시, package/lock, 설치 APK와 보존 APK를 대조·복구했습니다. 다음 격리 단계까지 에뮬레이터만 유지했습니다.

근거는 Git 제외 `docs/test-results/android-process-restart-55b7bda-20261025/`의 `process-cycle-summary.json`, `private-process-proof-*.json`, 종료 직후 DB 사본, 재실행 상태, `private-synthetic-final.tar`, `shutdown-status.json`입니다. 이전 OS 연결 차단4개와 이번 앱 종료3개를 합쳐 새 소스 검사 수로 표시하지 않습니다.

### c2c871f: 복원 목록과 사진의 독립 기한 2개 PASS

고정 소스는 **`c2c871feb2ddaca7f9132e930cb695657193ee69`**입니다. `RestoreClient`가 abort만 기다리지 않고 전체 요청 기한을 독립적으로 반환하며, 취소 정리도 반환을 막지 않도록 보완한 소스입니다. 합성 복원 사진을 정상 수신한 뒤 해당 시험 파일만 0바이트로 만들고, 제품의 점검 기록 API로 복구 대기를 보존한 별도 DB 두 개를 사용했습니다.

| 실제 HTTP 지연 | Android 관찰과 결과 |
| --- | --- |
| 방문 목록 headers와 본문 16/40 bytes 뒤 유지 | native 요청 시작에서 반환까지 약10.025초, Coordinator 전체 약10.033초. 기한 전 native 응답 객체나 reader 바이트는 노출되지 않음. 복구 큐, 서버 조회 cursor, 기존 URI/출처와 0바이트 파일 보존 |
| 사진 headers와 본문 16/7,090,841 bytes 뒤 유지 | 실제 native 응답 객체와 reader16 bytes 관측. 사진 요청 시작에서 반환까지 약30.029초, 선행 목록 조회와 점검을 포함한 Coordinator 전체 약31.159초. 새 파일 생성·등록 없이 기존 자료와 복구 대기 보존 |

두 경우 모두 실패 반환 뒤 DB를 닫고 다시 열어 대기가 유지됐고, 명시적 재시도에서 전체 크기·SHA가 맞는 새 URI만 연결했습니다. 이전 0바이트 파일을 보존했으며 반복 실행에서 재다운로드나 중복 등록은 없었습니다. 서버 조회 cursor와 대기 payload는 유지됐습니다. 사진 경우의 방문/파일 점검 scan은 정상 순환 점검으로1→0 되감겼고, 이 실패 후 값은 늦은 전송 시도와 DB 재개방 동안 그대로였습니다.

기한 뒤 tail을 보내려 할 때 두 연결 모두 이미 닫혀 있었습니다. 이후 대기·URI·파일 목록이 바뀌지 않은 것은 확인했지만, 실제 늦은 본문을 native가 수신하고 거절한 모든 경로를 입증하지는 않습니다. 이번 두 검사에는 OS 무선 설정 변경이나 앱 강제 종료가 없습니다.

첫 판정 도구의 네트워크 실패 시 paused 기대와 모든 scan 값의 전후 동일 기대를 실제 계약에 맞게 수정했습니다. paused는 계정/화면 중단에 사용되고 scan은 재점검 과정에서 되감길 수 있습니다. 이미 끝난 실제 기한 요청을 다시 시작하거나 제품을 바꾸지 않고 보존한 결과에서 재시도를 이어갔습니다.

Node24.21.0의 `bash scripts/verify-cloud.sh`가 PASS입니다. 타입, ESLint, 19개 파일의 **모바일498개**, 이 Android 브랜치 verifier의 backend syntax/native dependency load와 양쪽 production JS/Hermes export를 포함합니다. 공통 서버61개와 공통 HTTP 검사를 이번 Android 단계에서 다시 실행한 것으로 표시하지 않습니다. 브랜치 CI도 고정 QA 소스의498개/native2개와 구분합니다.

새 원본/인증 기준과의 최종 보존 대조를 통과했습니다. 합성 DB 두 개와 사진 다섯 개를 근거로 보관한 뒤 시험 소유분과 QA 앱 DB/WAL/SHM 세 개를 지웠습니다. 앱과 자체 서버를 먼저 멈추고 임시 소스55개(기존14개, 새41개)를 원래 존재 여부와 해시로 복구했습니다. package/lock, 설치·보존 APK와 무선 설정도 같습니다. 전용8082 reverse와 loopback3002/3003을 정리하고 모든 검사를 마친 뒤 에뮬레이터를 정상 종료했습니다. HTTP reverse와 iOS8081, iPhone, 원래 checkout 조작은 없습니다. 생성된 JS/Hermes 출력40개, 논리8,784,523 bytes만 사용 후 정리했습니다.

근거는 Git 제외 `docs/test-results/android-restore-deadline-c2c871f-20261025/`의 `deadline-cycle-summary.json`, `private-observed-*.json`, `private-state-after-*.json`, `private-synthetic-final.tar`, `verification.log`, `shutdown-status.json`입니다. 개인 원본 수량, 값, 해시와 인증 항목, fixture 비밀값은 공개하지 않습니다. 실제 Android 휴대폰, Release, 이동 중 무선망 전환, 자동 복구, 전원 장애와 G1~G4 전체 수용 기준은 계속 별도입니다.

### 저장공간 정리

실행 중인 Gradle 빌드가 없는 것을 확인한 뒤 사용자 요청에 따라 `/Users/oh/.gradle/caches`의 재생성 캐시 **2,319,745,024 bytes(약2.32GB)**를 정리했습니다. 다음 native 빌드 때 다시 다운로드할 수 있습니다. SDK, NDK, JDK, AVD 데이터, 소스, APK, 개인 DB/사진과 기존 검증 근거는 보존했습니다. 캐시 삭제 직후 가용량 증가는 관측되지 않았습니다.

9월28일·10월12일 로컬 백업은 앞선 정리 이력대로 현재 없었습니다. 새로 확인한 **10월20일21:59:52 Time Machine 로컬 백업 한 개는 사용자에게 별도 삭제 승인을 받은 뒤 삭제**했고, 로컬 스냅샷 목록이 빈 것을 확인했습니다. 해당 삭제 전후 실제 가용량은 **35,298,185,216→55,692,115,968 bytes**, 관측 증가는 **20,393,930,752 bytes(약20.39GB)**입니다. 캐시 삭제량을 여기에 다시 더하지 않습니다. 프로젝트 `.snapshots/`, 외장·원격 백업, 소스와 기기 자료는 삭제하지 않았습니다. 근거는 로컬 `storage-cleanup-20261025.json`, `time-machine-cleanup-20261025.json`입니다.

## 10월 24일 후속: 사진 ACK의 부분 응답과 기한 검증

공통 **`55b7bdae804d74ef0776ef37c7aeb91d50b40493`**를 새로 고정했습니다. 제품 변경은 `PhotoSyncClient`의 응답 stream 읽기, 64KiB 제한과 독립적인 전체 요청 30초 기한입니다. 패키지, SDK, 기존 APK는 그대로이며 Android 시작 기준은 `287ae1c`입니다. 아래 4개는 새 소스의 시나리오이며, 앞선 `8b48ec8`의 두 시나리오와 v5 native16개에 합산하지 않습니다.

| 새 소스 시나리오 | 실제 결과 |
| --- | --- |
| multipart 전송 중 OS 연결 차단 | 프록시가 사진 21,243 bytes, backend가 multipart 21,900 bytes를 받은 뒤 비행기 모드와 Wi-Fi/데이터 OFF. Native HTTP도 실제 실패. 서버 사진, 영수증, 부분 파일 없음. 원래 사진 SHA와 작업, 대기 보존. DB 재개방 후 같은 작업 재시도로 한 번만 저장 |
| 사진 응답 중 OS 연결 차단 | 실제 native reader가 PNG 16,384 bytes를 읽은 뒤 차단. 새 파일 생성/등록 없이 복구 대기와 기존 URI, 0바이트 파일 보존. DB 재개방 뒤 전체 본문을 새 사본으로 검증해 연결, 기존 손상 파일 보관. 반복 실행 중복 없음 |
| 저장된 사진의 ACK 일부 뒤 TCP 중단 | 서버가 사진과 영수증을 저장한 뒤 전체 ACK 486 bytes 중 32 bytes를 보낸 다음 TCP를 닫음. Native reader에서도 32 bytes가 관측되고 약 1.002초에 실패 반환. 로컬 ACK 미적용, 파일과 고정 작업/fingerprint 보존. DB 재개방과 같은 작업 재시도로 확인되며 서버 중복 없음 |
| 끝나지 않는 ACK의 전체 기한 | 서버가 ACK 32/486 bytes만 보낸 채 유지. Android transport가 기한 전 응답 객체를 반환하지 않은 경로에서 약 30.041초에 실패 반환. 대기와 미확인 fingerprint 유지, native 요청 종료. 기한 뒤 tail 전송 시도 시 연결은 이미 닫힘. DB 재개방, 동일 작업 재시도와 중복 방지 통과 |

ACK 두 시나리오는 서버가 이미 저장을 마친 경우이므로 사진과 영수증이 각각 하나 있는 것이 정상입니다. 부분 업로드가 서버 사진/영수증을 만들지 않은 경우와 구분합니다. 복귀와 재시도는 native Coordinator를 명시적으로 실행했으며 이번 단계에서 새 UI 확인창이나 물리 Android를 검사하지 않았습니다.

첫 도구는 TCP를 끊기 **전에** native reader의 32 bytes 관측을 기다렸지만 Android에서는 그 시점에 응답 객체가 노출되지 않아 관측 조건이 끝났습니다. 해당 대기에서 실제 30초 기한 반환을 별도로 보존했고, TCP 시나리오는 서버가 32 bytes를 보낸 뒤 끊어 native reader의 32 bytes를 확인했습니다. 제품은 바꾸지 않았습니다. 기한 시나리오는 응답 객체 반환 전 transport 경로이며, 부분 32 bytes를 reader가 소비한 것으로 표시하지 않습니다. 기한 뒤에는 소켓이 닫혀 실제 늦은 ACK를 수신하지 않았으므로, 이를 늦은 ACK 소비/거절의 모든 native 경우로 확대하지 않습니다. iOS 내부 JSON/text 경로의 원인은 이 Android 기록에서 단정하지 않습니다.

새 QA 소스의 Node24.21.0 `bash scripts/verify-cloud.sh`가 PASS입니다. 타입, ESLint, 18개 파일의 **모바일489개**, 기존 backend syntax/native dependency load와 Android/iOS production JS/Hermes export를 포함합니다. 공통 서버61개는 여기서 반복하지 않았으며 실제 합성 서버와 native HTTP 결과와 구분합니다.

두 고정 소스 모두 원래 개인 DB의 모든 저장 행, 설정, 스키마, 사진 바이트와 인증 보존 대조를 통과했습니다. 기본 개인 DB를 새 소스로 열지 않았습니다. 새 소스의 합성 DB 두 개와 파일 다섯 개를 최종 근거로 보관한 뒤 시험 DB/파일, QA 앱 DB/WAL/SHM 세 개를 정리했습니다. 원래 무선 설정과 임시 소스54개의 원문, 존재 여부, 해시를 복구했고 package/lock과 APK도 같습니다. 자체 8082, 프록시3002, backend3003과 reverse, 에뮬레이터를 종료했습니다. HTTP reverse, macOS나 사용자 라우터 설정 변경, 새 native 빌드/설치/의존성 변경은 없습니다. 사용 종료된 JS/Hermes 출력만 정리했으며 즉시 여유 공간 증가는 관측되지 않았습니다.

새 소스 근거는 Git 제외 `docs/test-results/android-ack-stream-55b7bda-20261024/`의 `inflight-cycle-summary.json`, `ack-response-cycle-summary.json`, `private-ack*-*.json`, `private-state-after-*.json`, `private-synthetic-final.tar`, `verification.log`, `shutdown-status.json`에 있습니다. 기존 소스 근거는 아래 별도 폴더로 유지합니다. 개인 원본 수량, 값, 해시, 인증 상태와 fixture 비밀값은 공개하지 않습니다. 실제 Android 휴대폰, Wi-Fi↔모바일망의 이동 전환, Release, 배터리, 전원 장애와 전체 수용 기준은 별도입니다. 추가 제품 수정 제안은 없습니다.

## 10월 24일 재개: 전송 본문 중 실제 연결 중단

공통 `8b48ec8`을 고정해 기존 APK/API 37에서 새 두 범위를 검사했습니다. HTTP용 reverse 없이 에뮬레이터의 `10.0.2.2:3002` 경로와 loopback 프록시/백엔드를 사용했습니다. macOS나 사용자 라우터의 네트워크는 변경하지 않았습니다. 기존 정상/요청 전 오프라인 결과를 반복한 수에 넣지 않습니다.

7,090,841 bytes의 유효 합성 PNG를 사용했습니다. 프록시 게이트는 본문의 일부가 실제로 흐른 것을 기록하는 용도이며, Android 비행기 모드와 Wi-Fi/모바일 데이터 OFF 뒤 게이트를 해제해 단순 서버 대기를 실패 원인으로 삼지 않았습니다. 두 경우 모두 별도 native HTTP도 차단됐고 요청은 기본 30초 제한 전에 실패로 반환됐습니다.

| 범위 | 실제 관찰과 결과 |
| --- | --- |
| multipart 본문 중 업로드 단절 | 사진 부분 32,923 bytes와 backend multipart 본문 33,580 bytes 실수신 후 OS 연결 차단. Native 요청 실패, 서버 사진/영수증 0개와 부분 파일 없음. 작업 ID, payload, 사진 SHA와 미확인 fingerprint 보존. DB 재개방 뒤 같은 작업을 명시적으로 보내 사진/영수증 각각 1개만 저장, 반복 실행도 중복 없음 |
| 사진 응답 본문 중 복구 단절 | 앱의 실제 native reader가 PNG 16,384 bytes를 읽은 뒤 OS 연결 차단. 전체 본문 미수신 상태로 실패했고 새 파일 생성/사진 등록은 없었음. 기존 0바이트 파일, 사진 URI, 복구 대기와 조회 위치가 DB 재개방 뒤 유지. 복귀 후 새 검증 사본으로만 연결하고 이전 손상 파일 보존. 반복 실행에서 재다운로드나 중복 등록 없음 |

두 번째는 이미 받은 QA 사진을 0바이트로 만든 복구 다운로드의 중단입니다. 실제 사용자 사진이나 원본 DB를 손상시키지 않았습니다. 전송 경로와 타이밍은 합성 프록시로 제어했으며 물리 Android, 실제 이동 중 무선망 전환, 전원 장애나 화면 확인창의 결과가 아닙니다. 업로드와 다운로드 실패 반환은 각각 약 1.1초, 1.4초였고, 임의 fetch 예외나 body 오류를 만들어 반환하지 않았습니다.

초기 검사 서버의 본문 계측 listener가 인증 미들웨어보다 먼저 스트림을 소비해 준비 요청이 400으로 끝났습니다. 계측을 스트림 흐름을 바꾸지 않는 방식으로 고친 뒤 동일한 제품 소스에서 위 결과를 확인했습니다. 이는 하네스 수정이며 제품 코드를 바꾸지 않았습니다.

개인 원본 행, 설정, 스키마, 사진 바이트와 인증의 전후 보존 대조를 통과했습니다. 합성 DB 두 개와 첨부본 세 개의 최종 사본을 로컬에 보관하고 시험 자료, QA 앱 DB/WAL/SHM, 자체 Metro/프록시/백엔드와 에뮬레이터를 정리했습니다. 무선 설정과 임시 소스54개의 원문/부재/해시, package/lock과 APK를 복구·대조했습니다. SDK, AVD, 원래 checkout과 기존 백업은 보존했습니다.

근거는 Git 제외 `docs/test-results/android-inflight-network-20261024/`의 `inflight-cycle-summary.json`, `request-timing-summary.json`, `private-*-at-gate.json`, `private-state-after-*.json`, `private-synthetic-final.tar`, `shutdown-status.json`에 있습니다. 개인 원본 수량, 값, 해시와 인증 상태는 공개하지 않습니다. 사진 저장 후 일부 ACK 응답의 중단은 이 두 검사에 포함하지 않으며, 공통 응답 처리 후속 소스에서 별도로 확인합니다.

## 10월 21일 종료 전: 실제 OS 네트워크 차단과 복귀 1회

사용자가 현재 검사까지만 마치고 저장·중단하도록 요청해, 시작한 네트워크 차단/복귀 한 차례만 완료했습니다. 공통 `8b48ec8`과 기존 APK/API 37을 고정했고 고유 QA DB, 인증 이름, 합성 HTTP 서버를 사용했습니다. 공통 제품 코드는 변경하지 않았습니다.

HTTP는 `10.0.2.2:3002`의 에뮬레이터 호스트 네트워크 경로로 연결했습니다. **HTTP용 adb reverse는 만들지 않았으며 전용 Metro 8082 reverse만 유지**했습니다. 실제 `expo/fetch`로 정상 HTTP 200을 먼저 확인한 뒤 Android OS의 비행기 모드를 켜고 Wi-Fi와 모바일 데이터를 껐습니다. 해당 OS 상태와 Connectivity 진단을 보존했으며 같은 native HTTP가 실제 오류로 실패했습니다. fetch 예외, 응답 유실, 타임아웃을 하네스로 주입한 결과가 아닙니다.

| 단계 | 실제 관찰 |
| --- | --- |
| 연결 정상 | 합성 서버의 native HTTP 200. 합성 방문 1건과 사진 1장의 전송 대기 준비 |
| OS 연결 차단 | 비행기 모드 켜짐, Wi-Fi와 모바일 데이터 꺼짐. native HTTP 실패, 방문 전송도 실패. 방문/사진 작업 ID, payload, 대기와 사진 SHA 보존. ACK metadata 없음. 방문 시도 횟수 증가는 허용하되 성공으로 처리하지 않음 |
| 원래 설정 복귀 | 원래 무선 설정으로 복구한 뒤 같은 native HTTP 200 |
| 명시적 재시도 | Coordinator를 다시 실행해 방문 다음 실제 multipart 사진 전송. 사진 ACK 1개, 대기 0건. 기기 첨부본의 SHA 유지, 서버 저장 바이트도 읽기 대조로 일치 확인 |

이는 에뮬레이터 OS 네트워크를 끊고 복귀한 조건입니다. 방문 우선 전송이 차단돼 사진은 전송 전에 대기했습니다. **사진을 전송하는 도중의 단절, Wi-Fi↔모바일망 전환, 물리 기기의 무선 환경이나 다운로드 도중 단절을 확인한 결과는 아닙니다.** 사용자 중단 요청에 따라 사진만 단독 실패시키는 추가 주기와 다운로드 중단 검사는 시작하지 않았습니다. 실제 화면 확인창 검사는 앞선 v5 결과이며 이번에는 native Coordinator를 명시적으로 실행했습니다.

시작·종료에 개인 원본 DB의 모든 저장 행, 설정, 스키마, 사진 바이트와 인증 보존을 비공개로 대조했습니다. 기본 개인 DB를 새 소스로 열지 않았습니다. 합성 시험 DB와 첨부본, QA 앱 DB/WAL/SHM 3개를 정리하고 네트워크 설정과 임시 소스54개의 원문/부재/해시를 복구했습니다. package/lock과 APK도 같으며 자체 8082/3002, Metro reverse, 에뮬레이터를 종료했습니다. HTTP reverse3002는 전 과정에서 없었습니다. 기존 백업, SDK, AVD와 중요한 근거는 보존했습니다.

실제 네트워크 주기와 전후 상태는 로컬 Git 제외 `docs/test-results/android-os-network-20261021/`의 `network-cycle-summary.json`, `private-state-after-*.json`, `private-network-*.txt`, `validation-files.json`, `shutdown-status.json`과 합성 서버 DB에 남깁니다. 공통8b48ec8의 앞선 모바일479개와 native16개를 이번에 반복하거나 새 검사 수에 합산하지 않았습니다. 결과 요약만 기존 Android PR에 저장하고 CI를 확인한 뒤 중단하며 다음 재개는 사용자의 새 요청을 기다립니다.

## 10월 21일 후속: 손상 다운로드 점검과 새 사본 복구

공통 **`8b48ec8deb74c2402ddfb5f3762664e6e85bbb63`**를 고정해 새 v5 복구를 검증했습니다. Android 시작 기준은 `1231bae`입니다. 기존 Debug APK, API 37, 실제 비동기 SQLite 3.50.3, native 파일과 SHA-256, 실제 `expo/fetch` HTTP를 사용했습니다. 고유 QA DB와 SecureStore 이름만 바꿔 임시 적용했고 새 native 빌드, 설치, 의존성 변경은 없습니다.

**native 통합 16개가 모두 PASS**입니다. 이전 v4의 15개와 v3의 24개를 반복하거나 이번 수에 합산하지 않습니다.

| 확인 범위 | 수 | 실제 결과 |
| --- | ---: | --- |
| 이전 0바이트 사례의 v4→v5 | 1 | 보존한 합성 v4 DB와 두 사진을 새 DB 이름과 파일 경로에 복제. migration 전후 기존 모든 행과 이전 cursor 열 보존, applied 다운로드 두 개만 출처에 편입. 0바이트 사진만 새 경로에 검증 복사해 연결, 기존 0바이트와 정상 파일 보존. 재개방과 재점검 통과 |
| v4 출처 편입 실패 | 1 | 실제 `restore_files` INSERT 뒤 오류를 주입. 새 테이블, 점검 열, 버전, 기존 행 전체 rollback과 재시도 통과 |
| 0바이트, 누락, 같은 길이의 변조 | 3 | native 검사에서 각각 damaged/missing 판별. 새 파일의 크기와 SHA를 확인한 뒤 연결만 교체. 이전 바이트나 부재 상태 유지, 이전 출처 preserved, 새 출처 valid. 재개방 후 정상 파일 재다운로드 없음 |
| 복구 연결 SQL 실패 | 1 | 실제 사진 URI UPDATE 뒤 오류. 사진 연결, 출처, 큐의 부분 커밋 없음. 미등록 새 파일 제거, 기존 손상 파일과 대기 보존, 재개방 뒤 복구 성공 |
| 토큰, owner, URI 변경 | 3 | 새 파일 생성 뒤 토큰이나 계정 변경 시 등록 차단과 명시적 재시도. 점검 뒤 사진 URI가 사용자 첨부본으로 바뀌면 그 연결과 바이트를 보존하고 미등록 복구 사본만 제거 |
| 미전송 자식 변경, 부모 삭제 | 2 | 자식 outbox payload와 attempts 그대로 유지하며 복구 차단. 다운로드 뒤 부모 삭제 시 다시 연결하지 않고 삭제 큐와 이전 파일 보존 |
| 사용자 첨부본, 계정과 공유 경로 | 2 | restored 형태의 이름만 가진 사용자 사진은 출처 편입, 점검, 다운로드 대상이 아님. 실제 두 합성 계정의 같은 UUID에서 한 계정만 복구하고 다른 계정의 행, 출처, 바이트 유지. 공유 URI는 파일 읽기 전에 거절 |
| 점검, 다운로드 제한과 재개 | 1 | 기존 합성 사진 22개를 손상시킨 뒤 한 번에 점검 최대 20개, 새 받기 최대 20개 확인. 점검 cursor 재개방 보존, 첫 20개와 다음 나머지 2개 복구. 순환 점검 중 기아 없음, 이전 손상 사본 모두 보존 |
| 점검 storage, cursor 쓰기 실패 | 2 | 실제 native 정상 검사 뒤 주입한 storage 오류를 손상으로 오인하지 않음. 실제 점검 cursor SQL 뒤 오류에서는 cursor, 출처, 큐를 함께 rollback. 재개방과 재시도 통과 |

이전 합성 자료의 원래 보존본은 수정하지 않았습니다. 복제본의 파일 URI만 새 전용 경로로 치환했고, migration 보존 비교는 그 복제본을 기준으로 수행했습니다. 일부 계정, SQL, storage 실패는 검사 하네스에서 시점을 제어한 합성 오류이며 실제 디스크 부족이나 전원 차단으로 표시하지 않습니다.

### 실제 확인창과 사진 표시

새 QA 앱 저장소에서 같은 합성 계정으로 로그인했습니다. 9초간 자동 조회 없음, 계정과 서버, 20개 점검, 새 사본 연결, 기존 파일과 사용자 사진 보존 안내가 있는 확인창, 취소 시 조회 없음이 PASS입니다. 확인 후 서버 방문과 사진 목록을 먼저 읽고 정상 사진 두 개를 받았습니다.

그중 한 QA 파일만 의도적으로 0바이트로 만든 뒤 실제 화면에서 다시 확인하고 받았습니다. 이전 다운로드 두 개를 점검해 사진 한 개만 다시 받았고 **새 사본 복구 1개와 대기 0건 안내**가 표시됐습니다. 이전 0바이트 파일은 그대로 남았고 정상 사진의 경로는 유지됐습니다. 복구 후에도 새 확인창이 필요했고 취소 뒤 9초간 추가 점검이나 다운로드는 없었습니다. 지역 상세에서 두 합성 사진이 표시되는 것을 직접 확인했습니다.

에뮬레이터는 계속 켜 둔 채 앱 프로세스만 `am force-stop` 후 재실행했습니다. 현재 두 사진과 이전 0바이트 파일의 바이트, SHA, 출처, URI가 그대로이며 새 업로드 outbox나 ACK metadata를 만들지 않았습니다. QA 로그아웃도 마쳤습니다. **이전 host exit139의 직접 원인은 여전히 미확정**이며 강제 host 종료를 재현하지 않았습니다. 이번 결과는 손상 파일의 탐지와 보존 복구를 확인한 것이며 전원 장애나 전체 중단 내구성의 완료 판정이 아닙니다.

### 검사, 보존, 정리

고정 QA 소스에서 Node 24.21.0의 `bash scripts/verify-cloud.sh`가 PASS였습니다. 타입, ESLint, 18개 파일의 모바일 **479개**, 기존 backend syntax와 native dependency load, Android/iOS production JS/Hermes export를 포함합니다. 공통 서버 61개와 공통의 임시 HTTP 검사는 이번에 반복하지 않았으며 이번 native HTTP 결과와 구분합니다.

개인 원본의 모든 저장 행, 설정, 스키마, 사진 바이트와 인증 항목의 전후 보존 대조를 통과했습니다. 원래 개인 DB를 새 코드로 열지 않았습니다. 상세 값과 해시는 로컬에만 보관합니다. 16개 시험 DB와 해당 WAL/SHM 부재를 확인했고, QA 앱 DB/WAL/SHM 3개와 QA 사진 3개만 제거했습니다. 이전 0바이트 사례와 이번 복구의 DB 사본, 파일, 로그, 화면은 Git 제외 근거에 보존했습니다.

앱과 자체 8082/3002를 먼저 멈춘 뒤 임시 파일 **54개(기존 14개, 새 40개)**를 원래 존재 여부와 해시대로 복구했습니다. package/lock과 보존 APK도 같고 자체 reverse와 에뮬레이터는 정상 종료했습니다. 생성 JS/Hermes 출력도 사용 종료 후 정리했으며 즉시 가용량 증가는 없었습니다. 원래 checkout, iOS 8081, iPhone, SDK, AVD, APK와 기존 백업은 보존했습니다.

로컬 근거는 `docs/test-results/android-restore-repair-v5-20261021/`의 `validation-files.json`, `native-probe-result.json`, `private-archived-clone.json`, `ui-*-result.json`, `process-restart-summary.json`, `verification.log`, `shutdown-status.json`과 비공개 DB/파일 사본입니다. 이 폴더와 fixture 계정, 토큰, 원본 데이터는 커밋하지 않습니다. 실제 Android 휴대폰, Release, OS 네트워크 전환, 배터리, 시스템 백업과 전체 수용 기준은 계속 남겨 둡니다. Android PR에는 결과 문서만 저장합니다.

## 10월 21일 수동 기록 복원 검증

공통 동작 **`8ee29bd`**를 별도 합성 DB·인증 이름에서 실행했습니다. 기존 Debug APK와 API 37 에뮬레이터를 그대로 사용했으며 새 빌드·설치·의존성 변경은 없습니다. 실제 비동기 SQLite 3.50.3·파일·HTTP의 **15개를 모두 통과**했고 모바일 타입·린트·453개도 통과했습니다.

방문 선행, v3→v4 자료 보존과 실제 SQL 롤백, 다운로드 응답 유실 뒤 DB 재개방·대기 재개, 첫 실행 20개/다음 실행 나머지 받기, JPEG·PNG 바이트·해시, 계정별 동일 UUID와 파일 분리, 미전송 변경·삭제 보존을 확인했습니다. 계정·화면 상태 변경과 파일/SQL 실패 뒤 미등록 파일 정리·대기 보존, 잘못된 길이·형식·해시 거절과 재시도도 포함합니다. 장애 시점의 일부는 합성 제어이며 실제 디스크 부족 시험은 아닙니다.

화면에서는 대상 계정·서버·범위가 있는 확인창, 취소 시 요청 없음, 확인 후 복원과 완료 안내·재확인을 확인했습니다. 첫 복원 후 화면 확인 중 **에뮬레이터 프로세스가 비정상 종료(exit139)**됐고, 재실행 뒤 해당 합성 사진은 연결 정보가 남은 채 0바이트였습니다. 직접적인 원인은 확정하지 않았습니다. 이미 완료 상태인 파일을 다시 검사하거나 재다운로드하는 경로가 없어 수동 복원을 다시 눌러도 이 파일은 복구되지 않았습니다.

이상 사례를 그대로 보존한 뒤 다른 합성 사진을 받았고 파일 길이·해시와 상세 화면 표시가 정상이었습니다. 이후 **에뮬레이터는 켠 채 앱 프로세스만 종료·재실행**했을 때 새 사진의 바이트와 해시가 유지됐습니다. 정상 앱 재실행과 에뮬레이터 자체 비정상 종료 결과를 구분하며 전체 중단 내구성은 완료로 표시하지 않습니다. 다음 보완은 [완료된 복원 파일의 재검증·복구 제안](ANDROID_PROPOSED_CHANGES.md)입니다.

원래 개인 DB의 전체 저장 테이블·설정·스키마·사진 바이트와 인증을 읽기 대조해 보존했습니다. 기본 원본 DB를 새 코드로 열지 않았습니다. 임시 공통 파일53개를 원래 존재 여부·해시대로 복구하고 package/lock·APK도 보존했습니다. 시험 DB·합성 사진·시험 인증·자체 8082/3002·reverse 포트·에뮬레이터를 정리했습니다. 0바이트 사례와 정상 새 사진, DB 사본·로그·화면 근거는 Git 제외 `docs/test-results/android-restore-v4-20261021/`에 보관합니다. 개인 원본 행 수·내용·해시·인증 상태는 공개하지 않습니다.

추가 읽기 검토에서 macOS 진단의 호스트 에뮬레이터 HangDetector/CrashReporter 종료 경로를 확인했으며, 직접 원인은 계속 미확정입니다. 정상 새 합성 파일의 앱 프로세스 종료 전후 파일 매핑·해시·수정 시각과 0바이트 사례의 DB 사본을 로컬에 보존했습니다. 후속 손상 파일 보완은 고정 SHA/API를 받은 뒤 별도 검사합니다. 검증 과정의 생성 JS/Hermes 출력 40개(논리 8,739,107 bytes)는 사용 종료 후 정리했으며 즉시 가용량 증가는 관측되지 않았습니다. SDK·AVD·APK·백업과 중요한 근거는 보존했습니다.

이 결과는 Android 에뮬레이터의 Debug·Inspector 검사입니다. 실제 Android 휴대폰·Release·시스템 백업·배터리·OS 네트워크 전환·에뮬레이터 비정상 종료 원인과 손상 파일 자동 복구는 미확인입니다. 공통 제품 코드는 Android PR에 중복 포함하지 않으며 전체 수용 판정은 공통 체크리스트를 따릅니다.

10월 20일 공통 **`2bae436`의 모바일 DB v3을 실제 Android 비동기 SQLite 파일 DB 24개에서 검증해 모두 PASS**였습니다. v1/v2의 모든 owner 행·설정·사진 URI/bytes·큐·metadata 보존·재개방, 같은 UUID의 계정 격리, 복합 FK와 가져오기 cascade·충돌·실제 SQL rollback을 확인했습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 임시 소스 40개와 실행 환경은 복구·종료했습니다. 다운로드·복원 기능과 실제 Android 휴대폰 통과를 뜻하지 않습니다.

10월 19일 공통 **`809efe0`의 수동 사진 백업을 Android에서 검증**했습니다. 앞선 native 파일 준비 1개·비동기 SQLite/실제 multipart 통합 9개와 빈 계정 확인창 결과에 이어, **방문 1건·PNG 1개가 있는 합성 계정의 실제 화면 전송도 PASS**입니다. 확인 전·취소 후 전송 없음, 확인 뒤 방문 먼저·사진 정확히 1회, 완료 표시·ACK·기기 첨부본 유지와 매 실행 재확인을 확인했습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다.

10월 18일 `51c96d2`에서 실행한 연결 복구 13가지 PASS와 이전 화면·전송·경쟁 조건 결과는 아래 이력으로 유지합니다. 이 결과를 `809efe0`의 사진 검증으로 합산하지 않습니다.

현재 실제 Android 휴대폰은 없습니다. 결과는 Debug APK의 정적 검사와 API 37 에뮬레이터 시험이며, 실제 휴대폰이나 출시용 Release 검증으로 보지 않습니다. 전체 체크리스트와 완료 수는 공통 담당 채팅에서 관리합니다.

## 10월 20일 모바일 DB v3 native 검증: 24개 PASS

### 고정 소스와 안전한 적용

Android 시작은 **`1f299fb5fb37757efb9f7c86e92fea3e08683fc3`**, 공통 고정 소스는 **`2bae436b9f128219d6e81593139071526749b28a`**입니다. 이전 37개 목록에 새 `src/storage/migrations.ts`, `tests/migrations.test.ts`, 고정 `tests/fixtures/schema-v2.sql`을 포함해 **40개**의 원문·부재·고정 소스·적용 해시를 보존했습니다. production 23개·테스트 15개·fixture 1개·Vitest 설정 1개입니다.

database 이름 한 곳과 SecureStore key/service만 새 QA 이름으로 바꾸고 그 차이를 별도 기록했습니다. migration·schema·Repository와 고정 v2 fixture는 해당 SHA 그대로입니다. 원래 개인 v1 DB는 v3 앱으로 열지 않았습니다. 기존 Debug APK·API 37·CPU 4개·SwiftShader·전용 8082만 사용했고 새 native 빌드·설치·의존성 변경은 없었습니다.

실제 앱에 로드된 Repository·migration을 native `expo-sqlite`의 네 async adapter 함수와 고유 파일 DB에서 실행했습니다. 각 DB 경로가 원본과 다름을 확인하고 WAL·busy timeout을 사용했습니다. Inspector 코드는 기존에 검증한 ES2015 generator 변환을 적용했습니다. 측정된 native SQLite는 **3.50.3**이며, Repository가 실행하는 각 `BEGIN IMMEDIATE` 직전에 `foreign_keys=1`을 확인했습니다. 초기 연결을 FK OFF로 열거나 재개방한 뒤에도 initialize가 BEGIN 전에 켜는 것을 확인했습니다.

### 합성 자료와 실제 결과

`migrations.test.ts`와 고정 v2 SQL의 24개 시나리오를 실제 비동기 native 파일 DB에 옮겨 실행했습니다. guest/A/B, 활성·삭제·개발 방문, 사진 URI, 소수점 시각, outbox payload/attempts, 후보·설정, 미완료/업로드 metadata와 실제 native PNG bytes를 사용했습니다. 준비된 사진 fingerprint와 ACK는 합성 값이며 HTTP 서버·실제 서버 계정은 만들지 않았습니다.

| 묶음 | 수 | 실제 결과 |
| --- | ---: | --- |
| v1/v2→v3·재개방 | 2 | 세 owner의 기존 모든 테이블 행·설정·후보·URI·payload·attempts·소수점 시각 보존. v2의 미완료/완료 metadata·native PNG bytes 유지, 재개방·v3 재초기화 통과 |
| migration/지역 초기화 실패 | 8 | 새 테이블 생성·사진/metadata 복사·기존 테이블 제거·이름 교체·버전 쓰기 SQL 뒤 오류 6가지, COMMIT 직전 오류 1가지, migration 뒤 지역 초기화 오류 1가지. 실제 rollback으로 행·스키마·이전 버전 보존, 재개방 후 재시도 통과 |
| 불명확한 기존 저장 구조 | 4 | photos/metadata owner 불일치 2가지, 버전 -1/0/99 묶음, 예상 밖 중간 테이블. 소유권 추정·조용한 행 손실·버전 재표시 없이 기존 구조와 행 보존 |
| 같은 연결의 동시 요청 | 1 | 두 initialize와 후속 개발 방문 쓰기를 함께 요청. 실제 async 연결에서 직렬 처리·방문 1건 유지, 중첩 transaction 오류 없음 |
| 같은 UUID·fingerprint·ACK | 1 | A/B의 같은 방문·사진·작업 UUID 동시 저장. owner별 URI·다른 파일 해시·사진 준비·시도 횟수 독립. A ACK만 완료되고 B 큐·metadata·attempts 보존 |
| FK·owner 한정 삭제 | 2 | 다른 owner의 방문/사진을 참조하는 자식·metadata SQL 거절. Repository 삭제가 다른 owner를 보존하며, 물리 DELETE의 사진→metadata cascade도 해당 owner에만 적용 |
| guest GPS 가져오기 | 1 | outbox를 옮긴 뒤 부모 방문 owner 변경으로 사진·고정 metadata가 실제 ON UPDATE CASCADE. URI·frozen payload 유지, 개발 자료는 guest에 잔류, 같은 UUID의 B 자료 불변 |
| 가져오기 충돌·SQL 실패 | 5 | 방문 ID·session·사진 ID·작업 ID 충돌 4가지에서 양쪽 모든 행 불변. outbox 실제 이동 뒤 부모 UPDATE trigger의 SQL ABORT 1가지에서 부모·자식·metadata·outbox 전체 rollback |

행·스키마 비교는 실제 native SELECT 결과를 사용했습니다. 보존·재개방과 계정 관계 검사에서 `foreign_key_check` 빈 결과와 integrity `ok`를 확인했습니다. 일부 오류는 실제 SQL이 완료된 다음 adapter가 예외를 내도록 주입했고, 가져오기 실패는 native SQLite trigger의 ABORT입니다. 실제 디스크 장애·전원 차단이나 프로세스 중간 종료의 결과로 확대하지 않습니다. COMMIT 실패 경우는 **COMMIT 실행 전** 오류이며 이미 커밋한 내용을 rollback한 것으로 표시하지 않습니다.

### 원본·인증·파일·소스 복구

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 이전 검증의 보존 근거와도 같았습니다. QA 외 인증 저장 항목 해시도 같고 QA 인증 항목·실제 세션은 끝까지 부재였습니다.

24개 시험 DB는 각각 close/delete하고 DB·WAL·SHM 부재를 확인했습니다. 각 시험의 전용 native PNG 폴더도 제거돼 남은 폴더는 0개입니다. 앱용 QA DB는 v3·방문/사진/outbox/metadata 0건·integrity `ok`를 확인한 뒤 DB/WAL/SHM 3개만 정리했습니다.

앱·자체 Metro를 먼저 멈춘 뒤 기존 파일 **14개**를 원문으로 복구하고 새 임시 파일 **26개**를 제거했습니다. 40개 전체 존재 여부·바이트와 package/lock·보존 APK hash가 같습니다. 자체 reverse 8082와 에뮬레이터도 종료했습니다. HTTP 서버·실제 서버 계정은 시작하지 않았습니다. 원래 checkout·iOS 8081·iPhone·SDK·AVD·기존 캐시·백업·증거는 조작하지 않았습니다.

### 자동 검사와 남은 범위

QA DB·인증 이름 오버라이드를 포함한 임시 소스의 `bash scripts/verify-cloud.sh`가 PASS입니다. Node 24.21.0의 모바일 타입·ESLint·**15개 파일/402개**, 기존 backend syntax/native dependency load, Android/iOS JS/Hermes export를 포함합니다. 기존 의존성을 읽기 전용 재사용했고 `setup-cloud.sh`나 새 의존성 설치는 로컬에서 반복하지 않았습니다. 공통 서버 61개·실제 임시 HTTP 검사는 이번에 반복하지 않았으며 위 24개는 실제 native 저장 검사로 구분합니다.

제품 소스의 추가 수정 제안은 없습니다. 이번 결과는 저장 구조의 보존·격리 기반입니다. 사진 다운로드·복원·cursor/다운로드 대기·중단 재개 기능 완료, 실제 Android 휴대폰·Release·OS 백업/복원·실제 저장 공간 부족/전원 차단을 뜻하지 않습니다. 앞선 `809efe0`의 사진 native·UI 결과를 v3에서 반복한 것으로 합산하지 않으며 P3-10 전체·G1~G4 완료 수도 변경하지 않습니다.

로컬 Git 제외 근거: `docs/test-results/android-storage-v3-20261020/`. 개인 DB·사진·인증·기기 원본 로그·QA 식별자는 공개 문서와 PR에 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 SHA·새 migration/fixture·복구 해시 | `validation-files.json`, `common-*.txt`, `original-*.txt`, `schema-v2.sql`, QA 이름 사본 |
| 24개 실제 native case·engine 버전 | `native-probe-result.json`, `private-native-probe-result.json`, generator 변환 probe |
| 원본 전체 테이블·설정·사진·인증 | `baseline-data.json`, `final-data.json`, `private-original-all-tables.json`, `*-credential.json` |
| 시험 DB·PNG·실행 환경·APK 보존 | `native-cleanup-summary.json`, `shutdown-status.json`, `apk-preservation.json` |
| 자동 검사·실행 로그 | `verification.log`, `metro.log`, `emulator.log` |

## 10월 19일 후속: 사진이 있는 계정의 실제 UI 전송 PASS

### 소스·DB·인증 격리

Android 시작은 **`753438aa898cde37d22e221acc4bcdf166eb8241`**, 공통 동작은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**입니다. 공통 HEAD `fb8da94`까지의 차이는 문서이며 검증 대상 37개 파일은 고정 SHA와 같았습니다. 기존 APK·API 37·SwiftShader·자체 8082·새 합성 HTTP 서버를 사용했습니다. 앞선 파일 1개·통합 9개·빈 계정 UI·모바일 378개 검사는 반복하지 않았습니다.

새 QA DB 파일명과 **QA 전용 SecureStore key/service**만 오버라이드했습니다. DB 이름 한 곳과 인증 상수 두 곳의 차이 및 적용 해시를 별도 기록했고 나머지 동작 소스는 고정 SHA 그대로입니다. 원본 v1 DB와 기존 인증 항목은 사용하지 않았습니다. 실제 계정 화면에서 새 합성 계정을 만들고, QA DB에 합성 GPS형 방문 1건·전송 대기를 원자적으로 준비한 뒤 Repository로 새 PNG 1개·사진 대기를 연결했습니다. 실제 위치나 개인 사진을 사용하지 않았고 게스트 가져오기도 하지 않았습니다. GPS 판정·센서 수용 시험의 결과에 포함하지 않습니다.

첫 자료 준비에서 방문 확정 전 사진 연결이 거절됐습니다. 합성 방문·대기를 QA DB transaction으로 준비하는 방식으로 정리한 뒤 아래 UI 검증을 실행했습니다. 처음 준비한 미연결 합성 파일만 제거했고 실패 기록도 보존했습니다. 제품 소스 수정은 없습니다.

### 실제 화면·서버·기기 파일 대조

| 흐름 | 실제 결과 |
| --- | --- |
| 방문 1건·사진 1개 대기, 자동 방문 백업 꺼짐 | 화면에서 사진 대기 1건 표시. 9초 관찰 동안 방문·사진 POST 모두 0회, 서버도 0건 |
| 사진 백업하기 → 첫 확인창 → 취소 | 대상 계정·서버·형식·크기·보관 범위 표시, 방문·사진 POST 0회 유지 |
| 다시 열기 → 확인하고 전송 | 실제 화면 handler가 방문 sync 먼저·사진 multipart 다음으로 요청. 각각 정확히 1회, 서버 방문·사진·각 영수증도 1개 |
| 완료 화면·ACK | “사진 1건을 전송했습니다”와 서버 저장 확인 1개 표시. 방문·사진 대기 0건, 방문 성공 시각 있음. metadata revision/업로드 시각 저장·outbox 0건 |
| 기기 첨부본·서버 파일 | QA DB의 방문 1건·사진 행 1개와 native PNG의 기존 bytes·해시·크기 유지. 서버 첨부본의 bytes·해시·크기가 같고 썸네일은 별도 |
| 완료 뒤 다시 열기 → 취소 | 새 확인창이 다시 나타남. 취소 후 9초 관찰에도 방문·사진 POST 총 1회씩 유지, 중복 저장 없음 |

서버가 관측한 변경 요청 순서는 **`visit → photo`**였습니다. 사진은 실제 expo/fetch multipart 1회이며, 서버 사진·사진 영수증 각 1개와 integrity `ok`를 직접 대조했습니다. 전송·ACK·완료 문구는 실제 앱 화면 경로에서 확인했습니다. 관측한 9초 구간은 전체 장시간 자동 전송 수용 시험으로 확대하지 않습니다.

### 원본 보존·인증·종료

QA 인증 항목은 로그인 중 AES 암호화됐고 이메일·비밀번호는 평문으로 없었습니다. 로그아웃 뒤 QA 인증 항목은 삭제됐으며, 시작·로그인·로그아웃 모두 **QA 외 SecureStore 항목의 해시가 같았습니다**. 원본의 모든 owner visits/photos/outbox 전체 행·기존 사진 bytes도 시작·종료가 같습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다.

앱과 자체 Metro/HTTP를 먼저 멈췄습니다. QA UI DB v2의 전체 방문 1건·사진 1개·outbox 0건·업로드 metadata 1개·integrity `ok`, 기기 합성 PNG 유지와 해시를 확인·보존한 뒤 **이번 QA DB/WAL/SHM 3개와 합성 PNG 1개만** 정리했습니다. 원래 파일 14개 복원·새 임시 파일 23개 제거로 총 37개의 존재 여부·원문 해시를 대조했습니다. package/lock·보존 APK hash는 그대로이고 자체 reverse 8082·3002·에뮬레이터를 종료했습니다.

새 빌드·설치·의존성 변경·캐시/Time Machine 정리는 없었습니다. 원래 checkout·iOS·iPhone·SDK·AVD와 기존 근거는 조작하지 않았습니다. 이번에는 새 UI 흐름과 보존 대조만 실행했고, 앞선 378개·native 9개 결과는 해당 단계의 근거로 유지합니다. 실제 OS 네트워크 전환·전송 중 앱 종료·자동 사진 전송·다운로드/복원·여러 기기 삭제 병합·실제 Android·Release는 남아 있으며 P3-10 전체와 G1~G4를 완료 처리하지 않습니다.

근거는 Git 제외 `docs/test-results/android-photo-ui-nonempty-20261019/`에 보존합니다. 공개 문서에는 실제 계정·token·서버 주소·QA 이름·DB·사진·XML/PNG 원본·로그를 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 소스·QA 이름·복구 | `validation-files.json`, `qa-database-override.ts`, `qa-credentials-override.ts`, 원문/고정 사본 |
| 실제 화면·요청 순서/횟수 | `ui-*-result.json`, `server-after-*.json`, `completed-state.json`, 로컬 XML/PNG |
| ACK·기기/서버 첨부 bytes | `verify-result.json`, `server-data-verification.json`, `private-synthetic-attachment.png` |
| 원본·인증·종료 | `baseline-data.json`, `final-data.json`, `*-credential.json`, `shutdown-status.json` |
| 자료 준비와 초기 실패 | `seed-result.json`, `initial-fixture-failure-*.json` |

## 10월 19일 재개: 수동 사진 백업 native·확인창 검증

### 고정 소스와 원본 DB 분리

Android 시작은 **`a456f18808777c7da76aa49aa56ba7f96a448878`**, 공통 동작은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**입니다. 원격 공통 HEAD `1739ed1`은 문서만 추가한 상태이며 검증 파일은 같은 내용임을 확인했습니다. 이전에 준비한 37개 원본·부재·고정 사본의 해시를 다시 대조하고 새 실행 근거 폴더로 보존했습니다.

production 22개·테스트 14개·Vitest 설정 1개를 임시 적용했습니다. 실제 앱 UI에 쓰는 database 파일명 한 곳만 고유 QA DB로 바꾸고 별도 적용 해시를 기록했습니다. 사진 파일·repository·동기화 소스와 고정 backend 사본 12개는 공통 SHA 그대로입니다. 기존 원본 `trip-painting-v1.db`를 v2 앱으로 열거나 migration하지 않았습니다. native 통합 검사는 매번 별도 고유 파일 DB를 사용했습니다.

기존 Debug APK·API 37·SwiftShader·CPU 4개, 전용 localhost 8082·임시 합성 HTTP만 사용했습니다. 새 native 빌드·설치·의존성 설치와 package/lock 변경은 없습니다. Node 24.21.0과 기존 backend 의존성은 읽기 전용으로 재사용했습니다. 원래 checkout·iOS 8081·iPhone은 조작하지 않았습니다.

### native 파일 준비 1개 PASS

합성 PNG를 `.jpg` 이름으로 저장한 뒤 실제 `preparePhotoFile`을 호출했습니다. native File 복사·SHA-256·바이트 수·내용 기반 PNG 판별과 `attachment.png` rename이 통과했습니다. 전송 body가 실제 `File`인 것도 확인했습니다. 합성 원본을 바꿔도 이미 준비한 전송 사본은 같은 바이트를 유지했고, 원래 바이트로 돌린 뒤 dispose가 전용 cache만 지우고 첨부본은 유지함을 확인했습니다. 이 변경은 합성 파일에만 수행했습니다.

### 실제 비동기 SQLite·expo/fetch multipart 통합 9개 PASS

실제 앱에 로드된 Repository·PhotoBackupCoordinator·PhotoSyncClient·VisitBackupCoordinator, native async SQLite adapter와 `preparePhotoFile`·`photoFetch`를 사용했습니다. 검증용 시점·계정 변화와 응답 유실은 명시적으로 주입했으며 DB 쓰기·rollback, 파일 API와 이후 HTTP는 실제 실행입니다.

| 통합 경우 | 결과 |
| --- | --- |
| 별도 v1→v2 보존 갱신 | v1 합성 DB의 두 owner visits/photos/outbox 전체 행·사진 URI·payload·attempts·소수점 시각 유지, 빈 사진 metadata 테이블 추가, integrity `ok` |
| PNG·JPEG 실제 multipart | 부모 방문 선행 전송, 사진 2건 ACK와 metadata 원자 저장. 기기 파일·서버 첨부 bytes·native 해시·크기·MIME 일치 |
| 서버 200 뒤 응답 유실 모사·DB 재개방 | 큐·작업 UUID·고정 해시 유지. 첨부 bytes를 바꾼 합성 재시도는 HTTP 전에 차단. 원래 bytes 복구 후 같은 UUID 실제 재전송, 서버 사진·영수증 각 1개 |
| 잘못된 사진 다음 정상 사진 | HEIC·누락·10MiB 초과·잘못된 헤더·서버가 해독하지 못하는 PNG의 대기 5건 보존. 다음 JPEG 1건 성공, 건너뛴 이유·수 정확 |
| 오래된 동의·foreground 이탈 주입 | 파일 준비·사진 HTTP·metadata 쓰기 없이 거절, 대기 보존 |
| 실제 HTTP 200 뒤 같은 owner token 변경 | 이전 세션 ACK 차단·큐와 미완료 metadata 보존. 현재 세션의 같은 UUID 재시도는 서버 중복 없음 |
| ACK metadata 실제 쓰기 뒤 token 변경 | 실제 SQL rollback, 완료 metadata·큐 삭제 없음. 수동 재시도 성공·서버 중복 없음 |
| ACK outbox 실제 DELETE 뒤 token 변경 | DELETE 1건 뒤 실제 rollback, payload·작업 UUID·미완료 metadata 복구. 수동 재시도 성공 |
| ACK metadata 실제 쓰기 뒤 DB 오류 주입 | 실제 rollback, 큐·metadata·기기 첨부본 보존. 수동 재시도 성공·서버 중복 없음 |

서버 관측 사진 POST는 **14회이며 모두 실제 multipart boundary**가 있었습니다. 이 중 해독 불가 합성 PNG 1회는 실제 400이고 나머지는 성공·멱등 재전송입니다. 최종 서버 사진·사진 영수증은 **각 8개**입니다. 별도 서버 DB v3와 저장 파일을 직접 대조해 8개 첨부본 모두 metadata의 해시·크기와 같고 썸네일이 별도 파일임을 확인했습니다. 서버 integrity는 `ok`입니다. 요청 횟수와 고유 저장 수를 합산하지 않습니다.

첫 검사 도구는 Inspector에 직접 넣은 중첩 async 함수가 native Promise보다 먼저 반환해 DB 준비 단계에서 조기 실패했습니다. 사진 POST는 0회였으며 제품 결함으로 판단하지 않았습니다. 이전 native 검사와 같은 TypeScript ES2015 generator 변환을 적용한 뒤 위 9개를 다시 실행해 통과했습니다. 사전 도구가 남긴 자체 합성 파일 18개는 앱을 멈춘 뒤 정확한 전용 이름만 정리했고 실패 근거도 보존했습니다. 최종 native 시험 DB 9개는 close/delete 후 DB·WAL·SHM 부재를 확인했습니다.

### 0건 합성 계정의 실제 확인창 PASS

실제 계정 화면에서 새 합성 계정을 가입했습니다. 이 계정은 QA DB·서버 모두 방문·사진·전송 대기 0건이며 원본 게스트 가져오기를 실행하지 않았습니다.

| 실제 화면 흐름 | 결과 |
| --- | --- |
| 사진 백업하기 → 전용 확인창 | 대상 계정·서버, JPEG/PNG·20개·10MiB·미지원/누락 대기·원본 보관·복원 미지원 표시 |
| 첫 확인창 취소 | 창만 닫힘, 사진 POST 0회 |
| 다시 열기 → 확인하고 전송 | 다시 명시적 확인 요구, “전송할 사진이 없습니다” 안내. 사진 대기·서버 저장 확인 0건, 방문 성공 시각 null 유지 |
| 수동 실행 뒤 다시 열기 → 취소 | 세 번째도 확인창 표시, 앞선 동의를 재사용해 자동 전송하지 않음 |
| 로그아웃 | QA guest·기록 꺼짐·0건, native 인증 항목 삭제 |

로그인 중 인증 항목의 AES 암호화와 이메일·비밀번호 평문 부재를 확인했습니다. 이 단계의 UI 계정은 서버 방문·사진·사진 영수증이 끝까지 0건입니다. 사진이 있는 계정의 전체 UI는 위 후속 검증 결과로 구분합니다. 실제 사진 본문과 ACK·재시도는 이 단계의 독립 native 통합 검사 결과입니다.

### 자동 검사·원본 보존·복구와 남은 범위

QA 파일명 오버라이드를 포함한 임시 소스에서 `bash scripts/verify-cloud.sh`가 PASS였습니다. 모바일 타입·ESLint·**14개 파일/378개 테스트**, 기존 backend syntax·native dependency load와 Android/iOS 생산용 JS/Hermes export를 포함합니다. `setup-cloud.sh`를 다시 실행하거나 의존성을 재설치하지 않았습니다. 공통 서버 61개 검사는 이번에 반복하지 않았으며 별도 고정 서버의 실제 native HTTP·파일 대조와 구분합니다.

시작·종료 읽기 전용 대조에서 원본 모든 owner visits/photos/outbox 전체 행·기존 사진 바이트가 같았습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 독립 QA UI DB는 v2·전체 방문/사진/outbox/metadata 0건·integrity `ok`를 확인했습니다.

앱·자체 Metro·HTTP를 먼저 멈춰 혼합 소스 재로딩을 차단한 뒤, 기존 14개 파일을 원문·해시로 복구하고 새 임시 파일 23개를 제거했습니다. 총 37개의 존재 여부·바이트를 다시 확인했으며 package/lock·보존 Debug APK hash도 그대로입니다. QA UI DB·WAL·SHM 3개만 제거했고, 합성 사진 첨부본과 전송 cache도 0개였습니다. 자체 reverse 8082·3002와 에뮬레이터를 종료했습니다. 서버 합성 DB·첨부본·fixture·원본 로그·화면·실패/성공 근거는 로컬 Git 제외 폴더에 남깁니다.

새 캐시·Time Machine·SDK·AVD·원본 자료 정리는 하지 않았습니다. 종료 가용량은 57,331,204,096 bytes(약 53.39GiB)이며 이번 확보량으로 표시하지 않습니다. 전송 중 프로세스 종료·실제 OS 네트워크 전환·자동 사진 백업·다운로드/새 기기 복원·여러 기기 삭제 병합·Android 실기기·Release는 NOT RUN입니다. P3-10 전체와 G1~G4 완료를 뜻하지 않습니다.

근거는 Git 제외 `docs/test-results/android-photo-backup-20261019/`에 있습니다. 계정·token·서버 주소·QA 이름·원본 DB·사진·화면·로그는 공개 PR에 포함하지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 SHA·임시 적용·원문 복구 | `validation-files.json`, `common-*.txt`, `original-*.txt`, `qa-database-override.ts` |
| native 파일·9개 통합과 서버 대조 | `native-file-snapshot-result.json`, `native-probe-result.json`, `server-summary.json`, `server-data-verification.json` |
| 실제 화면·인증 | `ui-*-result.json`, `ui-*-state.json`, `signed-in-credential.json`, `logged-out-credential.json`, 로컬 XML/PNG |
| 원본·종료·시험 파일·APK 보존 | `baseline-data.json`, `final-data.json`, `shutdown-status.json`, `native-file-cleanup-summary.json`, `apk-preservation.json` |
| 자동 검사·도구 조기 실패 근거 | `verification.log`, `harness-raw-async-failure-*.json`, `harness-early-db-cleanup.json` |

## 10월 19일 사진 백업 준비 저장·종료와 용량 정리

### 고정 소스는 사본만 준비, 사진 검사는 NOT RUN

Android 시작 HEAD는 `6d3777c`, 준비한 공통 기준은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**입니다. production JS/TS 22개, 테스트 14개, Vitest 설정 1개로 총 37개 파일의 기존 내용·부재와 고정 소스 사본을 보존했습니다. backend src·schema 사본 12개도 같은 SHA로 고정했습니다. 공통 database 소스의 DB 이름 한 곳만 고유 QA 파일명으로 바꾼 사본을 별도 준비했습니다.

**37개 소스와 QA DB 이름 변경은 실제 작업 파일에 적용하지 않았습니다.** 10월 19일 현재 파일의 기존 존재 여부·원문 해시, 고정 사본·backend 사본의 Git 원본 해시, QA 사본의 이름 한 곳만 변경되었음을 모두 재확인했습니다. package/lock도 변함없습니다. 원본을 덮어쓴 적이 없으므로 복원한 파일 수는 0개이며, 37개를 복원했다고 표시하지 않습니다.

사용자가 진행하던 범위까지만 저장하고 마무리하도록 요청해 사진 native·UI 시나리오를 시작하지 않았습니다. 10월 18일의 최종 종료 명령은 자동 승인 검토의 사용량 한도로 실행되지 않았고, 10월 19일 실제 상태를 확인한 뒤 종료를 완료했습니다. 새 서버·Metro·앱 실행, 새 에뮬레이터 시작, 설치·빌드·DB migration은 하지 않았습니다. 공통의 모바일·서버 자동 검사 결과도 이번 Android 실행으로 계산하지 않습니다.

| 준비된 후속 검사 | 이번 실행 |
| --- | --- |
| native File의 cache 복사·MIME별 rename·파일 보존 | NOT RUN |
| JPEG/PNG의 실제 expo/fetch multipart·서버 사진 저장 | NOT RUN |
| 별도 QA DB의 v1→v2 migration·기존 행 보존 | NOT RUN |
| 사진 ACK transaction·응답 유실·중복 재시도·계정 전환 guard | NOT RUN |
| 0건 합성 계정의 수동 사진 백업·매 실행 동의·계정 범위 UI | NOT RUN |

다시 검증할 때도 원본 v1 DB를 v2 소스로 열지 않습니다. 사본 해시를 재확인하고 고유 QA DB·합성 계정·합성 사진으로만 시작해야 합니다. 원본 게스트 가져오기와 사진 쓰기는 하지 않습니다.

### 원본과 실제 종료 상태

10월 18일 baseline과 10월 19일 종료 직전 읽기 전용 대조에서 모든 owner의 visits/photos/outbox 전체 행·기존 사진 바이트가 같았습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 준비한 QA DB와 WAL·SHM은 기기에 없었습니다.

이미 실행 중이던 전용 API 37 에뮬레이터만 종료했습니다. 종료 전 전용 8082·3002 리스너와 adb reverse는 없었습니다. 사진 준비에서 Metro·HTTP·Inspector를 시작한 적이 없으며, 다른 프로세스와 원래 checkout·iOS·iPhone은 조작하지 않았습니다. APK 두 개의 해시도 정리 전후 같습니다. 소스 사본·합성 fixture·원본 로그와 검증 자료는 Git 제외 경로에 보존합니다.

### 사용하지 않는 캐시 정리와 실제 공간 측정

사용자의 Mac 저장공간 정리 요청에 따라 Android Studio·Gradle 빌드가 실행 중이지 않은 상태에서 다음 네 경로만 삭제했습니다. SDK·NDK·JDK·Gradle 의존성 다운로드와 wrapper, AVD 전체·DB·사진·APK·서명·소스·기존 증거·백업·Android Studio LocalHistory는 보존했습니다. 원래 checkout과 iOS 캐시는 정리하지 않았습니다.

| 삭제한 재생성 가능 캐시 | 삭제 전 할당 크기 |
| --- | ---: |
| `~/.gradle/caches/9.3.1/transforms` | 3,544,608,768 bytes |
| `~/Library/Caches/Google/AndroidStudio2026.2.1/caches` | 530,694,144 bytes |
| `~/Library/Caches/Google/AndroidStudio2026.2.1/index` | 911,638,528 bytes |
| `~/.npm/_cacache` | 1,999,638,528 bytes |
| 합계 | **6,986,579,968 bytes, 약 6.51GiB** |

실제 파일시스템 가용량은 삭제 직전 **18,461,765,632 bytes(약 17.19GiB)**, 삭제 직후 **18,458,112,000 bytes(약 17.19GiB)**였습니다. **6.51GiB를 실제 확보했다고 주장하지 않습니다.** 시점 차이는 다른 프로세스의 쓰기·파일시스템 공간 회수도 포함합니다. 읽기 전용 조회에서 9월 28일·10월 12일의 purgeable Time Machine 로컬 스냅샷 두 개가 확인되어 삭제한 블록을 보유할 가능성이 있으나, 그 영향이나 개별 확보량은 측정하지 않았습니다. 이 단계에서는 로컬 백업을 보존했습니다. 다음 native 빌드·Studio 실행·패키지 설치 때 삭제한 캐시를 다시 생성하거나 내려받을 수 있습니다.

### 별도 사용자 허용 후 Time Machine 로컬 백업 두 개 정리

위 캐시 정리 이후 사용자가 **“두 로컬 백업 정리”**를 선택했습니다. 두 복원 시점이 사라진다는 안내에 대한 직접 허용을 확인한 뒤, Mac 데이터 볼륨에 있는 `2026-09-28-220816`과 `2026-10-12-210523`의 Time Machine 로컬 스냅샷만 정확한 식별자로 삭제했습니다. 두 삭제가 성공했고 승인한 스냅샷의 부재와 Time Machine 로컬 목록이 빈 상태임을 다시 확인했습니다. 외장·원격 백업, 프로젝트 `.snapshots/`, 현재 소스·앱 데이터·AVD·사진·APK·검증 자료는 삭제 대상으로 삼지 않았습니다. 새 앱 실행·native 검사·빌드는 시작하지 않았습니다.

로컬 백업 정리 직전 가용량은 **18,640,543,744 bytes(17.36GiB)**였습니다. 삭제 직후에는 24,808,034,304 bytes였고, 공간 회수가 더 반영된 후속 측정에서는 **62,259,200,000 bytes(57.98GiB, 약 62.3GB)**였습니다. 정리 전후 관측 증가는 **43,618,656,256 bytes(40.62GiB, 약 43.6GB)**입니다. 이 증가량을 Android 캐시만의 확보량으로 계산하거나 캐시 삭제량과 다시 합산하지 않습니다. 정확한 측정 시각·삭제 성공·전후 바이트는 로컬 `time-machine-cleanup.json`에 보존합니다.

원본 근거는 Git 제외인 `docs/test-results/android-photo-backup-20261018/`에 있습니다. 공개 문서·PR에는 실제 계정·비밀번호·token·서버 주소·QA 파일 식별자·기기 원본 DB·사진·로그를 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 사본·기존 파일과 QA 이름 | `validation-files.json`, `common-*.txt`, `original-*.txt`, `qa-database-override.ts`, `frozen-backend/` |
| 원본 보존 대조 | `baseline-data.json`, `final-data.json`, `private-baseline-fingerprints.json` |
| 미적용 확인·종료·미실행 범위 | `restoration-result.json`, `shutdown-status.json`, `stop-status.json` |
| 삭제 경로·측정 바이트·APK 보존 | `disk-cleanup.json` |
| 별도 허용한 로컬 백업 두 개 삭제·실제 가용량 | `time-machine-cleanup.json` |

## 10월 18일 foreground 연결 복구

### 고정 소스와 검증 환경

Android 시작 기준은 `cf79090`, 공통 검증 소스는 **`51c96d249b2772517da3d9937cb03e568dc1b2d9`**입니다. 고정 SHA를 받기 전에는 원본 파일·해시·부재와 기존 DB/사진만 확인했고 새 소스를 적용하지 않았습니다. 원본 모든 owner 행·사진 바이트는 10월 17일 기준과 같았습니다. 이후 이전과 같은 필요한 JS/TS 14개만 임시 적용하고 backend의 src·schema도 이 SHA의 별도 읽기 전용 사본으로 고정했습니다.

기존 API 37·SwiftShader AVD, 보존한 Debug APK와 자체 Metro 8082를 사용했습니다. 설치 APK의 hash가 보존한 APK와 같았으며 새 설치·native rebuild·의존성 변경은 없었습니다. 실제 사용자 DB에 합성 방문을 넣거나 게스트 가져오기·초기화하지 않았고, 원래 checkout·iOS 8081·iPhone은 조작하지 않았습니다.

검사는 실제 앱에 로드된 Repository·Coordinator·VisitSyncClient와 `expo-sqlite`의 비동기 API를 사용했습니다. 각각 새 고유 파일 DB를 열어 원본과 다른 경로를 확인하고 WAL·busy timeout을 적용했습니다. 시험 계정·DB·서버 업로드 경로도 원본과 별도입니다. Inspector는 즉시 시작 응답을 받은 뒤 전역 완료 플래그를 polling했습니다.

### 연결 복구 13가지 PASS

전송 transport가 처음 두 번 `TypeError`를 내도록 제어했습니다. 이 두 실패는 실제 HTTP 요청이나 OS Wi-Fi 단절이 아닙니다. 이후 health·정상 ACK와 제어한 HTTP 오류 응답은 실제 임시 HTTP 서버를 사용했습니다. Coordinator의 시계만 주입해 진행했고, 실제 health abort에는 실시간 timer를 사용했습니다.

| 경우 | 실제 결과 |
| --- | --- |
| 두 transport 실패 → DB 재개방 → 이른 복구 | 첫 실패 후 retry/check는 30초. 둘째 실패 후 retry는 60초·check는 30초로 저장되고 재개방 후 동일. check 직전 호출은 요청 0건, due 시 무인증 GET health 뒤 긴 retry 전에 같은 작업 UUID ACK |
| health HTTP 503 | 방문 재전송 없이 connectionCheckAt만 진행. nextAttemptAt·큐·사진·완료 시각 보존 |
| health 응답 처리 중 opt-out | 자동 꺼짐을 따르고 두 시각·큐·사진 보존, 후속 sync 없음 |
| health 응답 처리 중 foreground 이탈 | 전송 pause, 두 시각·큐·사진 보존 |
| health 응답 처리 중 같은 owner token 교체 | 전송 pause, 두 시각·큐·사진 보존 |
| 연결 확인 CAS의 BEGIN 뒤 foreground 이탈 | 실제 transaction rollback. 일반 backoff로 기존 시각을 덮어쓰지 않음 |
| CAS 첫 native metadata 쓰기 뒤 token 교체 | 실제 쓰기 뒤 rollback, 원래 두 시각·큐·사진 보존 |
| CAS 첫 native 쓰기 뒤 DB 오류 주입 | 실제 쓰기 뒤 rollback. 일반 실패 backoff 대신 기존 시각 보존 안내·상태 유지 |
| CAS 직전 retry/check가 다른 값으로 갱신됨 | 오래된 expected 값의 CAS를 거절하고 새 두 시각·큐 보존 |
| 실제 HTTP 401 응답 | 인증 pause 저장, 자동 health·재전송 우회 없음 |
| 실제 HTTP 409 응답 | 충돌 pause 저장, 자동 health·재전송 우회 없음 |
| 실제 HTTP 500 두 번 | 일반 60초 retry 유지·connectionCheckAt null. 기한 전 health 우회 없음 |
| 실제 지연 health HTTP·3초 abort | AbortSignal이 발생하고 false 반환. 1회 관측 3,022ms, Authorization 없음 |

정상 복구에서는 방문 큐만 ACK되고 사진 큐·URI·연결·소수점 시각을 보존했습니다. 서버에서 실제 방문 1건·고유 방문 ID 1개·작업 영수증 1개를 직접 대조했습니다. 본 검사 health 요청은 서버 관측 10회였고 모두 GET·Authorization 없음이었습니다. client에서도 credentials omit을 확인했습니다. 준비 도구의 health 호출은 이 10회에 합산하지 않았습니다.

health·CAS 경쟁 시점, DB 오류와 HTTP 401/409/500 응답은 검증용 adapter·transport·서버 제어로 만들었습니다. CAS 자체의 BEGIN·쓰기·ROLLBACK은 실제 비동기 native SQLite입니다. 모든 파일 DB의 integrity가 `ok`였고, 작업 ID·payload·생성 시각·attempts를 포함한 큐 보존을 대조했습니다. 3,022ms는 해당 Debug 에뮬레이터 1회 관측이며 성능 SLA나 실기기 수치가 아닙니다.

실제 사용자 계정의 nonempty 큐·OS 네트워크 변경·전송 중 프로세스 종료·전체 앱 E2E는 별도입니다. 새 “백업 확인 중/다음 백업 확인” 문구의 실제 화면 검사는 하지 않았습니다. 이전 14개 전송 검사와 장시간 화면 꺼짐도 이번에 반복하거나 새 결과로 합산하지 않았습니다.

### 사진 서버 기반과 모바일 범위

고정 backend 사본은 별도 합성 DB를 version 3으로 초기화했습니다. 이번 Android 검사는 방문·health 경로만 사용했으며 새 사진 API를 호출하지 않았습니다. **모바일 사진 전송·동의·다운로드·다른 기기 복원은 여전히 연결 전**입니다. 사진 행·큐·URI 보존 결과를 사진 업로드 성공으로 표시하지 않습니다. 공통 서버 사진 검사 61개도 이 Android 실행 수에 넣지 않습니다.

### 자동 검사·원본 보존·종료

임시 소스에서 `npm --prefix travel_visit_tracker run check`의 타입 검사·ESLint·이 worktree의 기존 **90개 테스트가 PASS**였습니다. 공통 모바일 232개·서버 61개와 Android의 실제 13가지 native 검사는 별도 결과입니다.

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 모든 owner의 visits/photos/outbox 전체 행·기존 사진 바이트는 시작과 같습니다. 별도 시험 DB **12개와 WAL·SHM의 부재**, 원본 DB의 존재를 확인했습니다. timeout 경우에는 별도 DB를 만들지 않았습니다.

자체 Metro·합성 HTTP 서버·Inspector helpers·에뮬레이터를 종료하고 전용 연결만 제거했습니다. 임시 파일 14개 중 기존 5개는 원문과 바이트 단위로 같게 복구하고 새 9개는 적용 해시 확인 후 제거했습니다. package/lock·APK·서명·SDK·AVD·백업·원본 로그·증거는 보존했습니다. 이번에는 새 native 빌드·캐시 삭제나 용량 정리를 하지 않았고 확보량은 0입니다. 시점별 가용량은 준비 18.46GiB·종료 16.73GiB이며 다른 작업·AVD의 사용량을 분리한 값은 아닙니다.

원본은 Git 제외인 `docs/test-results/android-connection-recovery-20261018/`에 보존합니다. 공개 요약에는 계정·token·서버 주소·기기 값·원본 사진·DB·원본 로그를 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 준비·고정 SHA·복구 | `preparation.json`, `validation-files.json`, `original-*.txt`, `common-*.txt`, `restoration-result.json` |
| 원본·기존 APK 대조 | `prior-baseline-match.json`, `baseline-data.json`, `final-data.json`, `prepared-state.json`, `final-runtime-state.json` |
| native 13가지·시점 제어 | `native-probe-result.json`, `native-probe-manifest.json`, 비공개 검증 표현식·새 fixture |
| 실제 HTTP·DBv3·중복 없음 | `server-summary.json`, `server-verification.json` |
| 시험 DB 제거·종료·자동 검사 | `temporary-databases-cleanup.json`, `shutdown-status.json`, `common-check.log`, `metro.log`, `server.log`, `emulator.log` |

남은 수용 범위는 실제 Android·Release·배터리·OS 백업/복원, nonempty 실제 사용자 UI의 연결 복구·전송 중단, 모바일 사진 전송·새 기기 복원·여러 기기 삭제 병합입니다. 이번 결과로 전체 G1~G4를 완료 처리하지 않습니다.

## 10월 17일 방문 백업 화면·Coordinator와 경쟁 조건

### 소스 기준과 임시 적용

Android 시작 기준은 `f05a3b3`입니다. 공통 **`c95d6caa209086431b371a68cd2ac0d2222aa48b`**에서 계정·설정·layout, 두 store, storage/database·repository·outbox, auth·credentials·session·visitSync·visitBackup의 필요한 JS/TS 파일 14개만 임시 적용했습니다. 원래 있던 5개 파일의 원문·해시와 새로 생기는 9개 파일의 부재를 먼저 보존했습니다. 공통 backend 소스도 같은 커밋의 읽기 전용 사본으로 고정하고 별도 루프백 서버·합성 DB·업로드 경로를 사용했습니다.

첫 화면 검사와 native HTTP 검사 종료 후 공통 수정 **`202a2e250420b10056c518d8d26454035f548615`**의 다음 세 파일만 후속 적용했습니다. 기존 원상 복구 기준은 Android 시작 HEAD 그대로 유지하고 두 단계의 해시를 구분했습니다.

- `travel_visit_tracker/src/storage/repository.ts`
- `travel_visit_tracker/src/services/visitSync.ts`
- `travel_visit_tracker/src/services/visitBackup.ts`

두 커밋 사이 backend 내용은 같았습니다. 기존 설치 Debug APK·API 37·SwiftShader·Android 전용 8082만 사용했습니다. 설치 APK의 hash가 10월 15일 보존한 새 APK와 같음을 재확인했고, 새 설치·native rebuild·의존성 설치나 package/lock 변경은 없었습니다. iOS 8081·연결된 iPhone·원래 checkout·공유 진행표는 수정하지 않았습니다.

### `c95d6ca` 실제 계정 화면

화면에서 새 합성 계정을 가입했습니다. 이 계정은 기기·서버 모두 방문 0건이며 원본 게스트 가져오기를 실행하지 않았습니다.

| 실제 화면 흐름 | 결과 |
| --- | --- |
| 가입 후 기본 설정 | signed-in·계정 방문/사진/대기 0건, 자동 방문 백업 꺼짐 |
| 수동 빈 백업 | “전송할 방문이 없습니다.” 표시, 마지막 성공 시각을 만들지 않음 |
| 자동 백업 동의창 | 대상 계정·서버, 화면이 열려 있을 때의 전송 범위, 사진 백업·다른 기기 복원 미지원 표시 |
| 동의 취소 | 자동 백업 꺼짐 유지 |
| 동의 후 켜기 | 자동 백업 켜짐·설명 표시, 기록 꺼짐 유지 |
| 강제 종료·재실행 | 같은 합성 계정의 세션과 opt-in 복구, 실제 me 성공, 계정 자료 0건 유지 |
| 자동 백업 끄기·로그아웃 | 꺼짐 확인 후 guest·토큰 없음·기록 꺼짐으로 복귀, native 인증 항목 삭제 |
| 원본 대조 | 모든 owner의 visits/photos/outbox 전체 행·기존 사진 바이트 불변, integrity `ok` |

로그인 중 native SecureStore 인증 항목의 AES 암호화 저장과 이메일·비밀번호 평문 부재도 확인했습니다. 화면 원본과 계정·서버 값은 로컬에만 보존합니다. **UI의 실제 비어 있지 않은 방문 전송이나 전송 중 프로세스 종료를 확인한 결과는 아닙니다.** `202a2e2`에서 이 가입·동의 UI 전체를 다시 실행하지 않았으며, 그 단계는 아래의 독립 저장·전송 검사와 마지막 guest 상태 확인으로 구분합니다.

### 실제 비동기 native SQLite·HTTP 검사: 두 기준 모두 14개 PASS

`c95d6ca`와 세 파일 수정 후 `202a2e2`에서 **각각 새 고유 파일 DB·새 합성 계정으로 동일한 14개 검사를 실행**했습니다. 실제 앱에 로드된 Repository·Coordinator·VisitSyncClient, `expo-sqlite` 비동기 API와 별도 실제 HTTP 서버를 사용했습니다. production과 같은 네 async adapter 함수, WAL·busy timeout을 사용하고 시험 DB 경로가 원본과 다름을 확인했습니다.

| 확인한 항목 | 두 단계 결과 |
| --- | --- |
| 실제 async SQLite·실제 합성 HTTP | PASS |
| 자동 백업 기본 꺼짐 | 자동 실행은 전송하지 않음 |
| 수동 방문 ACK·성공 시각 | 방문 1건 ACK 후 성공 시각 저장 |
| 사진 큐·URI·소수점 시각 | 사진 큐 1건·URI·연결과 소수점 시각 유지 |
| 빈 큐 수동 실행 | 전송 호출·성공 시각 변경 없음 |
| 서버 저장 뒤 응답 유실 모사 | 방문 큐·사진 큐 보존, 다음 재시도 시각 저장 |
| DB 닫기·재개방·일찍 재시도 | 지연 시각 복구, 시각 전 실행은 전송하지 않음 |
| 같은 작업 UUID 재전송 | ACK 후 방문 큐만 제거, 사진 큐는 유지 |
| 서버 중복 방지·무결성 | 각 시험 계정의 방문은 고유 ID 2건, integrity `ok` |

14개 세부 플래그는 단계별 결과 파일에 있습니다. 실제 서버의 성공한 sync 응답은 두 단계 합계 6회였고, 각 단계의 서버 방문 수·고유 ID 수는 2/2였습니다. UI 시험 계정의 서버 방문은 끝까지 0건입니다.

응답 유실은 서버가 200 응답을 낸 뒤 client transport가 예외를 내도록 모사했습니다. 재시도 시각은 Coordinator의 주입 가능한 시계를 진행해 검증했습니다. 실제 OS 네트워크 단절·전송 중 앱 강제 종료나 실시간 30초 대기를 수행한 결과로 바꾸지 않습니다.

### `202a2e2` 경쟁 조건: 실제 native DB·합성 ACK 네 가지 PASS

각 경우를 별도 고유 DB에서 실행했습니다. 이 네 검사는 HTTP 대신 합성 ACK 응답을 사용하며, SQLite의 BEGIN·DELETE·COMMIT·ROLLBACK은 실제 비동기 native API입니다.

| 경쟁 조건 | 실제 결과 |
| --- | --- |
| 빈 큐 snapshot 뒤 새 방문·삭제 작업 enqueue | 완료 저장 transaction이 false를 반환하고 성공 시각은 null 유지. Coordinator가 다음 배치까지 처리한 뒤에만 완료 저장 |
| 같은 enqueue 뒤 자동 백업 opt-out | 첫 배치만 ACK, 새 두 작업을 큐에 남기고 성공 시각을 만들지 않음 |
| ACK가 다른 transaction 뒤에서 대기 중 같은 owner의 token 교체 | captured guard 전달, ACK transaction rollback·Runner paused·ACK 0건, 큐 내용과 사진 URI 보존 |
| 실제 outbox DELETE 직후 같은 owner의 token 교체 | 실제 삭제 1건 뒤 rollback, Runner paused·ACK 0건. 방문·사진·outbox ID/payload/시각 보존 |

각 DB의 integrity는 `ok`였습니다. 경쟁 시점을 adapter의 제어 지점으로 만들었으며 실제 사용자 DB·세션·방문에는 주입하지 않았습니다. 새 기능 전체 E2E나 모든 동시 실행 조합의 통과로 확대하지 않습니다.

### 자동 검사·보존·종료

각 임시 소스 단계에서 `npm --prefix travel_visit_tracker run check`를 실행해 타입 검사·ESLint·이 worktree의 기존 **90개 테스트**가 PASS였습니다. 공통의 189개 모바일·36개 서버 검사 수를 Android 실행 결과로 바꾸지 않습니다. Android 커밋에는 공통 코드·테스트를 넣지 않습니다.

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 원본 DB에 합성 방문을 넣거나 게스트 가져오기·삭제·초기화하지 않았습니다. 독립 시험 DB **6개와 해당 WAL·SHM의 부재**, 원본 DB의 존재를 확인했습니다.

Inspector helpers·자체 Metro 8082·별도 HTTP 서버·에뮬레이터를 종료하고 전용 연결만 제거했습니다. 원래 있던 5개 파일은 바이트 단위로 복구하고 새 QA 파일 9개는 적용 해시를 확인한 뒤 제거했습니다. package/lock은 그대로입니다. 기존 APK·서명·SDK·AVD·DB·사진·백업·로그·원본 증거도 보존했습니다.

시작 가용량은 20.52GiB, 종료 때는 18.52GiB였습니다. 파일시스템의 해당 시점 값이며 AVD·다른 작업의 사용량을 분리한 결과는 아닙니다. 이번에는 새 native 빌드나 캐시·중간 바이너리 삭제를 하지 않았고, 용량 확보량도 0입니다. 이전 날짜의 정리 결과와 합산해 이번 확보량으로 표시하지 않습니다.

원본 근거는 Git 제외인 `docs/test-results/android-backup-ui-20261017/`에 보존합니다. 공개 문서에는 상태·개수·검증 한계만 적으며 계정·토큰·서버 주소·사진·기기 값과 원본 로그는 올리지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 두 SHA·임시 파일·복구 | `validation-files.json`, `original-*.txt`, `common-*.txt`, `restoration-result.json` |
| 화면·동의·재실행 | `ui-summary.json`, `consent-summary.json`, `after-*-state.json`, `restored-state.json`, 비공개 화면 XML·PNG |
| native 인증 항목·원본 대조 | `*-credential.json`, `baseline-data.json`, `after-*-data.json`, `final-data.json`, 비공개 fingerprint 기준 |
| c95 실제 HTTP 14개 | `c95-native-probe-result.json`, `c95-native-probe-manifest.json`, `c95-complete.json` |
| 202a 실제 HTTP 14개 | `native-probe-result.json`, `native-probe-manifest.json` |
| 202a DB 경쟁 조건 네 가지 | `race-probe-result.json`, `race-probe-manifest.json`, `race-probe-source.js` |
| 서버·임시 DB 제거 | `server-summary.json`, `server-final-counts.json`, `temporary-databases-cleanup.json` |
| 자동 검사·설치 APK·종료 | `common-check.log`, `common-202a-check.log`, `installed-apk-preserved.json`, `shutdown-status.json`, `metro*.log`, `server.log`, `emulator.log` |

실제 Android 휴대폰·Release·OS 클라우드 백업/복원·배터리와 G1~G4 전체 조건은 남아 있습니다. 사진 업로드·새 기기 복원·여러 기기 삭제 병합과 비어 있지 않은 앱 UI의 전송 중단·복구도 별도입니다. 공통 수정의 Android 제안은 이번 네 조건에서 해결 확인했으며, 결과만 기존 PR #1에 저장합니다.

## 10월 16일 설치 APK와 실제 비동기 SQLite

### 기존 자료를 보존한 APK 업데이트

Android 시작 기준은 `3bb9493`입니다. 10월 15일 빌드한 APK의 보존 hash·파일 크기, APK 서명 유효성, 현 설치 앱과의 서명·package·버전 호환성을 먼저 대조했습니다. 모든 조건과 원본 자료 대조를 통과한 뒤 **`adb install -r`을 한 번만** 실행했고 성공했습니다. 새 의존성, prebuild나 native rebuild는 없었으며 uninstall, wipe, 재시드와 원본 DB 삭제도 하지 않았습니다.

설치 후 package 경로에서 읽은 APK의 SHA-256이 보존한 새 APK와 같았습니다. 따라서 그 바이너리의 최종 manifest와 컴파일된 XML을 대조해 fullBackupContent·dataExtractionRules 참조, full-backup·cloud-backup·device-transfer의 `sharedpref/SecureStore` 제외를 설치 앱 기준으로 확인했습니다. 초기 XML 검사식은 aapt의 속성 값과 Raw 표시를 중복 집계해 실패했으며, 속성 행만 세도록 바로잡고 읽기 전용으로 재확인했습니다. 재설치는 하지 않았습니다.

| 설치 전후 검사 | 결과 |
| --- | --- |
| 보존 APK hash·서명·설치 호환성 | PASS |
| 데이터 보존 업데이트 | `install -r` 1회 성공 |
| 설치 APK와 검증 APK의 hash | 동일 |
| 설치 앱의 백업 제외 규칙 | manifest 참조와 세 규칙 PASS |
| 모든 owner의 visits·photos·outbox 전체 행 | 설치 전후 hash 동일 |
| 기존 guest 행·사진 파일 바이트 | 10월 14일 원본 기준과 동일 |
| 최종 기존 자료·상태 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

이번에는 **실제 OS 클라우드 백업·복원·기기 전송을 시작하지 않았습니다.** 이 검사로 방문·사진의 OS 복원이나 실제 Android·Release 수용 조건을 완료 처리하지 않습니다.

### production과 같은 비동기 adapter 검사

공통 소스는 **`f4eb401cc58a7a03acc5fd38797f6c938b62b932`에 고정**했습니다. `repository.ts`, `schema.ts`, `dwell.ts`, `database.ts` 네 파일을 Git에서 읽어 원문·해시를 로컬에 보존했습니다. 작업 중인 공통 소스나 원래 checkout은 복사하지 않았고 Android 앱 소스에도 overlay하지 않았습니다.

`database.ts`에서 production `SqlConnection` 객체의 본문을 그대로 추출했습니다. 네 함수는 `execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`를 직접 호출하며 sync API wrapper를 쓰지 않습니다. `getConnection()` 자체를 실행하면 원본 DB가 열리므로 실행하지 않았습니다. 대신 새 고유 이름의 합성 DB를 `openDatabaseAsync`로 열고 production과 같은 WAL·busy timeout을 설정한 뒤, 그 연결에 같은 adapter 본문과 Repository를 연결했습니다. `PRAGMA database_list`로 시험 파일 경로를 확인했습니다.

Hermes Inspector 표현식은 즉시 반환하고 전역 finished 플래그를 별도 polling했습니다. 검증 코드는 지난번 확인한 ES2015 Promise 변환을 사용했습니다. 앱 시작 직후 Inspector가 아직 준비되지 않은 경우에만 제한된 대기를 추가했고, 실제 DB 시험은 한 번 실행해 PASS였습니다.

| 합성 파일 DB의 비동기 API 검사 | 결과 |
| --- | --- |
| 합성 관측·방문·사진 행 생성 | async API로 성공. 실제 사진 파일은 만들지 않음 |
| A/B 계정 분리 | A의 방문·사진을 B에서 볼 수 없음 |
| 명시적 GPS 가져오기 | GPS 방문 1건·사진 행 1건 이동, 개발 방문은 guest에 남음 |
| UUID·session·소수점 시각·사진 URI·연결 | 모두 동일 |
| outbox 내용 보존 | owner 변경 외 ID·entity·operation·payload·생성 시각·attempts 동일 |
| 비활성 owner import·attempt 쓰기·ACK | 모두 거절, outbox 불변 |
| B의 ACK에 A 작업을 전달 | 삭제 0건, A의 대기 자료 보존 |
| async close·reopen | 방문 UUID·소수점 시각·outbox 유지 |
| 무결성·종료 | integrity `ok`, closeAsync·deleteDatabaseAsync 성공 |
| 파일 제거·원본 재대조 | 해당 임시 DB·WAL·SHM 없음, 원본 전체 행·사진 바이트 불변 |

10월 15일의 메모리 DB·sync native wrapper 결과와 구분합니다. 이번에는 production과 같은 **네 비동기 adapter 함수**를 실제 native SQLite에서 확인했지만, 앱의 연결 캐시·계정 화면 전환·서버 전송 UI의 E2E 전체를 검증한 것은 아닙니다. 준비 중인 공통 백업 버튼·자동 전송 소스도 이번 결과에 포함하지 않습니다.

### 사용자 요청 용량 정리와 종료

검증 후 자체 Metro 8082·에뮬레이터·Inspector를 종료하고 열린 파일을 대조했습니다. 최초 서버가 IPv6 localhost에만 떠서 IPv4 연결용 서버를 준비하는 동안 두 프로세스가 있었으며, 사용하지 않는 자체 IPv6 서버를 먼저 종료했습니다. 최종적으로 두 자체 서버 모두 종료됐습니다. 공통 iOS 8081과 연결된 iPhone은 조작하지 않았습니다.

10월 15일 본인 prebuild가 만든 디렉터리 안의 남은 재생성 가능한 `.so`, `.pch`, `.class`, `.jar`, `.o`, `.a`, `.dex`, `.flat`, `.bc`만 정리했습니다. 디렉터리 생성 이력과 실제 worktree 경로를 기준으로 소유를 확인했습니다. 일부 복제 파일의 생성 시각은 원본 시각을 유지했으므로 파일 시각만으로 사전 존재 여부를 판단하지 않았습니다. 삭제 전 해당 파일의 열린 핸들이 없었고 APK·서명·로그·근거 해시는 삭제 후에도 같았습니다.

| 정리 경로 | 해당 디렉터리 |
| --- | --- |
| 앱 | `travel_visit_tracker/android/app/build/intermediates`, `travel_visit_tracker/android/app/build/tmp` |
| `travel_visit_tracker/node_modules/<package>/android/build/intermediates` | `expo-modules-core`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-screens`, `react-native-worklets` |
| `travel_visit_tracker/node_modules/<package>/android/.cxx` | `expo-modules-core`, `react-native-reanimated`, `react-native-worklets` |
| `travel_visit_tracker/node_modules/<package>/android/build/tmp` | `expo`, `expo-constants`, `expo-dev-launcher`, `expo-dev-menu`, `expo-json-utils`, `expo-manifests`, `expo-modules-core`, `expo-updates-interface`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-worklets`, `@expo/log-box`, `@maplibre/maplibre-react-native` |

파일 **3,265개, 논리 크기 2,189,723,038 bytes(2.04GiB)**를 제거했습니다. 실제 파일시스템 가용량은 정리 직전 24,603,115,520 bytes에서 직후 24,764,792,832 bytes로 **161,677,312 bytes(154.19MiB) 증가**했습니다. 파일 크기 합계를 실제 확보량으로 바꾸지 않습니다. 복제 블록 공유나 다른 작업의 디스크 사용량을 분리 측정한 결과도 아닙니다.

최종·기존 APK와 설치 전 APK 복사본, signing 파일, 모든 로그·XML·JSON·원본 근거, AVD·DB·사진·outbox·백업은 유지했습니다. 중복된 최종 APK를 삭제하지 않았고 원래 checkout·전역 캐시·SDK 정리는 이 Android 작업에서 하지 않았습니다. 공통 코드와 package/lock은 변경하지 않았으므로 복구할 임시 overlay도 없습니다. 삭제한 중간 바이너리는 필요할 때 다시 빌드해야 합니다.

이번 원본은 Git 제외인 `docs/test-results/android-update-async-20261016/`에 있습니다. 공개하는 내용은 이 결과 요약이며 원본 DB·사진·서명·기기 경로와 APK는 커밋하지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 소스 고정·adapter 추출 | `source-manifest.json`, `*-source.ts`, `production-async-adapter.txt`, `async-probe-manifest.json` |
| 설치 전 확인·설치·최종 바이너리 | `apk-preflight.json`, `install-r.log`, `installed-apk-result.json`, `installed-manifest.txt`, `secure_store_*-installed-compiled.txt` |
| 실제 비동기 시험·임시 DB 정리 | `async-native-probe.js`, `async-native-start.json`, `async-native-result.json`, `temporary-database-cleanup.json` |
| 원본 전후 비교 | `before-install-data.json`, `after-install-data.json`, `after-async-data.json`, 비공개 행·사진 fingerprint 기준 |
| 용량·종료 | `cleanup-inspection.json`, `cleanup-removed-files.json`, `cleanup-summary.json`, `shutdown-status.json`, `metro*.log`, `emulator.log` |

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
| 원본 앱 대조 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

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
| 원본 보존 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

계정 뷰 유지 시험은 **로컬 계정 자료가 0건인 조건**입니다. 계정 소유자가 유지되고 게스트 기록이 노출·이동되지 않는 것을 확인했으며, 비어 있지 않은 계정의 방문·사진 복원까지 검증했다는 뜻은 아닙니다. 가져오기 원자성은 공통 담당의 임시 SQL 검사 결과이고 이번 native 시험에서는 실제 가져오기를 하지 않았습니다.

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

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 임시 서버와 전용 연결, 자체 Metro와 에뮬레이터를 종료했습니다. 공통 overlay 10개는 원래 Android HEAD로 복원했고, 이번에만 생긴 공통 파일은 해시를 확인한 뒤 제거했습니다. 원래 common checkout, iOS와 기록·사진·증거·백업은 보존했습니다. 이번 종료 커밋은 Android 결과 문서만 포함합니다.

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
| 기존 자료 보존 | PASS | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |
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

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 새 장시간 시험, 위치 주입, APK 재설치나 native rebuild는 하지 않았습니다. P4-06의 Android 뒤로 가기 부분 확인이며 작은 화면, 큰 글자, 스크린리더와 양쪽 실제 기기 검증은 계속 남아 있습니다.

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
| 화면 복귀·중지·앱 재실행 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

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
