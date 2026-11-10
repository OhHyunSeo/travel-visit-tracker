# Android 지도 요청의 호스트 검사

JDK 17과 기존 캐시의 OkHttp 4.12.0, Okio 3.6.0, Kotlin stdlib 2.2.21을 사용합니다. 검사 스크립트가 의존성 해시를 확인하고 임시 폴더에서 컴파일합니다. 서버는 `127.0.0.1`의 임시 포트에만 열립니다.

```sh
bash qa/map-transport/android/host-transport/run-tests.sh \
  "$QA_OKHTTP_JAR" "$QA_OKIO_JAR" "$QA_KOTLIN_STDLIB_JAR"
```

`FixtureRequestPolicyTest`는 리소스 분류, 허용 범위와 정확한 헤더를 확인합니다. `FixtureHttpClientTest`는 합성 URL 변환, 원래 인증 헤더 제거, 다른 출처와 리다이렉트 거절, `503 Retry-After: 0`과 변환 interceptor의 중복 호출 때 실제 전송 횟수를 대조합니다. 전송 허용 횟수는 OkHttp Call마다 한 번입니다. 다음 Call까지 묶는 영속 장부와 본문 예산, MapLibre와 Android에서의 동작은 별도 검증 범위입니다.

`FixtureBodyQueueTest`는 비동기 callback 안에서 네 본문을 읽는 동안 두 호출이 대기하는지 서버와 대조합니다. 대기 호출 하나를 취소한 뒤에는 다섯 번째만 도착해야 합니다. 이 동시 수는 비동기 `enqueue`와 callback 내부 본문 읽기·닫기에 적용됩니다.
