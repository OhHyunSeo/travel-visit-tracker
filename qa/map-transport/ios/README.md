# iPhone 지도 통신 시험 앱

2026-10-30에 UIScene 시작 오류를 수정한 뒤 후속 사용자 재개에서 단일 HTTP 송신 경로를 추가했습니다. 이전 소스의 실제 iPhone 13개와 새 소스의 12개를 구분해 기록했습니다. 제품 MapLibre에 연결한 앱이나 공급원 제한을 보장하는 완료본은 아닙니다.

앱 ID는 `app.trippainting.maptransportqa`입니다. UIKit, Foundation과 Network.framework를 사용하며 MapLibre, 로그인이나 위치 기록은 연결하지 않았습니다. 서명 검사에서 원래 앱과 다른 application identifier, 공유 Keychain과 app group 없음, 위치와 백그라운드 권한 없음을 확인했습니다.

## 10월 30일 후속 재개: 한 번만 쓰는 HTTP 시험 경로

이전 전달용 NSURLSession을 `TPHTTPExchange`의 새 TCP 연결과 한 번의 HTTP/1.1 송신으로 바꿨습니다. 실행 전에 장부를 저장하고, 응답을 끝내거나 취소한 연결의 `cancelled` 상태가 올 때 전역 자리를 반환합니다. 내부 HTTP 재시도, 연결 재사용, redirect와 인증 응답 처리는 구현하지 않았습니다. 이 경로는 사설 IPv4의 합성 HTTP 서버만 받으며 HTTPS와 공개 공급원은 거절합니다.

응답 헤더는 8KiB, 본문은 256바이트 안에서 검사합니다. 길이 중복과 미지정, 압축과 chunked, 상태줄의 제어 문자, 잘린 응답과 뒤에 붙은 바이트를 거절하며 정상 본문도 EOF를 확인한 뒤 전달합니다. `acceptedBodyBytes`는 완료해 전달한 본문만, `receivedHTTPBytesSettled`는 끝난 연결에서 검사한 receive 조각의 헤더와 본문을 셉니다. 거절 이후 조각은 더 검사하지 않으므로 전체 callback 바이트나 OS 전체 수신량과도 다릅니다.

Mac에서 같은 Objective-C 소스를 컴파일해 실제 loopback TCP 검사를 추가했습니다. 연결 단절 뒤 자동 재전송 없음, 명시적 재시도와 새 프로세스의 비환급 예약, 12개 요청의 최대 동시 4개, 응답 모양과 취소, 제한 시간을 확인합니다. 실행 명령은 아래와 같고 Linux에서는 Apple framework가 없어 명시적으로 건너뜁니다.

```sh
python3 -B -m unittest discover -s qa/map-transport/ios -p 'test_http_exchange.py'
```

새 서명 소스의 실제 iPhone 기본 11개와 QA 강제 종료/새 PID 재실행 1개, 총 12개가 통과했습니다. 기본 사례에서 시작 수와 HTTP 쓰기 수가 맞고, 재실행에서는 미확정 256에 새 256을 추가해 512를 유지했습니다. QA 문서 5개를 대조해 보관하고 앱과 서버를 정리했습니다. Mac의 부분 EOF를 iPhone에서 재현한 결과로 세지 않습니다. 아래의 이전 실제 iPhone 13개와도 별개입니다. 이 실험은 일반 HTTP client나 MapLibre 공급원 어댑터의 완료본이 아닙니다. TLS와 HTTP/2, 실제 SDK 재요청과 저장소 통합, OS 수신량 상한은 남아 있습니다.

Apple은 [Network framework](https://developer.apple.com/documentation/network)를 낮은 수준의 TCP/TLS 접근에 쓰고 일반 HTTP에는 URLSession을 사용하도록 안내합니다. 이번 구현도 제한된 합성 HTTP/1.1 실험으로 둡니다. [송신의 idempotent 옵션](https://developer.apple.com/documentation/network/nw_connection_send_idempotent_content)은 연결 시도에 걸쳐 재생될 수 있어 사용하지 않습니다.

## 이전 소스에서 확인한 결과

10월 30일 서명 빌드와 실제 실행이 통과했습니다. 기본 11개는 혼합 리소스의 본문 수명 최대 4개, 앱 식별값과 합성 인증 제거, 대기와 실행 중 취소, 미지원 주소와 응답의 거절, 예약 한도와 잘못된 장부 보존입니다.

사용자가 완료 후 홈 화면으로 나갔다 돌아왔을 때 같은 프로세스, 결과 내용과 서버 통계가 유지됐습니다. 별도 재실행 검사에서는 응답을 기다리던 QA 프로세스를 실제 SIGKILL로 종료했습니다. 새 프로세스는 미확정 예약 256바이트와 항목 하나를 그대로 읽었고, 새 요청 뒤 총 512바이트와 이전 미확정 항목을 유지했습니다. 원래 요청의 재전송이나 제품 백업, 실제 전원 종료를 검증한 결과는 아닙니다.

새 앱은 활성 scene에서 프로세스당 한 번만 검사를 시작하며 화면 비활성화와 완료 때 이전 화면 유지 값을 복원하도록 했습니다. 지원하지 않는 stage와 경로 형태의 run ID를 거절하고, basic에서는 이미 사용한 run 폴더를 재사용하지 않습니다. 준비가 실패한 hold 단계도 화면 유지를 계속하지 않습니다.

QA 문서 파일 5개를 보관하고 native 결과와 장부, 변경하지 않은 잘못된 장부를 대조했습니다. 새 앱을 제거했고 원래 여행색칠의 설치 정보는 같았습니다. 개인 DB, 사진과 native 인증은 열거나 새로 대조하지 않았습니다. 통과 앱은 로컬 `.build/pinned-scene-20261030/`에 보관하고 이번 생성한 중간 빌드만 정리했습니다.

### 이전 시작 실패 기록

2026-10-29 signed Debug 빌드와 정적 서명 검사는 통과했습니다. 앱은 197,870바이트였습니다. 실제 아이폰에 설치해 실행했지만 UIKit의 `NoSceneLifecycleAdoption` 구간에서 종료됐고 사용자도 즉시 닫힘을 확인했습니다. 합성 리소스 요청과 통신 결과 파일이 없어 대상 네트워크 사례는 NOT RUN입니다. 시험 앱을 제거했고 원래 여행색칠의 설치 정보는 같았습니다. 기존 앱의 데이터 저장소를 열거나 새 인증 비교를 하지는 않았습니다.

이전 실패한 서명 앱과 소스 해시는 로컬 `.build/pinned-startup-failed/` 및 검사 기록에 남겨 두었습니다. 위 10월 30일 결과가 시작 오류와 대상 NOT RUN을 갱신하며, 기존 실패 기록을 새 통과로 세지는 않습니다.

## 빌드와 시험 입력

설치된 Xcode와 자신의 서명 팀을 사용합니다. `APPLE_TEAM_ID` 환경 변수를 지정하거나 첫 인자로 팀을 전달한 뒤 `build-ios.sh`를 실행합니다. 팀 값과 프로필은 저장소에 넣지 않습니다. 출력은 Git 제외 `.build/`에 생성합니다.

시험 앱 실행 시 `QA_SERVER_ORIGIN`, `QA_RUN_ID`, `QA_STAGE`를 별도로 전달합니다. 서버 주소는 포트가 있는 사설 IPv4의 HTTP 주소만 허용합니다. stage는 `basic`, `hold`, `resume`이며 run ID는 영문, 숫자, 밑줄과 하이픈 1~64자입니다. `basic`은 새 run ID를 사용하고, 실제 종료와 재실행을 보는 `hold`와 `resume`만 같은 ID를 공유합니다. 기존 여행색칠을 실행하거나 그 저장소 경로를 바꿔 사용하지 않습니다.

## 코드의 범위

`TPTransport`는 이 시험 앱의 외부 NSURLSession에만 등록하는 NSURLProtocol입니다. 주소와 리소스를 검사한 뒤 전역 대기열, 예약 장부와 `TPHTTPExchange`를 연결합니다. 계정 헤더를 전달하는 대신 고정된 HTTP 요청을 새로 만듭니다. 제품 앱에는 등록하지 않습니다.

본문 256바이트를 시작 전에 예약하고 성공과 실패 뒤에도 환급하지 않습니다. 파일 쓰기는 같은 폴더의 임시 파일, fsync와 rename을 사용하며 실제 전원 종료의 내구성 검증은 아닙니다. 합성 경로에서 한 예약에 한 HTTP 송신을 관찰한 결과를 공급원이나 실제 SDK의 모든 요청 제한으로 확대하지 않습니다.
