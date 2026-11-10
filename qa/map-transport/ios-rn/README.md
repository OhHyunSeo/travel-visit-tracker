# React Native에서 지도 요청 확인하기

작은 React Native 앱에서 실제 MapLibre 지도를 엽니다. 시작할 때 시험용 HTTPS 전송을 먼저 설정하고 MapLibre RN의 URL 변경 기능을 연결합니다. JavaScript는 첫 스타일 주소를 바꿉니다. 지도 렌더가 끝났다는 이벤트를 받으면 빈 스타일을 한 번 더 요청합니다. 서버에서 바뀐 스타일, 타일 한 장, 빈 스타일 순서가 맞고 앱의 요청 장부와도 일치해야 통과입니다.

## Mac에서 실행

기존 여행색칠 개발 환경의 Node 24.21.0, Ruby의 `xcodeproj`, 생성된 iOS Pods·코드와 이미 받은 MapLibre 패키지를 사용합니다. iPhone 17 / iOS 26.2 시뮬레이터 런타임이 필요합니다. 두 명령은 저장소 루트에서 실행합니다.

```sh
bash qa/map-transport/ios-rn/build-simulator.sh my-run
python3 -B qa/map-transport/ios-rn/run-simulator.py \
  qa/map-transport/ios-rn/.build/my-run/DerivedData/Build/Products/Debug-iphonesimulator/TripPainting.app \
  docs/test-results/my-rn-map-run
```

다른 Ruby 설치를 사용한다면 첫 명령에 `TP_RN_RUBY`와 해당 설치의 `GEM_HOME`을 지정할 수 있습니다. 각 실행은 새 이름을 사용하세요. 빌드는 분리된 폴더와 `app.trippainting.rnmapqa` 식별자를 씁니다. 실행 도구는 전용 시뮬레이터를 만들어 127.0.0.1 합성 서버로 요청을 보낸 뒤 자신이 만든 시뮬레이터와 서버를 정리합니다. 보관하는 인증서는 공개 부분입니다.

이 검사는 React Native 초기화, URL 변환, 렌더 이벤트와 시험용 HTTPS 경로를 확인합니다. 실기기, 여행색칠 제품 앱, HTTP/2와 오프라인 지도 저장은 별도 검사입니다.
