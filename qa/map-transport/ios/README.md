# iPhone 지도 통신 시험 앱

## 2026-11-02 후속: HTTPS 장부와 전역 자리 수명

`configureFixtureTLSOrigin`이 연결별 TLS를 기존 `TPTransport`의 장부와 대기열에 묶습니다. 명시적 loopback HTTPS와 최대16KiB DER만 허용하며, 같은 origin·한도·leaf DER가 저장 장부와 일치해야 다시 열립니다. pin 변경과 잘못된 입력은 기존 파일을 바꾸지 않습니다. 기본 HTTP 생성자와 `safeOrigin`은 유지하고, SDK 앱이나 제품에 HTTPS를 자동으로 열지 않습니다.

Mac 실제 TLS gate8개가 통과했습니다. 정상 요청·정상 종료 후 새 process의 장부 재개와 세 번째 한도 거절, 잘린 응답의 명시적 재시도, HTTP를 쓰기 전 신뢰 실패의 예약 유지, pin 변경 거절, 네 자리 뒤의 대기와 대기/전송 중 중복 취소를 대조했습니다. 첫 네 응답을 보류했을 때 native active4/pending4와 서버 도착4를 확인했습니다. 서버 peak는 보류된 응답 본문 수이며 동시에 살아 있는 TLS socket 수의 보장은 아닙니다. native 자리는 handshake부터 응답·로컬 취소 완료까지 유지됩니다.

추가 사례는 Mac CLI를 실제 SIGKILL한 뒤 새 process에서 같은 장부를 읽었습니다. 전송4·대기4에서 남은 기존 예약1,024바이트와 미확정 ID4개가 보존됐고, 새 요청8개 완료 후3,072바이트와 기존 미확정4개가 남았습니다. 서버는 총12회 도착, 새 process는 시작/반환/송신8회입니다. 원래 작업의 자동 재개, iPhone·Release·전원 종료나 같은 SDK 작업 재시도의 결과는 아닙니다.

```sh
python3 -B -m unittest discover -s qa/map-transport/ios -p 'test_tls_transport.py'
```

저장된 DER는 시험 인증서의 공개 bytes이며 private key는 장부에 넣지 않습니다. suite의 임시 키·인증서·장부·binary와 소유 process는 종료 때 정리합니다. 같은 소스의 iOS arm64 문법·API 확인은 통과했지만 새 signed app/SDK HTTPS/기기 실행은 NOT RUN입니다. 이전 iPhone 근거를 이 helper 변경의 기기 통과로 옮기지 않습니다. 공개 공급원·HTTP2 구현·팩 귀속과 OS 수신량 상한은 남아 있습니다.

## 2026-11-02 Mac 안에서만 확인한 TLS 기본 경로

`TPHTTPExchange`에 별도 TLS 시험 생성자를 추가했습니다. `127.0.0.1`의 명시적 HTTPS 포트와 최대 16KiB의 DER 인증서만 받으며, 기존 생성자와 `TPTransport`의 HTTP 전용 동작은 유지합니다. MapLibre나 영속 장부에 HTTPS를 연결하지 않았고 제품 소스·의존성도 바꾸지 않았습니다.

인증서는 해당 연결의 trust 객체에만 적용합니다. 지정한 anchor만 사용하고 호스트 이름, 인증서 체인과 실제 leaf DER를 함께 대조하며 인증서 검증의 네트워크 가져오기를 끕니다. Keychain이나 시스템 신뢰 설정은 바꾸지 않습니다. 신뢰 평가는 비동기로 수행해 전송 제한 시간의 큐를 막지 않으며, 취소 뒤 완료되는 평가에는 전송을 허용하지 않도록 했습니다. 이 마지막 분기는 소스 검토 범위이며 실제 늦은 trust callback을 관찰한 결과는 아닙니다.

시험은 `http/1.1`과 `h2`를 제안하되 선택 결과가 정확히 `http/1.1`일 때만 HTTP를 씁니다. 실제 `h2` 선택과 ALPN 없음은 HTTP 쓰기 전에 거절했습니다. HTTP/2 구현이나 수용 통과로 세지 않습니다. ALPN 문자열을 복사하는 API 때문에 이 선택적 TLS 시험은 macOS 15.5/iOS 18.5 이상에서만 허용하며, 더 이른 환경에서는 거절합니다. 기존 HTTP 경로의 지원 범위는 바꾸지 않습니다.

Mac의 실제 loopback TLS 검사 7개가 통과했습니다. 정상 인증서·호스트의 한 번 송신, 다른 인증서·호스트 거절, 신뢰 체인이 맞아도 다른 leaf인 경우 거절, ALPN 정책, 잘못된 DER·공개/DNS/LAN·평문 입력의 접속 전 거절, 미완료 handshake의 제한 시간·중복 취소와 100ms 내 단일 완료, TLS 후 잘린/추가 HTTP 본문 거절입니다. 서버 도착 수와 native 결과를 함께 대조합니다.

```sh
python3 -B -m unittest discover -s qa/map-transport/ios -p 'test_tls_exchange.py'
```

임시 키·인증서·실행 파일은 이 suite가 새로 만든 폴더 안에만 두고 종료 때 정리합니다. 일반 검사와 Cloud CI에서는 Apple framework가 없는 환경의 7개를 명시적으로 건너뜁니다. iOS arm64 문법·API 확인과 QA 프로젝트의 Security.framework 연결은 별도로 점검하며, 새 iPhone 앱 빌드·설치·실행과 SDK HTTPS 검증은 NOT RUN입니다. 이전 `eaa88af` iPhone 취소 두 사례를 새 TLS 소스의 기기 통과로 바꾸지 않습니다.

위 직접 TLS 생성자의7개는 gate를 우회한 기본 시험입니다. 후속의 gate8개는 별도 구간에서 장부·전역 자리를 함께 확인하며, 두 결과를 구분합니다. 공개 공급원과 OS 수신량 상한은 미완료입니다.

구현 근거는 Apple의 [TLS 검증 콜백](https://developer.apple.com/documentation/security/sec_protocol_options_set_verify_block(_:_:_:)), [비동기 신뢰 평가](https://developer.apple.com/documentation/security/sectrustevaluateasyncwitherror(_:_:_:))와 로컬 SDK 헤더입니다. 임시 서버의 TLS·ALPN은 Python의 [ssl 문서](https://docs.python.org/3/library/ssl.html)를 따릅니다.

## 2026-11-01 Mac에서 대기와 중복 취소 확인

`test-transport-queue.m`은 첫 네 응답 본문을 보류한 실제 loopback 서버와 함께 여덟 요청을 검사합니다. native 대기 4개와 서버 도착 4개를 대조한 뒤 본문을 풀어 다섯 번째가 먼저 전송되지 않는지 확인합니다. 대기 요청의 두 번 취소는 전송·예약 없이 빠지고, 전송 중 두 번 취소는 native 종료 callback 뒤 한 번만 자리를 반환하며 이전 예약은 남깁니다. 원본 자료 대신 임시 장부와 합성 본문을 사용합니다.

새 세 사례와 기존 열 사례, Mac native 13개가 통과했습니다. Linux에서는 Apple framework 전용 13개를 명시적으로 건너뜁니다. `pending/maxPending`, 취소와 반환 카운터는 QA 관찰값이며 제품 API에 추가하지 않았습니다. 서버가 취소를 인식하는 시점과 native 취소 완료는 다를 수 있어 전송 중 취소의 서버 active 수를 OS 전체 동시 수신량 상한으로 세지 않습니다.

이 결과는 실제 MapLibre나 iPhone의 취소·대기 증거가 아닙니다. 별도 SDK 앱의 새 기기 검사는 준비 중이며 공급원과 TLS/HTTP2, 제품 연결은 계속 꺼 둡니다.

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

## 2026-11-03 명시적 사설 HTTPS 시험 경로

기존 loopback TLS 생성자는 그대로 두고 exact canonical origin(127.0.0.1 또는 RFC1918 IPv4·명시적 포트)과 공개 DER를 같이 받는 opt-in 경로를 추가했습니다. DNS·public·link-local·IPv6·추가 URL 구성요소와 다른 origin은 전송 전에 거절합니다. 엄격한 base64와 DER의 최대16KiB를 확인하며 같은 장부·전역 gate를 유지합니다. Mac 새7개는 실제 loopback 연결이며 사설 주소의 host 검사는 전송 없는 설정/거절 근거입니다. 실제 LAN 연결은 별도 SDK iPhone 단일 렌더1개에서만 확인했습니다. TLS verified 카운터는 정상 완료·신뢰·정확한 ALPN이 모두 확인된 exchange만 셉니다. HTTP2·제품 공급원·OS 수신량을 증명하지 않습니다.
