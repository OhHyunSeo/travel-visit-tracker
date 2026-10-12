# 개발용 한국 경계 팩

자료: [geoBoundaries gbOpen KOR ADM2](https://www.geoboundaries.org/api/current/gbOpen/KOR/ADM2/). 앱에 포함한 도형은 사각형 목업 대신 실제 Polygon / MultiPolygon 지도를 개발·검증하기 위한 자료이다.

| 항목                | 값                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 경계 기준 연도      | 2020                                                                                                                                      |
| 자료 ID             | KOR-ADM2-91817680                                                                                                                         |
| 고정 다운로드       | [Git 9469f09의 GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KOR/ADM2/geoBoundaries-KOR-ADM2.geojson) |
| API 안내 지역 수    | 229                                                                                                                                       |
| 실제 파일의 지역 수 | 228                                                                                                                                       |
| 파일 형식           | EPSG:4326 경위도, GeoJSON Polygon / MultiPolygon                                                                                          |
| 출처 표기           | geoBoundaries / citypopulation.de                                                                                                         |
| 원본 라이선스 안내  | Creative Commons Attribution 3.0                                                                                                          |
| 앱 보관 파일        | korea-adm2.json, korea-adm2.metadata.json                                                                                                 |

앱의 비율 분모는 실제 파일의 228개이며 현재 대한민국의 공식 시·군·구 수라고 표현하지 않는다. 표시 이름 일부를 한국어로 바꾸고 방문·선택 여부를 런타임 속성으로 추가하지만 원본 도형은 보존한다.

원본 API 메타데이터와 실제 다운로드 수, 저장 파일 해시는 metadata에 남겼다. geometry 검사에서는 닫힌 ring, 좌표 범위, 고유 ID, hole / MultiPolygon 처리와 강남구 내부 좌표를 확인한다.

지역 ID는 현재 자료의 `shapeID`에 `gb:`를 붙인다. 이 ID가 다음 경계 버전과 동일하다고 가정하지 않는다. 출시용 최신 데이터의 행정 코드, 누락 여부와 사용 조건을 확인하고 기존 ID의 변환표를 마련해야 P1-07을 완료할 수 있다.

자료를 사용할 때 [원본 출처의 이용 조건](https://www.citypopulation.de/en/help/termsofuse/)과 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 표기를 함께 유지한다. 현재 앱 지도와 설정에 출처와 기준 연도를 표시한다.
