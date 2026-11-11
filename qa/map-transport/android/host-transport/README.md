# Android 지도 요청의 호스트 검사

JDK 17과 기존 캐시의 OkHttp 4.12.0, Okio 3.6.0, Kotlin stdlib 2.2.21을 사용합니다. 검사 스크립트가 의존성 해시를 확인하고 임시 폴더에서 컴파일합니다. 서버는 `127.0.0.1`의 임시 포트에만 열립니다.

```sh
bash qa/map-transport/android/host-transport/run-tests.sh \
  "$QA_OKHTTP_JAR" "$QA_OKIO_JAR" "$QA_KOTLIN_STDLIB_JAR"
```

`FixtureRequestPolicyTest`는 리소스 분류, 허용 범위와 정확한 헤더를 확인합니다. `FixtureHttpClientTest`는 합성 URL 변환, 원래 인증 헤더 제거, 다른 출처와 리다이렉트 거절, `503 Retry-After: 0`과 변환 interceptor의 중복 호출 때 실제 전송 횟수를 대조합니다. 전송 허용 횟수는 OkHttp Call마다 한 번입니다. 다음 Call까지 묶는 영속 장부와 본문 예산, MapLibre와 Android에서의 동작은 별도 검증 범위입니다.

`FixtureBodyQueueTest`는 비동기 callback 안에서 네 본문을 읽는 동안 두 호출이 대기하는지 서버와 대조합니다. 대기 호출 하나를 취소한 뒤에는 다섯 번째만 도착해야 합니다. 이 동시 수는 비동기 `enqueue`와 callback 내부 본문 읽기·닫기에 적용됩니다.

`FixtureBody`는 한 응답의 예약 범위 안에서 정상적인 identity 본문을 전부 읽고 확인한 뒤 반환합니다. `FixtureHttpClientTest`는 localhost의 크기 초과·chunked·gzip 헤더와 메모리의 길이 불일치를 거절하는지 확인합니다. 이 상한은 검사 코드가 수락하는 본문에 적용됩니다. 운영체제와 OkHttp가 먼저 받아 둔 바이트는 측정하지 않습니다.

`FixtureCancellationTest`는 전송 중 취소로 본문이 닫힌 뒤에도 callback 반환까지 자리를 유지하는지 확인합니다. 대기한 다섯 번째 요청의 서버 도착, 중복 취소의 callback 횟수와 자동 재전송 여부를 함께 대조합니다.

`FixtureBudgetTest`는 세션의 전체 시도·타일 시도·고정 바이트 예약을 전송 전에 차감하고 완료 후에도 유지하는지 확인합니다. 같은 타일 경로를 반복하는 새 Call도 예약을 사용합니다. 이 단계의 메모리 상태는 재실행 때 보존되지 않습니다.

전용 client는 응답을 `FixtureBody.guard`로 감싸 callback이 보는 스트림에 요청별 예약을 적용합니다. 응답이 거절돼도 선행 예약을 유지합니다.

`FixtureBudget.open`은 private 디렉터리의 고정 파일에 예약을 append하고 강제 저장합니다. 같은 장부의 중복 writer, 설정 변경과 불완전한 기록을 거절합니다. 호출자는 client가 끝난 뒤 budget도 닫아 파일 lock을 해제합니다. `FixtureJournalTest`가 재개방, 전송 전 기록, 동시 예약과 잘린/손상된 장부를 검증합니다. 테스트는 소유 임시 파일만 정리합니다.
