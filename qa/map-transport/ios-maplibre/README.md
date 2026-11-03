# 실제 지도 엔진을 연결한 iPhone 시험

## 최신 장부 소스의 실제 iPhone HTTPS 대기 통과

`tls-queue`의 새 signed Debug 앱에서1개 사례를 통과했습니다. 대기active4/pending2·장부5/4/1280, 완료7송신/6타일/TLS확인7·본문837·장부7/6/1792·idle를 별도 서버와 대조했습니다. 실제 RN native 변환과 SDK 렌더 콜백도 확인했습니다. 서로 다른 두 peak4는 native permit과 서버 응답 본문의 관측이며 모든 TLS socket 수를 뜻하지 않습니다.

신뢰 거절과 첫0HTTP 준비는 제외해 보관했고 같은 빌드의 새run이 통과했습니다. 처음0HTTP의 원인은 확정하지 않았습니다. 최종/제외 Documents4파일과 소스·앱 해시를 확인한 뒤 QA 앱·캐시·서버·임시 키를 정리했고 원래 앱 설치 정보는 같았습니다. 개인 DB·사진·native 인증은 열지 않았습니다. 통과 앱은 `.build/pinned-sdk-tls-queue-native-ledger-20261103/`, 원문은 Git 제외 `sdk-queue-native-ledger-20261103/`입니다. 아래 예전 준비의 NOT RUN을 이번 정확한 소스·범위에서만 갱신합니다. TLS 취소/재실행·HTTP2·제품 JS·공급원/OS 수신량은 여전히 미완료입니다.

## HTTPS에서 추가 요청 대기 준비

`QA_STAGE=tls-queue`는 같은 private origin·DER와 `tls-ledger.json`을 사용합니다. 지도 생성 전에 실제 RN native 변환 규칙이 `multi-entry`를 `multi`로 바꿉니다. 1024pt·zoom2에서 active4/pending1~2의 스냅샷과 최종7요청·6타일·예약1792·TLS 확인7·렌더·빈 대기를 모두 요구합니다. TLS 단계는 신뢰가 고정되지 않은 TPControl과 후속 HTTP 재설정을 사용하지 않습니다. `tls_queue_result.py`의 독립 합성 회귀30개가 장부·PID·pin·서버 TLS·경로·본문·수명을 대조합니다.

실제 TLS fixture의 네 본문은500ms 보류하며 HTTP120ms는 그대로입니다. 서버 peak는 응답 본문의 수명이며 모든 TLS socket 수를 뜻하지 않습니다. 전체 verifier와 signed Debug 빌드는 통과했지만, 현재 사용자 환경은 iPhone cellular/Mac이 같은 iPhone hotspot이고 폰→Mac 경로가 확인되지 않아 **기기0통과**입니다. 준비 앱은 `.build/pinned-sdk-tls-queue-prepared-20261103/`, 제외 결과·장부2개는 로컬 근거에 보관했습니다. SDK TLS 취소/재시작·HTTP2·공급원·OS 수신량의 근거로 확대하지 않습니다.

## 11월 3일: 아이폰의 작은 합성 지도를 HTTPS로 확인했습니다

기존 여행색칠과 분리된 시험 앱에서 **물리 iPhone 1개 사례**를 통과했습니다. 실제 RN native 주소 변환 클래스를 유지한 채 스타일과 타일 2개 요청을 정확한 사설 IPv4·포트와 공개 DER에 고정했습니다. TLS·HTTP/1.1 확인 2회, 시작·반환·송신 2회, 본문307바이트, 장부 requests2/tiles1/reserved512와 마지막 active/pending/unresolved0을 서버와 대조했습니다. 서버의 두 응답도 HTTP/1.1·TLS1.3, 인증·쿠키 없음으로 일치했습니다. 실제 최대 동시는1이며, TLS에서의 네 자리 대기·SDK 취소/재실행·HTTP2·제품 JS·공급원·OS 수신량 검증으로 세지 않습니다.

기존 loopback TLS API와 HTTP 동작은 유지하고 사설 시험 origin을 명시하는 별도 API만 추가했습니다. 최대16KiB DER의 엄격한 base64 입력은 지도 생성 전에 검사하고, origin·인증서·한도는 같은 영속 장부에 묶습니다. 인증서·호스트·leaf와 ALPN 확인을 재사용하며 시스템 신뢰 설정을 바꾸지 않습니다. 단일 `tls-render` 단계는 고정되지 않은 readiness/control 호출과 후속 HTTP 재설정을 건너뜁니다. 제품 앱·의존성과 공급원 다운로드는 연결하지 않았습니다.

처음 OS가 신뢰 설정 때문에 실행을 거절한 준비와, 다음 첫 TLS admission 뒤 송신0·예약256으로 끝난 준비는 제외해 보관했습니다. 후자의 원인은 확정하지 않았습니다. 사용자가 같은 Wi-Fi·로컬 네트워크 허용을 확인한 뒤 같은 빌드의 새 PID/run에서 통과했습니다. 결과를 임의 수정하거나 이 준비들을 기기 통과로 세지 않았습니다.

공통 전체 verifier exit0 PASS: 모바일609/서버61/fixture29/Androidhost118/MacHTTP13+TLS기본7+gate8+private7/기존 보고서13+TLS보고서17/임시 HTTP·SQLite·파일/양쪽 production JS-Hermes. 서버 ALPN/TLS 필드를 추가로 요구하는 최종 TLS 보고서18개와 합계31개 보고서 회귀도 별도 PASS입니다. 서명 Debug 빌드·격리 검사가 통과했고 SDK는 재사용했습니다.

최종·제외 run의 결과와 장부4파일을 대조해 보관했습니다. QA 앱·전용 캐시와 소유 TLS 서버·임시 비공개 키를 정리했고 원래 앱 설치 정보가 같았습니다. 개인 DB·사진·native 인증은 열거나 새로 대조하지 않았습니다. 원문은 Git 제외 `map-sdk-tls-resume-20261103/`입니다. 전체 **24/54**, P3-02 부분 완료/G1~G4 미완료를 유지합니다.

`QA_STAGE=tls-render`, 새 `QA_RUN_ID`, canonical `QA_SERVER_ORIGIN=https://PRIVATE_IPV4:PORT`와 `QA_TLS_LEAF_DER_BASE64`를 실행 환경에 전달합니다. 인증서 DER는 공개 값만 최대16KiB로 받으며 비공개 키는 Mac의 임시 서버에만 둡니다. 이 단계는 한 번의 스타일·타일 렌더 후 끝나며 기존 HTTP queue/cancel 단계와 구분합니다. HTTP stage에 TLS 입력을 섞으면 거절합니다.

`tls_result.py RESULT SERVER --ledger LEDGER --certificate PUBLIC_DER --origin ORIGIN --pid PID`로 보관 파일을 독립 대조합니다. 이 도구의 합성 회귀와 실제 기기 사례를 합치지 않습니다. 인증서 신뢰 방식은 Apple의 [anchor 제한](https://developer.apple.com/documentation/security/sectrustsetanchorcertificatesonly(_:_:))과 [네트워크 가져오기 제한](https://developer.apple.com/documentation/security/sectrustsetnetworkfetchallowed(_:_:)) API를 사용합니다.

## 2026-11-02 취소와 수동 재로딩 통과

새 signed Debug 소스의 물리 iPhone 두 사례가 통과했습니다. `QA_STAGE=cancel-retry`는 한 장부로 진행합니다. 타일 전송 4개·대기 2개를 서버와 함께 관측한 뒤 로컬 빈 `styleJSON`으로 전환해 SDK 취소를 일으킵니다. task나 전송 도구의 취소 함수를 직접 호출하지 않습니다. 네 옛 응답은 본문 없이 닫혔으며 시작한 다섯 요청의 자리 반환과 기존 1,280바이트 예약을 대조했습니다.

이전 응답이 모두 닫힌 뒤 `/release-held`가 0개를 해제했음을 확인하고 같은 스타일 주소를 다시 엽니다. 기존 네 타일 경로를 포함한 여섯 타일이 실제로 재수신됐고 SDK 렌더 완료가 확인됐습니다. 최종 시작·반환·송신은 12회, 본문 1,040바이트, 예약 3,072바이트이며 native와 서버의 최대 동시는 각각 4, 마지막 active/pending은 0입니다. 자동 네트워크 재시도가 아닌 수동 SDK 스타일 재로딩 결과입니다.

원격 빈 스타일을 같은 전송 대기열에 넣었던 첫 준비와 SDK 주석 source/layer까지 0개로 기대했던 다음 준비는 제외해 보관했습니다. 최종 도구는 빈 JSON과 합성 raster 제거를 확인하고 내부 주석 객체의 이름을 별도로 기록합니다. 두 번째 준비의 취소 4/2만으로 전체 통과를 선언하지 않았습니다.

`cancel_result.py`는 결과와 서버 기록, 선택한 PID와 보관 장부를 독립적으로 대조합니다. 전송·대기 수명, 예약 누적, 옛 응답 불변, 실제 같은 경로 재요청과 본문 수가 맞아야 통과합니다. Objective-C 논리식의 정확한 숫자 1 직렬화만 해당 플래그에 허용하며 일반 카운터의 bool은 거절합니다. 합성 보고서 회귀 13개가 통과했으며 기기 사례 수와 합치지 않습니다.

```sh
python3 -B -m unittest discover -s qa/map-transport/ios-maplibre -p 'test_cancel_result.py'
python3 qa/map-transport/ios-maplibre/cancel_result.py RESULT_JSON SERVER_JSON --ledger LEDGER_JSON --pid QA_PID
```

Documents 6개(최종 결과·장부와 제외 두 run의 결과·장부)를 대조한 뒤 QA 앱·전용 캐시·서버를 정리했습니다. 원래 앱 설치 정보는 같고 개인 DB·사진·native 인증은 열거나 새로 대조하지 않았습니다. 통과 앱은 `.build/pinned-sdk-cancel-20261102/`, 원문은 Git 제외 `map-sdk-cancel-resume-20261102/`에 보관합니다. 제품 소스·의존성과 공급원 다운로드는 연결하지 않았습니다.

## 2026-11-01 실제 iPhone 대기열 통과

준비된 `80f4b4d` signed Debug 앱을 변경 없이 재사용해 세 사례를 마쳤습니다. 다중 구간은 실제 타일 6개를 요청했고 native active 4/pending 2를 동시에 관측했습니다. 당시 unresolved 4개·예약 1,280바이트였으며, 완료 뒤 스타일 포함 시작·반환·송신 7회와 예약 1,792바이트, active/pending 0을 확인했습니다. 서버 최대 동시 수는 4였습니다.

단일 합성 지도와 주소 변환·렌더 완료, 외부 타일 전송 전 거절도 통과했습니다. 전체 서버 요청 10개와 native 송신이 같고 인증·쿠키가 없었습니다. 렌더 완료는 SDK 콜백이며 픽셀·사용자 지도 확인이나 SDK 취소·재요청 결과는 아닙니다.

잠금·권한 안내와 네트워크 연결 전 대기, CLI10004/PID 미확인 준비는 요청 0건으로 제외했습니다. 사용자가 같은 네트워크에 연결한 뒤 새 프로세스와 새 run ID로 검사했습니다. 결과·세 장부와 제외 readiness 결과 두 개, 문서 6개를 대조해 보관하고 QA 앱·전용 캐시·소유 서버를 정리했습니다. 원래 앱 설치 정보는 같으며 개인 DB·사진·인증은 열거나 새로 대조하지 않았습니다.

통과 근거는 Git 제외 `map-sdk-queue-physical-20261101/`, 앱은 기존 `.build/pinned-queue-prepared-20261101/MapLibreQA.app`입니다. 새 빌드·SDK 다운로드·앱 사본은 만들지 않았습니다. 아래 준비 단계의 NOT RUN은 이번 결과가 해당 대기열 범위에서 갱신합니다.

## 2026-11-01 다섯 번째 타일 대기 준비

다중 타일 구간의 viewport를 1024×1024pt로 넓혔습니다. 실제 SDK에서 최소 다섯 타일과 native active 4/pending 1 이상의 동시 스냅샷, 렌더 완료와 마지막 빈 대기를 모두 확인해야 통과합니다. 이전 네 타일 결과를 이 조건의 통과로 바꾸지 않습니다.

새 signed Debug 빌드와 정적 격리는 통과했습니다. iPhone 실행은 연결·잠금 해제 답변을 기다리는 **NOT RUN**이며 아직 새 QA 앱을 설치하지 않았습니다. 준비본은 `.build/pinned-queue-prepared-20261101/MapLibreQA.app`, 소스·앱 해시는 Git 제외 `map-queue-qa-20261101/prepared-app.json`에 있습니다. Mac의 별도 대기·취소 13개 결과도 이 기기 검사를 대신하지 않습니다.

기존 여행색칠과 다른 `app.trippainting.maplibreqa` 앱입니다. MapLibre 6.31.0으로 작은 합성 지도를 읽습니다. 계정, 사진, 방문과 위치 기록은 연결하지 않습니다. 지도 캐시도 이 앱의 저장 공간에 새로 생깁니다.

2026-10-31 후속 signed Debug 앱에서는 설치된 RN 11.5.0의 `MLRNTransformRequest.h/.m`을 변경 없이 직접 연결했습니다. 버전과 두 파일의 SHA-256을 고정하고 MIT 라이선스를 앱에 포함합니다. JS/TurboModule wrapper는 연결하지 않았습니다. 실제 iPhone의 새 소스에서 세 가지를 확인했습니다.

- 실제 native 클래스가 `/entry`를 `/sdk`로 바꾸고 SDK delegate로 유지됐습니다. 합성 스타일과 256px 타일, 예상 source/layer와 SDK 렌더 완료 콜백을 확인했습니다. 송신 2회, 본문 306바이트였습니다.
- 줌 2 타일 네 개와 렌더 완료를 확인했습니다. 스타일 포함 송신 5회, 본문 624바이트였고 native permit과 서버의 최대 동시 수신은 모두 4였습니다. 타일이 정확히 네 개여서 다섯 번째 요청의 대기를 증명한 결과는 아닙니다.
- 다른 호스트를 가리키는 타일을 SDK가 요청했을 때 실제 전송 전에 거절했습니다. 이 단계에서 서버에 간 요청은 합성 스타일 하나뿐이었습니다.

서버 총 8개 요청과 native 집계가 같고 합성 인증·쿠키가 없었습니다. 결과와 세 장부, 문서 4개를 대조해 보관한 뒤 시험 앱과 서버를 정리했습니다. 원래 여행색칠의 설치 정보는 같으며 개인 DB, 사진과 인증을 열거나 새로 대조하지 않았습니다. 사용자 요청으로 현재 검사까지 저장하고 중단했습니다. 새 재개 전에는 추가 빌드나 기기 검사를 시작하지 않습니다.

이전 같은 날의 두 사례는 QA sentinel을 사용한 별도 소스입니다. 그때 로컬 네트워크 허용 전 준비는 지도 요청 0건이라 제외했습니다. 이전 결과를 이번 실제 native 클래스의 증거로 합치지 않습니다.

## 범위는 여기까지입니다

이 결과는 작은 네이티브 SDK 시험입니다. React Native의 JS 초기화와 bridge, 글꼴과 아이콘, TLS/HTTP2, 오프라인 팩과 OS 수신량 상한은 아직 확인하지 않았습니다. 위 취소·수동 재로딩은 합성 HTTP/1.1 경로의 결과입니다. 렌더 완료는 SDK 콜백으로 확인했으며 픽셀 검사나 사용자의 화면 확인 결과로 세지 않습니다. 공개 지도 공급원에는 요청하지 않았고 제품 앱에도 연결하지 않았습니다.

`MLNNetworkConfiguration`의 delegate는 native 클래스의 singleton입니다. URL과 header 규칙은 지도 생성 전에만 등록하며 시험 중 배열을 수정하지 않습니다. 세션 설정을 바꿔도 같은 클래스가 유지되고 주소 변환이 서버 도착 경로에 반영되는지 확인했습니다. 설정은 `MLNMapView`와 기본 지도 저장소를 만들기 전에 적용하고 명시적인 합성 스타일로 시작합니다. 위치 표시와 위치 권한 요청은 꺼 둡니다.

## 다시 빌드하려면

`APPLE_TEAM_ID`에 기존 개발 서명 팀을 지정하고 실행합니다.

```sh
bash qa/map-transport/ios-maplibre/build-ios.sh
```

`dependency.json`은 제품에 선언된 것과 같은 6.31.0의 공식 dynamic SDK 주소, 크기와 SHA-256 및 설치된 native 변환 소스를 고정합니다. `prepare-sdk.py`는 약 10.3MB 압축 파일을 대조하고 실제 아이폰용 약 8.8MB만 준비합니다. 기존 SDK를 재사용하며 이번 후속에서는 다운로드하지 않았습니다. 기존 Pods/SPM과 앱 의존성은 바꾸지 않습니다. SDK의 BSD와 RN의 MIT 라이선스를 앱에 포함합니다. 다운로드와 SDK, 서명·빌드 출력은 모두 Git 제외 `.build/`에 둡니다.

아이폰과 Mac은 같은 로컬 네트워크에 연결하고 로컬 네트워크 안내를 허용합니다. 케이블은 설치·관측에 사용하며 합성 HTTP 연결을 대신하지 않습니다. 허용이나 네트워크 준비 전에 끝난 run은 새 프로세스와 새 ID로 다시 시작하고 이전 결과는 제외해 보관합니다.

실행할 때 `QA_SERVER_ORIGIN`과 새 `QA_RUN_ID`를 전달합니다. `QA_STAGE`는 기본 `queue`이며 취소 후 같은 경로를 다시 받는 구간은 `cancel-retry`입니다. 다른 stage는 거절하고, 새 프로세스와 리소스 0건인 새 서버 상태를 요구합니다. 서버는 [sdk-server.mjs](../fixture/sdk-server.mjs)이며 명시적으로 허용한 사설 IPv4의 HTTP만 받습니다. 이미 사용한 시험 이름은 거절하고 결과 파일도 덮어쓰지 않습니다. 현재 앱의 재실행 보존 검사는 별도 범위입니다.

이번 원문은 Git 제외 `docs/test-results/maplibre-transform-qa-20261031/`, 통과 앱은 `.build/pinned-native-transform-20261031/`입니다. 이전 두 사례는 `maplibre-sdk-qa-20261031/`와 `.build/pinned-sdk-20261031/`에 유지합니다. 다음은 [재개 순서](../../../docs/RESUME.md)와 [제품 연결 전 조건](../../../docs/OFFLINE_MAP_TRANSPORT.md)을 따릅니다.
