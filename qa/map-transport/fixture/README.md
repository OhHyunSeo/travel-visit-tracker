# 지도 요청 시험 서버

외부 지도 공급원에 연결하지 않고 요청 수명과 헤더, 본문 처리만 확인하는 작은 합성 서버입니다. 실제 지도 타일이나 사용자 자료는 읽지 않습니다. Node 24로 실행합니다.

```sh
node qa/map-transport/fixture/server.mjs --port 0
node --test qa/map-transport/fixture/server.test.mjs
```

첫 출력의 `origin`이 서버 주소입니다. 기본은 `127.0.0.1`과 임의의 빈 포트입니다. 휴대폰 시험에서 LAN 사용이 명시적으로 허용된 경우에만 다음처럼 Mac의 실제 사설 IPv4 하나에 바인딩할 수 있습니다. `0.0.0.0`, 공개 주소와 DNS 이름은 LAN 옵션으로 허용하지 않습니다.

```sh
node qa/map-transport/fixture/server.mjs --host 192.168.1.10 --port 3091 --allow-lan
```

모듈에서는 `createMapFixture({ host, port, allowLan })`를 가져올 수 있습니다. 결과는 `origin`, `stats()`, `reset()`, `release()`, `close()`를 제공합니다. `allowLan`은 기본적으로 꺼져 있습니다.

## 요청과 응답

`GET /resource/{style|tile|glyph|sprite}/{id}`가 합성 본문을 돌려줍니다. ID는 영문, 숫자, 밑줄과 하이픈 1~64자입니다. 본문은 `0x61`을 반복한 바이트이며 실제 스타일이나 타일 형식은 아닙니다.

| 쿼리 | 기본값과 범위 |
| --- | --- |
| `bytes` | 64, 0~65,536 |
| `delayMs` | 100, 0~2,000. 헤더 전과 본문 두 조각 사이에 각각 적용 |
| `status` | 200, 200~599. 본문이 없는 204, 205, 304는 거절 |
| `chunked=1` | Content-Length를 생략해 chunked 전송 |
| `gzip=1` | 합성 본문을 gzip으로 압축 |
| `redirect=1` | 302와 `http://example.invalid/fixture-target` Location. 서버가 해당 주소를 요청하지 않음 |
| `hold=1` | `/release`가 올 때까지 헤더도 보내지 않고 대기 |

이름이 없는 옵션, 중복 옵션과 잘못된 값은 400입니다. 새 리소스 종류나 지원하지 않는 경로는 404입니다. 오류 응답에도 `bytes`만큼의 합성 본문을 보낼 수 있어 클라이언트의 오류 본문 처리를 확인할 수 있습니다.

- `GET /stats`: 현재 계측 JSON. 제어 요청은 리소스 수에 포함하지 않습니다.
- `GET /release`: 지금 대기 중인 hold 요청을 풀고 개수를 반환합니다. 이후 새 hold 요청까지 자동으로 풀지는 않습니다.
- `GET /reset`: 활성 리소스가 없을 때만 통계를 초기화하며, 활성 요청이 있으면 409입니다.

서버는 리소스 요청을 받은 시점부터 응답 `finish` 또는 `close`까지 활성으로 셉니다. 응답 헤더와 절반의 본문만 보낸 뒤에도 활성으로 남겨 클라이언트가 자리를 너무 일찍 반환하는지 관측할 수 있습니다. 취소된 연결은 `aborted`이며 정상 종료와 한 번만 구분해 셉니다.

`nonControlRequestCount`는 제어 경로를 제외한 모든 HTTP 도착을 셉니다. 잘못된 경로는 `invalidRouteCount`, 잘못된 옵션은 `invalidQueryCount`에 따로 남기므로 클라이언트가 지원하지 않는 요청을 전송 전에 막았는지 확인할 수 있습니다. `rejectedCount`는 메서드와 경로, 옵션을 포함한 거절 수입니다.

`requests`에는 순번 `id`, 경로의 `resourceId`, `kind`, 쿼리를 제외한 `path`, `ua`, 인증과 쿠키 헤더의 존재 여부, `bytesWritten`, `decodedBodyBytes`, `gzip`, `chunked`, `finished`, `aborted`가 있습니다. 인증과 쿠키의 실제 값은 기록하지 않습니다.

`bytesWritten`과 `totalBytesWritten`은 Node 응답 쓰기에 넣은 **payload 바이트**입니다. gzip이면 압축된 본문 길이를 셉니다. HTTP chunk 프레임, 헤더와 TLS, OS가 실제 전달한 양이나 클라이언트가 받은 양은 포함하지 않습니다. 이 값만으로 공급원 수신량 상한이나 네이티브 다운로드 수용을 통과했다고 판단하지 않습니다.

`close()`와 CLI의 SIGINT, SIGTERM은 이번 서버의 타이머와 대기 연결을 정리합니다. 개인용 서버나 다른 프로세스를 종료하지 않습니다.
