# Android 지도 요청의 호스트 검사

JDK 17과 기존 캐시의 OkHttp 4.12.0, Okio 3.6.0, Kotlin stdlib 2.2.21을 사용합니다. 검사 스크립트가 의존성 해시를 확인하고 임시 폴더에서 컴파일합니다. 서버는 `127.0.0.1`의 임시 포트에만 열립니다.

JDK의 keytool로 소유 임시 폴더에 두 시험 인증서를 생성합니다. HTTPS client는 지정한 인증서를 연결별로 신뢰하고 공개키 pin과 기본 hostname 확인을 함께 사용합니다. `FixtureTlsTest`가 정상 TLSv1.3·HTTP/1.1 수신, 다른 인증서·호스트 불일치와 HTTP downgrade 거절을 확인합니다. 키와 인증서는 runner 종료 때 함께 제거됩니다.

```sh
bash qa/map-transport/android/host-transport/run-tests.sh \
  "$QA_OKHTTP_JAR" "$QA_OKIO_JAR" "$QA_KOTLIN_STDLIB_JAR"
```

MapLibre OpenGL 13.6.1 AAR과 기존 Android 36 `android.jar`를 네 번째와 다섯 번째 인수로 넘기면 배포 SDK의 Java 클래스로 컴파일합니다. 이 모드는 AAR과 `classes.jar`의 해시를 확인하며 `sdk-binding/FixtureModuleProviderTest`도 실행합니다. 기존 로더 위임, 중복·늦은 설치 거절과 합성 요청의 예약을 확인합니다. `android.jar`는 호스트에서 API 타입을 해석하는 데 사용합니다. [MapLibre Maven 배포본](https://repo.maven.apache.org/maven2/org/maplibre/gl/android-sdk-opengl/13.6.1/android-sdk-opengl-13.6.1.aar)

`FixtureNativeRequestTest`는 실제 배포 JAR의 `NativeHttpRequest`에 포인터 0을 전달해 JVM에서 공급자 선택과 HTTPS 취소·재요청을 대조합니다. JNI 호출은 실제 Android 시험에 남아 있습니다.

`FixtureRequestPolicyTest`는 리소스 분류, 허용 범위와 정확한 헤더를 확인합니다. `FixtureHttpClientTest`는 합성 URL 변환, 원래 인증 헤더 제거, 다른 출처와 리다이렉트 거절, `503 Retry-After: 0`과 변환 interceptor의 중복 호출 때 실제 전송 횟수를 대조합니다. 전송 허용 횟수는 OkHttp Call마다 한 번입니다. 다음 Call까지 묶는 영속 장부와 본문 예산, MapLibre와 Android에서의 동작은 별도 검증 범위입니다.

`FixtureBodyQueueTest`는 비동기 callback 안에서 네 본문을 읽는 동안 두 호출이 대기하는지 서버와 대조합니다. 대기 호출 하나를 취소한 뒤에는 다섯 번째만 도착해야 합니다. 이 동시 수는 비동기 `enqueue`와 callback 내부 본문 읽기·닫기에 적용됩니다.

`FixtureBody`는 한 응답의 예약 범위 안에서 정상적인 identity 본문을 전부 읽고 확인한 뒤 반환합니다. `FixtureHttpClientTest`는 localhost의 크기 초과·chunked·gzip 헤더와 메모리의 길이 불일치를 거절하는지 확인합니다. 이 상한은 검사 코드가 수락하는 본문에 적용됩니다. 운영체제와 OkHttp가 먼저 받아 둔 바이트는 측정하지 않습니다.

`FixtureCancellationTest`는 전송 중 취소로 본문이 닫힌 뒤에도 callback 반환까지 자리를 유지하는지 확인합니다. 대기한 다섯 번째 요청의 서버 도착, 중복 취소의 callback 횟수와 자동 재전송 여부를 함께 대조합니다.

`FixtureBudgetTest`는 세션의 전체 시도·타일 시도·고정 바이트 예약을 전송 전에 차감하고 완료 후에도 유지하는지 확인합니다. 같은 타일 경로를 반복하는 새 Call도 예약을 사용합니다. 이 단계의 메모리 상태는 재실행 때 보존되지 않습니다.

전용 client는 응답을 `FixtureBody.guard`로 감싸 callback이 보는 스트림에 요청별 예약을 적용합니다. 응답이 거절돼도 선행 예약을 유지합니다.

`FixtureBudget.open`은 private 디렉터리의 고정 파일에 예약을 append하고 강제 저장합니다. 같은 장부의 중복 writer, 설정 변경과 불완전한 기록을 거절합니다. 호출자는 client가 끝난 뒤 budget도 닫아 파일 lock을 해제합니다. `FixtureJournalTest`가 재개방, 전송 전 기록, 동시 예약과 잘린/손상된 장부를 검증합니다. 테스트는 소유 임시 파일만 정리합니다.

`FixtureCrashRecoveryTest`는 전송 전과 본문 수신 중인 고정 Java 자식을 강제 종료합니다. 실제 다른 프로세스의 writer lock과 종료 후 같은 장부의 재개방·예약 보존을 대조합니다.

같은 `FixtureBudget`을 사용하는 client들은 비동기 dispatcher의 네 자리를 공유합니다. client의 close는 자기 Call만 취소합니다. budget의 close는 세션 전체를 취소하고 callback 종료를 기다린 뒤 장부를 닫습니다. callback이 5초 안에 끝나지 않으면 lock을 보존한 IOException을 반환하며 종료를 다시 시도할 수 있습니다. `FixtureSharedSessionTest`는 client 사이의 자리 공유와 종료 영향을 확인합니다.

`FixtureSessionCloseTest`는 callback이 지연된 실제 close timeout에서 writer lock을 보존하고, callback 종료 후 close 재시도로 장부를 재개방하는지 확인합니다.

`FixtureMapLibreRequest`는 취소된 리소스 객체에 늦은 완료를 전달하지 않는 합성 어댑터입니다. `FixtureMapLibreRequestTest`가 정상 변환·본문·응답 헤더, 한 번 실행, 취소와 같은 타일 재로딩의 예약을 검증합니다. `FixtureConditionalRequestTest`는 단일 ETag 우선 또는 HTTP 날짜로 재검증하고, 조건부 요청에 대한 빈 304만 받으며, 전송한 모든 요청의 예약을 보존하는지 검사합니다. `FixtureRangeRequestTest`는 요청별 예약 안의 단일 닫힌 바이트 범위만 전송하고, 일치하는 206과 고정 길이 또는 조건부 빈 304만 받는지 검사합니다.

### 선택적 HTTP/2 호스트 검사

JDK 17과 기존 세 의존성, MockWebServer 4.12.0, JUnit 4.13.2, Hamcrest Core 1.3이 필요합니다. 각 JAR의 해시를 확인한 뒤 합성 서버와 일회용 TLS 키로 실행합니다.

```sh
bash qa/map-transport/android/host-transport/http2/run-test.sh \
  "$okhttp_jar" "$okio_jar" "$kotlin_jar" "$mockwebserver_jar" "$junit_jar" "$hamcrest_jar"
```

뒤에 고정 MapLibre AAR와 Android `android.jar`를 추가하면 공개 서명 사본 대신 배포 클래스에 어댑터를 연결합니다.

이 검사는 별도로 HTTP/2를 선택해 TLS 연결 하나의 네 콜백이 응답을 보유할 때 다섯 번째 요청이 대기하고, 대기 중 취소한 요청은 서버에 도착하지 않는지 확인합니다. 실제 전송 및 초과 본문 거절에도 요청별 예약이 남는지 확인합니다. 수신 도중 타일을 취소해도 다른 요청과 새 타일 요청이 같은 연결에서 완료되며 두 타일 시도의 예약이 모두 남는지 검사합니다. 조건부 요청과 단일 바이트 범위에서는 허용된 304·206만 전달합니다. 스트림 거절과 503의 자동 후속 전송도 확인합니다. 기본 시험 APK와 기존 runner는 HTTP/1.1 경로를 사용합니다.

`sdk-contract`는 [MapLibre Native 13.6.1 HttpRequest](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/HttpRequest.java)와 [HttpResponder](https://github.com/maplibre/maplibre-native/blob/android-v13.6.1/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/http/HttpResponder.java)의 공개 API 서명만 포함합니다. 라이선스는 해당 폴더의 `LICENSE.maplibre`에 보존했습니다. 이 runner는 그 인터페이스로 호스트 컴파일하며, 실제 SDK 바이너리·JNI·RN 연결은 별도 검증 범위입니다. Android 빌드에서는 이 호스트 계약 파일을 포함하지 않습니다.

`FixturePersistenceFailureTest`는 장부의 부분 tail, 수정 시각과 권한 변경을 만들고 실패 시 HTTP 요청 0회와 파일 보존을 대조합니다.

`FixtureAdapterRaceTest`는 응답 마지막 바이트 반환과 취소를 두 스레드에서 경쟁시켜 완료 횟수와 취소 반환 이후의 전달을 대조합니다.

본문 대기와 활성 취소 검사는 HTTP와 인증서 고정 HTTPS에서 각각 실행합니다. HTTPS에서도 대기 취소는 예약하지 않고, 이미 전송한 취소 시도는 예약을 유지합니다.

`FixtureTlsDeadlineTest`는 TLS ClientHello 뒤 응답이 없는 두 연결에서 call deadline과 명시적 취소를 확인합니다. 이 단계의 HTTP 예약 0은 TLS handshake 통신량을 뜻하지 않습니다.

프로세스 강제 종료 뒤 장부 복구는 HTTPS 본문 수신 중에도 실행합니다. 같은 타일의 새 HTTPS 요청이 이전 예약에 추가되는지 서버와 장부로 대조합니다.
