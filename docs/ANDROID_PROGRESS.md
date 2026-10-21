# Android 개발·검증 기록

마지막 갱신: 2026-10-21, Asia/Seoul.

## 10월 21일 종료 전: 실제 OS 네트워크 차단과 복귀 1회

사용자가 현재 검사까지만 마치고 저장·중단하도록 요청해, 시작한 네트워크 차단/복귀 한 차례만 완료했습니다. 공통 `8b48ec8`과 기존 APK/API 37을 고정했고 고유 QA DB, 인증 이름, 합성 HTTP 서버를 사용했습니다. 공통 제품 코드는 변경하지 않았습니다.

HTTP는 `10.0.2.2:3002`의 에뮬레이터 호스트 네트워크 경로로 연결했습니다. **HTTP용 adb reverse는 만들지 않았으며 전용 Metro 8082 reverse만 유지**했습니다. 실제 `expo/fetch`로 정상 HTTP 200을 먼저 확인한 뒤 Android OS의 비행기 모드를 켜고 Wi-Fi와 모바일 데이터를 껐습니다. 해당 OS 상태와 Connectivity 진단을 보존했으며 같은 native HTTP가 실제 오류로 실패했습니다. fetch 예외, 응답 유실, 타임아웃을 하네스로 주입한 결과가 아닙니다.

| 단계 | 실제 관찰 |
| --- | --- |
| 연결 정상 | 합성 서버의 native HTTP 200. 합성 방문 1건과 사진 1장의 전송 대기 준비 |
| OS 연결 차단 | 비행기 모드 켜짐, Wi-Fi와 모바일 데이터 꺼짐. native HTTP 실패, 방문 전송도 실패. 방문/사진 작업 ID, payload, 대기와 사진 SHA 보존. ACK metadata 없음. 방문 시도 횟수 증가는 허용하되 성공으로 처리하지 않음 |
| 원래 설정 복귀 | 원래 무선 설정으로 복구한 뒤 같은 native HTTP 200 |
| 명시적 재시도 | Coordinator를 다시 실행해 방문 다음 실제 multipart 사진 전송. 사진 ACK 1개, 대기 0건. 기기 첨부본의 SHA 유지, 서버 저장 바이트도 읽기 대조로 일치 확인 |

이는 에뮬레이터 OS 네트워크를 끊고 복귀한 조건입니다. 방문 우선 전송이 차단돼 사진은 전송 전에 대기했습니다. **사진을 전송하는 도중의 단절, Wi-Fi↔모바일망 전환, 물리 기기의 무선 환경이나 다운로드 도중 단절을 확인한 결과는 아닙니다.** 사용자 중단 요청에 따라 사진만 단독 실패시키는 추가 주기와 다운로드 중단 검사는 시작하지 않았습니다. 실제 화면 확인창 검사는 앞선 v5 결과이며 이번에는 native Coordinator를 명시적으로 실행했습니다.

시작·종료에 개인 원본 DB의 모든 저장 행, 설정, 스키마, 사진 바이트와 인증 보존을 비공개로 대조했습니다. 기본 개인 DB를 새 소스로 열지 않았습니다. 합성 시험 DB와 첨부본, QA 앱 DB/WAL/SHM 3개를 정리하고 네트워크 설정과 임시 소스54개의 원문/부재/해시를 복구했습니다. package/lock과 APK도 같으며 자체 8082/3002, Metro reverse, 에뮬레이터를 종료했습니다. HTTP reverse3002는 전 과정에서 없었습니다. 기존 백업, SDK, AVD와 중요한 근거는 보존했습니다.

실제 네트워크 주기와 전후 상태는 로컬 Git 제외 `docs/test-results/android-os-network-20261021/`의 `network-cycle-summary.json`, `private-state-after-*.json`, `private-network-*.txt`, `validation-files.json`, `shutdown-status.json`과 합성 서버 DB에 남깁니다. 공통8b48ec8의 앞선 모바일479개와 native16개를 이번에 반복하거나 새 검사 수에 합산하지 않았습니다. 결과 요약만 기존 Android PR에 저장하고 CI를 확인한 뒤 중단하며 다음 재개는 사용자의 새 요청을 기다립니다.

## 10월 21일 후속: 손상 다운로드 점검과 새 사본 복구

공통 **`8b48ec8deb74c2402ddfb5f3762664e6e85bbb63`**를 고정해 새 v5 복구를 검증했습니다. Android 시작 기준은 `1231bae`입니다. 기존 Debug APK, API 37, 실제 비동기 SQLite 3.50.3, native 파일과 SHA-256, 실제 `expo/fetch` HTTP를 사용했습니다. 고유 QA DB와 SecureStore 이름만 바꿔 임시 적용했고 새 native 빌드, 설치, 의존성 변경은 없습니다.

**native 통합 16개가 모두 PASS**입니다. 이전 v4의 15개와 v3의 24개를 반복하거나 이번 수에 합산하지 않습니다.

| 확인 범위 | 수 | 실제 결과 |
| --- | ---: | --- |
| 이전 0바이트 사례의 v4→v5 | 1 | 보존한 합성 v4 DB와 두 사진을 새 DB 이름과 파일 경로에 복제. migration 전후 기존 모든 행과 이전 cursor 열 보존, applied 다운로드 두 개만 출처에 편입. 0바이트 사진만 새 경로에 검증 복사해 연결, 기존 0바이트와 정상 파일 보존. 재개방과 재점검 통과 |
| v4 출처 편입 실패 | 1 | 실제 `restore_files` INSERT 뒤 오류를 주입. 새 테이블, 점검 열, 버전, 기존 행 전체 rollback과 재시도 통과 |
| 0바이트, 누락, 같은 길이의 변조 | 3 | native 검사에서 각각 damaged/missing 판별. 새 파일의 크기와 SHA를 확인한 뒤 연결만 교체. 이전 바이트나 부재 상태 유지, 이전 출처 preserved, 새 출처 valid. 재개방 후 정상 파일 재다운로드 없음 |
| 복구 연결 SQL 실패 | 1 | 실제 사진 URI UPDATE 뒤 오류. 사진 연결, 출처, 큐의 부분 커밋 없음. 미등록 새 파일 제거, 기존 손상 파일과 대기 보존, 재개방 뒤 복구 성공 |
| 토큰, owner, URI 변경 | 3 | 새 파일 생성 뒤 토큰이나 계정 변경 시 등록 차단과 명시적 재시도. 점검 뒤 사진 URI가 사용자 첨부본으로 바뀌면 그 연결과 바이트를 보존하고 미등록 복구 사본만 제거 |
| 미전송 자식 변경, 부모 삭제 | 2 | 자식 outbox payload와 attempts 그대로 유지하며 복구 차단. 다운로드 뒤 부모 삭제 시 다시 연결하지 않고 삭제 큐와 이전 파일 보존 |
| 사용자 첨부본, 계정과 공유 경로 | 2 | restored 형태의 이름만 가진 사용자 사진은 출처 편입, 점검, 다운로드 대상이 아님. 실제 두 합성 계정의 같은 UUID에서 한 계정만 복구하고 다른 계정의 행, 출처, 바이트 유지. 공유 URI는 파일 읽기 전에 거절 |
| 점검, 다운로드 제한과 재개 | 1 | 기존 합성 사진 22개를 손상시킨 뒤 한 번에 점검 최대 20개, 새 받기 최대 20개 확인. 점검 cursor 재개방 보존, 첫 20개와 다음 나머지 2개 복구. 순환 점검 중 기아 없음, 이전 손상 사본 모두 보존 |
| 점검 storage, cursor 쓰기 실패 | 2 | 실제 native 정상 검사 뒤 주입한 storage 오류를 손상으로 오인하지 않음. 실제 점검 cursor SQL 뒤 오류에서는 cursor, 출처, 큐를 함께 rollback. 재개방과 재시도 통과 |

이전 합성 자료의 원래 보존본은 수정하지 않았습니다. 복제본의 파일 URI만 새 전용 경로로 치환했고, migration 보존 비교는 그 복제본을 기준으로 수행했습니다. 일부 계정, SQL, storage 실패는 검사 하네스에서 시점을 제어한 합성 오류이며 실제 디스크 부족이나 전원 차단으로 표시하지 않습니다.

### 실제 확인창과 사진 표시

새 QA 앱 저장소에서 같은 합성 계정으로 로그인했습니다. 9초간 자동 조회 없음, 계정과 서버, 20개 점검, 새 사본 연결, 기존 파일과 사용자 사진 보존 안내가 있는 확인창, 취소 시 조회 없음이 PASS입니다. 확인 후 서버 방문과 사진 목록을 먼저 읽고 정상 사진 두 개를 받았습니다.

그중 한 QA 파일만 의도적으로 0바이트로 만든 뒤 실제 화면에서 다시 확인하고 받았습니다. 이전 다운로드 두 개를 점검해 사진 한 개만 다시 받았고 **새 사본 복구 1개와 대기 0건 안내**가 표시됐습니다. 이전 0바이트 파일은 그대로 남았고 정상 사진의 경로는 유지됐습니다. 복구 후에도 새 확인창이 필요했고 취소 뒤 9초간 추가 점검이나 다운로드는 없었습니다. 지역 상세에서 두 합성 사진이 표시되는 것을 직접 확인했습니다.

에뮬레이터는 계속 켜 둔 채 앱 프로세스만 `am force-stop` 후 재실행했습니다. 현재 두 사진과 이전 0바이트 파일의 바이트, SHA, 출처, URI가 그대로이며 새 업로드 outbox나 ACK metadata를 만들지 않았습니다. QA 로그아웃도 마쳤습니다. **이전 host exit139의 직접 원인은 여전히 미확정**이며 강제 host 종료를 재현하지 않았습니다. 이번 결과는 손상 파일의 탐지와 보존 복구를 확인한 것이며 전원 장애나 전체 중단 내구성의 완료 판정이 아닙니다.

### 검사, 보존, 정리

고정 QA 소스에서 Node 24.21.0의 `bash scripts/verify-cloud.sh`가 PASS였습니다. 타입, ESLint, 18개 파일의 모바일 **479개**, 기존 backend syntax와 native dependency load, Android/iOS production JS/Hermes export를 포함합니다. 공통 서버 61개와 공통의 임시 HTTP 검사는 이번에 반복하지 않았으며 이번 native HTTP 결과와 구분합니다.

개인 원본의 모든 저장 행, 설정, 스키마, 사진 바이트와 인증 항목의 전후 보존 대조를 통과했습니다. 원래 개인 DB를 새 코드로 열지 않았습니다. 상세 값과 해시는 로컬에만 보관합니다. 16개 시험 DB와 해당 WAL/SHM 부재를 확인했고, QA 앱 DB/WAL/SHM 3개와 QA 사진 3개만 제거했습니다. 이전 0바이트 사례와 이번 복구의 DB 사본, 파일, 로그, 화면은 Git 제외 근거에 보존했습니다.

앱과 자체 8082/3002를 먼저 멈춘 뒤 임시 파일 **54개(기존 14개, 새 40개)**를 원래 존재 여부와 해시대로 복구했습니다. package/lock과 보존 APK도 같고 자체 reverse와 에뮬레이터는 정상 종료했습니다. 생성 JS/Hermes 출력도 사용 종료 후 정리했으며 즉시 가용량 증가는 없었습니다. 원래 checkout, iOS 8081, iPhone, SDK, AVD, APK와 기존 백업은 보존했습니다.

로컬 근거는 `docs/test-results/android-restore-repair-v5-20261021/`의 `validation-files.json`, `native-probe-result.json`, `private-archived-clone.json`, `ui-*-result.json`, `process-restart-summary.json`, `verification.log`, `shutdown-status.json`과 비공개 DB/파일 사본입니다. 이 폴더와 fixture 계정, 토큰, 원본 데이터는 커밋하지 않습니다. 실제 Android 휴대폰, Release, OS 네트워크 전환, 배터리, 시스템 백업과 전체 수용 기준은 계속 남겨 둡니다. Android PR에는 결과 문서만 저장합니다.

## 10월 21일 수동 기록 복원 검증

공통 동작 **`8ee29bd`**를 별도 합성 DB·인증 이름에서 실행했습니다. 기존 Debug APK와 API 37 에뮬레이터를 그대로 사용했으며 새 빌드·설치·의존성 변경은 없습니다. 실제 비동기 SQLite 3.50.3·파일·HTTP의 **15개를 모두 통과**했고 모바일 타입·린트·453개도 통과했습니다.

방문 선행, v3→v4 자료 보존과 실제 SQL 롤백, 다운로드 응답 유실 뒤 DB 재개방·대기 재개, 첫 실행 20개/다음 실행 나머지 받기, JPEG·PNG 바이트·해시, 계정별 동일 UUID와 파일 분리, 미전송 변경·삭제 보존을 확인했습니다. 계정·화면 상태 변경과 파일/SQL 실패 뒤 미등록 파일 정리·대기 보존, 잘못된 길이·형식·해시 거절과 재시도도 포함합니다. 장애 시점의 일부는 합성 제어이며 실제 디스크 부족 시험은 아닙니다.

화면에서는 대상 계정·서버·범위가 있는 확인창, 취소 시 요청 없음, 확인 후 복원과 완료 안내·재확인을 확인했습니다. 첫 복원 후 화면 확인 중 **에뮬레이터 프로세스가 비정상 종료(exit139)**됐고, 재실행 뒤 해당 합성 사진은 연결 정보가 남은 채 0바이트였습니다. 직접적인 원인은 확정하지 않았습니다. 이미 완료 상태인 파일을 다시 검사하거나 재다운로드하는 경로가 없어 수동 복원을 다시 눌러도 이 파일은 복구되지 않았습니다.

이상 사례를 그대로 보존한 뒤 다른 합성 사진을 받았고 파일 길이·해시와 상세 화면 표시가 정상이었습니다. 이후 **에뮬레이터는 켠 채 앱 프로세스만 종료·재실행**했을 때 새 사진의 바이트와 해시가 유지됐습니다. 정상 앱 재실행과 에뮬레이터 자체 비정상 종료 결과를 구분하며 전체 중단 내구성은 완료로 표시하지 않습니다. 다음 보완은 [완료된 복원 파일의 재검증·복구 제안](ANDROID_PROPOSED_CHANGES.md)입니다.

원래 개인 DB의 전체 저장 테이블·설정·스키마·사진 바이트와 인증을 읽기 대조해 보존했습니다. 기본 원본 DB를 새 코드로 열지 않았습니다. 임시 공통 파일53개를 원래 존재 여부·해시대로 복구하고 package/lock·APK도 보존했습니다. 시험 DB·합성 사진·시험 인증·자체 8082/3002·reverse 포트·에뮬레이터를 정리했습니다. 0바이트 사례와 정상 새 사진, DB 사본·로그·화면 근거는 Git 제외 `docs/test-results/android-restore-v4-20261021/`에 보관합니다. 개인 원본 행 수·내용·해시·인증 상태는 공개하지 않습니다.

추가 읽기 검토에서 macOS 진단의 호스트 에뮬레이터 HangDetector/CrashReporter 종료 경로를 확인했으며, 직접 원인은 계속 미확정입니다. 정상 새 합성 파일의 앱 프로세스 종료 전후 파일 매핑·해시·수정 시각과 0바이트 사례의 DB 사본을 로컬에 보존했습니다. 후속 손상 파일 보완은 고정 SHA/API를 받은 뒤 별도 검사합니다. 검증 과정의 생성 JS/Hermes 출력 40개(논리 8,739,107 bytes)는 사용 종료 후 정리했으며 즉시 가용량 증가는 관측되지 않았습니다. SDK·AVD·APK·백업과 중요한 근거는 보존했습니다.

이 결과는 Android 에뮬레이터의 Debug·Inspector 검사입니다. 실제 Android 휴대폰·Release·시스템 백업·배터리·OS 네트워크 전환·에뮬레이터 비정상 종료 원인과 손상 파일 자동 복구는 미확인입니다. 공통 제품 코드는 Android PR에 중복 포함하지 않으며 전체 수용 판정은 공통 체크리스트를 따릅니다.

10월 20일 공통 **`2bae436`의 모바일 DB v3을 실제 Android 비동기 SQLite 파일 DB 24개에서 검증해 모두 PASS**였습니다. v1/v2의 모든 owner 행·설정·사진 URI/bytes·큐·metadata 보존·재개방, 같은 UUID의 계정 격리, 복합 FK와 가져오기 cascade·충돌·실제 SQL rollback을 확인했습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 임시 소스 40개와 실행 환경은 복구·종료했습니다. 다운로드·복원 기능과 실제 Android 휴대폰 통과를 뜻하지 않습니다.

10월 19일 공통 **`809efe0`의 수동 사진 백업을 Android에서 검증**했습니다. 앞선 native 파일 준비 1개·비동기 SQLite/실제 multipart 통합 9개와 빈 계정 확인창 결과에 이어, **방문 1건·PNG 1개가 있는 합성 계정의 실제 화면 전송도 PASS**입니다. 확인 전·취소 후 전송 없음, 확인 뒤 방문 먼저·사진 정확히 1회, 완료 표시·ACK·기기 첨부본 유지와 매 실행 재확인을 확인했습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다.

10월 18일 `51c96d2`에서 실행한 연결 복구 13가지 PASS와 이전 화면·전송·경쟁 조건 결과는 아래 이력으로 유지합니다. 이 결과를 `809efe0`의 사진 검증으로 합산하지 않습니다.

현재 실제 Android 휴대폰은 없습니다. 결과는 Debug APK의 정적 검사와 API 37 에뮬레이터 시험이며, 실제 휴대폰이나 출시용 Release 검증으로 보지 않습니다. 전체 체크리스트와 완료 수는 공통 담당 채팅에서 관리합니다.

## 10월 20일 모바일 DB v3 native 검증: 24개 PASS

### 고정 소스와 안전한 적용

Android 시작은 **`1f299fb5fb37757efb9f7c86e92fea3e08683fc3`**, 공통 고정 소스는 **`2bae436b9f128219d6e81593139071526749b28a`**입니다. 이전 37개 목록에 새 `src/storage/migrations.ts`, `tests/migrations.test.ts`, 고정 `tests/fixtures/schema-v2.sql`을 포함해 **40개**의 원문·부재·고정 소스·적용 해시를 보존했습니다. production 23개·테스트 15개·fixture 1개·Vitest 설정 1개입니다.

database 이름 한 곳과 SecureStore key/service만 새 QA 이름으로 바꾸고 그 차이를 별도 기록했습니다. migration·schema·Repository와 고정 v2 fixture는 해당 SHA 그대로입니다. 원래 개인 v1 DB는 v3 앱으로 열지 않았습니다. 기존 Debug APK·API 37·CPU 4개·SwiftShader·전용 8082만 사용했고 새 native 빌드·설치·의존성 변경은 없었습니다.

실제 앱에 로드된 Repository·migration을 native `expo-sqlite`의 네 async adapter 함수와 고유 파일 DB에서 실행했습니다. 각 DB 경로가 원본과 다름을 확인하고 WAL·busy timeout을 사용했습니다. Inspector 코드는 기존에 검증한 ES2015 generator 변환을 적용했습니다. 측정된 native SQLite는 **3.50.3**이며, Repository가 실행하는 각 `BEGIN IMMEDIATE` 직전에 `foreign_keys=1`을 확인했습니다. 초기 연결을 FK OFF로 열거나 재개방한 뒤에도 initialize가 BEGIN 전에 켜는 것을 확인했습니다.

### 합성 자료와 실제 결과

`migrations.test.ts`와 고정 v2 SQL의 24개 시나리오를 실제 비동기 native 파일 DB에 옮겨 실행했습니다. guest/A/B, 활성·삭제·개발 방문, 사진 URI, 소수점 시각, outbox payload/attempts, 후보·설정, 미완료/업로드 metadata와 실제 native PNG bytes를 사용했습니다. 준비된 사진 fingerprint와 ACK는 합성 값이며 HTTP 서버·실제 서버 계정은 만들지 않았습니다.

| 묶음 | 수 | 실제 결과 |
| --- | ---: | --- |
| v1/v2→v3·재개방 | 2 | 세 owner의 기존 모든 테이블 행·설정·후보·URI·payload·attempts·소수점 시각 보존. v2의 미완료/완료 metadata·native PNG bytes 유지, 재개방·v3 재초기화 통과 |
| migration/지역 초기화 실패 | 8 | 새 테이블 생성·사진/metadata 복사·기존 테이블 제거·이름 교체·버전 쓰기 SQL 뒤 오류 6가지, COMMIT 직전 오류 1가지, migration 뒤 지역 초기화 오류 1가지. 실제 rollback으로 행·스키마·이전 버전 보존, 재개방 후 재시도 통과 |
| 불명확한 기존 저장 구조 | 4 | photos/metadata owner 불일치 2가지, 버전 -1/0/99 묶음, 예상 밖 중간 테이블. 소유권 추정·조용한 행 손실·버전 재표시 없이 기존 구조와 행 보존 |
| 같은 연결의 동시 요청 | 1 | 두 initialize와 후속 개발 방문 쓰기를 함께 요청. 실제 async 연결에서 직렬 처리·방문 1건 유지, 중첩 transaction 오류 없음 |
| 같은 UUID·fingerprint·ACK | 1 | A/B의 같은 방문·사진·작업 UUID 동시 저장. owner별 URI·다른 파일 해시·사진 준비·시도 횟수 독립. A ACK만 완료되고 B 큐·metadata·attempts 보존 |
| FK·owner 한정 삭제 | 2 | 다른 owner의 방문/사진을 참조하는 자식·metadata SQL 거절. Repository 삭제가 다른 owner를 보존하며, 물리 DELETE의 사진→metadata cascade도 해당 owner에만 적용 |
| guest GPS 가져오기 | 1 | outbox를 옮긴 뒤 부모 방문 owner 변경으로 사진·고정 metadata가 실제 ON UPDATE CASCADE. URI·frozen payload 유지, 개발 자료는 guest에 잔류, 같은 UUID의 B 자료 불변 |
| 가져오기 충돌·SQL 실패 | 5 | 방문 ID·session·사진 ID·작업 ID 충돌 4가지에서 양쪽 모든 행 불변. outbox 실제 이동 뒤 부모 UPDATE trigger의 SQL ABORT 1가지에서 부모·자식·metadata·outbox 전체 rollback |

행·스키마 비교는 실제 native SELECT 결과를 사용했습니다. 보존·재개방과 계정 관계 검사에서 `foreign_key_check` 빈 결과와 integrity `ok`를 확인했습니다. 일부 오류는 실제 SQL이 완료된 다음 adapter가 예외를 내도록 주입했고, 가져오기 실패는 native SQLite trigger의 ABORT입니다. 실제 디스크 장애·전원 차단이나 프로세스 중간 종료의 결과로 확대하지 않습니다. COMMIT 실패 경우는 **COMMIT 실행 전** 오류이며 이미 커밋한 내용을 rollback한 것으로 표시하지 않습니다.

### 원본·인증·파일·소스 복구

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 이전 검증의 보존 근거와도 같았습니다. QA 외 인증 저장 항목 해시도 같고 QA 인증 항목·실제 세션은 끝까지 부재였습니다.

24개 시험 DB는 각각 close/delete하고 DB·WAL·SHM 부재를 확인했습니다. 각 시험의 전용 native PNG 폴더도 제거돼 남은 폴더는 0개입니다. 앱용 QA DB는 v3·방문/사진/outbox/metadata 0건·integrity `ok`를 확인한 뒤 DB/WAL/SHM 3개만 정리했습니다.

앱·자체 Metro를 먼저 멈춘 뒤 기존 파일 **14개**를 원문으로 복구하고 새 임시 파일 **26개**를 제거했습니다. 40개 전체 존재 여부·바이트와 package/lock·보존 APK hash가 같습니다. 자체 reverse 8082와 에뮬레이터도 종료했습니다. HTTP 서버·실제 서버 계정은 시작하지 않았습니다. 원래 checkout·iOS 8081·iPhone·SDK·AVD·기존 캐시·백업·증거는 조작하지 않았습니다.

### 자동 검사와 남은 범위

QA DB·인증 이름 오버라이드를 포함한 임시 소스의 `bash scripts/verify-cloud.sh`가 PASS입니다. Node 24.21.0의 모바일 타입·ESLint·**15개 파일/402개**, 기존 backend syntax/native dependency load, Android/iOS JS/Hermes export를 포함합니다. 기존 의존성을 읽기 전용 재사용했고 `setup-cloud.sh`나 새 의존성 설치는 로컬에서 반복하지 않았습니다. 공통 서버 61개·실제 임시 HTTP 검사는 이번에 반복하지 않았으며 위 24개는 실제 native 저장 검사로 구분합니다.

제품 소스의 추가 수정 제안은 없습니다. 이번 결과는 저장 구조의 보존·격리 기반입니다. 사진 다운로드·복원·cursor/다운로드 대기·중단 재개 기능 완료, 실제 Android 휴대폰·Release·OS 백업/복원·실제 저장 공간 부족/전원 차단을 뜻하지 않습니다. 앞선 `809efe0`의 사진 native·UI 결과를 v3에서 반복한 것으로 합산하지 않으며 P3-10 전체·G1~G4 완료 수도 변경하지 않습니다.

로컬 Git 제외 근거: `docs/test-results/android-storage-v3-20261020/`. 개인 DB·사진·인증·기기 원본 로그·QA 식별자는 공개 문서와 PR에 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 SHA·새 migration/fixture·복구 해시 | `validation-files.json`, `common-*.txt`, `original-*.txt`, `schema-v2.sql`, QA 이름 사본 |
| 24개 실제 native case·engine 버전 | `native-probe-result.json`, `private-native-probe-result.json`, generator 변환 probe |
| 원본 전체 테이블·설정·사진·인증 | `baseline-data.json`, `final-data.json`, `private-original-all-tables.json`, `*-credential.json` |
| 시험 DB·PNG·실행 환경·APK 보존 | `native-cleanup-summary.json`, `shutdown-status.json`, `apk-preservation.json` |
| 자동 검사·실행 로그 | `verification.log`, `metro.log`, `emulator.log` |

## 10월 19일 후속: 사진이 있는 계정의 실제 UI 전송 PASS

### 소스·DB·인증 격리

Android 시작은 **`753438aa898cde37d22e221acc4bcdf166eb8241`**, 공통 동작은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**입니다. 공통 HEAD `fb8da94`까지의 차이는 문서이며 검증 대상 37개 파일은 고정 SHA와 같았습니다. 기존 APK·API 37·SwiftShader·자체 8082·새 합성 HTTP 서버를 사용했습니다. 앞선 파일 1개·통합 9개·빈 계정 UI·모바일 378개 검사는 반복하지 않았습니다.

새 QA DB 파일명과 **QA 전용 SecureStore key/service**만 오버라이드했습니다. DB 이름 한 곳과 인증 상수 두 곳의 차이 및 적용 해시를 별도 기록했고 나머지 동작 소스는 고정 SHA 그대로입니다. 원본 v1 DB와 기존 인증 항목은 사용하지 않았습니다. 실제 계정 화면에서 새 합성 계정을 만들고, QA DB에 합성 GPS형 방문 1건·전송 대기를 원자적으로 준비한 뒤 Repository로 새 PNG 1개·사진 대기를 연결했습니다. 실제 위치나 개인 사진을 사용하지 않았고 게스트 가져오기도 하지 않았습니다. GPS 판정·센서 수용 시험의 결과에 포함하지 않습니다.

첫 자료 준비에서 방문 확정 전 사진 연결이 거절됐습니다. 합성 방문·대기를 QA DB transaction으로 준비하는 방식으로 정리한 뒤 아래 UI 검증을 실행했습니다. 처음 준비한 미연결 합성 파일만 제거했고 실패 기록도 보존했습니다. 제품 소스 수정은 없습니다.

### 실제 화면·서버·기기 파일 대조

| 흐름 | 실제 결과 |
| --- | --- |
| 방문 1건·사진 1개 대기, 자동 방문 백업 꺼짐 | 화면에서 사진 대기 1건 표시. 9초 관찰 동안 방문·사진 POST 모두 0회, 서버도 0건 |
| 사진 백업하기 → 첫 확인창 → 취소 | 대상 계정·서버·형식·크기·보관 범위 표시, 방문·사진 POST 0회 유지 |
| 다시 열기 → 확인하고 전송 | 실제 화면 handler가 방문 sync 먼저·사진 multipart 다음으로 요청. 각각 정확히 1회, 서버 방문·사진·각 영수증도 1개 |
| 완료 화면·ACK | “사진 1건을 전송했습니다”와 서버 저장 확인 1개 표시. 방문·사진 대기 0건, 방문 성공 시각 있음. metadata revision/업로드 시각 저장·outbox 0건 |
| 기기 첨부본·서버 파일 | QA DB의 방문 1건·사진 행 1개와 native PNG의 기존 bytes·해시·크기 유지. 서버 첨부본의 bytes·해시·크기가 같고 썸네일은 별도 |
| 완료 뒤 다시 열기 → 취소 | 새 확인창이 다시 나타남. 취소 후 9초 관찰에도 방문·사진 POST 총 1회씩 유지, 중복 저장 없음 |

서버가 관측한 변경 요청 순서는 **`visit → photo`**였습니다. 사진은 실제 expo/fetch multipart 1회이며, 서버 사진·사진 영수증 각 1개와 integrity `ok`를 직접 대조했습니다. 전송·ACK·완료 문구는 실제 앱 화면 경로에서 확인했습니다. 관측한 9초 구간은 전체 장시간 자동 전송 수용 시험으로 확대하지 않습니다.

### 원본 보존·인증·종료

QA 인증 항목은 로그인 중 AES 암호화됐고 이메일·비밀번호는 평문으로 없었습니다. 로그아웃 뒤 QA 인증 항목은 삭제됐으며, 시작·로그인·로그아웃 모두 **QA 외 SecureStore 항목의 해시가 같았습니다**. 원본의 모든 owner visits/photos/outbox 전체 행·기존 사진 bytes도 시작·종료가 같습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다.

앱과 자체 Metro/HTTP를 먼저 멈췄습니다. QA UI DB v2의 전체 방문 1건·사진 1개·outbox 0건·업로드 metadata 1개·integrity `ok`, 기기 합성 PNG 유지와 해시를 확인·보존한 뒤 **이번 QA DB/WAL/SHM 3개와 합성 PNG 1개만** 정리했습니다. 원래 파일 14개 복원·새 임시 파일 23개 제거로 총 37개의 존재 여부·원문 해시를 대조했습니다. package/lock·보존 APK hash는 그대로이고 자체 reverse 8082·3002·에뮬레이터를 종료했습니다.

새 빌드·설치·의존성 변경·캐시/Time Machine 정리는 없었습니다. 원래 checkout·iOS·iPhone·SDK·AVD와 기존 근거는 조작하지 않았습니다. 이번에는 새 UI 흐름과 보존 대조만 실행했고, 앞선 378개·native 9개 결과는 해당 단계의 근거로 유지합니다. 실제 OS 네트워크 전환·전송 중 앱 종료·자동 사진 전송·다운로드/복원·여러 기기 삭제 병합·실제 Android·Release는 남아 있으며 P3-10 전체와 G1~G4를 완료 처리하지 않습니다.

근거는 Git 제외 `docs/test-results/android-photo-ui-nonempty-20261019/`에 보존합니다. 공개 문서에는 실제 계정·token·서버 주소·QA 이름·DB·사진·XML/PNG 원본·로그를 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 소스·QA 이름·복구 | `validation-files.json`, `qa-database-override.ts`, `qa-credentials-override.ts`, 원문/고정 사본 |
| 실제 화면·요청 순서/횟수 | `ui-*-result.json`, `server-after-*.json`, `completed-state.json`, 로컬 XML/PNG |
| ACK·기기/서버 첨부 bytes | `verify-result.json`, `server-data-verification.json`, `private-synthetic-attachment.png` |
| 원본·인증·종료 | `baseline-data.json`, `final-data.json`, `*-credential.json`, `shutdown-status.json` |
| 자료 준비와 초기 실패 | `seed-result.json`, `initial-fixture-failure-*.json` |

## 10월 19일 재개: 수동 사진 백업 native·확인창 검증

### 고정 소스와 원본 DB 분리

Android 시작은 **`a456f18808777c7da76aa49aa56ba7f96a448878`**, 공통 동작은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**입니다. 원격 공통 HEAD `1739ed1`은 문서만 추가한 상태이며 검증 파일은 같은 내용임을 확인했습니다. 이전에 준비한 37개 원본·부재·고정 사본의 해시를 다시 대조하고 새 실행 근거 폴더로 보존했습니다.

production 22개·테스트 14개·Vitest 설정 1개를 임시 적용했습니다. 실제 앱 UI에 쓰는 database 파일명 한 곳만 고유 QA DB로 바꾸고 별도 적용 해시를 기록했습니다. 사진 파일·repository·동기화 소스와 고정 backend 사본 12개는 공통 SHA 그대로입니다. 기존 원본 `trip-painting-v1.db`를 v2 앱으로 열거나 migration하지 않았습니다. native 통합 검사는 매번 별도 고유 파일 DB를 사용했습니다.

기존 Debug APK·API 37·SwiftShader·CPU 4개, 전용 localhost 8082·임시 합성 HTTP만 사용했습니다. 새 native 빌드·설치·의존성 설치와 package/lock 변경은 없습니다. Node 24.21.0과 기존 backend 의존성은 읽기 전용으로 재사용했습니다. 원래 checkout·iOS 8081·iPhone은 조작하지 않았습니다.

### native 파일 준비 1개 PASS

합성 PNG를 `.jpg` 이름으로 저장한 뒤 실제 `preparePhotoFile`을 호출했습니다. native File 복사·SHA-256·바이트 수·내용 기반 PNG 판별과 `attachment.png` rename이 통과했습니다. 전송 body가 실제 `File`인 것도 확인했습니다. 합성 원본을 바꿔도 이미 준비한 전송 사본은 같은 바이트를 유지했고, 원래 바이트로 돌린 뒤 dispose가 전용 cache만 지우고 첨부본은 유지함을 확인했습니다. 이 변경은 합성 파일에만 수행했습니다.

### 실제 비동기 SQLite·expo/fetch multipart 통합 9개 PASS

실제 앱에 로드된 Repository·PhotoBackupCoordinator·PhotoSyncClient·VisitBackupCoordinator, native async SQLite adapter와 `preparePhotoFile`·`photoFetch`를 사용했습니다. 검증용 시점·계정 변화와 응답 유실은 명시적으로 주입했으며 DB 쓰기·rollback, 파일 API와 이후 HTTP는 실제 실행입니다.

| 통합 경우 | 결과 |
| --- | --- |
| 별도 v1→v2 보존 갱신 | v1 합성 DB의 두 owner visits/photos/outbox 전체 행·사진 URI·payload·attempts·소수점 시각 유지, 빈 사진 metadata 테이블 추가, integrity `ok` |
| PNG·JPEG 실제 multipart | 부모 방문 선행 전송, 사진 2건 ACK와 metadata 원자 저장. 기기 파일·서버 첨부 bytes·native 해시·크기·MIME 일치 |
| 서버 200 뒤 응답 유실 모사·DB 재개방 | 큐·작업 UUID·고정 해시 유지. 첨부 bytes를 바꾼 합성 재시도는 HTTP 전에 차단. 원래 bytes 복구 후 같은 UUID 실제 재전송, 서버 사진·영수증 각 1개 |
| 잘못된 사진 다음 정상 사진 | HEIC·누락·10MiB 초과·잘못된 헤더·서버가 해독하지 못하는 PNG의 대기 5건 보존. 다음 JPEG 1건 성공, 건너뛴 이유·수 정확 |
| 오래된 동의·foreground 이탈 주입 | 파일 준비·사진 HTTP·metadata 쓰기 없이 거절, 대기 보존 |
| 실제 HTTP 200 뒤 같은 owner token 변경 | 이전 세션 ACK 차단·큐와 미완료 metadata 보존. 현재 세션의 같은 UUID 재시도는 서버 중복 없음 |
| ACK metadata 실제 쓰기 뒤 token 변경 | 실제 SQL rollback, 완료 metadata·큐 삭제 없음. 수동 재시도 성공·서버 중복 없음 |
| ACK outbox 실제 DELETE 뒤 token 변경 | DELETE 1건 뒤 실제 rollback, payload·작업 UUID·미완료 metadata 복구. 수동 재시도 성공 |
| ACK metadata 실제 쓰기 뒤 DB 오류 주입 | 실제 rollback, 큐·metadata·기기 첨부본 보존. 수동 재시도 성공·서버 중복 없음 |

서버 관측 사진 POST는 **14회이며 모두 실제 multipart boundary**가 있었습니다. 이 중 해독 불가 합성 PNG 1회는 실제 400이고 나머지는 성공·멱등 재전송입니다. 최종 서버 사진·사진 영수증은 **각 8개**입니다. 별도 서버 DB v3와 저장 파일을 직접 대조해 8개 첨부본 모두 metadata의 해시·크기와 같고 썸네일이 별도 파일임을 확인했습니다. 서버 integrity는 `ok`입니다. 요청 횟수와 고유 저장 수를 합산하지 않습니다.

첫 검사 도구는 Inspector에 직접 넣은 중첩 async 함수가 native Promise보다 먼저 반환해 DB 준비 단계에서 조기 실패했습니다. 사진 POST는 0회였으며 제품 결함으로 판단하지 않았습니다. 이전 native 검사와 같은 TypeScript ES2015 generator 변환을 적용한 뒤 위 9개를 다시 실행해 통과했습니다. 사전 도구가 남긴 자체 합성 파일 18개는 앱을 멈춘 뒤 정확한 전용 이름만 정리했고 실패 근거도 보존했습니다. 최종 native 시험 DB 9개는 close/delete 후 DB·WAL·SHM 부재를 확인했습니다.

### 0건 합성 계정의 실제 확인창 PASS

실제 계정 화면에서 새 합성 계정을 가입했습니다. 이 계정은 QA DB·서버 모두 방문·사진·전송 대기 0건이며 원본 게스트 가져오기를 실행하지 않았습니다.

| 실제 화면 흐름 | 결과 |
| --- | --- |
| 사진 백업하기 → 전용 확인창 | 대상 계정·서버, JPEG/PNG·20개·10MiB·미지원/누락 대기·원본 보관·복원 미지원 표시 |
| 첫 확인창 취소 | 창만 닫힘, 사진 POST 0회 |
| 다시 열기 → 확인하고 전송 | 다시 명시적 확인 요구, “전송할 사진이 없습니다” 안내. 사진 대기·서버 저장 확인 0건, 방문 성공 시각 null 유지 |
| 수동 실행 뒤 다시 열기 → 취소 | 세 번째도 확인창 표시, 앞선 동의를 재사용해 자동 전송하지 않음 |
| 로그아웃 | QA guest·기록 꺼짐·0건, native 인증 항목 삭제 |

로그인 중 인증 항목의 AES 암호화와 이메일·비밀번호 평문 부재를 확인했습니다. 이 단계의 UI 계정은 서버 방문·사진·사진 영수증이 끝까지 0건입니다. 사진이 있는 계정의 전체 UI는 위 후속 검증 결과로 구분합니다. 실제 사진 본문과 ACK·재시도는 이 단계의 독립 native 통합 검사 결과입니다.

### 자동 검사·원본 보존·복구와 남은 범위

QA 파일명 오버라이드를 포함한 임시 소스에서 `bash scripts/verify-cloud.sh`가 PASS였습니다. 모바일 타입·ESLint·**14개 파일/378개 테스트**, 기존 backend syntax·native dependency load와 Android/iOS 생산용 JS/Hermes export를 포함합니다. `setup-cloud.sh`를 다시 실행하거나 의존성을 재설치하지 않았습니다. 공통 서버 61개 검사는 이번에 반복하지 않았으며 별도 고정 서버의 실제 native HTTP·파일 대조와 구분합니다.

시작·종료 읽기 전용 대조에서 원본 모든 owner visits/photos/outbox 전체 행·기존 사진 바이트가 같았습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 독립 QA UI DB는 v2·전체 방문/사진/outbox/metadata 0건·integrity `ok`를 확인했습니다.

앱·자체 Metro·HTTP를 먼저 멈춰 혼합 소스 재로딩을 차단한 뒤, 기존 14개 파일을 원문·해시로 복구하고 새 임시 파일 23개를 제거했습니다. 총 37개의 존재 여부·바이트를 다시 확인했으며 package/lock·보존 Debug APK hash도 그대로입니다. QA UI DB·WAL·SHM 3개만 제거했고, 합성 사진 첨부본과 전송 cache도 0개였습니다. 자체 reverse 8082·3002와 에뮬레이터를 종료했습니다. 서버 합성 DB·첨부본·fixture·원본 로그·화면·실패/성공 근거는 로컬 Git 제외 폴더에 남깁니다.

새 캐시·Time Machine·SDK·AVD·원본 자료 정리는 하지 않았습니다. 종료 가용량은 57,331,204,096 bytes(약 53.39GiB)이며 이번 확보량으로 표시하지 않습니다. 전송 중 프로세스 종료·실제 OS 네트워크 전환·자동 사진 백업·다운로드/새 기기 복원·여러 기기 삭제 병합·Android 실기기·Release는 NOT RUN입니다. P3-10 전체와 G1~G4 완료를 뜻하지 않습니다.

근거는 Git 제외 `docs/test-results/android-photo-backup-20261019/`에 있습니다. 계정·token·서버 주소·QA 이름·원본 DB·사진·화면·로그는 공개 PR에 포함하지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 SHA·임시 적용·원문 복구 | `validation-files.json`, `common-*.txt`, `original-*.txt`, `qa-database-override.ts` |
| native 파일·9개 통합과 서버 대조 | `native-file-snapshot-result.json`, `native-probe-result.json`, `server-summary.json`, `server-data-verification.json` |
| 실제 화면·인증 | `ui-*-result.json`, `ui-*-state.json`, `signed-in-credential.json`, `logged-out-credential.json`, 로컬 XML/PNG |
| 원본·종료·시험 파일·APK 보존 | `baseline-data.json`, `final-data.json`, `shutdown-status.json`, `native-file-cleanup-summary.json`, `apk-preservation.json` |
| 자동 검사·도구 조기 실패 근거 | `verification.log`, `harness-raw-async-failure-*.json`, `harness-early-db-cleanup.json` |

## 10월 19일 사진 백업 준비 저장·종료와 용량 정리

### 고정 소스는 사본만 준비, 사진 검사는 NOT RUN

Android 시작 HEAD는 `6d3777c`, 준비한 공통 기준은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**입니다. production JS/TS 22개, 테스트 14개, Vitest 설정 1개로 총 37개 파일의 기존 내용·부재와 고정 소스 사본을 보존했습니다. backend src·schema 사본 12개도 같은 SHA로 고정했습니다. 공통 database 소스의 DB 이름 한 곳만 고유 QA 파일명으로 바꾼 사본을 별도 준비했습니다.

**37개 소스와 QA DB 이름 변경은 실제 작업 파일에 적용하지 않았습니다.** 10월 19일 현재 파일의 기존 존재 여부·원문 해시, 고정 사본·backend 사본의 Git 원본 해시, QA 사본의 이름 한 곳만 변경되었음을 모두 재확인했습니다. package/lock도 변함없습니다. 원본을 덮어쓴 적이 없으므로 복원한 파일 수는 0개이며, 37개를 복원했다고 표시하지 않습니다.

사용자가 진행하던 범위까지만 저장하고 마무리하도록 요청해 사진 native·UI 시나리오를 시작하지 않았습니다. 10월 18일의 최종 종료 명령은 자동 승인 검토의 사용량 한도로 실행되지 않았고, 10월 19일 실제 상태를 확인한 뒤 종료를 완료했습니다. 새 서버·Metro·앱 실행, 새 에뮬레이터 시작, 설치·빌드·DB migration은 하지 않았습니다. 공통의 모바일·서버 자동 검사 결과도 이번 Android 실행으로 계산하지 않습니다.

| 준비된 후속 검사 | 이번 실행 |
| --- | --- |
| native File의 cache 복사·MIME별 rename·파일 보존 | NOT RUN |
| JPEG/PNG의 실제 expo/fetch multipart·서버 사진 저장 | NOT RUN |
| 별도 QA DB의 v1→v2 migration·기존 행 보존 | NOT RUN |
| 사진 ACK transaction·응답 유실·중복 재시도·계정 전환 guard | NOT RUN |
| 0건 합성 계정의 수동 사진 백업·매 실행 동의·계정 범위 UI | NOT RUN |

다시 검증할 때도 원본 v1 DB를 v2 소스로 열지 않습니다. 사본 해시를 재확인하고 고유 QA DB·합성 계정·합성 사진으로만 시작해야 합니다. 원본 게스트 가져오기와 사진 쓰기는 하지 않습니다.

### 원본과 실제 종료 상태

10월 18일 baseline과 10월 19일 종료 직전 읽기 전용 대조에서 모든 owner의 visits/photos/outbox 전체 행·기존 사진 바이트가 같았습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 준비한 QA DB와 WAL·SHM은 기기에 없었습니다.

이미 실행 중이던 전용 API 37 에뮬레이터만 종료했습니다. 종료 전 전용 8082·3002 리스너와 adb reverse는 없었습니다. 사진 준비에서 Metro·HTTP·Inspector를 시작한 적이 없으며, 다른 프로세스와 원래 checkout·iOS·iPhone은 조작하지 않았습니다. APK 두 개의 해시도 정리 전후 같습니다. 소스 사본·합성 fixture·원본 로그와 검증 자료는 Git 제외 경로에 보존합니다.

### 사용하지 않는 캐시 정리와 실제 공간 측정

사용자의 Mac 저장공간 정리 요청에 따라 Android Studio·Gradle 빌드가 실행 중이지 않은 상태에서 다음 네 경로만 삭제했습니다. SDK·NDK·JDK·Gradle 의존성 다운로드와 wrapper, AVD 전체·DB·사진·APK·서명·소스·기존 증거·백업·Android Studio LocalHistory는 보존했습니다. 원래 checkout과 iOS 캐시는 정리하지 않았습니다.

| 삭제한 재생성 가능 캐시 | 삭제 전 할당 크기 |
| --- | ---: |
| `~/.gradle/caches/9.3.1/transforms` | 3,544,608,768 bytes |
| `~/Library/Caches/Google/AndroidStudio2026.2.1/caches` | 530,694,144 bytes |
| `~/Library/Caches/Google/AndroidStudio2026.2.1/index` | 911,638,528 bytes |
| `~/.npm/_cacache` | 1,999,638,528 bytes |
| 합계 | **6,986,579,968 bytes, 약 6.51GiB** |

실제 파일시스템 가용량은 삭제 직전 **18,461,765,632 bytes(약 17.19GiB)**, 삭제 직후 **18,458,112,000 bytes(약 17.19GiB)**였습니다. **6.51GiB를 실제 확보했다고 주장하지 않습니다.** 시점 차이는 다른 프로세스의 쓰기·파일시스템 공간 회수도 포함합니다. 읽기 전용 조회에서 9월 28일·10월 12일의 purgeable Time Machine 로컬 스냅샷 두 개가 확인되어 삭제한 블록을 보유할 가능성이 있으나, 그 영향이나 개별 확보량은 측정하지 않았습니다. 이 단계에서는 로컬 백업을 보존했습니다. 다음 native 빌드·Studio 실행·패키지 설치 때 삭제한 캐시를 다시 생성하거나 내려받을 수 있습니다.

### 별도 사용자 허용 후 Time Machine 로컬 백업 두 개 정리

위 캐시 정리 이후 사용자가 **“두 로컬 백업 정리”**를 선택했습니다. 두 복원 시점이 사라진다는 안내에 대한 직접 허용을 확인한 뒤, Mac 데이터 볼륨에 있는 `2026-09-28-220816`과 `2026-10-12-210523`의 Time Machine 로컬 스냅샷만 정확한 식별자로 삭제했습니다. 두 삭제가 성공했고 승인한 스냅샷의 부재와 Time Machine 로컬 목록이 빈 상태임을 다시 확인했습니다. 외장·원격 백업, 프로젝트 `.snapshots/`, 현재 소스·앱 데이터·AVD·사진·APK·검증 자료는 삭제 대상으로 삼지 않았습니다. 새 앱 실행·native 검사·빌드는 시작하지 않았습니다.

로컬 백업 정리 직전 가용량은 **18,640,543,744 bytes(17.36GiB)**였습니다. 삭제 직후에는 24,808,034,304 bytes였고, 공간 회수가 더 반영된 후속 측정에서는 **62,259,200,000 bytes(57.98GiB, 약 62.3GB)**였습니다. 정리 전후 관측 증가는 **43,618,656,256 bytes(40.62GiB, 약 43.6GB)**입니다. 이 증가량을 Android 캐시만의 확보량으로 계산하거나 캐시 삭제량과 다시 합산하지 않습니다. 정확한 측정 시각·삭제 성공·전후 바이트는 로컬 `time-machine-cleanup.json`에 보존합니다.

원본 근거는 Git 제외인 `docs/test-results/android-photo-backup-20261018/`에 있습니다. 공개 문서·PR에는 실제 계정·비밀번호·token·서버 주소·QA 파일 식별자·기기 원본 DB·사진·로그를 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 고정 사본·기존 파일과 QA 이름 | `validation-files.json`, `common-*.txt`, `original-*.txt`, `qa-database-override.ts`, `frozen-backend/` |
| 원본 보존 대조 | `baseline-data.json`, `final-data.json`, `private-baseline-fingerprints.json` |
| 미적용 확인·종료·미실행 범위 | `restoration-result.json`, `shutdown-status.json`, `stop-status.json` |
| 삭제 경로·측정 바이트·APK 보존 | `disk-cleanup.json` |
| 별도 허용한 로컬 백업 두 개 삭제·실제 가용량 | `time-machine-cleanup.json` |

## 10월 18일 foreground 연결 복구

### 고정 소스와 검증 환경

Android 시작 기준은 `cf79090`, 공통 검증 소스는 **`51c96d249b2772517da3d9937cb03e568dc1b2d9`**입니다. 고정 SHA를 받기 전에는 원본 파일·해시·부재와 기존 DB/사진만 확인했고 새 소스를 적용하지 않았습니다. 원본 모든 owner 행·사진 바이트는 10월 17일 기준과 같았습니다. 이후 이전과 같은 필요한 JS/TS 14개만 임시 적용하고 backend의 src·schema도 이 SHA의 별도 읽기 전용 사본으로 고정했습니다.

기존 API 37·SwiftShader AVD, 보존한 Debug APK와 자체 Metro 8082를 사용했습니다. 설치 APK의 hash가 보존한 APK와 같았으며 새 설치·native rebuild·의존성 변경은 없었습니다. 실제 사용자 DB에 합성 방문을 넣거나 게스트 가져오기·초기화하지 않았고, 원래 checkout·iOS 8081·iPhone은 조작하지 않았습니다.

검사는 실제 앱에 로드된 Repository·Coordinator·VisitSyncClient와 `expo-sqlite`의 비동기 API를 사용했습니다. 각각 새 고유 파일 DB를 열어 원본과 다른 경로를 확인하고 WAL·busy timeout을 적용했습니다. 시험 계정·DB·서버 업로드 경로도 원본과 별도입니다. Inspector는 즉시 시작 응답을 받은 뒤 전역 완료 플래그를 polling했습니다.

### 연결 복구 13가지 PASS

전송 transport가 처음 두 번 `TypeError`를 내도록 제어했습니다. 이 두 실패는 실제 HTTP 요청이나 OS Wi-Fi 단절이 아닙니다. 이후 health·정상 ACK와 제어한 HTTP 오류 응답은 실제 임시 HTTP 서버를 사용했습니다. Coordinator의 시계만 주입해 진행했고, 실제 health abort에는 실시간 timer를 사용했습니다.

| 경우 | 실제 결과 |
| --- | --- |
| 두 transport 실패 → DB 재개방 → 이른 복구 | 첫 실패 후 retry/check는 30초. 둘째 실패 후 retry는 60초·check는 30초로 저장되고 재개방 후 동일. check 직전 호출은 요청 0건, due 시 무인증 GET health 뒤 긴 retry 전에 같은 작업 UUID ACK |
| health HTTP 503 | 방문 재전송 없이 connectionCheckAt만 진행. nextAttemptAt·큐·사진·완료 시각 보존 |
| health 응답 처리 중 opt-out | 자동 꺼짐을 따르고 두 시각·큐·사진 보존, 후속 sync 없음 |
| health 응답 처리 중 foreground 이탈 | 전송 pause, 두 시각·큐·사진 보존 |
| health 응답 처리 중 같은 owner token 교체 | 전송 pause, 두 시각·큐·사진 보존 |
| 연결 확인 CAS의 BEGIN 뒤 foreground 이탈 | 실제 transaction rollback. 일반 backoff로 기존 시각을 덮어쓰지 않음 |
| CAS 첫 native metadata 쓰기 뒤 token 교체 | 실제 쓰기 뒤 rollback, 원래 두 시각·큐·사진 보존 |
| CAS 첫 native 쓰기 뒤 DB 오류 주입 | 실제 쓰기 뒤 rollback. 일반 실패 backoff 대신 기존 시각 보존 안내·상태 유지 |
| CAS 직전 retry/check가 다른 값으로 갱신됨 | 오래된 expected 값의 CAS를 거절하고 새 두 시각·큐 보존 |
| 실제 HTTP 401 응답 | 인증 pause 저장, 자동 health·재전송 우회 없음 |
| 실제 HTTP 409 응답 | 충돌 pause 저장, 자동 health·재전송 우회 없음 |
| 실제 HTTP 500 두 번 | 일반 60초 retry 유지·connectionCheckAt null. 기한 전 health 우회 없음 |
| 실제 지연 health HTTP·3초 abort | AbortSignal이 발생하고 false 반환. 1회 관측 3,022ms, Authorization 없음 |

정상 복구에서는 방문 큐만 ACK되고 사진 큐·URI·연결·소수점 시각을 보존했습니다. 서버에서 실제 방문 1건·고유 방문 ID 1개·작업 영수증 1개를 직접 대조했습니다. 본 검사 health 요청은 서버 관측 10회였고 모두 GET·Authorization 없음이었습니다. client에서도 credentials omit을 확인했습니다. 준비 도구의 health 호출은 이 10회에 합산하지 않았습니다.

health·CAS 경쟁 시점, DB 오류와 HTTP 401/409/500 응답은 검증용 adapter·transport·서버 제어로 만들었습니다. CAS 자체의 BEGIN·쓰기·ROLLBACK은 실제 비동기 native SQLite입니다. 모든 파일 DB의 integrity가 `ok`였고, 작업 ID·payload·생성 시각·attempts를 포함한 큐 보존을 대조했습니다. 3,022ms는 해당 Debug 에뮬레이터 1회 관측이며 성능 SLA나 실기기 수치가 아닙니다.

실제 사용자 계정의 nonempty 큐·OS 네트워크 변경·전송 중 프로세스 종료·전체 앱 E2E는 별도입니다. 새 “백업 확인 중/다음 백업 확인” 문구의 실제 화면 검사는 하지 않았습니다. 이전 14개 전송 검사와 장시간 화면 꺼짐도 이번에 반복하거나 새 결과로 합산하지 않았습니다.

### 사진 서버 기반과 모바일 범위

고정 backend 사본은 별도 합성 DB를 version 3으로 초기화했습니다. 이번 Android 검사는 방문·health 경로만 사용했으며 새 사진 API를 호출하지 않았습니다. **모바일 사진 전송·동의·다운로드·다른 기기 복원은 여전히 연결 전**입니다. 사진 행·큐·URI 보존 결과를 사진 업로드 성공으로 표시하지 않습니다. 공통 서버 사진 검사 61개도 이 Android 실행 수에 넣지 않습니다.

### 자동 검사·원본 보존·종료

임시 소스에서 `npm --prefix travel_visit_tracker run check`의 타입 검사·ESLint·이 worktree의 기존 **90개 테스트가 PASS**였습니다. 공통 모바일 232개·서버 61개와 Android의 실제 13가지 native 검사는 별도 결과입니다.

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 모든 owner의 visits/photos/outbox 전체 행·기존 사진 바이트는 시작과 같습니다. 별도 시험 DB **12개와 WAL·SHM의 부재**, 원본 DB의 존재를 확인했습니다. timeout 경우에는 별도 DB를 만들지 않았습니다.

자체 Metro·합성 HTTP 서버·Inspector helpers·에뮬레이터를 종료하고 전용 연결만 제거했습니다. 임시 파일 14개 중 기존 5개는 원문과 바이트 단위로 같게 복구하고 새 9개는 적용 해시 확인 후 제거했습니다. package/lock·APK·서명·SDK·AVD·백업·원본 로그·증거는 보존했습니다. 이번에는 새 native 빌드·캐시 삭제나 용량 정리를 하지 않았고 확보량은 0입니다. 시점별 가용량은 준비 18.46GiB·종료 16.73GiB이며 다른 작업·AVD의 사용량을 분리한 값은 아닙니다.

원본은 Git 제외인 `docs/test-results/android-connection-recovery-20261018/`에 보존합니다. 공개 요약에는 계정·token·서버 주소·기기 값·원본 사진·DB·원본 로그를 넣지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 준비·고정 SHA·복구 | `preparation.json`, `validation-files.json`, `original-*.txt`, `common-*.txt`, `restoration-result.json` |
| 원본·기존 APK 대조 | `prior-baseline-match.json`, `baseline-data.json`, `final-data.json`, `prepared-state.json`, `final-runtime-state.json` |
| native 13가지·시점 제어 | `native-probe-result.json`, `native-probe-manifest.json`, 비공개 검증 표현식·새 fixture |
| 실제 HTTP·DBv3·중복 없음 | `server-summary.json`, `server-verification.json` |
| 시험 DB 제거·종료·자동 검사 | `temporary-databases-cleanup.json`, `shutdown-status.json`, `common-check.log`, `metro.log`, `server.log`, `emulator.log` |

남은 수용 범위는 실제 Android·Release·배터리·OS 백업/복원, nonempty 실제 사용자 UI의 연결 복구·전송 중단, 모바일 사진 전송·새 기기 복원·여러 기기 삭제 병합입니다. 이번 결과로 전체 G1~G4를 완료 처리하지 않습니다.

## 10월 17일 방문 백업 화면·Coordinator와 경쟁 조건

### 소스 기준과 임시 적용

Android 시작 기준은 `f05a3b3`입니다. 공통 **`c95d6caa209086431b371a68cd2ac0d2222aa48b`**에서 계정·설정·layout, 두 store, storage/database·repository·outbox, auth·credentials·session·visitSync·visitBackup의 필요한 JS/TS 파일 14개만 임시 적용했습니다. 원래 있던 5개 파일의 원문·해시와 새로 생기는 9개 파일의 부재를 먼저 보존했습니다. 공통 backend 소스도 같은 커밋의 읽기 전용 사본으로 고정하고 별도 루프백 서버·합성 DB·업로드 경로를 사용했습니다.

첫 화면 검사와 native HTTP 검사 종료 후 공통 수정 **`202a2e250420b10056c518d8d26454035f548615`**의 다음 세 파일만 후속 적용했습니다. 기존 원상 복구 기준은 Android 시작 HEAD 그대로 유지하고 두 단계의 해시를 구분했습니다.

- `travel_visit_tracker/src/storage/repository.ts`
- `travel_visit_tracker/src/services/visitSync.ts`
- `travel_visit_tracker/src/services/visitBackup.ts`

두 커밋 사이 backend 내용은 같았습니다. 기존 설치 Debug APK·API 37·SwiftShader·Android 전용 8082만 사용했습니다. 설치 APK의 hash가 10월 15일 보존한 새 APK와 같음을 재확인했고, 새 설치·native rebuild·의존성 설치나 package/lock 변경은 없었습니다. iOS 8081·연결된 iPhone·원래 checkout·공유 진행표는 수정하지 않았습니다.

### `c95d6ca` 실제 계정 화면

화면에서 새 합성 계정을 가입했습니다. 이 계정은 기기·서버 모두 방문 0건이며 원본 게스트 가져오기를 실행하지 않았습니다.

| 실제 화면 흐름 | 결과 |
| --- | --- |
| 가입 후 기본 설정 | signed-in·계정 방문/사진/대기 0건, 자동 방문 백업 꺼짐 |
| 수동 빈 백업 | “전송할 방문이 없습니다.” 표시, 마지막 성공 시각을 만들지 않음 |
| 자동 백업 동의창 | 대상 계정·서버, 화면이 열려 있을 때의 전송 범위, 사진 백업·다른 기기 복원 미지원 표시 |
| 동의 취소 | 자동 백업 꺼짐 유지 |
| 동의 후 켜기 | 자동 백업 켜짐·설명 표시, 기록 꺼짐 유지 |
| 강제 종료·재실행 | 같은 합성 계정의 세션과 opt-in 복구, 실제 me 성공, 계정 자료 0건 유지 |
| 자동 백업 끄기·로그아웃 | 꺼짐 확인 후 guest·토큰 없음·기록 꺼짐으로 복귀, native 인증 항목 삭제 |
| 원본 대조 | 모든 owner의 visits/photos/outbox 전체 행·기존 사진 바이트 불변, integrity `ok` |

로그인 중 native SecureStore 인증 항목의 AES 암호화 저장과 이메일·비밀번호 평문 부재도 확인했습니다. 화면 원본과 계정·서버 값은 로컬에만 보존합니다. **UI의 실제 비어 있지 않은 방문 전송이나 전송 중 프로세스 종료를 확인한 결과는 아닙니다.** `202a2e2`에서 이 가입·동의 UI 전체를 다시 실행하지 않았으며, 그 단계는 아래의 독립 저장·전송 검사와 마지막 guest 상태 확인으로 구분합니다.

### 실제 비동기 native SQLite·HTTP 검사: 두 기준 모두 14개 PASS

`c95d6ca`와 세 파일 수정 후 `202a2e2`에서 **각각 새 고유 파일 DB·새 합성 계정으로 동일한 14개 검사를 실행**했습니다. 실제 앱에 로드된 Repository·Coordinator·VisitSyncClient, `expo-sqlite` 비동기 API와 별도 실제 HTTP 서버를 사용했습니다. production과 같은 네 async adapter 함수, WAL·busy timeout을 사용하고 시험 DB 경로가 원본과 다름을 확인했습니다.

| 확인한 항목 | 두 단계 결과 |
| --- | --- |
| 실제 async SQLite·실제 합성 HTTP | PASS |
| 자동 백업 기본 꺼짐 | 자동 실행은 전송하지 않음 |
| 수동 방문 ACK·성공 시각 | 방문 1건 ACK 후 성공 시각 저장 |
| 사진 큐·URI·소수점 시각 | 사진 큐 1건·URI·연결과 소수점 시각 유지 |
| 빈 큐 수동 실행 | 전송 호출·성공 시각 변경 없음 |
| 서버 저장 뒤 응답 유실 모사 | 방문 큐·사진 큐 보존, 다음 재시도 시각 저장 |
| DB 닫기·재개방·일찍 재시도 | 지연 시각 복구, 시각 전 실행은 전송하지 않음 |
| 같은 작업 UUID 재전송 | ACK 후 방문 큐만 제거, 사진 큐는 유지 |
| 서버 중복 방지·무결성 | 각 시험 계정의 방문은 고유 ID 2건, integrity `ok` |

14개 세부 플래그는 단계별 결과 파일에 있습니다. 실제 서버의 성공한 sync 응답은 두 단계 합계 6회였고, 각 단계의 서버 방문 수·고유 ID 수는 2/2였습니다. UI 시험 계정의 서버 방문은 끝까지 0건입니다.

응답 유실은 서버가 200 응답을 낸 뒤 client transport가 예외를 내도록 모사했습니다. 재시도 시각은 Coordinator의 주입 가능한 시계를 진행해 검증했습니다. 실제 OS 네트워크 단절·전송 중 앱 강제 종료나 실시간 30초 대기를 수행한 결과로 바꾸지 않습니다.

### `202a2e2` 경쟁 조건: 실제 native DB·합성 ACK 네 가지 PASS

각 경우를 별도 고유 DB에서 실행했습니다. 이 네 검사는 HTTP 대신 합성 ACK 응답을 사용하며, SQLite의 BEGIN·DELETE·COMMIT·ROLLBACK은 실제 비동기 native API입니다.

| 경쟁 조건 | 실제 결과 |
| --- | --- |
| 빈 큐 snapshot 뒤 새 방문·삭제 작업 enqueue | 완료 저장 transaction이 false를 반환하고 성공 시각은 null 유지. Coordinator가 다음 배치까지 처리한 뒤에만 완료 저장 |
| 같은 enqueue 뒤 자동 백업 opt-out | 첫 배치만 ACK, 새 두 작업을 큐에 남기고 성공 시각을 만들지 않음 |
| ACK가 다른 transaction 뒤에서 대기 중 같은 owner의 token 교체 | captured guard 전달, ACK transaction rollback·Runner paused·ACK 0건, 큐 내용과 사진 URI 보존 |
| 실제 outbox DELETE 직후 같은 owner의 token 교체 | 실제 삭제 1건 뒤 rollback, Runner paused·ACK 0건. 방문·사진·outbox ID/payload/시각 보존 |

각 DB의 integrity는 `ok`였습니다. 경쟁 시점을 adapter의 제어 지점으로 만들었으며 실제 사용자 DB·세션·방문에는 주입하지 않았습니다. 새 기능 전체 E2E나 모든 동시 실행 조합의 통과로 확대하지 않습니다.

### 자동 검사·보존·종료

각 임시 소스 단계에서 `npm --prefix travel_visit_tracker run check`를 실행해 타입 검사·ESLint·이 worktree의 기존 **90개 테스트**가 PASS였습니다. 공통의 189개 모바일·36개 서버 검사 수를 Android 실행 결과로 바꾸지 않습니다. Android 커밋에는 공통 코드·테스트를 넣지 않습니다.

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 원본 DB에 합성 방문을 넣거나 게스트 가져오기·삭제·초기화하지 않았습니다. 독립 시험 DB **6개와 해당 WAL·SHM의 부재**, 원본 DB의 존재를 확인했습니다.

Inspector helpers·자체 Metro 8082·별도 HTTP 서버·에뮬레이터를 종료하고 전용 연결만 제거했습니다. 원래 있던 5개 파일은 바이트 단위로 복구하고 새 QA 파일 9개는 적용 해시를 확인한 뒤 제거했습니다. package/lock은 그대로입니다. 기존 APK·서명·SDK·AVD·DB·사진·백업·로그·원본 증거도 보존했습니다.

시작 가용량은 20.52GiB, 종료 때는 18.52GiB였습니다. 파일시스템의 해당 시점 값이며 AVD·다른 작업의 사용량을 분리한 결과는 아닙니다. 이번에는 새 native 빌드나 캐시·중간 바이너리 삭제를 하지 않았고, 용량 확보량도 0입니다. 이전 날짜의 정리 결과와 합산해 이번 확보량으로 표시하지 않습니다.

원본 근거는 Git 제외인 `docs/test-results/android-backup-ui-20261017/`에 보존합니다. 공개 문서에는 상태·개수·검증 한계만 적으며 계정·토큰·서버 주소·사진·기기 값과 원본 로그는 올리지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 두 SHA·임시 파일·복구 | `validation-files.json`, `original-*.txt`, `common-*.txt`, `restoration-result.json` |
| 화면·동의·재실행 | `ui-summary.json`, `consent-summary.json`, `after-*-state.json`, `restored-state.json`, 비공개 화면 XML·PNG |
| native 인증 항목·원본 대조 | `*-credential.json`, `baseline-data.json`, `after-*-data.json`, `final-data.json`, 비공개 fingerprint 기준 |
| c95 실제 HTTP 14개 | `c95-native-probe-result.json`, `c95-native-probe-manifest.json`, `c95-complete.json` |
| 202a 실제 HTTP 14개 | `native-probe-result.json`, `native-probe-manifest.json` |
| 202a DB 경쟁 조건 네 가지 | `race-probe-result.json`, `race-probe-manifest.json`, `race-probe-source.js` |
| 서버·임시 DB 제거 | `server-summary.json`, `server-final-counts.json`, `temporary-databases-cleanup.json` |
| 자동 검사·설치 APK·종료 | `common-check.log`, `common-202a-check.log`, `installed-apk-preserved.json`, `shutdown-status.json`, `metro*.log`, `server.log`, `emulator.log` |

실제 Android 휴대폰·Release·OS 클라우드 백업/복원·배터리와 G1~G4 전체 조건은 남아 있습니다. 사진 업로드·새 기기 복원·여러 기기 삭제 병합과 비어 있지 않은 앱 UI의 전송 중단·복구도 별도입니다. 공통 수정의 Android 제안은 이번 네 조건에서 해결 확인했으며, 결과만 기존 PR #1에 저장합니다.

## 10월 16일 설치 APK와 실제 비동기 SQLite

### 기존 자료를 보존한 APK 업데이트

Android 시작 기준은 `3bb9493`입니다. 10월 15일 빌드한 APK의 보존 hash·파일 크기, APK 서명 유효성, 현 설치 앱과의 서명·package·버전 호환성을 먼저 대조했습니다. 모든 조건과 원본 자료 대조를 통과한 뒤 **`adb install -r`을 한 번만** 실행했고 성공했습니다. 새 의존성, prebuild나 native rebuild는 없었으며 uninstall, wipe, 재시드와 원본 DB 삭제도 하지 않았습니다.

설치 후 package 경로에서 읽은 APK의 SHA-256이 보존한 새 APK와 같았습니다. 따라서 그 바이너리의 최종 manifest와 컴파일된 XML을 대조해 fullBackupContent·dataExtractionRules 참조, full-backup·cloud-backup·device-transfer의 `sharedpref/SecureStore` 제외를 설치 앱 기준으로 확인했습니다. 초기 XML 검사식은 aapt의 속성 값과 Raw 표시를 중복 집계해 실패했으며, 속성 행만 세도록 바로잡고 읽기 전용으로 재확인했습니다. 재설치는 하지 않았습니다.

| 설치 전후 검사 | 결과 |
| --- | --- |
| 보존 APK hash·서명·설치 호환성 | PASS |
| 데이터 보존 업데이트 | `install -r` 1회 성공 |
| 설치 APK와 검증 APK의 hash | 동일 |
| 설치 앱의 백업 제외 규칙 | manifest 참조와 세 규칙 PASS |
| 모든 owner의 visits·photos·outbox 전체 행 | 설치 전후 hash 동일 |
| 기존 guest 행·사진 파일 바이트 | 10월 14일 원본 기준과 동일 |
| 최종 기존 자료·상태 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

이번에는 **실제 OS 클라우드 백업·복원·기기 전송을 시작하지 않았습니다.** 이 검사로 방문·사진의 OS 복원이나 실제 Android·Release 수용 조건을 완료 처리하지 않습니다.

### production과 같은 비동기 adapter 검사

공통 소스는 **`f4eb401cc58a7a03acc5fd38797f6c938b62b932`에 고정**했습니다. `repository.ts`, `schema.ts`, `dwell.ts`, `database.ts` 네 파일을 Git에서 읽어 원문·해시를 로컬에 보존했습니다. 작업 중인 공통 소스나 원래 checkout은 복사하지 않았고 Android 앱 소스에도 overlay하지 않았습니다.

`database.ts`에서 production `SqlConnection` 객체의 본문을 그대로 추출했습니다. 네 함수는 `execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`를 직접 호출하며 sync API wrapper를 쓰지 않습니다. `getConnection()` 자체를 실행하면 원본 DB가 열리므로 실행하지 않았습니다. 대신 새 고유 이름의 합성 DB를 `openDatabaseAsync`로 열고 production과 같은 WAL·busy timeout을 설정한 뒤, 그 연결에 같은 adapter 본문과 Repository를 연결했습니다. `PRAGMA database_list`로 시험 파일 경로를 확인했습니다.

Hermes Inspector 표현식은 즉시 반환하고 전역 finished 플래그를 별도 polling했습니다. 검증 코드는 지난번 확인한 ES2015 Promise 변환을 사용했습니다. 앱 시작 직후 Inspector가 아직 준비되지 않은 경우에만 제한된 대기를 추가했고, 실제 DB 시험은 한 번 실행해 PASS였습니다.

| 합성 파일 DB의 비동기 API 검사 | 결과 |
| --- | --- |
| 합성 관측·방문·사진 행 생성 | async API로 성공. 실제 사진 파일은 만들지 않음 |
| A/B 계정 분리 | A의 방문·사진을 B에서 볼 수 없음 |
| 명시적 GPS 가져오기 | GPS 방문 1건·사진 행 1건 이동, 개발 방문은 guest에 남음 |
| UUID·session·소수점 시각·사진 URI·연결 | 모두 동일 |
| outbox 내용 보존 | owner 변경 외 ID·entity·operation·payload·생성 시각·attempts 동일 |
| 비활성 owner import·attempt 쓰기·ACK | 모두 거절, outbox 불변 |
| B의 ACK에 A 작업을 전달 | 삭제 0건, A의 대기 자료 보존 |
| async close·reopen | 방문 UUID·소수점 시각·outbox 유지 |
| 무결성·종료 | integrity `ok`, closeAsync·deleteDatabaseAsync 성공 |
| 파일 제거·원본 재대조 | 해당 임시 DB·WAL·SHM 없음, 원본 전체 행·사진 바이트 불변 |

10월 15일의 메모리 DB·sync native wrapper 결과와 구분합니다. 이번에는 production과 같은 **네 비동기 adapter 함수**를 실제 native SQLite에서 확인했지만, 앱의 연결 캐시·계정 화면 전환·서버 전송 UI의 E2E 전체를 검증한 것은 아닙니다. 준비 중인 공통 백업 버튼·자동 전송 소스도 이번 결과에 포함하지 않습니다.

### 사용자 요청 용량 정리와 종료

검증 후 자체 Metro 8082·에뮬레이터·Inspector를 종료하고 열린 파일을 대조했습니다. 최초 서버가 IPv6 localhost에만 떠서 IPv4 연결용 서버를 준비하는 동안 두 프로세스가 있었으며, 사용하지 않는 자체 IPv6 서버를 먼저 종료했습니다. 최종적으로 두 자체 서버 모두 종료됐습니다. 공통 iOS 8081과 연결된 iPhone은 조작하지 않았습니다.

10월 15일 본인 prebuild가 만든 디렉터리 안의 남은 재생성 가능한 `.so`, `.pch`, `.class`, `.jar`, `.o`, `.a`, `.dex`, `.flat`, `.bc`만 정리했습니다. 디렉터리 생성 이력과 실제 worktree 경로를 기준으로 소유를 확인했습니다. 일부 복제 파일의 생성 시각은 원본 시각을 유지했으므로 파일 시각만으로 사전 존재 여부를 판단하지 않았습니다. 삭제 전 해당 파일의 열린 핸들이 없었고 APK·서명·로그·근거 해시는 삭제 후에도 같았습니다.

| 정리 경로 | 해당 디렉터리 |
| --- | --- |
| 앱 | `travel_visit_tracker/android/app/build/intermediates`, `travel_visit_tracker/android/app/build/tmp` |
| `travel_visit_tracker/node_modules/<package>/android/build/intermediates` | `expo-modules-core`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-screens`, `react-native-worklets` |
| `travel_visit_tracker/node_modules/<package>/android/.cxx` | `expo-modules-core`, `react-native-reanimated`, `react-native-worklets` |
| `travel_visit_tracker/node_modules/<package>/android/build/tmp` | `expo`, `expo-constants`, `expo-dev-launcher`, `expo-dev-menu`, `expo-json-utils`, `expo-manifests`, `expo-modules-core`, `expo-updates-interface`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-worklets`, `@expo/log-box`, `@maplibre/maplibre-react-native` |

파일 **3,265개, 논리 크기 2,189,723,038 bytes(2.04GiB)**를 제거했습니다. 실제 파일시스템 가용량은 정리 직전 24,603,115,520 bytes에서 직후 24,764,792,832 bytes로 **161,677,312 bytes(154.19MiB) 증가**했습니다. 파일 크기 합계를 실제 확보량으로 바꾸지 않습니다. 복제 블록 공유나 다른 작업의 디스크 사용량을 분리 측정한 결과도 아닙니다.

최종·기존 APK와 설치 전 APK 복사본, signing 파일, 모든 로그·XML·JSON·원본 근거, AVD·DB·사진·outbox·백업은 유지했습니다. 중복된 최종 APK를 삭제하지 않았고 원래 checkout·전역 캐시·SDK 정리는 이 Android 작업에서 하지 않았습니다. 공통 코드와 package/lock은 변경하지 않았으므로 복구할 임시 overlay도 없습니다. 삭제한 중간 바이너리는 필요할 때 다시 빌드해야 합니다.

이번 원본은 Git 제외인 `docs/test-results/android-update-async-20261016/`에 있습니다. 공개하는 내용은 이 결과 요약이며 원본 DB·사진·서명·기기 경로와 APK는 커밋하지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 소스 고정·adapter 추출 | `source-manifest.json`, `*-source.ts`, `production-async-adapter.txt`, `async-probe-manifest.json` |
| 설치 전 확인·설치·최종 바이너리 | `apk-preflight.json`, `install-r.log`, `installed-apk-result.json`, `installed-manifest.txt`, `secure_store_*-installed-compiled.txt` |
| 실제 비동기 시험·임시 DB 정리 | `async-native-probe.js`, `async-native-start.json`, `async-native-result.json`, `temporary-database-cleanup.json` |
| 원본 전후 비교 | `before-install-data.json`, `after-install-data.json`, `after-async-data.json`, 비공개 행·사진 fingerprint 기준 |
| 용량·종료 | `cleanup-inspection.json`, `cleanup-removed-files.json`, `cleanup-summary.json`, `shutdown-status.json`, `metro*.log`, `emulator.log` |

## 10월 15일 SecureStore 백업 제외와 native SQLite

### 최종 APK의 백업 선언 확인

Android 시작 기준은 `b32afc6`, 공통 소스 기준은 `d51a8fefc8603327ad13bf2dba67045372eefa0a`입니다. 공통 `app.config.ts` 한 파일만 정확한 커밋 내용으로 임시 적용했습니다. 차이는 `expo-secure-store` 플러그인의 `configureAndroidBackup: true`, `faceIDPermission: false` 선언입니다. 원문과 양쪽 해시를 보존했고, 검증 후 원래 Android HEAD와 바이트 단위로 같게 복구했습니다. package/lock과 의존성은 바꾸지 않았습니다.

Node 24.21.0, JDK 17, 기존 Android SDK로 Android만 prebuild하고 아래 빌드를 실행했습니다. Expo는 offline, dotenv 비활성 조건이었습니다.

```sh
# travel_visit_tracker/에서
EXPO_OFFLINE=1 EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 CI=1 npx expo prebuild --platform android --no-install
# travel_visit_tracker/android/에서, 기존 JDK/SDK 환경 사용
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --offline --max-workers=2 --no-daemon --console=plain
```

빌드는 **2분 42초, 497개 task로 성공**했습니다. 기존 APK의 최종 manifest에는 아래 두 참조가 없었습니다. 새 `travel_visit_tracker/android/app/build/outputs/apk/debug/app-debug.apk`에서는 SDK의 `aapt`로 참조 ID와 컴파일된 XML을 대조했습니다.

| 최종 APK 검사 | 결과 |
| --- | --- |
| `android:fullBackupContent` | `@xml/secure_store_backup_rules` 리소스로 연결됨 |
| `android:dataExtractionRules` | `@xml/secure_store_data_extraction_rules` 리소스로 연결됨 |
| 기존 full-backup 규칙 | `sharedpref` 도메인의 `SecureStore` 제외 |
| cloud-backup 규칙 | `sharedpref` 도메인의 `SecureStore` 제외 |
| device-transfer 규칙 | `sharedpref` 도메인의 `SecureStore` 제외 |
| APK 서명 검증, 기존 APK와 서명·package 비교 | 모두 PASS |

새 APK는 109,406,499 bytes이며 로컬에 보존합니다. **설치하지 않았으므로 에뮬레이터에 남은 기존 APK의 백업 정책이 바뀐 것은 아닙니다.** 이번 PASS는 최종 Debug 바이너리에 제외 규칙이 들어간다는 근거입니다. OS 백업·복원·기기 전송 실행, 방문 DB·사진의 OS 백업 보존, Release나 실제 휴대폰 시험은 수행하지 않았습니다. `faceIDPermission: false`의 iOS native 결과도 이번 Android 검사 범위가 아닙니다.

### 원본과 분리한 저장 계층 시험

기존 설치 Debug APK의 Hermes와 `expo-sqlite` native 함수를 사용했습니다. 공통 `d51a8fe`의 repository/schema/dwell 원문과 해시를 별도로 보존하고, 저장소 파일을 덮어쓰지 않은 채 Inspector의 격리된 함수로 불러왔습니다. 새 연결의 **`:memory:` DB**만 사용했으며 `PRAGMA database_list`의 빈 파일 경로를 확인했습니다. 기존 앱의 DB 연결과 구분되며 종료 시 `closeSync()`로 모든 시험 자료를 해제했습니다.

| 합성 native SQLite 검사 | 결과 |
| --- | --- |
| A/B 계정 조회 분리 | A가 가져온 방문·사진을 B가 볼 수 없음 |
| 명시적 게스트 가져오기 | GPS 방문 1건과 연결 사진 행 1건만 이동, 개발 방문은 guest에 남음 |
| 비활성 계정 가져오기 | 현재 계정과 다르면 거절됨 |
| 식별자·시각·사진 연결 | 방문 UUID, session ID, 소수점 시각, 사진 URI와 visit 연결 보존 |
| 전송 대기 자료 | owner 변경 외 ID, entity, operation, payload, 생성 시각, attempts 보존 |
| 계정 전환 후 전송 보호 | 비활성 A의 attempt 갱신 거절, B의 ACK로 A의 대기 자료가 삭제되지 않음 |
| 무결성·종료 | integrity `ok`, 메모리 DB 닫힘 |
| 원본 앱 대조 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

사진은 합성 URI 문자열과 연결 행만 만들었고 실제 사진 파일을 만들지 않았습니다. 위치 관측 결과를 합성한 저장 계층 시험이므로 GPS 수신·체류 판정이나 앱 UI, 서버 전송 E2E의 통과 근거로 사용하지 않습니다. 동기식 native SQLite 호출을 Repository 연결 형태로 감싸 실행했으며 production의 비동기 adapter 전체를 검증한 결과도 아닙니다.

초기 Inspector 시험은 native async/await로 변환한 검증 코드에서 방문 생성 후속 단계가 실패했습니다. 같은 공통 원문을 TypeScript ES2015 Promise 흐름으로 변환한 뒤 전체 항목이 PASS였습니다. 제품 소스는 수정하지 않았고, 초기 실패와 최종 결과를 함께 보존합니다. 이전 credentials 직접 probe의 미완료 상태를 이번 결과로 소급 변경하지 않습니다.

### 용량 정리와 종료

빌드와 Inspector, 자체 Metro 8082, 에뮬레이터 종료를 확인한 뒤 이번 빌드에서 새로 생성한 중간 바이너리만 정리했습니다. 각 디렉터리·파일 생성 시각, 이 worktree 안의 실제 경로, 열린 파일 부재를 확인했습니다. `.so`, `.o`, `.a`, `.dex`, `.class`, `.jar`, `.flat`, `.bc` 파일 **1,236개, 논리 크기 2,570,324,503 bytes**를 제거했습니다. 디렉터리와 로그·리포트·XML·JSON은 유지했습니다.

정리 직전 가용량은 23,472,234,496 bytes(21.86GiB), 직후는 25,807,925,248 bytes(24.04GiB)였습니다. **즉시 측정한 확보량은 2,335,690,752 bytes(2.18GiB)**입니다. 빌드 전 기록값은 29,941,760,000 bytes(27.88GiB), 빌드 직후는 25,053,179,904 bytes(23.33GiB)였습니다. 각 시점의 파일시스템 가용량이며 다른 프로세스 사용량을 분리한 값은 아닙니다.

정리한 경로는 다음과 같습니다. 아래 package 이름은 각 행의 접두·접미 경로에 그대로 대응합니다.

| 경로 | 해당 디렉터리 |
| --- | --- |
| 앱 | `travel_visit_tracker/android/app/build/intermediates`, `travel_visit_tracker/android/app/.cxx` |
| `travel_visit_tracker/node_modules/<package>/android/build/intermediates` | `expo`, `expo-constants`, `expo-dev-client`, `expo-dev-launcher`, `expo-dev-menu`, `expo-dev-menu-interface`, `expo-json-utils`, `expo-manifests`, `expo-modules-core`, `expo-updates-interface`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-svg`, `react-native-worklets`, `@expo/log-box`, `@maplibre/maplibre-react-native`, `@react-native-masked-view/masked-view` |
| `travel_visit_tracker/node_modules/<package>/android/.cxx` | `expo-modules-core`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-screens`, `react-native-worklets` |

기존·신규 APK와 debug signing 파일은 정리 전후 해시가 같습니다. 원본 checkout, 전역 Gradle 캐시, SDK, AVD, DB·사진·outbox, 기존 증거·백업·로그는 유지했습니다. 공통 임시 설정은 복구했고 iOS 8081 프로세스는 그대로입니다. 자체 8082 연결만 제거했으며 다음 빌드 때 삭제한 중간 바이너리는 다시 생성해야 합니다.

이번 원본은 Git 제외인 `docs/test-results/android-backup-20261015/`에 보존합니다. 공유 가능한 결과는 이 문서에 기록하며 APK, 원본 로그, 서명 값, DB와 기기 식별자는 공개하지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 기준 소스·복구 | `validation-files.json`, `original-*.txt`, `restoration-result.json`, `synthetic-source-manifest.json`, `*-source.ts` |
| 빌드·APK 검사 | `prebuild.log`, `assemble-debug.log`, `old-apk-summary.json`, `apk-backup-result.json`, `new-apk-manifest.txt`, `secure_store_*-compiled.txt` |
| 격리 SQLite와 원본 대조 | `synthetic-native-probe.js`, `make-sqlite-probe.cjs`, `run-sqlite-probe.mjs`, `synthetic-native-attempt*.json`, `synthetic-native-result.json`, `synthetic-native-summary.json`, `app-before-synthetic.json`, `app-after-synthetic.json` |
| 정리·종료 | `cleanup-candidate-inspection.json`, `cleanup-removed-files.json`, `cleanup-summary.json`, `shutdown-status.json`, `metro.log`, `emulator.log` |

이번 변경은 Android 결과 문서만 포함합니다. 공통 진행표·체크리스트는 수정하지 않았고 실제 기기·Release·배터리 수용 조건도 완료로 올리지 않았습니다.

## 10월 14일 P3-07 Android 로그인 QA 결과

**이번 native 흐름은 PASS입니다.** 실제 backend의 `createBackend`를 읽기 전용으로 재사용하되 별도 루프백 서버, 임시 DB·업로드 폴더와 합성 계정만 사용했습니다. 실제 backend의 data/uploads나 환경 비밀값은 사용하지 않았습니다. 공개 문서에는 합성 계정 값, 토큰, 서버 주소와 원본 JSON을 적지 않습니다.

| 시험 | 실제 결과 |
| --- | --- |
| 가입 | 실제 가입 API 성공 후 계정 뷰로 전환. 계정 로컬 자료는 0건, 게스트 자료는 별도로 유지 |
| 저장·강제 재실행 복구 | native SecureStore에 AES 암호화 항목 저장 확인. 앱 강제 종료·재실행 후 세션 복구와 실제 me 확인 성공 |
| 서버 오프라인 | offline 상태로 바뀌어도 토큰과 같은 계정의 로컬 뷰 유지. 게스트로 임의 전환하지 않음 |
| JWT 비밀값 교체 | 실제 me 요청이 401로 거절된 뒤 expired·토큰 없음으로 변경. 같은 계정 뷰와 게스트 자료 유지 |
| 재로그인 | 같은 합성 계정으로 실제 로그인 API 성공, signed-in·토큰 있음으로 복귀 |
| 게스트 가져오기 | 확인창을 열었다 취소하는 것만 확인. 기록 이동이나 가져오기 실행 없음 |
| 로그아웃 | guest·세션 없음·토큰 없음·기록 꺼짐으로 복귀. 해당 native SecureStore 인증 항목도 삭제됨 |
| 원본 보존 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

계정 뷰 유지 시험은 **로컬 계정 자료가 0건인 조건**입니다. 계정 소유자가 유지되고 게스트 기록이 노출·이동되지 않는 것을 확인했으며, 비어 있지 않은 계정의 방문·사진 복원까지 검증했다는 뜻은 아닙니다. 가져오기 원자성은 공통 담당의 임시 SQL 검사 결과이고 이번 native 시험에서는 실제 가져오기를 하지 않았습니다.

### 기준 소스와 검사 범위

Android 시작 기준은 `0bc330d`, 공통 검증 소스는 **`aa09aa0`**입니다. 계정 화면, 설정 화면, authClient/sessionManager/credentials 두 플랫폼 파일, database/repository, useAuthStore/useAppStore의 승인된 10개 파일만 임시 적용했습니다. 파일 해시로 `aa09aa0`와의 일치를 확인했고 시험 중 다시 동기화하지 않았습니다. 이후 공통 전송 서비스 개발은 이번 native 결과에 포함하지 않습니다.

새 의존성 설치, APK 재설치, native rebuild나 장시간 시험은 하지 않았습니다. 기존 APK의 SecureStore 클래스·등록 참조와 설치 파일 일치는 준비 단계에서 읽기 전용으로 확인했습니다. 임시 UI 상태의 Android 타입 검사, ESLint와 기존 **90개 테스트**가 PASS였습니다. 공통 채팅의 112개 또는 이후 검사 수를 이 worktree의 실행 결과로 바꾸지 않습니다.

독립 비동기 Inspector의 credentials.read 진단은 완료 응답을 얻지 못해 직접 API probe의 PASS로 표시하지 않습니다. 실제 흐름 확인은 가입·로그인 UI, 강제 재실행과 me 성공, 동기식 앱 상태 읽기, native 암호화 항목의 존재·로그아웃 후 삭제와 DB·사진 원본 대조로 수행했습니다. 초기 연결·화면 자동 입력 문제는 인증 실패로 분류하지 않으며, 원본 예외도 로컬에 보존했습니다.

10월 14일에는 새 app.config의 SecureStore backup 제외 선언을 동기화하지 않았습니다. 10월 15일 새 Debug APK에서 native 제외 규칙을 확인한 결과는 위에 별도로 기록합니다. 기존 설치 APK는 그대로이며 OS 백업·복원, 실제 Android 휴대폰·Release와 iOS 실제 계정 UI/DB 전환은 이 로그인 QA의 완료 범위가 아닙니다.

### 근거와 종료 상태

원본 근거는 Git 제외인 `docs/test-results/android-auth-20261014/`에 보존했습니다. 아래 파일에는 상태·개수 중심의 요약 또는 비공개 원본이 있으므로 공개 PR에는 이 설명만 공유합니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 승인 소스 일치·원상 복원 | `validation-files.json`, 원래 존재한 파일의 `original-*.txt` |
| 검사 결과 | `common-auth-check.log` |
| 단계별 앱·DB 상태 | `after-signup`, `restored-online`, `server-offline`, `invalid-token`, `after-relogin`, `final-guest` 이름의 `*-session.json`, `*-db.json` |
| native 인증 저장 항목 | 단계별 `*-credential.json` (존재·암호화 여부만 기록) |
| 확인창 취소 | `guest-import-confirmation.*`, `guest-import-cancelled.*` |
| 실제 임시 서버 응답·최종 요약 | `server-summary.json`, `summary.json` |
| 종료 확인 | `shutdown-status.json`, `loopback-remove.log` |

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 임시 서버와 전용 연결, 자체 Metro와 에뮬레이터를 종료했습니다. 공통 overlay 10개는 원래 Android HEAD로 복원했고, 이번에만 생긴 공통 파일은 해시를 확인한 뒤 제거했습니다. 원래 common checkout, iOS와 기록·사진·증거·백업은 보존했습니다. 이번 종료 커밋은 Android 결과 문서만 포함합니다.

### 다음 native 시험의 연결 도구

준비 단계에서 추가한 `android-auth-loopback.sh`는 임시 서버의 health 응답을 확인한 뒤 인증 전용 포트를 에뮬레이터에 연결합니다. 공통 서버·Metro 포트와 실제 휴대폰을 거절하고 `--remove`는 해당 연결만 제거합니다. 서버·계정·앱을 만드는 도구는 아니며 임시 DB·합성 계정 격리는 실제 서버 설정에서 별도로 확인해야 합니다. 가짜 adb/curl로 검사한 `test-android-auth-loopback.py`는 PASS입니다.

```
bash travel_visit_tracker/scripts/android-auth-loopback.sh
bash travel_visit_tracker/scripts/android-auth-loopback.sh --remove
```

설치 APK 준비 근거는 `docs/test-results/android-auth-prep-20261014/`에 따로 보존했습니다. 원본 APK·기기 경로, bytecode, 계정·토큰과 키 값은 GitHub에 올리지 않습니다.

## 10월 14일에 확인한 내용

이번 작업은 P2-07의 배터리 안내, 초기 지도 범위, P4-06의 Android 뒤로 가기 일부를 확인하는 작업입니다.

| 확인한 흐름 | 결과 | 실제로 확인한 내용 |
| --- | --- | --- |
| 배터리 안내 | PASS | 정상 전원과 합성 절전 상태에서 위치 수신 지연, 2분 공백, 저장한 방문·사진 보존 설명이 표시됨 |
| 휴대폰 앱 설정 열기 | PASS | Android 앱 정보 화면이 열리고, 뒤로 가면 앱 설정 화면으로 돌아옴 |
| 초기 지도 | PASS | 지도를 움직이기 전과 앱 프로세스 재실행 후에도 제주 전체가 지도 영역 안에 표시됨 |
| 설정 탭의 뒤로 가기 | PASS | 내 지도로 돌아옴 |
| 지역 검색의 뒤로 가기 | PASS | 검색 모달이 닫히고 지도에 복귀함 |
| 지역 상세의 뒤로 가기 | PASS | 선택했던 지역이 있는 지도 화면으로 복귀함 |
| 지도 선택 카드의 뒤로 가기 | PASS (후속 수정 확인) | 첫 번째 뒤로 가기는 카드만 닫고 지도 유지. 두 번째는 기존 OS 흐름으로 앱이 화면 밖으로 나감 |
| 선택이 남아 있는 다른 화면의 뒤로 가기 | PASS | 상세·설정 탭·검색 모달에서 뒤로 가면 선택이 유지된 지도에 복귀. 그다음 지도에서 뒤로 가면 카드 닫힘 |
| 기존 자료 보존 | PASS | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |
| 새 crash와 ANR | 없음 | 시험 전후 진단 내용에 변화 없음 |
| 실제 기기, Release, 배터리 사용 시간 | BLOCKED / 미실행 | 실제 Android 휴대폰 없음. 이번 안내 확인으로 배터리 시험을 완료하지 않음 |

### 어떤 소스로 시험했는지

첫 배터리·지도 검증의 Android 기준은 `7db23ae`입니다. 사용자가 지정한 공통 브랜치 `codex/common-ios`의 `712dc04`에서 아래 두 파일만 임시 적용했습니다. 두 파일은 동작 소스 `70805c4`의 내용과 같았습니다.

- `travel_visit_tracker/app/(tabs)/settings.tsx`: 새 배터리 안내.
- `travel_visit_tracker/src/ui/RegionMap.native.tsx`: 전체 경계 bounds에 맞춘 초기 지도.

지도 선택 카드의 뒤로 가기 개선 후보를 전달한 뒤, 공통 담당이 `travel_visit_tracker/app/(tabs)/index.tsx`에 Android의 포커스된 지도에서만 선택을 해제하는 처리를 추가했습니다. 후속 검증은 Android 기준 `cdb023a`에 이 새 지도 화면과 위 두 파일, 총 세 파일만 임시 적용했습니다. 공통 checkout HEAD는 `712dc04`였고 새 `index.tsx`는 아직 미커밋 검증본이었습니다. 해당 파일 SHA-256은 `087b8c738c873716b376d585fdb24be0cf9eea38c670947ce78e94ab40ecc36d`입니다. 나머지 두 파일은 기존 공통 커밋의 내용과 같았습니다.

공통 브랜치 전체를 합친 시험은 아닙니다. 검증 전 Android 파일의 원문과 해시를 로컬에 보존했고, 각 검증 후 임시 공통 파일을 원래 Android HEAD와 바이트 단위로 같게 복원했습니다. 이 공통 파일들은 Android 커밋에 넣지 않습니다. 루트, 모바일, backend README와 공통 진행 문서도 수정하지 않았습니다.

Emulator 37.2.12, API 37, CPU 4개, SwiftShader와 기존 APK를 사용했습니다. 앱을 재설치하지 않았고 새 native 의존성이나 빌드를 추가하지 않았습니다. Android 개발 서버는 localhost 8082만 사용했습니다.

합성 절전은 전원을 연결하지 않은 상태와 배터리 15%, low_power=1로 만들었습니다. 안내와 앱 설정 연결을 확인한 뒤 low_power=0, AC 전원 연결, 배터리 100%로 복구했습니다. 자동 기록은 시험 내내 꺼져 있었으며 새 위치나 방문을 만들지 않았습니다.

### 이번 검증의 근거

검증용 UI 상태에서 `npm --prefix travel_visit_tracker run check`를 실행해 타입 검사, ESLint, 90개 테스트가 통과했습니다. 이후 앱 재실행 전후의 저장 요약을 대조했고 방문, 사진 파일과 연결, 전송 대기 수가 모두 일치했습니다.

원본 근거는 로컬 `docs/test-results/android-ui-20261014/`에 보존합니다. GitHub에는 이 설명만 공유하며 원본 화면, 사진, DB, 기기 로그와 식별자는 올리지 않습니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 소스 적용·복원 확인 | `validation-files.json`, `original-0.txt`, `original-1.txt` |
| 자동 검사 | `common-ui-check.log` |
| 배터리 안내·앱 설정 복귀 | `battery-guidance-saver.*`, `android-app-settings.*`, `app-settings-back.*` |
| 제주 포함 지도 | `settings-tab-back.png`, `cold-map-jeju.png` |
| 뒤로 가기 | `search-before-back.*`, `search-after-back.*`, `region-detail.*`, `region-detail-back.*`, `map-selected-back.*` |
| 저장 보존·진단 요약 | `baseline.json`, `after-back-flows.json`, `final-state.json`, `summary.json` |

`*`는 같은 이름의 PNG와 화면 구조 XML입니다. 첫 로딩 캡처도 보존했지만 지도 통과 근거로 쓰지 않았습니다. 실제 지도 확인은 위의 로딩 완료 화면을 사용했습니다. 앱 설정의 배터리 제한을 변경하거나 위치·알림 권한을 회수하지 않았습니다.

### 지도 뒤로 가기 수정의 후속 근거

후속 원본은 `docs/test-results/android-back-20261014/`에 보존합니다. 첫 카드 닫기와 두 번째 OS 복귀, 상세에서 지도 복귀, 선택이 남아 있는 설정 탭·검색 모달 복귀, 마지막 카드 닫기까지 모두 PASS였습니다. 다른 화면에 머무는 동안 지도 전용 뒤로 가기가 동작을 가로채지 않았습니다. 이 결과로 앞서 발견한 선택 카드의 개선 후보를 해결 확인 이력으로 갱신합니다.

| 근거 | 로컬 파일 |
| --- | --- |
| 세 파일 임시 적용·복원 | `validation-files.json`, `original-0.txt`~`original-2.txt` |
| 타입 검사·lint·90개 테스트 PASS | `common-back-check.log` |
| 첫 카드 닫기·두 번째 OS 복귀 | `selected-before-back.*`, `first-back-closes-card.*`, `second-back-default-os.*` |
| 상세·설정·검색의 포커스 회귀 | `detail-back-keeps-selection.*`, `settings-back-keeps-selection.*`, `search-back-keeps-selection.*`, `final-back-closes-card.*` |
| 단계별 대조·저장·진단 | `back-steps.json`, `baseline.json`, `final-state.json`, `summary.json` |

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 새 장시간 시험, 위치 주입, APK 재설치나 native rebuild는 하지 않았습니다. P4-06의 Android 뒤로 가기 부분 확인이며 작은 화면, 큰 글자, 스크린리더와 양쪽 실제 기기 검증은 계속 남아 있습니다.

## 10월 12일에 완료한 위치 기록 시험

이 시험은 Android 소스의 최초 기준 `0cf402a`에서 진행했습니다. 기존 AVD 데이터를 유지하면서 SwiftShader로 부팅을 복구했고, 최신 JS를 8082 개발 서버에 연결했습니다. 당시 부팅은 약 14.6초였고 기존 APK의 데이터 보존 업데이트 설치가 성공했습니다.

| 시험 | 결과와 의미 |
| --- | --- |
| 위치 권한 회수 | 앱 재개 후 기록 중단과 권한 확인 안내. 화면 잠금 권한만 회수하면 foreground 수집으로 전환 |
| GPS 끄기 | 활성 화면에서 기록 중단과 위치 서비스 확인 안내 |
| 알림 거부 | 알림을 거부해도 위치 foreground 서비스 시작과 후보 진행 확인 |
| 긴 위치 공백 | 권한·위치 서비스는 켜둔 채 새 위치를 멈춤. 마지막 관측 후 123.160초에 후보 만료, 저장한 방문 유지 |
| 짧은 절전 시험 | 합성 배터리 15%와 절전 상태에서 약 15초 관측 지속. 실제 배터리 절감 결과는 아님 |
| 기록 중지·재시작 | 중지 버튼으로 위치 서비스 종료, 재시작 후 정상 수신 |
| 30분 화면 꺼짐 | 1800.589초 동안 31회 읽기. 총 301.100초 체류에서 한 번 확정, GPS 방문·전송 대기 2→3건. 추가 확정 없음 |
| 화면 복귀·중지·앱 재실행 | 개인 원본 보존 대조 통과. 상세 값은 로컬 근거에만 보관 |

30분 시험의 시작 직후 화면 상태는 Dozing, 60초부터 끝까지 매분 Asleep이었습니다. 보안 키가드는 표시되지 않았습니다. 고정된 합성 GPS, AC 전원, Debug 앱, Metro와 매분 adb 진단이 있는 조건이므로 깊은 절전, 제조사별 제한, 보안 잠금이나 실제 배터리 검증으로 해석하지 않습니다. 매분 관측한 마지막 위치의 나이는 최대 10.098초였으며, 모든 이벤트 간격을 연속 측정한 값은 아닙니다.

당시 배터리 제한 안내는 없었지만, 위의 10월 14일 공통 UI 시험에서 안내 표시와 설정 연결을 확인했습니다. 누락 발견 이력은 남기되 현재 미해결 안내 문제로 취급하지 않습니다.

10월 12일 원본 근거는 `docs/test-results/android-native-20261012/`에 있습니다. `long-lock-monitor.json`, `long-lock-00.json`~`long-lock-30.json`, `after-screen-return.*`, `after-long-stop.json`, `after-long-restart.*`, `restored-permissions.txt`, `crash-final.log`, `lastanr-final.txt`를 보존합니다. 저장된 증거를 대조하는 아래 명령의 세 묶음은 모두 PASS였습니다.

```sh
python3 scripts/check-android-native-evidence.py docs/test-results/android-native-20261012
```

타입 검사, ESLint와 90개 테스트, Android 실행 스크립트의 격리 검사, shell/Python 문법 검사도 통과했습니다. [최종 인계 커밋의 Linux Cloud 검사](https://github.com/OhHyunSeo/travel-visit-tracker/actions/runs/38489319781)도 성공했습니다. 이 Mac에서는 backend 의존성이나 iOS Pods를 설치하지 않았습니다.

## 지도 성능은 별도로 남아 있습니다

아래는 **10월 12일, 초기 지도 수정 전** Debug·SwiftShader 측정입니다. 10월 14일 제주 표시 개선을 성능 개선 수치로 바꾸지 않습니다. 경계 팩은 geoBoundaries의 2020년 개발 자료 228개이며 최신 공식 경계가 아닙니다.

| 측정 항목 | 1회 | 2회 | 3회 |
| --- | --- | --- | --- |
| Android activity 시작 시간 | 2.526초 | 2.419초 | 2.469초 |
| 시작 요청에서 지도 화면 구조 확인까지의 상한 | 14.665초 | 12.152초 | 12.897초 |
| 전체 앱 PSS 메모리 | 397.32MiB | 397.04MiB | 396.12MiB |
| Native Heap PSS | 204.23MiB | 203.84MiB | 202.81MiB |

화면 구조 확인 시간에는 adb와 UI dump 지연이 포함되며 도형 그리기 완료 시각을 직접 측정한 값은 아닙니다. 전체 앱 메모리에서 지도만의 사용량을 분리할 수 없습니다. 지도 이동, 검색, 선택 후 전체 PSS는 427.45MiB였습니다.

Android HWUI 누적 지표는 시작 직후 102프레임 중 janky 67(65.69%), p50 40ms/p90 65ms/p95 101ms였습니다. 조작 후에는 239프레임 중 janky 204(85.36%), p50 34ms/p90 133ms/p95 200ms였습니다. legacy janky는 각각 94/102와 138/239였습니다. 지연이 높으므로 실제 Android Release와 같은 조건의 GPU 비교 전에는 성능 완료로 표시하지 않습니다. 이 값은 MapLibre GL의 독립 FPS나 검색 응답 시간도 아닙니다. 당시 새 crash와 ANR은 없었습니다.

근거: 10월 12일 증거 폴더의 `map-profile.json`, `map-start-{0,1,2}.txt`, `map-memory-{0,1,2}.txt`, `map-full.png`, `map-panned.png`, `map-selected.png`, `gfx-before.txt`, `gfx-after.txt`.

## 작업 범위와 통합

Android 채팅은 Android 실행·진단 스크립트, 전용 검사와 이 문서를 담당합니다. 공통 화면, 기록 판정·저장, app config, package/lock, backend와 전체 체크리스트는 공통 담당이 관리합니다. 남은 제안은 [공통 변경 제안](ANDROID_PROPOSED_CHANGES.md)에 정리합니다.

작업 브랜치는 `codex/android-native`, 통합 대상은 master의 [초안 PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1)입니다. 병합이나 원래 checkout 수정은 하지 않았습니다.

| 커밋 | 내용 |
| --- | --- |
| `0cf402a` | 최초 공통 소스·역할 문서 기준. 당시 origin/master는 `a0a4e52` |
| `75b9d2f` | Android 실행 격리, 데이터 보존 emulator 실행, 사진 파일·연결 진단과 검사 |
| `55ed305` | 30분 증거 대조 스크립트와 최종 결과 |
| `7db23ae` | 10월 14일 인계 기록. 첫 배터리·지도 UI 검증의 Android 시작 기준 |
| `cdb023a` | 배터리 안내·제주 포함 지도·뒤로 가기 첫 검증과 읽기 쉬운 설명. 선택 카드 수정 검증의 Android 시작 기준 |
| `6b0c042` | 포커스된 지도 선택 카드의 Android 뒤로 가기 후속 검증 |
| `0bc330d` | 합성 인증 서버용 Android 루프백 연결과 SecureStore 검사 준비 |
| `b32afc6` | 10월 14일 native 로그인 QA·원본 보존·종료 결과. 10월 15일 백업 설정 빌드의 Android 시작 기준 |

10월 12일 최종 공개 단계가 사용량 한도로 중단돼 10월 14일에 기존 자료를 확인하고 커밋·푸시와 PR 설명 갱신을 마쳤습니다. 이번 후속 검증에서도 공통 UI는 임시로만 사용했으며 Android PR에 중복 포함하지 않습니다.

### 재개할 때 쓰는 명령

Node 24.21.0을 사용합니다. 외부 설치를 읽기 전용 재사용할 때는 `TRIP_NODE_BIN`에 해당 bin 경로를 지정합니다.

```sh
bash travel_visit_tracker/scripts/android-emulator.sh
TRIP_NODE_BIN="<Node 24.21.0 bin>" bash travel_visit_tracker/scripts/android-local.sh
python3 scripts/test-android-local.py
python3 scripts/test-android-emulator.py
```

기본 GPU는 설치 도움말과 실제 부팅에서 확인한 SwiftShader입니다. auto, host, software, lavapipe, swiftshader, swangle 지원을 확인했지만 다른 모드의 성능 비교까지 마친 것은 아닙니다. 이전 host 재시작 실패 이력이 있어 이번 조건을 유지했습니다. 스크립트는 기존 AVD와 설치 도구를 사용하며 데이터를 wipe하거나 스냅샷을 삭제하지 않습니다. Android Metro 기본 포트는 8082이고 iOS용 8081은 거절합니다.

## 자료와 실행 환경 보존

기존 DB, 방문, 사진, 전송 대기 자료, APK, 소스와 스냅샷은 삭제하지 않았습니다. 10월 12일 시작 가용량은 약 48GiB, 10월 14일 후속 시작 시 약 37GiB였습니다. 10월 14일까지는 캐시 정리나 자료 삭제를 하지 않았고 확보량은 0이었습니다. 10월 15일의 새 중간 바이너리 정리 경로와 확보량은 위의 별도 기록을 따릅니다.

10월 12일에는 위치 권한 3개와 알림을 원래 허용 상태로 돌리고 알림의 user-fixed 플래그를 제거했습니다. 위치 공백용 test provider도 제거하고 mock_location을 원래 default deny로 복구했습니다. 이번에는 권한을 바꾸지 않았고 합성 전원만 복구했습니다.

각 검증의 에뮬레이터와 자체 8082 서버는 종료했습니다. 임시 적용한 공통 파일은 첫 검증 두 개, 뒤로 가기 수정 검증 세 개 모두 원래 내용으로 복원했습니다. iOS 8081과 원래 checkout은 조작하지 않았습니다. 근거는 각 로컬 증거 폴더의 `shutdown-status.json`과 `validation-files.json`에 남겼습니다. 공유 문서에는 개인 위치, 기기 식별자, 환경·서명 값을 넣지 않습니다.
