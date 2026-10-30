# Android 지도 전송 시험 앱

실제 앱과 다른 `app.trippainting.maptransportqa` 패키지로 만든 작은 시험 앱입니다. Android의 비동기 OkHttp 경로와 앱 전용 파일의 예약 장부를 확인합니다. MapLibre, 로그인, 위치 기능과 개인 앱의 저장 공간은 연결하지 않습니다. 권한은 인터넷 하나이며 백업도 꺼져 있습니다.

검사할 동작은 다음과 같습니다.

- 두 client가 공유하는 dispatcher가 본문을 읽고 닫을 때까지 최대 4개 요청을 유지합니다.
- 에뮬레이터의 `10.0.2.2`에 있는 지정 시험 서버와 네 종류의 합성 리소스만 요청합니다. 알 수 없는 주소와 쿼리를 전송 전에 거절하고 redirect를 따라가지 않습니다.
- 고정 User-Agent만 보내며 쿠키, 계정 인증, 프록시와 캐시는 사용하지 않습니다. network interceptor는 자동 follow-up의 두 번째 교환을 전송 전에 거절합니다.
- 요청 전에 본문 128바이트를 예약해 `AtomicFile`에 쓰고 동기화합니다. 예약은 성공이나 실패 뒤에도 환급하지 않습니다. 앱 강제 종료 뒤 확인하지 못한 예약은 대기로 남습니다.
- 합성 한도는 본문 예약 8,192바이트, 타일 시도 40번, 전체 시도 100번입니다. 각 시도에서 길이를 알 수 없거나 128바이트를 넘는 본문, 압축 응답과 오류 응답은 받아들이지 않습니다.

여기서 세는 본문은 **앱이 받아들인 바이트**입니다. OS가 이미 받은 바이트나 HTTP/TLS 전체 전송량을 제한했다는 결과가 아닙니다. 현재 시험 서버는 HTTP/1.1이며 실제 SDK, HTTP/2, 공급원 접속과 운영 앱의 lifecycle 통합도 별도입니다. 시험별 `run_id`는 독립 합성 사례를 위한 이름으로, 실제 다운로드 ID를 바꿔 예산을 초기화하는 제품 기능이 아닙니다.

## 2026-10-30 재개 결과

이전 AVD의 QCOW2, base userdata와 설정을 읽기만 해서 다시 대조했습니다. 현재 해시는 이전 실행 종료 때 보관한 값과 모두 같습니다. 과거 QCOW2의 전후 차이는 당시 전체 해시와 크기만 기록돼 있어 메타데이터와 guest 데이터 변경을 구분할 수 없습니다. 원인은 계속 미확정이며 원본을 복구하거나 덮어쓰고 삭제하지 않았습니다.

다음 실행이 기존 AVD를 잘못 선택하지 않도록 `qa_avd_guard.py`를 추가했습니다. 전용 이름과 workspace 소유 경로, 준비 기록과 설정 해시, 실제 emulator process의 데이터 경로를 함께 확인합니다. 호스트 검사를 마친 뒤 읽기 전용 guest 이름도 대조합니다. 기본 이미지의 symlink와 hardlink, QCOW2 backing 경로도 확인합니다. 이 조건을 통과하기 전에는 앱 설치나 실행 명령을 보내지 않습니다. 실제 명령은 검사한 ADB transport ID로 고정하고 매번 host PID, 시작 시각과 경로를 다시 확인합니다. 사용했던 QA AVD도 재사용하지 않도록 첫 실행 전에 소유 기록을 한 번만 남깁니다.

호스트 회귀 검사 25개는 통과했습니다. 기존 이름, 외부 경로와 심볼릭 링크, 바뀐 설정과 미지원 옵션, 콘솔과 ADB의 서로 다른 소유 PID, 이전 사용 기록을 거절하는지 확인했습니다. fixture 정리 실패가 QA 패키지 제거를 건너뛰지 않는지도 확인했습니다. 이 결과는 실제 emulator/guest 연결의 통과가 아닙니다.

이번에는 새 AVD 증가량을 1GiB 이하로 보수적으로 제한할 근거를 마련하지 못해 **새 AVD 생성과 native 재검사는 NOT RUN**입니다. 예전 이미지의 실제 할당량은 약 10.8GB였습니다. 기존 SDK나 userdata를 복사하거나 새 시스템 이미지를 다운로드하지 않았고, emulator와 ADB도 시작하지 않았습니다. 앞의 여섯 통신 묶음은 이전 고정 소스의 결과로만 유지합니다.

## 빌드

설치된 SDK 36의 `aapt2`, `d8`, `zipalign`, `apksigner`와 JDK 17을 재사용합니다. Gradle 프로젝트나 새 AGP는 받지 않습니다. 고정 버전 OkHttp 4.12.0과 Okio 3.6.0의 작은 jar만 공식 Maven에서 받을 수 있으며 SHA-256을 확인합니다. Kotlin stdlib 2.2.21은 기존 jar를 재사용하고 해시도 대조합니다. 세 라이브러리의 버전, 주소, 라이선스와 해시는 `dependencies.json`에 있습니다.

```sh
bash qa/map-transport/android/build.sh
```

표준 위치와 다르면 `ANDROID_HOME`, `JAVA_HOME`, `KOTLIN_STDLIB_JAR`로 지정합니다. 출력과 시험 서명 키는 Git에서 제외한 이 폴더의 `.build/`에만 만듭니다. 기존 앱의 빌드, 패키지 설정과 의존성은 바꾸지 않습니다.

## 새 에뮬레이터 검사를 시작하기 전

현재 검사 도구는 준비 기록 없는 기존 AVD를 의도적으로 거절합니다. 새 시험용 AVD를 만들고 증가량의 상한을 독립적으로 확인하는 준비 단계가 먼저 필요합니다. 숫자만 기록한 marker는 실제 디스크 증가량을 보장하지 않습니다. 이번에는 해당 marker나 실행 환경을 만들지 않았습니다.

준비된 AVD는 이 도구의 `.build/avd/TripPaintingMapTransportQA_<unique>.avd` 바로 아래에 있어야 합니다. 준비 기록 `.trip-painting-map-qa.json`은 생성한 새 이름과 정규 경로, cached SDK에서 시작했다는 출처, 설정 SHA-256과 검증한 증가량을 묶습니다. 이전 AVD를 복사하거나 경로만 바꾼 경우의 소유 증명으로 사용하지 않습니다. 심볼릭 링크와 외부 userdata/cache 경로는 거절합니다.

실행 중인 emulator의 콘솔과 ADB 포트가 같은 호스트 PID인지 읽기만 해서 확인합니다. 이미 준비된 ADB 서버가 없으면 client 호출 전에 거절하며, 준비 주체가 그 서버의 수명을 소유해야 합니다. SDK 실행 파일과 명시적 `-avd`, `-datadir`, `-port`, `-no-snapshot` 및 허용한 옵션을 대조하고, 그 뒤 `adb emu avd name`을 읽습니다. 실제 Android 휴대폰과 임의의 emulator serial만으로는 진행하지 않습니다. 연결에 대응하는 transport ID를 얻고, 이후 명령 전후에 emulator와 ADB 서버의 PID, 시작 시각과 실제 데이터 경로가 같은지 다시 확인합니다. host 프로세스 확인과 CLI 실행 사이의 동시 종료를 원자적으로 묶는 OS sandbox는 아니므로 다른 주체가 시험 환경을 재시작하면 검사를 중단해야 합니다. 첫 검사에 사용할 새 AVD에서는 개인용 `app.trippainting.mobile` 패키지가 없어야 하며, 그 파일이나 DB를 읽어 baseline으로 삼지 않습니다.

호스트 거절 검사는 별도 기기 없이 실행할 수 있습니다.

```sh
python3 -m unittest discover -s qa/map-transport/android -p 'test_qa_avd_guard.py'
```

독립 준비가 완료된 경우에만 검증한 경로를 `QA_AVD_DIR`로 지정하고 실행합니다.

```sh
node qa/map-transport/fixture/server.mjs --port 3188
python3 qa/map-transport/android/run-validation.py --serial emulator-5562 --qa-avd-dir "$QA_AVD_DIR" --port 3188
```

실행 도구는 기존 패키지를 임의로 덮어쓰지 않습니다. 고유한 `.build/validation/run_*/`에 결과를 남겨 이전 근거를 덮어쓰지 않고, 처음 검사하는 소유 AVD에 사용 기록을 원자적으로 남긴 뒤 QA 앱만 설치합니다. 끝나면 QA 앱만 제거하고 개인 패키지의 계속된 부재와 네트워크, 화면 설정을 대조합니다. 기존 앱의 인증이나 DB 보존을 새로 확인한 결과로 보고하지 않습니다. HTTP에는 `adb reverse`를 사용하지 않습니다.

이 도구는 AVD를 만들거나 시작, 종료하지 않습니다. 준비 주체가 실제 디스크 증가량과 새 저장 공간의 출처, 소유 서버와 emulator 종료를 별도로 확인해야 합니다. 과거 QCOW2 차이가 해결되지 않은 상태에서 원본을 덮어쓰거나 지워 해시를 맞추지 않습니다.
