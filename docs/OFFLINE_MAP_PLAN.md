# 배경지도와 오프라인 저장 방향

확인일: 2026-10-28, 기준: MapLibre React Native 11.5.0

첫 배경지도 공급원은 **OpenFreeMap 공개 서비스**, 기본 스타일은 **Liberty**로 정했습니다. 도입 조건은 아래의 요청 수와 다운로드 한도를 먼저 집행하는 것입니다. 별도 계정이나 API 키, 필수 구독료가 없고 작은 지역을 미리 받아 쓰는 조건이 공개돼 있어 현재 개발 범위에 맞습니다. [서비스 안내](https://openfreemap.org/), [모바일 연결 안내](https://openfreemap.org/quick_start/)

이 문서로 P3-01의 공급원, 스타일, 다운로드 범위와 비용 결정을 마칩니다. 앱에 배경지도나 다운로드 버튼을 연결한 것은 아닙니다. 현재 방문 지도와 개인 기록은 그대로이며, 실제 다운로드 구현은 P3-02~04와 별도입니다. G1~G4와 기존 계획의 G2 선행 조건도 완료 처리하지 않습니다.

## 후보를 비교한 결과

| 후보 | 확인한 조건과 비용 | 이번 결정 |
| --- | --- | --- |
| OpenFreeMap 공개 서비스 | 무료, 키 불필요, 상업 사용 가능. 작은 오프라인 영역은 명시된 한도 안에서 허용 | 첫 공급원으로 선정. 아래 전송 제어를 갖춘 뒤 연결 |
| Stadia Maps | 무료는 비상업용 20만 credits/월. 상업용 Starter는 현재 US$20/월, 100만 credits. 일반 벡터 타일은 1 credit/타일 | 계정과 키가 필요해 대안으로 보관. 모바일 오프라인 100MB/기기, 캐시 재검증 조건과 한국 관련 약관 문구는 도입 전 별도 확인 |
| MapTiler Cloud | 무료는 비상업/R&D 범위. 일반 온라인 플랜의 캐시 허용과 대량 다운로드 권한은 다름 | 오프라인 일괄 수집은 별도 서면 합의가 필요하므로 이번 선택에서 제외 |
| OSM 표준 공개 타일 서버 | OSM 데이터 라이선스와 서버 이용 권한은 별개 | 공개 서버의 사전 수집, 오프라인 다운로드 금지로 제외 |
| 직접 운영하는 벡터 타일 서버 | 지역 데이터, 서버, 저장 공간과 배포 운영을 직접 마련해야 함 | 후속 대안. 현재 Mac에서 전 세계 자료를 받거나 새 서버를 만들지 않음 |

근거: [OpenFreeMap](https://openfreemap.org/), [Stadia 요금](https://stadiamaps.com/pricing/), [Stadia 오프라인 안내](https://docs.stadiamaps.com/tutorials/offline-maps-with-flutter-maplibre-gl/), [Stadia 약관](https://stadiamaps.com/terms-of-service/), [MapTiler Cloud 약관](https://www.maptiler.com/terms/cloud/), [OSM 타일 정책](https://operations.osmfoundation.org/policies/tiles/).

가격은 확인일의 표시 금액이며 세금, 통신 요금과 별도 인프라 비용을 합산한 견적은 아닙니다. 이번 작업에서는 가입, 결제, 구독이나 공급원 문의를 하지 않았습니다.

## 처음 제공할 범위

한 번에 사용자가 고른 시군구 하나의 경계 상자를 받습니다. 첫 확대 범위는 **줌 8~12**로 제한합니다. 전국 일괄 저장이나 위성 지도는 첫 범위에 넣지 않습니다. 팩 밖이나 저장하지 않은 확대 수준에서는 기기에 담긴 방문 경계 지도를 계속 사용할 수 있게 합니다.

[OpenFreeMap 약관](https://openfreemap.org/tos/)은 다운로드당 3,000타일 또는 50MB, 동시 요청 최대 4개와 앱을 식별하는 User-Agent를 명시합니다. 앱은 해석의 여유를 이용해 범위를 늘리지 않고 **2,500타일 이하와 50,000,000바이트 이하를 모두 만족**하는 쪽으로 설계합니다. MB를 MiB로 확대하지 않습니다. 한 번에 활성 다운로드는 하나이며, 한도를 맞출 수 없으면 영역이나 확대 수준을 줄여 다시 선택하게 합니다.

2,500은 앱이 정한 보수적인 타일 목표이지 공급원이 정한 새 한도가 아닙니다. 단말의 앱 관리 지도 저장 목표는 우선 200MB로 두되, SDK 공유 캐시와 DB 여유 공간까지 실제로 제한할 수 있는지는 P3-03에서 확인합니다. 공간 확보를 위해 원래 방문, 사진이나 출처가 불명확한 캐시를 자동 삭제하지 않습니다.

같은 타일의 재요청도 예산에 포함하고, 스타일과 글꼴, 아이콘, 실패 응답과 재시도의 본문도 바이트 예산에서 뺍니다. HTTP/TLS 전체 통신량이나 SDK의 압축 저장 크기와 동일한 지표라고 표시하지 않습니다. 중단 뒤에도 같은 다운로드의 사용량을 유지하며, ID를 바꿔 한도를 초기화하는 방식으로 제한을 피하지 않습니다. 구체적인 계측과 저장 보장은 다음 구현에서 검증합니다.

기존 2020년 개발용 경계 228개의 상자를 이용해 줌 8~12를 계산했습니다. 각 변에 타일 하나를 더하고 낮은 줌의 래스터 조상도 포함한 계획 견적은 강남구 64개, 제주시 181개, 가장 넓게 나온 옹진군 663개였습니다. 이는 타일 좌표를 계산한 값이며 실제 SDK 요청 수나 파일 용량 측정이 아닙니다. 스타일, 글꼴과 아이콘 파일의 바이트는 추가로 계산해야 합니다.

## 스타일과 출처를 함께 보관

기본 스타일 주소는 `https://tiles.openfreemap.org/styles/liberty`입니다. 확인한 응답은 스타일 v8이며 벡터 지도와 낮은 줌의 Natural Earth 래스터, Noto Sans 글꼴과 아이콘을 함께 참조했습니다. 벡터 원본 TileJSON은 줌 0~14를 안내했지만, 첫 앱 팩은 위의 8~12만 요청합니다. [공식 연결 예시](https://openfreemap.org/quick_start/)

다운로드 팩에는 공급원, 경계 팩 ID, 영역, 줌, 스타일 해시와 원본 타일 버전을 남깁니다. 스타일이나 타일 버전이 바뀌면 기존 팩에 새 자료를 섞어 완료로 표시하지 않습니다. 로컬 스타일 사본과 그 스타일을 사용한 팩, 화면의 지도도 같은 버전으로 연결해야 합니다. 이 버전 고정과 갱신 처리는 P3-02~03의 구현 항목입니다.

배경지도 출처는 `OpenFreeMap`, `© OpenMapTiles`, `OpenStreetMap contributors`와 각 링크를 표시합니다. OSM 데이터의 ODbL 안내와 스타일의 BSD/CC BY, 글꼴의 OFL 등도 별도로 유지합니다. OpenFreeMap 프로젝트가 MIT라는 이유로 지도와 모든 부품을 MIT로 표시하지 않습니다. [출처 안내](https://openfreemap.org/), [부품별 라이선스](https://github.com/hyperknot/openfreemap-styles/blob/main/LICENSE.md), [OSM 데이터 라이선스](https://www.openstreetmap.org/copyright)

현재 `RegionMap.native.tsx`는 배경 타일이 없는 자체 스타일에서 출처 버튼을 숨깁니다. 외부 배경지도를 연결할 때는 이 설정을 바꾸거나 동등한 표시를 제공해야 합니다. 현재 경계 팩의 geoBoundaries 출처, 2020년 기준과 228개 분모도 별도로 남깁니다. 배경 타일이 바뀌어도 방문 ID와 사진 연결을 바꾸지 않습니다.

## SDK에서 추가로 해결할 부분

설치된 SDK와 공식 소스를 읽어 확인한 내용입니다. 기기에서 다운로드를 시험한 결과는 아닙니다.

| 항목 | 확인한 점 | 구현 전 필요한 확인 |
| --- | --- | --- |
| 팩 생성 | `OfflineManager.createPack`은 스타일 URL, 경계, 줌으로 팩을 만들며 ID로 관리. iOS wrapper는 생성 뒤 바로 다운로드를 재개 | 통신 제어와 범위 검사는 `createPack` 전에 완료. 영속 manifest와 같은 ID를 연결하고 중단, 재실행, 실패를 시험 |
| 앱 식별 | `TransformRequestManager.addHeader`는 주소 패턴별 헤더를 지원 | OpenFreeMap 리소스 주소에만 고정 앱 User-Agent를 보내는지 실제 HTTP로 확인. 계정 토큰과 기기 고유 ID는 붙이지 않음 |
| 요청 4개 | 공개 JS API에는 동시 요청 수 설정이 없음. Android 헤더 기능이 설치하는 client는 호스트별 기본값 20 | 헤더 초기화와 충돌하지 않는 네이티브 요청 제어를 구현하고 스타일, 타일, 글꼴, 아이콘을 합친 동시 수를 측정 |
| 타일 제한 | JS `setTileCountLimit`는 하위의 Mapbox/canonical 타일 집계로 연결됨 | 일반 OpenFreeMap HTTPS 타일의 한도로 사용하지 않음. 모든 소스의 좌표 범위를 사전 계산하고 실제 전송 경계에서 보장 |
| 용량 제한 | 진행 이벤트의 완료 크기는 사후 저장 통계이며 네트워크 바이트 예산과 같지 않음 | 진행 이벤트 뒤 `pause()`만 호출해 정확한 50MB 상한을 보장했다고 하지 않음. 요청과 응답을 제어하는 계층에서 예산 집행 |
| 삭제와 공간 | 팩 삭제는 공유 리소스를 즉시 모두 지운다는 뜻이 아님 | 앱 소유 manifest와 사용자가 고른 팩만 대상으로 삼음. `resetDatabase`나 전체 캐시 지우기로 공간을 강제 확보하지 않음 |

SDK 근거: [OfflineManager](https://maplibre.org/maplibre-react-native/docs/modules/offline-manager/), [요청 헤더 API](https://maplibre.org/maplibre-react-native/docs/modules/transform-request-manager/), 설치된 `src/modules/offline`과 Android/iOS wrapper. iOS 6.31.0의 [네트워크 설정](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/darwin/src/MLNNetworkConfiguration.h)은 세션 설정을 지도와 OfflineStorage 생성 전에 적용하도록 안내합니다. 그 설정만으로 요청 4개가 보장된다는 검증은 아직 없으며, RN의 기존 요청 변환 delegate도 보존해야 합니다.

Android에서는 [공통 HTTP client를 교체하는 경로](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/module/http/HttpRequestUtil.java#L41)가 있습니다. 다만 RN에서 첫 요청 변환이나 헤더를 등록할 때 client를 새로 설치하므로 초기화 순서도 해결해야 합니다. 타일의 [전역 canonical 집계](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/default/src/mln/storage/offline_database.cpp#L1454), [저장 크기 통계](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/default/src/mln/storage/offline_database.cpp#L308)를 공급원의 다운로드별 제한과 혼동하지 않습니다. 이 검토는 선언된 Android Native 13.6.1, OkHttp 4.12.0 기준의 소스 조사이며 새 빌드나 동작 시험이 아닙니다.

이 조건을 충족하기 전에는 OpenFreeMap을 향한 자동 타일 다운로드를 켜지 않습니다. 반복 다운로드로 한도를 나누어 피하거나 서버 프록시로 이용 조건을 우회하는 방식도 쓰지 않습니다. 네이티브 변경이 필요하면 `app.config.ts`와 config plugin 또는 관리되는 모듈에 선언하고 생성 폴더를 직접 고쳐 저장하지 않습니다.

## 다음 구현과 확인 순서

1. **P3-02 준비:** 통제된 작은 시험 서버에서 앱 식별값, 실제 동시 요청 수와 바이트 제한을 먼저 확인합니다. 개인 방문 DB와 MapLibre의 기존 저장소를 보존하고 별도 시험 공간을 마련합니다.
2. **P3-02:** 경계 팩과 별도인 배경지도 manifest, 지역 선택, 예상 범위, 저장 상태와 명시적 시작을 연결합니다. 사용자에게 보이는 안내는 지역, 데이터 사용과 저장 공간 중심으로 작성합니다.
3. **P3-03:** 다운로드 중단과 재개, 버전 변경, 공간 부족과 사용자가 요청한 팩 삭제를 구현합니다. 실패한 팩을 완료로 표시하지 않고 기존 방문, 사진과 완료 팩을 유지합니다.
4. **P3-04:** 실제 iPhone과 Android에서 비행기 모드, 재실행, 한글 글꼴과 아이콘, 영역 밖의 표시를 확인합니다. 온라인에서도 요청 주소로 열람 지역이 추정될 수 있으므로 첫 연결과 저장 안내에 공급원과 데이터 사용을 알립니다.

공식 문서 조사 외에 지도 서비스에서 직접 읽은 리소스는 공개 스타일 JSON 43,311바이트와 TileJSON 19,254바이트뿐입니다. 타일, 글꼴, 아이콘 다운로드와 휴대폰 실행, 빌드, 설치는 하지 않았습니다. 세부 메타데이터와 해시는 이 PC의 Git 제외 `docs/test-results/offline-provider-review-20261028/`에 보관합니다.
