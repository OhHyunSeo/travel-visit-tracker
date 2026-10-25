# Android 검증에서 공통 담당에 전달할 내용

## 10월 25일 후속: OS 복귀 뒤 버튼 없는 자동 방문 백업 확인

고정 **`8d01be8b8e3bf4896fbc76264b442b9dfe415d55`**에서 P3-13의 Android 자동 복귀2개를 실제 OS 무선 차단과 복구로 확인했습니다. 제품을 수정하지 않았고 같은 APK/API37, 고유 QA DB/인증/cache root를 사용했습니다. [진행 기록](ANDROID_PROGRESS.md)에 정확한 순서, 호출과 보존 근거를 남겼습니다.

Foreground 흐름은 실제 opt-in 뒤 자연 자동 실패2회와 약30초/60초 backoff를 기다렸습니다. 저장된 health/재시도 시각도 실제 SQLite 사본에서 확인했습니다. OS 연결을 복구한 뒤 도구에서 backupVisits/Coordinator를 호출하지 않았고 기존 주기 health→방문 ACK가 자동 완료됐습니다. health는 긴 재시도 시각보다27.884초, ACK는26.791초 먼저였고 AppState는 계속 active였습니다. 이는 OS 네트워크 이벤트 listener 추가가 아니라 기존 foreground 주기의 회복입니다.

다른 합성 방문은 실제 background에서 네트워크를 복구했습니다. 약32.316초의 background 관찰과 자연 재시도 시각 경과 동안 전송은 없었고, 같은 PID/JS로 foreground에 돌아온 뒤 버튼 없이 자동 ACK됐습니다. 서버 sync POST와 방문/영수증은 방문별1개, 전체2개이며 같은 operation/payload가 유지됐습니다. 사진 큐/원본 바이트는 그대로이고 사진 POST와 서버 사진/영수증은0개입니다.

과거 시계, 재시도 시각 편집이나 별도 경쟁 전송 주체를 쓰지 않았습니다. 새 UI 실물 확인, OS background 전송/GPS/배터리와 강제 종료 내구성, 실제 Android/Release의 결과는 아닙니다. 이전 고정 소스의537개/JS-Hermes는 반복하지 않고 이번 native2개와 구분합니다.

원래 모든 DB/설정/사진/인증과 package/lock/APK/네트워크를 보존했습니다. 임시 source59개와 cache 상수, 새 transport를 존재 여부/해시대로 복구하고 최종 QA DB/대기 사진을 보관한 뒤 시험 소유 자료와 자체 서비스/reverse/에뮬레이터를 정리했습니다. 기존 캐시/백업 삭제나 새 빌드/설치는 없습니다. 추가 제품 수정 제안은 없으며 전체 완료 수, P3-13과 G1~G4는 변경하지 않습니다.

## 10월 25일 후속: 방문 응답 기한과 native transport 검증 완료

공통 **`8d01be8b8e3bf4896fbc76264b442b9dfe415d55`**의 새 visitTransport와 AppStore 연결을 기존 APK/API37에서 검증했습니다. `cb61e47`의 독립 health3초/ACK10초, bounded stream과 늦은 응답 거부를 포함합니다. 제품 소스는 QA 이름으로만 임시 적용한 뒤 복구했고 Android PR에는 결과 문서만 저장합니다.

새 native3개가 PASS입니다. 실제 AppStore 수동 방문 백업은 서버 commit 후 ACK16/60 bytes 대기에서 약10.015초에 실패와 busy 해제로 돌아왔습니다. 같은 operation/payload와 대기, 성공 시각을 보존했고 DB 재개방 뒤 같은 작업을 정상 수동 재시도해 서버 방문/영수증1개, 요청 본문 완전 동일과 반복 중복 없음을 확인했습니다. Foreground 자동 백업의 health16 bytes 대기는 약3.016초에 false 반환, 큐/lastSuccessAt/nextAttemptAt 보존과 정상 connectionCheckAt 연기, 다음 수동 요청 성공이 통과했습니다. 두 경우 native 응답 객체와 reader 바이트는 기한 전 노출되지 않았습니다.

추가 독립 ACK는 autoEnabled=false 상태에서 해당 held 요청의 abort forwarding만 생략했습니다. 원래 signal이 aborted인 상태에서도 약10.010초에 반환됐습니다. 서버의 열린 연결에 늦은 tail을 실제 전송한 뒤 native Response가 노출됐지만 reader를 만들지 않고 cancel했고 로컬 ACK는 미적용이었습니다. 큐/성공 시각 보존과 DB 재개방 후 동일 작업 재시도가 통과했습니다. 서버 prefix, native 객체 반환과 reader bytes를 구분하며 원래 두 abort 경로와 섞지 않습니다.

자동 health는 현재 wall clock과 실제 AppStore/Coordinator 하나를 사용했습니다. 미래 재시도와 만료된 연결 점검 시각만 제품 repository API로 통제했습니다. 추가 독립 ACK 전에 자동 opt-in을 꺼 다른 interval 전송을 배제했습니다. 새 손가락 UI/OS 종료 내구성, 실제 Android/Release의 결과가 아닙니다. 정확한 조건과 도구 준비 보완은 [진행 기록](ANDROID_PROGRESS.md)에 있습니다.

모바일537개/20파일, 타입과 린트, 이 verifier의 backend syntax/native dependency load와 양쪽 JS/Hermes가 PASS입니다. 공통 서버61개와 초과 본문 host 회귀를 새 native 검사로 합산하지 않습니다. 원래 모든 테이블/설정/스키마/사진과 인증, package/lock/APK/무선 상태를 보존했습니다. 임시59개 소스의 원문/부재/해시, 새 transport2개와 cache root 상수를 복구했고 QA DB/인증, 자체8082/3002/3003과 reverse/에뮬레이터를 정리했습니다. 추가 캐시/백업 삭제와 새 빌드/설치는 없습니다. 추가 공통 수정 제안은 없고 완료 수와 G1~G4는 유지합니다.

## 10월 25일 후속: 안전한 준비 사본 정리의 Android 검증 완료

아래 잔여 캐시 제안은 공통 **`4bd7ea3670d148a3df8c35bb49066e4dbfc4d10e`**에서 구현됐고, Android의 새 격리 소스에서 native19개와 모바일525개, 타입/린트, 양쪽 JS/Hermes를 확인했습니다. 제품 코드는 Android PR에 중복 포함하지 않고 원래대로 복구했습니다. [진행 기록](ANDROID_PROGRESS.md)에 정확한 근거와 범위를 남겼습니다.

- 실제 전송 도중 force-stop/재실행2개: 일부 multipart 수신과 서버 저장 후 ACK32 bytes 대기. 실제 Coordinator가 owner/operation/photo context를 넘겨 marker를 만들었고 새 PID/JS/Constants.sessionId와 QA 인증 복구를 확인했습니다. 같은 DB의 대기, payload, fingerprint와 원본을 보존했습니다. ACK 전에는 유지, 동일 작업 ACK 후 실제 수동 사진 백업 완료 wiring에서 옛 사본만 제거, 서버 중복 없음이 PASS입니다.
- 실제 시작 wiring1개: 로컬 ACK가 있는 실제 native producer의 사본을 현재 session/active 상태에서는 보존했습니다. 앱 재시작 뒤 수동 cleanup 없이 initialize 정리로 이전 사본만 제거됐고 DB 행, 원본과 다른 미전송 대기는 유지됐습니다. emulator boot ID는 같습니다.
- 합성 marker 변형16개: active/current-session, 미표시/무marker, ACK 없음, owner/operation/photo/fingerprint 불일치, 원본 누락/변경과 사본 변경, 추가 파일, 깨진/미지원 marker15개 보존. 유효한 이전 session 사본1개만 실제 repository ACK 검사와 native 최종 bytes 비교 뒤 제거, 반복0개였습니다. 합성 marker session 편집과 실제 앱 재시작을 구분합니다.

보존15개를 확인한 뒤 하네스가 정리한 것은 이번 시험 소유 경로만입니다. 기존 legacy 캐시나 기본 snapshot root를 스캔/삭제하지 않았고 root 상수도 고유 QA 값으로 격리했습니다. 원본 변경/누락 조건은 합성 파일에만 만들고 되돌렸습니다. 새 native 파일 읽기 오류,20개/64MiB stress, 장기 누적이나 실제 OS 오류를 이19개에 포함하지 않습니다. 새 UI 조작과 물리 Android/Release, 전원 손실 검증도 아닙니다.

원래 모든 자료와 인증, package/lock과 설치/보존 APK, 무선 설정이 보존됐고 임시 소스56개와 cache 상수 원문/부재/해시를 복구했습니다. QA DB/사진/사본과 자체8082/3002/3003, reverse, 에뮬레이터를 정리했습니다. 추가 전역 캐시나 백업 정리는 없습니다. 공통 서버61개는 여기서 반복하지 않았습니다. 새 공통 제품 수정 제안은 없습니다. 완료 수와 G1~G4는 유지합니다.

## 10월 25일: 앱 강제 종료, 복원 기한과 준비 캐시 잔여

공통 **55b7bda**의 실제 앱 force-stop 세 경우와 **c2c871f**의 복원 응답 기한 두 경우를 서로 다른 QA 기준에서 확인했습니다. 기존 Debug APK/API37, 실제 native SQLite/파일/HTTP이며 새 빌드나 설치는 없습니다. [진행 기록](ANDROID_PROGRESS.md)에 고정 SHA, 실제 시점, 근거와 한계를 남겼습니다.

앱 종료는 partial multipart 수신, 서버 저장 후 ACK32 bytes 대기, native 사진 reader16,384 bytes 수신의 세 시점입니다. 매번 기존 PID 소멸과 새 PID/JS instance, 같은 emulator boot ID를 확인했습니다. DB 재주입 없이 같은 작업, payload, fingerprint와 복구 대기를 재개방했고, 명시적 재시도에서 업로드 중복 없이 확인하거나 새 검증 사본만 연결했습니다. 이는 OS 재부팅/충돌/전원 장애나 인증 자동 복구의 증거가 아닙니다.

복원 기한은 목록16/40 bytes 유지에서 요청 약10.025초, 사진16/7,090,841 bytes 유지에서 요청 약30.029초 반환으로 확인했습니다. 목록은 native 응답 객체 미노출, 사진은 실제 reader16 bytes 관측이므로 구분합니다. 대기와 서버 조회 cursor, URI/출처, 이전0바이트 파일 보존, 재개방 후 새 사본 복구와 반복 중복 없음이 PASS입니다. 정상 점검 scan은 되감길 수 있으며 실패 후 재개방 동안 유지됐습니다. 기한 뒤 두 소켓은 이미 닫혀 실제 늦은 본문 소비 전체를 검증한 것은 아닙니다. c2c871f의 타입, 린트, 모바일498개와 양쪽 JS/Hermes도 PASS입니다.

**새 공통 개선 제안:** 앱이 종료될 때 만들어 둔 업로드 준비 사본 두 개가 성공 재시도 뒤에도 남았습니다. 각7,090,841 bytes, 총14,181,682 bytes의 시험 소유 캐시이며 최종 근거에 보관한 뒤 정확한 경로만 정리했습니다. 시작/복구 시 고아 준비 캐시를 식별해 정리하는 방안을 검토할 수 있습니다. 활성 요청의 준비 파일과 사용자 원본은 보호하고, 디렉터리 이름만으로 무차별 삭제하지 않는 소유권/수명 기준이 필요합니다. OS 자동 회수와 장기 누적 여부는 미검증이며 제품 소스는 수정하지 않았습니다.

각 단계의 모든 원본 자료와 인증 보존, 임시 소스54개/55개 원문·존재 여부·해시, package/lock과 APK 대조를 마쳤습니다. 합성 DB/사진과 QA 앱 DB, 자체8082/3002/3003과 reverse를 정리하고 에뮬레이터를 정상 종료했습니다. 이번에는 새 UI 전체나 실제 Android/Release를 검증하지 않았으며 G1~G4는 완료 처리하지 않습니다.

사용자 요청으로 재생성 Gradle 캐시 약2.32GB를 정리했고, 별도 승인한10월20일 Time Machine 로컬 백업 한 개도 삭제했습니다. 백업 삭제 전후 실제 가용량은 약35.30→55.69GB, 관측 증가는 약20.39GB입니다. 캐시 크기와 중복 합산하지 않습니다. SDK, AVD, 원본 DB/사진, APK, 소스와 프로젝트 백업/기존 근거는 보존했습니다.

## 10월 24일: 실제 부분 전송과 ACK 기한 검증 완료

공통 `8b48ec8`의 실제 multipart/사진 응답 본문 중 OS 연결 차단 두 경우를 먼저 확인한 뒤, 수정 소스 **`55b7bda`의 네 가지 시나리오**를 별도 검증했습니다. 기존 APK와 API37, 실제 native SQLite/file/expoFetch, HTTP reverse 없는 가상 네트워크와 합성 프록시를 사용했습니다.

새 소스는 부분 업로드와 다운로드 중단, 저장된 사진의 ACK32/486 bytes 뒤 TCP 중단, ACK가 끝나지 않을 때 전체 약30초 기한이 모두 통과했습니다. 원본 첨부, 고정 작업과 SHA, 대기/조회 위치가 DB 재개방 뒤 유지됐고 동일 작업 재시도에서 중복 사진/영수증이 없었습니다. 부분 다운로드는 등록하지 않고, 정상 재수신 후 새 URI만 연결하며 이전 손상 파일을 보존했습니다.

TCP 시나리오에서는 native reader의32 bytes를 확인했습니다. 기한 시나리오는 Android transport의 응답 객체 반환 전 경로로 약30.041초에 종료됐으며, reader의 부분 소비나 기한 뒤 ACK 실제 수신을 주장하지 않습니다. 첫 사전 reader 관측 조건과 최종 실제 관찰의 차이도 [진행 기록](ANDROID_PROGRESS.md)에 남겼습니다. iOS 내부 원인을 Android 결과로 확대하지 않습니다.

새 소스의 타입, 린트, 모바일489개와 양쪽 JS/Hermes가 PASS입니다. 원래 모든 자료와 인증 보존, 네트워크 설정, 임시 소스54개, package/lock과 APK 복구·대조를 마치고 QA와 자체 서버/에뮬레이터를 정리했습니다. 공통 제품 소스는 수정하지 않았고 새 native 빌드나 설치도 없습니다. 결과 요약만 기존 PR에 저장하며 추가 제품 수정 제안은 없습니다. 실제 Android, Release, 이동 전환/전원 장애와 전체 수용 기준은 계속 별도입니다.

## 10월 21일 저장·중단: 실제 OS 연결 차단과 복귀

공통8b48ec8과 기존 APK에서 현재 진행하던 네트워크 주기 한 차례를 완료했습니다. HTTP용 reverse 없이 에뮬레이터 호스트 경로를 사용했고, Android 비행기 모드와 Wi-Fi/모바일 데이터 차단 중 native HTTP와 방문 요청이 실제로 실패했습니다. 연결된 사진과 방문의 작업 ID, payload, 대기와 첨부본은 보존됐고 ACK는 없었습니다. 원래 무선 설정으로 돌아온 뒤 명시적 재시도에서 방문 다음 multipart 사진 전송과 ACK, 대기 0건을 확인했습니다.

사진 업로드 도중 단절이나 Wi-Fi↔모바일망 전환을 확인한 것은 아닙니다. 사용자의 현재 검사 후 중단 요청에 따라 추가 단독 사진 실패, 다운로드 중단 실험은 시작하지 않았습니다. 원본과 인증 보존 대조, QA 정리, 네트워크 설정과 소스54개 복구, 자체 서버/에뮬레이터 종료를 마쳤습니다. 새 제품 수정 제안은 없으며 전체 수용 기준은 계속 별도입니다. [진행 기록](ANDROID_PROGRESS.md)에 근거와 한계를 저장하고 다음 재개는 사용자의 새 요청을 기다립니다.

## 10월 21일 후속: v5 손상 파일 복구 Android 검증 통과

공통 `8b48ec8`의 다운로드 출처와 URI 바인딩, 점검 cursor, 보존 복구를 기존 APK에서 검증했습니다. **새 native 16개와 모바일 479개가 PASS**입니다. 이전 합성 v4 DB와 0바이트 파일을 새 이름과 경로로 복제해 migration 전후 기존 행과 cursor를 유지했고, 손상된 사진만 새 검증 사본으로 연결했습니다. 기존 0바이트와 정상 파일은 그대로입니다.

누락, 같은 길이 변조, SQL 연결 실패 rollback과 재개방, owner/token/URI 변경, 미전송 자식 변경과 부모 삭제, 사용자 첨부본 비대상, 계정별 동일 UUID와 공유 경로 차단, 한 번에 점검 20개와 새 받기 20개가 통과했습니다. 실제 확인창 취소 시 조회 없음, 새 사본 복구 1개와 대기 0건 안내, 두 사진의 상세 표시와 앱 프로세스 재실행 뒤 파일/출처 보존도 확인했습니다. 오류 일부는 합성 시점 제어이며 실제 디스크 장애가 아닙니다.

개인 원본과 인증 보존 대조, QA 정리, 임시 소스54개의 존재 여부와 해시 복구, package/lock과 APK 보존을 마쳤습니다. 자체 8082/3002와 에뮬레이터도 종료했습니다. 공통 제품 코드는 수정하거나 Android PR에 넣지 않았습니다. 정확한 16개 범위와 근거는 [진행 기록](ANDROID_PROGRESS.md)에 있습니다.

이전 host exit139의 직접 원인은 미확정이며 비정상 host 종료는 다시 만들지 않았습니다. 아래 v4 당시의 복구 부재 제안은 이번 v5에서 보완과 검증을 확인한 이력입니다. 실제 Android 휴대폰, Release, OS 네트워크/전원 장애와 전체 수용 기준은 별도입니다.

## 10월 21일 v4 당시 관찰: 완료된 복원 파일의 재검증과 복구

새 v4 복원의 native15개와 정상 앱 종료·재실행은 통과했습니다. 다만 에뮬레이터 자체 비정상 종료 후 합성 사진 하나가 0바이트로 남았고, 완료된 기록으로 취급돼 수동 복원으로도 복구되지 않았습니다. 직접 원인은 미확정이며 이 관찰을 SDK 파일 복사나 제품 로직의 확정 원인으로 단정하지 않습니다. 원본 근거와 정상 새 사진·재실행 결과는 로컬 `android-restore-v4-20261021`에 보존했습니다.

공통 담당에게 제안하는 다음 동작은 다음과 같습니다.

- 서버에서 받은 것으로 확인되는 첨부본의 존재·크기·해시를 다시 확인하고, 없거나 손상된 경우 사용자에게 복구 대기를 표시합니다.
- 기존 사용자 사진이나 원래 경로의 바이트를 덮어쓰지 않고 새 사본을 검증한 뒤 같은 계정·부모·기존 연결이 유지될 때만 등록합니다. 불확실한 파일과 기존 연결은 먼저 보존합니다.
- 파일의 디스크 반영과 SQLite 완료 처리 순서를 검토하고, 정상 프로세스 종료와 에뮬레이터/전원 비정상 종료를 나눠 재현합니다. 원인이 확인되기 전에는 전체 중단 내구성을 통과 처리하지 않습니다.

공통 소스는 변경하지 않았습니다. 여러 기기 충돌·실제 Android 휴대폰·Release와 전체 수용 기준도 별도입니다.

### 종료 로그의 읽기 전용 검토와 후속 경계

macOS 진단에서 10월 21일 19:03:51 KST의 호스트 `qemu-system-aarch64-headless` SIGSEGV와 HangDetector → CrashReporter 종료 경로를 확인했습니다. 같은 로그에는 main loop·CPU 스레드의 약 15초 무응답이 있고, 별도 main-loop 스레드는 QEMU iothread mutex를 기다렸습니다. 이 스냅샷으로 잠금 정체의 원인이나 0바이트 파일의 디스크 반영 시점을 확정하지 못했습니다. Expo 파일 복사·앱·GPU·메모리 부족 중 하나를 원인으로 지정하지 않습니다.

손상 파일 보완의 고정 SHA와 API를 받은 뒤에는 출처·owner·photo·기존 URI 바인딩, 기존 파일을 보존하는 새 사본·CAS 연결, 계정/부모/URI 변경 시 등록 차단, SQL 실패 뒤 커서·연결 rollback, 재개방과 20개 점검 경계를 우선 확인합니다. 개인·legacy 첨부본을 복원 파일로 추정하지 않는 조건도 필요합니다. 아직 새 소스를 적용하거나 후속 검증을 실행하지 않았고 앞선 native15개·453개를 반복한 결과로 기록하지 않습니다. 상세 준비와 원본 진단은 Git 제외 근거 폴더에 보관합니다.



갱신: 2026-10-21. 이 문서는 공통 코드에 적용할 내용과 Android에서 확인한 결과를 구분해 기록합니다. Android 채팅이 공통 파일을 직접 커밋하지 않습니다.

## 10월 20일 모바일 DB v3 Android native 24개 PASS

Android `1f299fb`에서 공통 **`2bae436b9f128219d6e81593139071526749b28a`**를 고정했습니다. 기존 목록에 새 migration·migration 테스트·고정 v2 SQL을 더한 40개를 보존한 뒤 DB 파일명·SecureStore key/service만 QA 이름으로 바꿨습니다. 기존 APK·API 37·자체 8082에서 실제 async SQLite 파일 DB 24개를 사용했습니다. 측정한 native SQLite는 3.50.3이며 Repository BEGIN 전에 FK=1을 확인했습니다.

v1/v2 모든 owner 행·settings·후보·URI·payload·attempts·소수점 시각·v2 metadata·native PNG bytes 보존·재개방, 복사/교체 SQL 뒤 및 COMMIT 전 오류 rollback, 같은 UUID의 A/B·fingerprint·ACK 격리, cross-owner FK 거절·owner 한정 삭제, guest GPS·photo metadata cascade, 네 종류 충돌과 가져오기 SQL 실패 rollback이 모두 PASS입니다. 오류 시점은 adapter 제어 또는 native trigger로 주입했으며 실제 디스크 장애·전원 차단으로 표시하지 않습니다. HTTP와 실제 서버 계정은 만들지 않았습니다.

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 24개 시험 DB/WAL/SHM·합성 PNG 폴더 부재와 QA UI DB v3·0건·무결성 확인 후 제거를 마쳤습니다. 앱·Metro를 먼저 멈춘 뒤 기존14/신규26, 총40개 소스 원문·부재·해시와 package/lock·APK hash를 복구 대조했고 자체 reverse·에뮬레이터도 종료했습니다.

임시 QA 소스의 `bash scripts/verify-cloud.sh`는 타입·lint·모바일 402개·기존 backend syntax/native load·양쪽 JS/Hermes PASS입니다. 공통 서버 61개·HTTP와 앞선 v2 사진 native/UI를 이번 결과로 합산하지 않습니다. 새 빌드·설치·의존성·기존 캐시/백업 정리와 원래 checkout·iOS·iPhone 조작은 없습니다. 추가 제품 수정 제안은 없으며 다운로드·복원 기능이나 실제 Android·Release·전체 수용 시험 완료는 아닙니다. 상세 고정 소스·24개 항목·원본 보존·복구 근거는 [진행 기록](ANDROID_PROGRESS.md)에 보존했습니다.

## 10월 19일 후속: 사진이 있는 계정의 실제 UI 전송 확인

Android `753438a`에서 공통 **`809efe0`**의 남은 실제 화면 전송만 검증했습니다. 이전 native 파일 1개·통합 9개·빈 계정 UI·378개 검사는 반복하지 않았습니다. 새 QA DB 이름과 전용 SecureStore key/service만 오버라이드하고 새 합성 계정에 방문 1건·PNG 1개를 준비했습니다. 기존 APK·8082·합성 HTTP를 사용했고 제품 코드 변경은 없습니다.

사진 대기 1건 상태에서 9초간 방문·사진 POST 0회, 확인창 취소 후에도 0회였습니다. 실제 확인 버튼 뒤에는 **방문 먼저·사진 다음으로 각각 정확히 1회** 전송됐습니다. 완료 문구·저장 확인 1개·대기 0건·방문 성공 시각·ACK metadata가 확인됐고, 기기 첨부본의 bytes·해시·크기도 같았습니다. 서버 방문·사진·각 영수증은 1개, 첨부본 bytes/해시 일치·별도 썸네일·integrity `ok`도 직접 확인했습니다. 다시 누르면 새 확인창이 나타났으며 취소 후 9초 관찰에도 추가 요청이 없었습니다.

QA 외 인증 항목은 시작·로그인·로그아웃 동안 불변이며 QA 인증 항목은 로그아웃 때 삭제됐습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 앱·자체 서버를 먼저 종료한 뒤 합성 PNG 1개·QA DB/WAL/SHM 3개만 제거하고 37개 소스 원문·부재와 package/lock·APK hash를 복구 대조했습니다. 자체 reverse·에뮬레이터도 종료했습니다. 새 빌드·설치·의존성·캐시/백업 정리와 원래 checkout·iOS·iPhone 조작은 없습니다.

처음 가상 관측을 사용한 합성 자료 준비에서 사진 연결이 거절돼 QA DB transaction으로 준비 방법을 정리했으며 제품 수정은 없습니다. 정확한 원본 보존·요청 횟수·성공/초기 실패 근거는 [진행 기록](ANDROID_PROGRESS.md)에 있습니다. 실제 네트워크 전환·전송 중 앱 종료·자동 사진·복원·여러 기기 병합·실제 Android·Release와 P3-10 전체는 계속 남깁니다.

## 10월 19일 재개: 수동 사진 백업 Android 확인 완료

Android 시작 `a456f18`, 공통 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**의 source 37개를 임시 적용했습니다. database 이름 한 곳만 새 QA DB로 오버라이드했고 실제 원본 v1 DB는 열거나 migration하지 않았습니다. 새 native 빌드·설치·의존성 변경 없이 기존 Debug APK·API 37·자체 8082와 합성 HTTP를 사용했습니다.

native File의 복사·SHA-256·내용 기반 MIME rename·고정 첨부 사본·dispose 보존 1개가 PASS입니다. 별도 실제 async SQLite·expo/fetch multipart 통합 **9개도 PASS**입니다. v1→v2의 두 owner 전체 행 보존, JPEG/PNG 원본 bytes 전송·ACK/metadata, 서버 200 뒤 응답 유실·재개방·고정 해시·동일 UUID 재시도, 잘못된 사진 5건 뒤 정상 JPEG 진행, 동의/화면/계정 guard와 실제 ACK SQL 쓰기·DELETE 뒤 rollback을 확인했습니다. 응답 유실·계정 변화·DB 오류 시점은 주입했으며 native SQL·파일·이후 HTTP는 실제입니다. 서버 사진 POST 14회·고유 사진/사진 영수증 각 8개, 모든 저장 첨부본 해시·크기와 별도 썸네일도 직접 대조했습니다.

0건 합성 계정의 실제 UI에서 계정·서버·형식/크기/범위·원본 보관 안내, 취소, 재확인 후 빈 전송, 수동 실행 뒤에도 매번 다시 확인하는 흐름이 PASS입니다. 사진 POST는 없었고 방문 성공 시각도 만들지 않았습니다. 이는 사진이 있는 계정의 전체 UI 전송 결과가 아니며 독립 native 사진 전송 결과와 구분합니다. 로그아웃·native 인증 항목 삭제도 확인했습니다.

QA 임시 소스의 `bash scripts/verify-cloud.sh`는 타입·lint·모바일 378개·기존 backend syntax/native load·양쪽 JS/Hermes export PASS입니다. 공통 서버 61개는 이번에 반복하지 않았습니다. Inspector 도구의 중첩 async 조기 반환을 기존 generator 변환으로 고친 뒤 9개를 통과했으며 제품 소스는 수정하지 않았습니다. 정확한 실제 결과와 실패/성공 근거는 [진행 기록](ANDROID_PROGRESS.md)에 보존했습니다.

개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 앱·자체 서버를 먼저 종료한 뒤 원래 14개·새 23개, 총 37개 파일을 복구 대조했습니다. 시험 DB·WAL·SHM·합성 첨부본·전송 cache 부재, QA UI DB 제거, 자체 reverse·에뮬레이터 종료와 package/lock·APK hash 보존을 확인했습니다. 원래 checkout·iOS·iPhone·SDK·AVD·기존 증거는 조작하지 않았고 새 캐시·Time Machine 삭제도 없습니다.

공통 제품 코드의 수정 제안은 새로 없습니다. 실제 OS 네트워크 변화·전송 중 앱 종료·자동 사진 전송·다운로드/복원·여러 기기 삭제 병합·Android 실기기·Release와 P3-10 전체는 계속 남깁니다. nonempty 계정 전체 UI는 위 후속 검증 결과를 따릅니다. 아래 사진 NOT RUN은 개발 재개 전의 저장 이력입니다.

## 10월 19일 사진 백업은 준비 상태로 저장·종료

공통 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**의 production 22개·테스트 14개·설정 1개와 backend 12개의 고정 사본을 준비했습니다. 고유 QA DB 이름으로만 바꾼 database 사본도 준비했지만, **소스 37개와 QA 이름 모두 실제 파일에는 적용하지 않았습니다.** 현재 원본 존재 여부·해시와 고정 사본·QA 이름 한 곳 변경·package/lock 불변을 재확인했습니다.

사용자의 저장·종료 요청으로 사진 native·UI 검사는 **NOT RUN**입니다. File cache 복사·MIME rename, JPEG/PNG 실제 expo/fetch multipart, 별도 v1→v2 migration·사진 ACK·재시도·계정 guard·수동 동의 UI는 다음 검증 범위입니다. 아래 `51c96d2`의 방문 연결 복구 13가지 PASS를 이 사진 소스의 결과로 합치지 않습니다.

10월 18일 종료 명령은 자동 승인 검토의 사용량 한도로 실행되지 않았습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 전용 8082·3002와 reverse는 없었고 새 서버·앱·빌드·설치·migration을 시작하지 않았습니다.

추가 용량 정리 요청으로 사용하지 않는 Gradle transforms·Android Studio cache/index·npm 다운로드 캐시 약 6.51GiB를 삭제했습니다. 삭제 직후 실제 가용량 증가는 확인되지 않아 확보량으로 표시하지 않습니다. AVD·SDK·JDK·의존성·APK·방문·사진·백업·LocalHistory·로그·근거와 원래 checkout·iOS는 보존했습니다. 삭제 경로·정확한 바이트·공간 측정·후속 미실행 범위는 [진행 기록](ANDROID_PROGRESS.md)에 있습니다.

이후 사용자가 두 Time Machine 로컬 백업 삭제를 별도로 허용해 Mac 데이터 볼륨의 9월 28일·10월 12일 두 스냅샷만 삭제하고 부재를 확인했습니다. 정리 전후 후속 측정에서 실제 가용량은 17.36→57.98GiB(약 62.3GB), 관측 증가는 40.62GiB(약 43.6GB)였습니다. Android 캐시 확보량과 중복 합산하지 않습니다. 프로젝트 `.snapshots/`·현재 소스·기기 데이터·AVD·사진·APK·검증 자료와 외장·원격 백업은 삭제하지 않았습니다. 새 개발·native 검사 없이 용량 정리와 기록만 수행했습니다.

## 10월 18일 foreground 연결 복구 확인

Android `cf79090`에서 공통 **`51c96d249b2772517da3d9937cb03e568dc1b2d9`**의 필요한 14개 JS/TS만 임시 적용했습니다. 별도 native async 파일 DB·합성 계정과 고정 backend 사본의 실제 임시 HTTP를 사용한 연결 복구 13가지가 PASS입니다.

- 두 transport 예외 뒤 retry/check 시각을 저장하고 DB 재개방 후 보존. 확인 기한 전 요청 없이 무인증 GET health 뒤 긴 retry보다 먼저 같은 작업 UUID ACK. 사진 큐·URI·소수점 시각 유지.
- health HTTP 503은 확인 시각만 진행하며, health 응답 중 opt-out·foreground 이탈·token 변경은 두 시각·큐 보존.
- 실제 CAS transaction 중 foreground/token 변경·DB 오류는 rollback하며 일반 backoff로 덮어쓰지 않음. expected 시각이 바뀌었으면 새 시각을 유지.
- 실제 제어 HTTP 401/409는 pause, 500은 일반 retry를 유지하고 health로 우회하지 않음. 실제 지연 health의 약 3초 abort·무인증도 확인.

transport 예외·시계·경쟁 시점·오류 status는 합성 제어입니다. health·ACK는 실제 HTTP이고 DB 쓰기·rollback은 실제 native API입니다. 서버는 방문·고유 ID·영수증 각 1개였고 본 검사 health 10회 모두 GET·Authorization 없음이었습니다. 실제 OS Wi-Fi 단절·nonempty 사용자 UI·전송 중 프로세스 종료의 E2E로 확대하지 않습니다. 새 UI 문구와 이전 14개·장시간 시험은 이번에 다시 실행하지 않았습니다.

backend 합성 DBv3는 확인했지만 새 사진 API는 호출하지 않았습니다. 사진 서버 기반과 **아직 연결하지 않은 모바일 사진 업로드·동의·다운로드·복원**을 구분합니다. 사진 큐 보존은 사진 전송 성공이 아닙니다.

타입·lint·기존 Android worktree 90개 테스트가 PASS이며 공통 232/61개와 구분합니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 시험 DB 12개·WAL·SHM 제거, 공통 파일 14개 복구와 자체 프로세스 종료도 확인했습니다. 새 설치·native build·의존성 변경·캐시 삭제는 없었고 iOS·iPhone·원래 checkout은 조작하지 않았습니다. 정확한 한계·소스·근거는 [진행 기록](ANDROID_PROGRESS.md)에 저장합니다.

## 10월 17일 새 방문 백업·Coordinator Android 확인

공통 `c95d6caa209086431b371a68cd2ac0d2222aa48b`의 필요한 14개 파일만 임시 적용했습니다. 실제 계정 화면에서 합성 계정 0건, 기본 자동 꺼짐, 수동 빈 전송 안내와 성공 시각 미생성, 동의창의 계정·서버·범위·사진 제한 표시, 취소, opt-in, 강제 재실행 뒤 같은 계정·opt-in 복구, 자동 끄기·로그아웃을 확인했습니다. UI 시험에서 원본 가져오기나 비어 있지 않은 방문 전송은 실행하지 않았습니다.

별도 native async 파일 DB·실제 임시 HTTP 서버로 Coordinator 14개 검사도 PASS였습니다. 수동 ACK·성공 시각, 사진 큐·URI·소수점 시각 보존, 서버 저장 뒤 응답 유실 모사 → 재개방 → 저장된 지연 시각 → 같은 작업 UUID 재전송·서버 중복 없음까지 확인했습니다.

공통의 경쟁 조건 수정이 `202a2e250420b10056c518d8d26454035f548615`로 도착한 뒤 repository·visitSync·visitBackup 세 파일만 바꿨습니다. **이 새 기준에서도 새 합성 계정·DB로 실제 HTTP 14개를 다시 실행해 모두 PASS**였습니다. 이어 별도 실제 native DB·합성 ACK로 다음 네 경우도 통과했습니다.

- 빈 큐 snapshot 뒤 방문·삭제가 추가되면 완료 시각을 쓰지 않고 다음 배치까지 처리.
- 같은 시점에 자동 백업을 끄면 새 두 작업을 보존하고 완료 시각을 만들지 않음.
- ACK transaction이 대기 중 같은 owner의 token이 바뀌면 rollback·Runner paused·큐 보존.
- 실제 DELETE 뒤 같은 owner의 token이 바뀌어도 rollback·ACK 0건·사진 연결·큐 보존.

`c95` UI 전체와 `202a` 독립 합성 검사를 구분합니다. 네 경쟁 조건은 HTTP ACK stub을 쓴 실제 native DB 시험이며, 두 단계의 14개 검사는 실제 HTTP입니다. 응답 유실·재시도 시계도 통제한 모사이므로 OS 단절·전송 중 앱 강제 종료·전체 앱 E2E의 결과로 확대하지 않습니다.

두 임시 소스의 타입 검사·lint·이 worktree의 기존 90개 테스트가 각각 PASS였습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 합성 DB 여섯 개·WAL·SHM 제거, native 인증 항목 삭제, 공통 파일 원상 복구와 자체 서버·에뮬레이터 종료도 확인했습니다. 새 빌드·설치·의존성 변경·캐시 삭제는 없었으며 iOS·iPhone·원래 checkout은 조작하지 않았습니다.

공통 수정의 Android 해결 확인과 원본 근거·두 SHA·한계는 [진행 기록](ANDROID_PROGRESS.md)에 저장합니다. 실제 Android·Release·배터리·OS 백업/복원, 사진·다른 기기 복원·병합과 비어 있지 않은 UI 전송·중단 복구는 남아 있습니다.

## 10월 16일 APK 업데이트와 실제 비동기 SQLite 확인

보존한 새 APK와 현 설치 앱의 hash·서명·package·버전을 대조한 뒤 `install -r` 1회로 데이터 보존 업데이트했습니다. 설치된 APK의 hash가 검증한 파일과 같고, manifest와 컴파일된 XML의 SecureStore 백업 제외 세 규칙도 확인했습니다. 모든 owner의 방문·사진·outbox 전체 행과 기존 사진 바이트가 유지됐습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 새 빌드·의존성 설치·uninstall·wipe는 없었습니다.

공통 `f4eb401`에 고정한 네 저장 소스의 원문·해시를 보존하고, production `database.ts`의 네 비동기 adapter 함수를 그대로 추출했습니다. 새 고유한 임시 파일 DB에서 실제 `openDatabaseAsync`, `execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`, `closeAsync`, `deleteDatabaseAsync`를 사용했습니다. A/B 격리, GPS만 가져오기, UUID·session·소수점 시각·사진 URI·outbox 보존, 비활성 owner의 import·attempt 쓰기·ACK 거절, 다른 계정 ACK의 삭제 방지와 재개방 보존이 PASS입니다. 임시 DB·WAL·SHM 제거와 원본 불변도 확인했습니다.

10월 15일 sync wrapper 시험의 남은 범위 중 네 async adapter 함수는 이번에 확인했습니다. production 연결 캐시·계정 화면·서버 전송 UI E2E 전체나 새로 준비 중인 백업 버튼·자동 전송 기능의 결과는 아닙니다. 실제 OS 백업·복원·기기 전송은 시작하지 않았고 실제 Android·Release·배터리 조건도 남아 있습니다.

사용자 용량 정리 요청에 따라 검증 프로세스 종료 후 본인 worktree의 재생성 가능한 중간 바이너리 3,265개(논리 크기 2.04GiB)를 제거했습니다. 실가용량 증가는 **154.19MiB**이며 2.04GiB를 확보했다고 표시하지 않습니다. APK·서명·로그·근거·AVD·DB·사진·outbox·백업은 보존했습니다. 정확한 경로·바이트 수와 근거는 [진행 기록](ANDROID_PROGRESS.md)에 있습니다. 공통 파일 overlay나 package/lock 변경은 없었고, 자체 8082·에뮬레이터는 종료했으며 iOS 8081·iPhone·원래 checkout은 조작하지 않았습니다.

## SecureStore 백업 제외의 Debug 빌드를 확인했습니다

Android `b32afc6`에 공통 `d51a8fe`의 `app.config.ts`만 임시 적용해 offline Android Debug 빌드를 마쳤습니다. 최종 APK manifest의 fullBackupContent·dataExtractionRules 참조가 실제 XML 리소스로 연결되며, 컴파일된 full-backup·cloud-backup·device-transfer 규칙 모두 `sharedpref/SecureStore`를 제외합니다. APK 서명 검증과 기존 APK와의 서명·package 일치도 PASS입니다.

10월 15일에는 새 APK를 보존하고 설치하지 않았습니다. 10월 16일 데이터 보존 업데이트와 설치 바이너리 확인까지 마친 결과는 위에 별도로 기록합니다. OS 백업·복원·기기 전송, 방문 DB·사진 백업, Release·실제 휴대폰을 확인한 결과는 아닙니다. `faceIDPermission: false`의 iOS 결과도 Android 범위 밖입니다. 공통 설정은 원문·해시를 대조해 복구했고 package/lock이나 의존성은 바꾸지 않았습니다.

## 합성 native SQLite에서 가져오기와 계정 분리를 확인했습니다

동일 공통 커밋의 저장 소스를 원본 DB와 다른 `:memory:` native 연결에서 실행했습니다. A/B 계정 분리, GPS 방문·연결 사진 행만 명시적으로 가져오기, 개발 방문 guest 잔류, UUID·session·소수점 시각·사진 URI·outbox 내용 보존이 PASS였습니다. 비활성 계정 가져오기·attempt 갱신 거절과 다른 계정 ACK의 삭제 방지도 확인했습니다. 시험 후 메모리 연결을 닫았습니다.

실제 사진 파일이나 앱 원본 DB에는 시험 자료를 쓰지 않았습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 이 결과는 동기식 native SQLite를 감싼 저장 계층 시험이며 앱 UI나 production 비동기 adapter, 서버 전송 E2E 전체의 결과가 아닙니다. 초기 Inspector 변환 문제와 최종 PASS 근거는 [진행 기록](ANDROID_PROGRESS.md)에 구분했습니다.

검증 프로세스 종료 후 이번 worktree에서 새로 생성된 중간 바이너리만 정리해 가용량이 2.18GiB 증가했습니다. 최종·기존 APK, signing 파일, 로그·증거, AVD와 원본 자료는 보존했고 전역 캐시·원본 checkout·iOS 8081은 조작하지 않았습니다. 정확한 경로·용량과 로컬 근거 목록도 진행 기록에 있습니다.

첫 배터리·지도 검증은 Android 기준 `7db23ae`에 공통 `712dc04`의 설정 화면과 native 지도 두 파일을 임시 적용했습니다. 해당 UI 내용은 `70805c4`와 같았습니다. 뒤로 가기 수정의 후속 검증은 Android 기준 `cdb023a`에 공통 담당이 수정한 지도 화면까지 총 세 파일을 임시 적용했습니다. 검증 후 모든 파일을 원래 Android HEAD로 복원했습니다.

## 배터리 안내와 초기 지도는 Android에서도 확인했습니다

10월 12일에는 절전이나 앱 배터리 제한을 설명하는 안내가 없었고, 초기 지도에서 제주 일부가 잘렸습니다. 공통 담당이 안내와 전체 경계 bounds를 반영했고, 10월 14일 Android 에뮬레이터에서도 아래 결과를 확인했습니다.

| 변경 | 현재 결과 |
| --- | --- |
| 설정의 배터리 안내 | 정상 전원과 합성 절전 상태에서 수신 지연, 2분 공백, 저장된 방문·사진 보존 설명이 표시됨 |
| 휴대폰 앱 설정 연결 | Android 앱 정보 화면이 열리고 뒤로 가면 원래 설정 화면으로 복귀함 |
| 제주 포함 초기 지도 | 지도 조작 전과 앱 프로세스 재실행 후 제주 전체가 표시됨 |

이 두 제안은 해당 UI에 대한 Android 표시·연결 확인까지 끝났습니다. 실제 휴대폰의 배터리 제한이나 제조사별 절전 동작, 작은 화면·큰 글자·스크린리더까지 통과했다는 의미는 아닙니다. 초기 지도 개선으로 기존 성능 측정치가 좋아졌다고 주장하지도 않습니다.

원본 근거는 Git 제외인 `docs/test-results/android-ui-20261014/`의 `battery-guidance-saver.*`, `android-app-settings.*`, `app-settings-back.*`, `settings-tab-back.png`, `cold-map-jeju.png`, `summary.json`입니다. 공개 PR에는 설명만 남깁니다.

## 지도 선택 카드의 뒤로 가기 수정도 확인했습니다

첫 UI 검증에서는 지역 상세에서 지도에 돌아온 뒤 선택 카드가 열린 상태로 뒤로 가면 앱이 화면 밖으로 나갔습니다. 공통 담당은 Android의 포커스된 지도에서만 선택 카드를 먼저 닫도록 수정했습니다. 선택이 없으면 기존 뒤로 가기 흐름을 유지합니다.

수정된 지도 화면을 기존 Debug 앱에 임시 적용한 후 아래 동작을 native에서 확인했습니다.

| 흐름 | 결과 |
| --- | --- |
| 선택 카드에서 첫 번째 뒤로 가기 | 카드만 닫히고 지도에 머묾 |
| 선택이 없는 지도에서 두 번째 뒤로 가기 | 기존 OS 흐름으로 앱이 화면 밖으로 나감 |
| 선택 후 상세 진입 → 뒤로 가기 | 선택이 유지된 지도에 복귀함 |
| 지도 선택이 남은 상태에서 설정 탭 → 뒤로 가기 | 지도에 복귀하고 선택 카드가 유지됨. 지도 전용 처리가 설정의 복귀를 가로채지 않음 |
| 선택 카드가 있는 지도에서 검색 모달 → 뒤로 가기 | 모달만 닫히고 선택 카드가 유지됨. 이후 지도에서 뒤로 가면 카드 닫힘 |

모든 흐름과 저장 보존이 PASS였고 새 crash와 ANR은 없었습니다. 따라서 이 제안은 **수정 후 Android 확인 완료**로 갱신합니다. 실제 적용 코드는 공통 담당의 `travel_visit_tracker/app/(tabs)/index.tsx`이며 Android PR에 넣지 않았습니다.

검증 시 공통 checkout HEAD는 `712dc04`였지만 새 지도 화면은 아직 미커밋 상태였습니다. 정확한 파일 해시는 [진행 기록](ANDROID_PROGRESS.md)과 로컬 `docs/test-results/android-back-20261014/validation-files.json`에 남겼습니다. 단계별 원본과 저장 대조는 같은 폴더의 `back-steps.json`, `first-back-closes-card.*`, `second-back-default-os.*`, `detail-back-keeps-selection.*`, `settings-back-keeps-selection.*`, `search-back-keeps-selection.*`, `final-state.json`, `summary.json`입니다. 원본 화면과 기기 로그는 공개하지 않습니다.

P4-06은 Android 뒤로 가기에 대한 부분 확인입니다. 작은 화면, 큰 글자, 스크린리더와 양쪽 실제 기기 검증은 남아 있습니다. 새 장시간 시험이나 native rebuild는 하지 않았습니다.

## 로그인 QA는 aa09aa0 기준으로 완료했습니다

Android에서는 승인된 인증 파일 10개를 임시 적용해 가입, 강제 재실행 복구·me 확인, 서버 오프라인, JWT 비밀값 교체에 따른 expired·토큰 제거, 재로그인, 가져오기 확인창 취소와 로그아웃을 확인했습니다. 개인 원본과 인증 항목의 보존 대조를 통과했습니다. 상세 값은 로컬 근거에만 보관합니다. 공통 구현은 Android 커밋에 넣지 않았습니다.

이 결과는 기존 Debug APK·API 37 에뮬레이터와 자료 0건인 합성 계정 뷰의 시험입니다. 독립 비동기 Inspector 직접 읽기 진단은 미완료로 남겼고, 실제 앱 흐름과 native 저장 항목·서버 응답·원본 비교를 근거로 삼았습니다. 실제 게스트 가져오기나 이후 공통 전송 서비스를 검증한 결과가 아닙니다.

10월 14일 로그인 QA에는 SecureStore backup 제외 선언이 반영된 APK 근거가 없었습니다. 이후 10월 15일 새 Debug 빌드의 최종 manifest·XML에서 제외 규칙을 확인한 결과는 위에 별도로 기록합니다. OS 백업·복원, 실제 Android·Release와 iOS 계정 UI/DB 전환은 별도 확인이 필요합니다. 로그인 QA 종료 당시에는 사용자 지시에 따라 추가 시험을 시작하지 않았습니다. 자세한 상태와 로컬 근거 목록은 [진행 기록](ANDROID_PROGRESS.md)에 남겼습니다.

## 성능은 실제 기기에서 따로 판단해야 합니다

10월 12일 Debug·SwiftShader 환경에서 전체 앱 메모리는 시작 후 약 396~397MiB, 지도 이동·검색·선택 후 약 427MiB였습니다. Android 화면 렌더링 지연 지표도 높았습니다. 이번 UI 후속 검증에서는 같은 성능 시험을 반복하지 않았습니다.

이 결과만으로 경계를 단순화하거나 공통 지도 구조를 바꾸기보다, 실제 Android Release와 안정적인 GPU 조건에서 지도 표시 완료, 전체 앱 메모리와 프레임을 구분해 측정할 필요가 있습니다. P1-13/P4-07의 실제 기기 완료 조건은 그대로 남깁니다. 상세 수치와 측정 한계는 [Android 진행 기록](ANDROID_PROGRESS.md)에 보존했습니다.

## 실행 설명을 통합할 때 참고할 점

Android 담당 스크립트는 localhost 8082를 기본으로 쓰고 iOS의 8081은 거절합니다. 다른 포트는 `ANDROID_METRO_PORT`로, 외부 Node bin은 `TRIP_NODE_BIN`으로 지정할 수 있습니다. 루트·모바일 README와 RESUME의 실행 설명을 갱신할 때 이 방식에 맞추면 됩니다. 해당 문서와 backend 문서는 공통 담당 범위이므로 이번에는 수정하지 않았습니다.

실제 Android 기기, Release, 보안 잠금, 장시간 배터리 수용 시험이 완료되기 전에는 emulator의 화면 표시와 저장 보존 결과를 제품 전체 통과로 표시하지 않습니다.
