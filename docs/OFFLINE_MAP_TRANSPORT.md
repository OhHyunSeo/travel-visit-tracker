# 오프라인 지도 요청 제어 검토

## 10월 31일 후속: 실제 native 요청 변환 클래스

별도 iPhone 앱에 설치된 RN 11.5.0의 변경 없는 `MLRNTransformRequest.h/.m`을 직접 연결하고 버전·SHA-256·MIT 라이선스를 고정했습니다. JS/TurboModule wrapper는 연결하지 않았습니다. 지도 생성 전 클래스가 설치한 delegate를 유지하며 세션 설정을 적용했습니다. 물리 iPhone 새 소스 세 사례에서 주소 변환과 렌더 완료, 줌 2 타일 네 개의 native/server 최대 동시 4, 정확한 외부 타일의 전송 전 거절을 확인했습니다. 서버 총 8개 요청과 native 집계가 같고 합성 인증·쿠키가 없었습니다.

타일은 정확히 네 개였으므로 다섯 번째 요청이 기다리는 증거는 아닙니다. 글꼴·아이콘, 취소·재요청, JS 초기화와 제품 통합, TLS/HTTP2, 영속 다운로드 예산과 OS 수신량은 남아 있습니다. 렌더 완료는 SDK 콜백이며 픽셀·사용자 수용과 구분합니다.

Android는 실제 32MiB 제한 안에서 cached emulator의 `-version`만 실행했습니다. 37.2.12.0 출력과 종료, SDK 해시와 저장소 정리, 호스트 61개가 통과했습니다. 새 AVD 생성·부팅, ADB와 앱 native 검사는 0개이며 전체 emulator 강제 제한과 1GiB fresh 준비는 미완료입니다. 사용자 요청으로 현재 검사까지만 저장하고 중단합니다. 공급원 다운로드를 켜지 않으며 **24/54**, P3-02 부분 완료와 G1~G4 미완료입니다.

확인일: 2026-10-29. 설치된 MapLibre RN 11.5.0, 선언된 iOS 6.31.0, Android 13.6.1과 OkHttp 4.12.0 기준입니다.

P3-02를 시작하며 양쪽 네이티브 확장 경로와 공통 사전 계산을 검토했습니다. **제품 MapLibre의 통신 제한은 아직 구현하거나 검증하지 않았습니다.** 현재 지도는 기존 경계 지도를 유지하며 공급원 다운로드를 시작하지 않습니다. [공급원 선정과 예산](OFFLINE_MAP_PLAN.md)의 조건도 유지합니다.

## 10월 31일 실제 SDK의 작은 범위 확인

[별도 iPhone 앱](../qa/map-transport/ios-maplibre/README.md)에 공식 체크섬으로 고정한 MapLibre 6.31.0 dynamic SDK를 넣었습니다. 물리 iPhone signed Debug에서 합성 스타일·PNG를 받아 기대 source/layer와 렌더 완료 콜백을 확인했고, 외부 타일은 전송 전에 거절했습니다. 서버 도착은 합성 리소스 3건이며 인증·쿠키가 없었습니다. 기존 delegate 역할의 QA sentinel을 유지한 채 주소 변환도 반영됐습니다. 실제 RN 모듈, 글꼴·아이콘·여러 타일의 동시 처리, TLS/HTTP2와 OS 수신량 상한은 미검증입니다.

[6.31.0 세션 설정](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/darwin/src/MLNNetworkConfiguration.h)은 지도와 offline storage 생성 전에 적용하도록 명시합니다. 새 앱은 이 순서를 지키고 명시적 스타일로 시작했습니다. 기본 캐시는 새 QA bundle의 앱 내부에 만들어졌고, 원래 앱의 지도 저장소는 열지 않았습니다. 렌더 콜백을 픽셀 검사나 실제 여행 지도 표시 수용 결과로 세지 않습니다.

Android는 32MiB 고정 HFS 공간과 Python worker/child의 쓰기 제한 구성요소를 실제로 확인했습니다. ENOSPC와 복구, 외부 open/create/symlink 거절, worker FD 미상속 및 이미지 크기·할당량 유지와 정리까지 통과했습니다. 실제 emulator와 전체 1GiB 준비의 증거는 아닙니다. 전체 verifier 609/61, 합성 서버 17개와 호스트 49개/Mac 10개도 통과했으며 **24/54**, P3-02 부분 완료와 G1~G4 미완료를 유지합니다.

## 10월 30일 후속 재개: 단일 HTTP 송신 시험

이전 저장본 `34d5031`의 CI41003544861은 통과했습니다. 별도 iOS 시험 경로에서 전달용 NSURLSession을 새 TCP 연결과 한 번의 HTTP/1.1 쓰기로 바꿨습니다. 장부를 먼저 저장한 뒤 송신하고 연결의 취소 완료까지 자리를 유지합니다. 같은 소스의 Mac native 검사 10개에서 실제 부분 EOF 뒤 재전송 없음, 재시도 뒤 예약 유지와 한도 초과 거절, 최대 동시 4개와 잘못된 응답 거절을 확인했습니다. 이는 사설 HTTP 합성 서버의 결과입니다.

Apple의 [QA1941](https://developer.apple.com/library/archive/qa/qa1941/_index.html)은 URLSession의 idempotent 요청이 일부 조건에서 자동으로 재시도될 수 있음을 설명합니다. 이번 [Network framework](https://developer.apple.com/documentation/network) 실험은 그 전달 계층을 분리해 관찰하기 위한 것입니다. 일반 HTTP 구현으로 채택한 것이 아니며 HTTPS, HTTP/2와 실제 MapLibre 재요청은 연결하지 않았습니다. 같은 signed Debug 소스의 물리 iPhone 기본 11개와 실제 QA SIGKILL/새 PID 장부 1개도 통과했습니다. 미확정 256을 남기고 새 256을 추가했으며 이전 13개나 Mac의 부분 EOF 결과로 대신하지 않습니다.

Android에는 cached SDK와 여유 공간을 읽기만 하는 준비 점검을 추가했습니다. 실제 제한 backend가 없는 동안 숫자 marker만으로 native 실행에 들어갈 수 없도록 거절합니다. 최종 호스트 검사는 39개이고 원래 AVD의 현재 세 해시는 이전 종료값과 같습니다. 과거 차이의 원인은 여전히 미확정입니다. 새 AVD나 emulator, ADB는 실행하지 않았고 1GiB의 실제 강제 제한은 아직 입증하지 못했습니다.

제품 다운로드는 계속 꺼져 있으며 **24/54**, P3-02 부분 완료와 G1~G4 미완료를 유지합니다. TCP callback의 수신량을 OS 전체 수신량으로, 새 경로의 한 번 쓰기를 공급원과 SDK 전체의 교환 제어로 바꾸어 보고하지 않습니다.

## 10월 30일 별도 iPhone 실행과 Android 보호 장치

iPhone 시험 앱을 UIScene으로 바꿔 시작 오류를 수정했습니다. 실제 아이폰에서 기본 11개, 완료 후 홈 화면 복귀와 실제 강제 종료 후 새 프로세스 재실행 2개를 통과했습니다. 본문 수명 최대 4개와 응답 거절, 예약 보존을 확인했으며 재실행에서는 이전 미확정 256바이트를 남긴 채 새 요청 뒤 총 512바이트가 됐습니다. 같은 요청의 재전송을 증명한 것은 아닙니다.

Android에는 일반 AVD를 거절하는 실행 전 보호 장치를 추가했고 호스트 25개가 통과했습니다. 실제 emulator에서의 보호 장치와 새 native 재검사는 NOT RUN입니다. 현재 이미지 세 파일은 이전 종료 해시와 같지만 과거 QCOW2의 전후 차이 원인은 미확정입니다. 증가량을 독립적으로 확인할 수 없는 상태에서는 새 AVD를 생성하거나 이전 환경을 켜지 않았습니다.

전체 verifier도 609/61, 합성 서버 11개와 환경 보호 25개, 임시 HTTP/SQLite와 양쪽 JS/Hermes까지 통과했습니다. 사용자가 현재 부분까지 저장하도록 요청해 소유 환경을 정리하고 중단했습니다. 이 결과는 아래 제품 MapLibre 경로의 NOT RUN을 갱신하지 않습니다. 특히 iOS의 전달 task 장부를 내부 재시도마다의 교환 집계로 세거나 양쪽의 받아들인 본문을 OS 수신량 상한으로 표시하지 않습니다.

## 10월 29일 후속 시험과 중단 지점

MapLibre 없이 별도 저장 공간에서 전송부터 확인하는 [시험 도구](../qa/map-transport/README.md)를 추가했습니다. 합성 서버 11개를 공통 verifier에 포함했고 전체 검사 609/61과 임시 HTTP/SQLite, 양쪽 JS/Hermes도 통과했습니다. Android API37 Debug의 별도 OkHttp 여섯 묶음은 통과했습니다. iPhone은 서명 빌드를 마쳤지만 legacy 화면 시작이 UIKit `NoSceneLifecycleAdoption`에서 종료돼 통신 대상은 NOT RUN입니다.

Android 원래 앱의 추적 파일 11개와 APK, UID, 네트워크와 화면 설정은 같았습니다. 기존 AVD의 QCOW2 해시는 달라 전체 이미지 보존은 미확인으로 남겼습니다. base 이미지와 설정은 같고 변경 원인은 확정하지 못했습니다. 원본을 덮어쓰거나 삭제하지 않았으며 다음 실행은 별도 QA AVD를 먼저 준비합니다. iPhone 원래 앱은 설치 정보만 대조했고 개인 저장소와 인증은 열지 않았습니다.

iOS 후보의 장부는 전달 task 단위여서 NSURLSession 내부의 투명한 재시도마다 집계하는 강제 지점은 없습니다. Android의 교환 검사와 같은 보장으로 합치지 않습니다. 양쪽 모두 OS 수신량 상한이나 실제 MapLibre 연결의 통과로 세지 않습니다. 사용자가 현재 부분까지 저장, 중단을 요청했고 소유 환경을 종료했습니다. 다음 재개는 iPhone UIScene 시작 오류와 Android AVD 분리부터입니다.

## 이번에 추가한 공통 코드

`src/domain/backgroundMapPlan.ts`는 앱에 포함된 지역 하나를 받아 줌 8~12 안에서 배경지도 계획을 만듭니다. 경계 팩의 ID와 버전, 지역과 경계 상자, 스타일 SHA-256과 타일 버전 문자열을 함께 남깁니다. 사방에 타일 하나씩 여유를 둔 좌표 범위와 낮은 줌의 래스터 여유분을 계산하며, 계획 견적이 2,500개를 넘으면 거절합니다.

저장 형태의 JSON을 다시 읽을 때는 현재 경계 자료로 계산을 되풀이해 범위, 수량과 버전을 대조합니다. 잘못된 값, 미지원 형식, 오래된 경계나 정책 버전, 추가 필드를 그대로 받아들이지 않습니다. 결과는 복사해 변경을 막으며 개인 DB, 사진이나 인증을 열지 않습니다.

이 코드는 순수한 사전 계산입니다. 아직 화면, SQLite 저장, 다운로드나 SDK 팩 생성에 연결하지 않았습니다. 스타일 해시와 타일 버전은 입력 형식을 검사할 뿐 실제 받은 파일의 해시를 검증한 결과가 아닙니다. 타일 견적도 SDK의 추가 요청이나 재시도를 막는 장치가 아니며, 요청 수와 전송량의 강제 제한으로 표시하지 않습니다.

## iOS 후보

MapLibre 전용 `NSURLSessionConfiguration.protocolClasses`에 공급원 주소만 처리하는 `NSURLProtocol`을 넣는 경로를 우선 시험할 수 있습니다. 설정은 지도와 `MLNOfflineStorage` 생성 전이어야 합니다. 설치된 RN `MLRNTransformRequest.m:144–150`이 사용하는 기존 요청 변환 delegate는 보존합니다.

[MLNNetworkConfiguration.h](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/darwin/src/MLNNetworkConfiguration.h)는 외부 세션의 `NSURLSessionDataDelegate`를 지원하지 않는다고 명시합니다. 또한 [기본 HTTP 구현](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/darwin/core/http_file_source.mm#L295)은 전체 본문을 받은 completion 뒤 delegate에 응답을 전달하므로, 기존 응답 delegate에서 본문 수신을 실시간 제한할 수 없습니다.

후보 protocol은 별도 전달 세션으로 요청하고, 전역 대기열이 완료나 취소까지 자리를 유지하도록 해야 합니다. 세션별 연결 수 설정만으로 전역 동시 요청 4개를 보장하지 않습니다. 전달 세션에는 같은 protocol을 넣지 않아 재귀를 막고, 쿠키와 계정 인증 저장소를 사용하지 않으며 redirect는 자동 추적하지 않거나 매 경유지를 다시 검사해야 합니다. 이 방식의 SDK 호환성은 미검증입니다.

## Android 후보

[ModuleProvider.createHttpRequest](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/ModuleProvider.java)에서 자체 `HttpRequest`를 제공하고 전용 client를 소유하는 공개 확장 경로가 있습니다. [NativeHttpRequest](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/NativeHttpRequest.java#L13)는 이 구현을 만들고 `offlineUsage`를 전달합니다.

이 경로는 RN의 첫 헤더 등록이 공용 HTTP client를 교체하는 문제를 피하는 후보입니다. 기존 library loader에 위임하고 초기화 순서를 지켜야 하며, RN의 `TransformRequestInterceptor`도 유지해야 합니다. SDK 내부 클래스에 결합하므로 버전이 바뀌면 다시 확인합니다.

전용 OkHttp의 전역과 호스트별 dispatcher를 모두 4로 제한할 수 있습니다. 현재 [기본 callback](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/module/http/HttpRequestImpl.java#L132)은 본문을 읽고 닫을 때까지 반환하지 않습니다. 이 수명과 제한을 실제 HTTP로 확인해야 하며, 별도 비동기 작업으로 본문을 넘기거나 동기 `execute()`를 사용하면 같은 근거를 적용할 수 없습니다.

재시도와 redirect를 포함한 매 network exchange에서 주소, 앱 식별값과 예산을 검사해야 합니다. application interceptor 한 번만 세거나 `retryOnConnectionFailure=false`만 설정하는 것으로 충분하다고 하지 않습니다. [OkHttp follow-up 구현](https://github.com/lysine-dev/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt#L255)을 함께 검토했습니다.

## 공통으로 해결해야 할 점

| 항목 | 다음 구현 조건 |
| --- | --- |
| 다운로드 귀속 | URL만으로 SDK pack ID를 알 수 없음. 초기에는 단일 활성 작업의 장부를 열고 모든 공급원 요청을 그 예산에 합산. 다운로드 중 지도는 기존 경계 지도를 유지 |
| 요청 분류 | 고정된 스타일, 타일 버전과 좌표, 글꼴, 아이콘만 허용. 추가 줌, prefetch, 미확인 주소와 다른 호스트는 전송 전 거절 |
| 앱 식별 | 공급원 요청에만 고정 앱 User-Agent. 계정 토큰, 쿠키, 기기 식별값은 보내지 않음 |
| 재실행 | 전송 전에 타일 시도와 보수적 바이트 예약을 영속 기록. 중단 뒤 불확실한 예약을 환급하거나 작업 ID 변경으로 예산을 초기화하지 않음 |
| 본문 용량 | SDK에 전달한 바이트와 OS가 이미 받은 바이트를 구분. 길이 미지정, 압축, 오류 본문, redirect와 동시 요청의 예약 정책을 먼저 확정 |

본문을 읽다가 상한에서 취소하는 것만으로 실제 수신량의 정확한 상한을 증명하지 못합니다. iOS 전달 세션에도 버퍼링이 있으며 Android의 [HTTP/2 수신 버퍼](https://github.com/lysine-dev/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http2/Http2Stream.kt#L417), [HTTP/1 close 시 남은 본문 처리](https://github.com/lysine-dev/okhttp/blob/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/internal/http1/Http1ExchangeCodec.kt#L390)도 고려해야 합니다. 이 문제를 해결하기 전에는 accepted-body 계측만으로 공급원 용량 조건을 보장했다고 표시하지 않습니다.

## 기존 지도 저장소를 보호하는 시험 방식

새 파일 경로만 지정하면 격리가 끝난다고 가정하지 않습니다. iOS [MLNOfflineStorage 초기화](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/darwin/src/MLNOfflineStorage.mm#L244)는 custom 대상이 없으면 기존 legacy DB를 그곳으로 옮기려고 합니다. Android의 [캐시 경로 설정](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/storage/FileSource.java#L277)도 전역 singleton과 저장 설정에 영향을 주며, RN 지도 모듈은 일찍 초기화됩니다.

첫 네이티브 시험은 **다른 bundle/application ID와 별도 앱 저장 공간**을 쓰는 방식으로 준비합니다. 개인용 앱의 DB 경로를 바꾸거나 전체 캐시를 초기화하지 않습니다. 시험용 식별자는 기존 계정, Keychain 그룹과 위치 기록 작업을 공유하지 않게 검토하고, 새 빌드 전 디스크 여유와 소유 산출물 목록을 확인합니다. 재사용할 native 변경은 관리되는 모듈과 config plugin에 둡니다.

제품의 RN MapLibre 통합 경로에 대한 통제 서버 시험은 다음 순서로 진행합니다. 별도 iPhone native SDK의 작은 두 사례와 Android 전송 도구를 제품 수용으로 대신하지 않으며 제품 RN 경로는 아직 **NOT RUN**입니다.

1. 외부 공급원 주소를 허용하지 않으며 실제 MapLibre를 포함하는 별도 시험 앱을 준비합니다. 현재 작은 전송 앱과 합성 서버를 바탕으로 기존 DB, 사진, 인증, MapLibre 저장소를 건드리지 않는지 먼저 확인합니다.
2. 스타일, 타일, 글꼴과 아이콘을 함께 대기시켜 실제 응답 본문 수명 동안 최대 4개인지 측정합니다. 취소와 늦은 callback에서도 자리가 두 번 반환되지 않아야 합니다.
3. 식별값의 범위, 다른 호스트 redirect, SDK 자동 재시도, 미지원 URL과 추가 타일의 거절을 서버 요청 기록으로 확인합니다.
4. 고정 길이와 미지정 길이, 압축, 오류 본문을 작은 합성 한도로 시험합니다. SDK 전달량과 서버 송신량을 따로 기록하고, 실제 수신량 보장이 남아 있으면 통과로 세지 않습니다.
5. 앱 중단과 재실행 뒤 같은 장부, 사용량과 불확실한 예약을 유지하는지 확인합니다. 개인 앱과 시험 앱의 저장 공간 분리도 다시 대조합니다.

이 검토와 사전 계산만으로 P3-02를 완료하지 않습니다. 전체 **24/54**, P3-02~04와 G1~G4 미완료를 유지합니다. 실제 공급원 트래픽과 휴대폰 네이티브 검증은 다음 구현에서 별도 결과로 기록합니다.
