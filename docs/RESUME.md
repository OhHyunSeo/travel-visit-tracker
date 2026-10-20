# 여기서 이어서 개발하기

## 10월 20일 저장 구조 개발

모바일 DB v3을 구현했습니다. 계정+UUID 기본키와 같은 계정의 부모 방문을 가리키는 복합 외래키를 사용합니다. v1/v2 자료·URI·전송 payload/attempts·사진 메타데이터·설정을 원자적으로 보존하며, 가져오기 충돌은 양쪽 자료를 남기고 중단합니다. 앱 복원·다운로드 기능은 아직 없습니다.

공통 소스는 `2bae436b9f128219d6e81593139071526749b28a`입니다. Node 24.21.0의 모바일 타입·린트·402개, 서버 61개와 `bash scripts/verify-cloud.sh`, 해당 소스의 GitHub 검사 두 실행이 PASS입니다. 새 보존·격리 24개와 실제 임시 HTTP의 두 계정 동일 UUID 전송·응답 유실·재개방·ACK·첨부 바이트 조회·한쪽 삭제 격리를 확인했습니다. 원본 증거는 Git 제외 `docs/test-results/owner-keys-20261020/`에 있습니다. 10월 19일 native 결과는 `809efe0`의 v2 전송 검증과 구분합니다.

다음은 iPhone의 v3을 별도 합성 native DB에서 검사한 뒤 방문 변경·삭제 선행 복원, 다운로드 대기·커서 저장, 임시 파일 해시 확인과 재개를 연결하는 순서입니다. **원래 기기의 v1 DB를 새 코드로 열어 시험하지 않습니다.** 기존 계정·기록을 옮기거나 삭제하지 않고 고유 QA DB·인증 저장소를 먼저 준비합니다. iPhone은 실제 native 저장·복원 검증 때 연결이 필요하며 공통 개발·자동 검사에는 필요하지 않습니다.

Android는 같은 고정 소스의 실제 비동기 SQLite 3.50.3·별도 파일 DB에서 24개를 모두 통과했습니다. 모든 원본 테이블·설정·스키마·owner 행·사진 바이트·인증과 원래 v1·게스트 방문4/사진1/대기3·기록 꺼짐을 보존했습니다. native 시험 DB24개와 QA UI DB·합성 파일·자체 실행 환경을 정리하고 임시 소스40개의 원문/부재 해시·package/lock을 복구했습니다. 근거는 해당 worktree의 `docs/test-results/android-storage-v3-20261020/`입니다. HTTP 서버·실제 계정 생성·새 native 빌드·설치·의존성 변경은 없습니다. 완료 수 23/54와 P3-10·G1~G4 미완료, 원래 iOS 8081·Android 8082 분담을 유지합니다.

iPhone용 같은 24개 합성 probe는 Git 제외 `docs/test-results/ios-storage-v3-20261020/`에 ES2015 변환까지 준비했습니다. **실행은 NOT RUN**이며 기기 연결·원본 보존 기준값·고유 QA DB/인증 오버라이드를 준비한 뒤에만 시작합니다. 현재 iOS 소스 오버라이드·Metro·새 빌드는 적용하지 않았습니다.

## 10월 19일 사진 백업 검사

2026-10-19 최신 재개: **iPhone 수동 사진 백업의 native 전송과 실제 사용자 확인을 통과했습니다.** 공통 동작 `809efe0e012622b2e454b422dc8ef120b6d0e3ea`의 파일 준비 1개·별도 native SQLite/multipart 통합 9개 PASS입니다. 합성 방문1·PNG1 계정에서 사용자가 취소→확인 전송→다시 확인창 취소를 눌렀고, 방문 선행·사진 한 번 저장·대기0/서버 확인1·첨부본 유지와 매 실행 확인을 검증했습니다. 첫 두 창은 실제 화면의 핸들러로 열었고 세 번째는 사용자가 버튼부터 직접 눌렀습니다. 원래 앱의 신뢰 문제도 실제 실행으로 해결 확인했습니다.

종료 후 원래 v1 DB의 모든 7개 저장 테이블 해시와 guest·기록 꺼짐·foreground·방문9/사진0/대기9·무결성이 시작 때와 같습니다. 원래 SecureStore 항목은 계속 부재 상태이며 시험 계정만 로그아웃했습니다. QA UI DB·통합 DB9개와 WAL/SHM·합성 파일·전송 캐시 부재를 확인했고, 앱과 자체 iOS8081/HTTP를 먼저 종료한 뒤 DB·인증 이름 오버라이드 두 파일을 원래 해시대로 복구했습니다. package/lock은 같습니다. 새 native 빌드·설치·제품 코드 변경은 없습니다.

Android도 같은 동작의 합성 사진1건 UI 전송을 통과했습니다. 실제 에뮬레이터 화면에서 취소 POST0→확인 뒤 방문1·사진1 전송→다음 실행 재확인·취소, 원본 첨부본과 ACK/완료 문구를 확인했습니다. 원래 v1 DB·모든 owner 행·사진 바이트·게스트 방문4/사진1/대기3와 인증 항목을 보존했습니다. 임시 소스37개와 package/lock을 복구하고 QA DB·PNG·credential·자체 서버·reverse·에뮬레이터를 정리했습니다. 기존 native 1개·통합9개·빈 계정 UI는 `753438a`, 추가 UI 결과는 [PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1)에서 이어 저장합니다. 제품 소스는 같습니다.

다음 우선순위는 [사진 보존 계획](PHOTO_BACKUP_PLAN.md)의 계정+UUID 충돌을 보존하는 DB 갱신, 다운로드 대기·해시 검증·중단 재개와 새 합성 기기 복원입니다. 자동 사진 전송·복원과 P3-10 전체·G1~G4는 미완료, 완료 수는 23/54입니다.

최신 iPhone 근거는 Git 제외 `docs/test-results/ios-photo-backup-20261019-resume/`에 있습니다. 기본 DB에 새 QA 코드를 연결하지 말고 이후 기기 검증도 먼저 고유 QA DB·인증 저장소를 적용합니다. 원래 v1 DB를 새 schema로 열어 검증하지 않습니다. Xcode27.1/Swift6.4와 Expo Swift6.3.1 사전 컴파일 호환 문제는 남아 있으며, 새 native 기능을 넣기 전에 해결해야 합니다. 기존 앱은 재서명 상태로 이번 검사를 통과했습니다. 중복 재서명 사본은 정리했고 원래 native 빌드·갱신 프로필·서명 해시는 로컬에 보존했습니다.

## 10월 19일 앞선 저장

2026-10-19 저장·마무리: **사용자 요청으로 추가 개발·기기 검사를 멈췄습니다. 아이폰 앱 신뢰는 사용자 확인으로 완료됐고, 실제 재실행과 사진 검사는 다음 연결 때 진행합니다.** 신뢰 완료 뒤 새 검사를 실행하지 않았으므로 실행 문제가 해결됐다고 단정하지 않습니다. 새 재개 요청 전에는 시험 서버·빌드·기기 검사를 시작하지 않습니다.

Android 수동 사진 백업 검증은 완료했습니다. 공통 동작은 `809efe0e012622b2e454b422dc8ef120b6d0e3ea` 그대로입니다. Android의 파일 준비 1개·별도 native SQLite/실제 multipart 통합 9개와 빈 계정 확인창 취소·수동 확인·매 실행 재확인이 PASS입니다. 원본 v1 DB·방문 4건·사진 파일 1개·대기 3건과 모든 owner 행·첨부 바이트를 보존했습니다. 임시 파일 37개와 QA 실행 환경도 복구·종료했고 [PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1)의 결과 문서 `753438a`와 CI가 저장됐습니다.

아이폰 앱의 기존 개발 프로필은 10월 18일 만료됐습니다. 전체 갱신 빌드는 Xcode 27.1/Swift 6.4와 Expo의 Swift 6.3.1 사전 컴파일 구성요소 차이로 실패했습니다. 대신 기존 native 앱 사본에 같은 개발 인증서·앱 ID·권한의 새 프로필로 서명해 업데이트 설치했고 정적 서명 검증도 통과했습니다. 새 프로필 만료일은 10월 26일입니다. 앱을 삭제하지 않았으며 설치 전후 원본 DB v1·방문 9건·사진 0건·대기 9건과 전체 계정의 행·설정·무결성이 같았습니다.

설치 뒤 기기는 앱 실행을 보안 사유로 거부했고, 이후 사용자가 앱 신뢰를 완료했다고 알려주셨습니다. **iPhone 사진 native 전송·확인창은 NOT RUN**입니다. 나중의 마지막 DB 재조회는 기기 연결 reset으로 끝나지 않았습니다. 데이터 보존 근거는 설치 직후 성공한 대조이며, 그 뒤 개인 DB에 쓰기·가져오기·기록 변경은 하지 않았습니다.

시험용 DB·SecureStore 이름만 바꿨던 두 파일은 원래 바이트·해시대로 복구했습니다. package/lock도 그대로이며 자체 iOS 8081·합성 HTTP를 종료했습니다. QA 코드가 실행되기 전에 기기가 거부했으므로 QA 계정·사진·DB를 만든 결과는 없습니다. 원본 native 앱·갱신 사본·새 프로필·로그·서명·개인 DB 사본은 로컬 Git 제외 폴더에 보관하고 공개하지 않습니다. 새 캐시나 백업을 정리하지 않았습니다.

다음 연결에서는 별도 QA 환경을 준비하고 아이폰 앱이 실행되는지부터 확인합니다. 신뢰 완료를 다시 요청하지 않으며 새 실행 오류가 있을 때만 안내를 확인합니다. 원래 v1 DB에 새 코드를 연결하지 말고, 별도 QA DB와 인증 저장소 오버라이드를 먼저 적용한 뒤 8081을 엽니다. 합성 파일·독립 native DB·임시 HTTP로 multipart/ACK·재시도부터 확인하고, 그 뒤 확인창을 검사합니다. Inspector 중첩 async는 Android에서 확인한 ES2015 generator 변환을 사용하며 제품 코드와 구분합니다. 새 native 기능을 추가하기 전에는 위 컴파일러 호환 문제도 별도 해결해야 합니다. 완료 수 23/54, P3-10 전체·G1~G4와 사진 자동 전송·복원은 계속 미완료입니다.

현재 준비·서명 갱신·보존 근거는 Git 제외 `docs/test-results/ios-photo-backup-20261019/`에 있습니다. Android 원본은 해당 worktree의 같은 날짜 검사 폴더에 있습니다.

## 10월 19일 앞선 저장

2026-10-19, 끊긴 저장을 마무리합니다. 10월 18일 사용자 요청으로 수동 사진 백업·전용 확인창 구현까지 개발과 추가 시험을 중단한 상태를 유지합니다. 공통 동작은 **`809efe0e012622b2e454b422dc8ef120b6d0e3ea`**이며 [PR #2](https://github.com/OhHyunSeo/travel-visit-tracker/pull/2)에 저장했습니다. 모바일 타입·린트·378개, 서버 61개와 전체 `bash scripts/verify-cloud.sh`의 실제 임시 사진 HTTP·SQLite·양쪽 JS/Hermes 검사는 통과했습니다. 새 사진 native 전송·확인창, 자동 사진 전송·복원과 G1~G4는 미완료이며 완료 수는 23/54입니다.

사진은 매번 계정·서버·범위를 확인한 뒤 수동으로 전송합니다. 방문 선행, 첨부본 고정 해시·작업 UUID와 원자적 ACK/메타데이터를 연결했고 로컬 원본을 유지합니다. 모바일 DB v2는 추가 테이블만 만들며 파일명과 기존 행·사진 URI·큐는 유지합니다. 서버 DB는 v3입니다. 자동 방문 백업 동의에는 사진이 포함되지 않습니다.

다음 재개에서는 기존 APK·별도 합성 native DB·파일·실제 임시 HTTP로 사진 본문 전송부터 확인합니다. UI도 고유 QA DB 파일명 오버라이드로 분리해 원래 v1 DB를 열거나 갱신하지 않습니다. 고정 소스는 그대로 쓰되 QA DB 경로 차이와 복구 해시를 별도 기록합니다. 이전 v1 소스는 v2 DB를 열 수 없으므로 개인 DB에서 이 시험을 하지 않습니다. 새 UI 확인창 취소/매 실행 확인과 실제 multipart 성공 뒤에만 native 검증 완료로 기록합니다.

공통 원본 근거는 Git 제외 `docs/test-results/manual-photo-20261018/`에 보관합니다. Android는 스냅샷 37개를 준비했지만 앱에 적용하지 않았고 원래 파일·부재 해시가 모두 같습니다. 원본 방문 4건·사진 파일 1개·대기 3건과 DB v1을 보존하고 가상 기기를 종료했습니다. 새 사진 전송·확인창은 NOT RUN이며, 이전 `6d3777c`의 13개 연결 복구를 새 사진 결과로 취급하지 않습니다. Android 원본 근거는 해당 worktree의 Git 제외 `docs/test-results/android-photo-backup-20261018/`에 있습니다. 공통 동작 커밋 `809efe0`의 GitHub 검사 두 실행도 통과했습니다. 완료된 JS 출력 40개(논리 8.19MiB)만 로그·해시를 보관한 뒤 정리했고 직후 여유 공간은 약 8.33MiB 늘었습니다. 이번 저장에는 아이폰 연결이 필요하지 않았습니다. 새 개발·시험은 다음 재개 요청을 기다립니다.

## 직전 중단 시점

2026-10-18, 사용자 요청으로 개발과 추가 검사를 중단하고 저장했습니다. 재개 요청 전까지 새 개발·기기 시험은 진행하지 않습니다. 공통 동작은 **`51c96d249b2772517da3d9937cb03e568dc1b2d9`**이며, 서버 연결 복구 확인과 방문 연결 사진 서버 기반을 구현했습니다. 완료 수는 23/54, P3-10·13과 G1~G4 전체는 계속 미완료입니다.

공통 공유 문서 `c9d0997`과 Android 결과 `6d3777c`는 각각 [PR #2](https://github.com/OhHyunSeo/travel-visit-tracker/pull/2)·[PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1)에 저장했고 해당 커밋의 자동 검사는 모두 통과했습니다. 두 PR은 master 대상 초안이며 병합하지 않았습니다. 사용자 중단 상태를 추가 저장한 문서 커밋에는 새 동작 변경이 없습니다.

## 최신 구현과 확인

- 연결 전송 오류에는 `connectionCheckAt`를 계정별 settings에 저장합니다. 앱이 열린 동안 약 30초 간격의 기한에 설정한 서버의 `/health`를 최대 3초 확인하고, 복구되면 기대 retry/check·동의·계정·토큰·중단 상태가 맞을 때만 긴 retry를 풉니다. 인증값·방문 내용을 health로 보내지 않으며 HTTP500·401·409의 대기/중단을 우회하지 않습니다. OS Wi-Fi 복귀 이벤트 감지는 아닙니다.
- health 확인 중 화면 이탈·DB 저장 오류는 기존 retry를 보존합니다. 모바일 typecheck·lint·232개, 서버 61개와 전체 `bash scripts/verify-cloud.sh`, 임시 실제 HTTP·DB 재개방 연결 복구 및 양쪽 production JS/Hermes export PASS입니다.
- [방문 사진 API](../backend/docs/VISIT_PHOTOS.md)는 JPEG/PNG 첨부 bytes 그대로 저장·별도 썸네일·고정 UUID 멱등 처리·같은 계정의 활성 부모·삭제 뒤 접근 차단을 구현했습니다. DB v3의 새 테이블은 기존 계정·방문·지역 사진·삭제·영수증을 보존합니다. 서버 61개에는 사진24개와 DB0/1/2→3 보존 검사가 포함됩니다.
- 앱 사진 전송 서비스·동의·화면·복원은 아직 없습니다. 사진 큐와 실제 기기 파일은 그대로 두며 기존 방문 백업 동의로 사진을 보내지 않습니다. HEIC/WebP 서버 지원, 사진 자체 삭제 feed·물리 삭제·프로세스 중간 종료의 미참조 파일 정책·여러 기기 복원도 남습니다.
- Android는 같은 고정 SHA·기존 APK·API 37에서 별도 비동기 native 파일 DB의 연결 복구 13개를 통과했습니다. 처음 두 transport 실패·시각은 제어했고 health와 ACK는 실제 임시 HTTP입니다. 세션·화면·동의·DB 저장 실패 가드와 약 3초 실제 abort도 포함합니다. 새 UI 문구·실제 OS 네트워크 전환·사용자 앱의 nonempty 큐 전체 E2E는 미검증입니다.
- Android 모든 owner 행·사진 바이트와 게스트 방문 4건·사진 파일 1개·대기 3건·기록 꺼짐을 보존했습니다. 임시 소스 14개 복구·시험 DB 12개 제거·자체 8082/HTTP/Inspector/에뮬레이터 종료를 확인했습니다. 원본 근거는 해당 worktree의 Git 제외 `docs/test-results/android-connection-recovery-20261018/`에 있습니다. 새 native 모듈·의존성·빌드·설치와 아이폰 조작은 하지 않았습니다.
- 공통 동작 커밋 `51c96d2`의 GitHub 검사 두 실행도 통과했습니다. 완료된 JS 출력 40개(논리 8.11MiB)만 로그·해시 보존 뒤 정리해 직후 여유 공간 약 8.24MiB 증가를 확인했습니다. APK·서명·SDK·AVD·방문·사진·큐·백업·스냅샷과 원본 증거는 보존했습니다.

## 다음 순서

1. [사진 보존 계획](PHOTO_BACKUP_PLAN.md)의 클라이언트 단계: 방문 우선 전송 → 사진 파일 존재·형식·해시 확인 → 계정/토큰 가드가 있는 큐·ACK·재시도와 사진 전용 동의를 연결합니다. 실제 사용자 사진을 합성 시험에 사용하지 않습니다.
2. owner+UUID 키·파일 다운로드·처리 cursor의 보존 DB 갱신을 마련한 뒤 별도 테스트 기기로 복원과 전송 중 앱 종료·공간 부족을 확인합니다.
3. P3-13의 실제 앱 연결 복귀 화면·대기 큐 전송과 OS 네트워크 전환을 별도 테스트 환경에서 보완합니다. G1~G4·Android 실기기·Release·이동·배터리도 별도 검증입니다.

현재 root 원본 검사는 Git 제외 `docs/test-results/connection-photos-20261018/`에 보관합니다. 공유 문서와 PR에는 소스·요약만 보냅니다. 실행 상태와 최신 head는 재개할 때 다시 확인합니다.

## 10월 17일 저장 당시

2026-10-17: Android 방문 백업 검사를 재개하고 공통 전송 경쟁 조건 두 건을 수정했습니다. 현재 **23/54 완료**이며 G1~G4는 미완료입니다. [진행 기록](../PROGRESS.md)에 구현과 실제 검증의 범위를 정리했습니다.

## 최신 저장 상태

- 공통 동작은 `202a2e250420b10056c518d8d26454035f548615`입니다. 완료 시각 저장과 같은 트랜잭션에서 방문 큐를 다시 확인하며, ACK 삭제 전·후의 세션 검사 실패는 롤백합니다. 새 native 설정·의존성 변경은 없습니다.
- `bash scripts/verify-cloud.sh` PASS: 모바일 타입·린트·189개 테스트, 서버 36개, 실제 임시 HTTP와 양쪽 JS/Hermes export. 공통 커밋의 GitHub 검사도 PASS입니다. 아이폰은 오늘 조작하거나 새로 검사하지 않았습니다.
- Android `c95d6ca` 계정 화면은 기본 자동 꺼짐·빈 전송·동의 취소/켜기·프로세스 재시작 복구를 확인했습니다. 별도 비동기 native 파일 DB·실제 임시 HTTP 14개 검사를 `c95d6ca`와 수정 `202a2e2`에서 각각 통과했습니다. `202a2e2`의 실제 DB·합성 ACK 경쟁 조건 4개도 구분해 보존합니다. 실제 Android 휴대폰·Release·시스템 백업·복원은 아닙니다.
- Android 모든 owner의 방문·사진·큐와 기존 사진 바이트는 원본과 같습니다. 최종 게스트·기록 꺼짐·방문 4건·사진 파일 1개·대기 3건이며 가져오기는 실행하지 않았습니다. 공통 임시 적용 14개 파일 복구, 시험 DB 여섯 개·자체 서버·Inspector·에뮬레이터 정리를 확인했습니다.
- 아이폰 마지막 보존 확인은 10월 16일 게스트·기록 꺼짐·foreground·방문 9건·사진 0건·대기 9건입니다. 현재 연결·기기 상태로 단정하지 않습니다. 오늘은 iOS Metro나 Xcode 빌드를 실행하지 않았습니다.
- 이번 JS export 40개(논리 8.09MiB)를 로그·해시 보존 뒤 정리해 직후 가용량 약 8.22MiB 증가를 확인했습니다. APK·서명·SDK·AVD·방문·사진·큐·백업·스냅샷과 원본 로그는 보존합니다.

## 다음 작업

1. P3-13의 실제 앱 연결 복귀를 보완합니다. 현재는 foreground 시작·복귀와 4초 점검이 저장된 retry 시각(30초~5분)을 따르며 네트워크 복귀 이벤트 감지는 없습니다. 개인 DB에 합성 방문을 넣어 시험하지 않습니다.
2. [사진 백업 계획](PHOTO_BACKUP_PLAN.md)에 따라 방문 연결·고정 UUID·원본 첨부본 보존·부모 삭제·멱등 처리부터 구현하고 실제 임시 서버·합성 이미지로 검사합니다. 사진 전송은 기존 방문 전송 동의로 시작하지 않습니다.
3. 사진 큐·실패·재시도·동의를 연결하고, owner+UUID 키·파일 다운로드·커서의 보존 갱신을 마련한 뒤 별도 테스트 DB와 기기로 복원을 검증합니다.
4. 전송 중 앱 강제 종료, 실제 이동·배터리·Android 실기기·출시용 빌드와 G1~G4 전체 수용 시험을 계속 남깁니다.

공통·iOS `codex/common-ios`와 Android 독립 worktree `codex/android-native`의 역할·8081/8082 분리는 유지합니다. 두 초안 PR은 master 대상이며 병합하지 않았습니다. 재개 전에 실제 Git head·상태와 실행 프로세스를 확인합니다. 공통 원본은 `docs/test-results/backup-races-20261017/`, Android 원본은 해당 worktree의 `docs/test-results/android-backup-ui-20261017/`에 있습니다. 원본 증거는 로컬 Git 제외 폴더에만 있고 GitHub에는 요약과 소스만 있습니다.

## 10월 16일 종료 당시

2026-10-16, 사용자 요청에 따라 지금까지의 구현과 검사를 저장하고 마무리합니다. 새 기능 개발·추가 기기 시험은 재개 요청 뒤에 시작합니다. [앱 소개](../README.md)와 [진행 이야기](../PROGRESS.md)에 현재 범위를 정리했습니다.

## 현재 상태

- 완료 수는 20/54입니다. 수동 방문 백업, 계정별 기본 꺼짐의 자동 백업, 방문 변경사항 수·완료 시각·재시도 상태를 계정 화면에 연결했습니다. 자동 전송은 앱이 foreground일 때만 실행합니다. 사진 업로드·복원은 아직 없습니다.
- 자동 백업은 시작·화면 복귀·4초 점검에서 대기 상태를 읽고, 저장된 재시도 시각을 지킵니다. 실패 간격은 30초~5분이며 401·409는 자동 실행을 멈춥니다. 수동 버튼은 재시도 시각·자동 꺼짐과 별개로 사용할 수 있습니다. 계정·토큰·화면 상태를 전송 직전과 배치 사이에 다시 확인합니다.
- Node 24.21.0의 `npm --prefix travel_visit_tracker run check`와 `bash scripts/verify-cloud.sh` PASS. 모바일 180개·서버 36개, 합성 실제 HTTP 전송과 양쪽 생산용 JS/Hermes export를 포함합니다. 새 의존성 설치나 공통 native 빌드는 하지 않았습니다.
- 아이폰 실기기의 별도 합성 파일 DB에서 실제 비동기 SQLite API와 임시 서버를 사용한 14개 검사 PASS. 응답 유실 → DB 재개방 → 저장된 재시도 시각 → 같은 작업 UUID 재전송에서 서버 방문 중복이 없었습니다. 사진 큐·URI도 유지했습니다. 앱 시작 전체 흐름·전송 중 프로세스 강제 종료는 별도 검증입니다.
- 사용자가 닉네임 입력·가입, 빈 방문 백업, 자동 백업 켜기·확인을 직접 실행했습니다. 재시작 후 로그인과 opt-in 복구도 확인했습니다. 다른 입력칸·접근성 전체 검사는 남아 있습니다. 시험 계정은 0건이며 기존 게스트 가져오기를 실행하지 않았습니다.
- 아이폰을 자동 백업 해제·로그아웃 뒤 게스트로 돌렸습니다. 방문 9건·사진 0건·대기 9건의 행 해시와 무결성이 시작 때와 같습니다. 이번 시작 때 기록이 꺼져 있었으므로 **기록 꺼짐·foreground 모드**를 유지했습니다. 아래 과거의 8건·화면 잠금 기록 켜짐은 당시의 상태입니다.
- Android는 저장된 새 Debug APK를 업데이트 설치하고 설치본 해시·서명·백업 제외 XML을 확인했습니다. 공통 `f4eb401`의 실제 비동기 어댑터로 별도 WAL 파일 DB의 격리·가져오기·재개방 검사를 통과했습니다. 게스트 방문 4건·사진 파일 1개·대기 3건의 행·사진 바이트는 보존됐습니다. 결과는 Android `f05a3b3`에 저장했습니다. **이번 새 방문 백업 UI·Coordinator는 Android 미검증**이며 시스템 백업·복원과 실제 Android 휴대폰도 대기입니다.
- 10월 12일 실제 아이폰 정지 30분 잠금과 Android 에뮬레이터 30분 화면 꺼짐 결과는 기존 기록입니다. 실제 경계 이동·배터리·Release와 G1~G4 전체는 미완료입니다.

## 재개할 순서

1. 두 PR의 최신 head와 Git 상태를 확인합니다. 공통 소스를 고정 커밋으로 Android worktree에 임시 적용해 새 방문 백업 화면·자동 전송을 검사하고 원상 복구합니다. Android 커밋에 공통 파일을 중복으로 넣지 않습니다.
2. 앱 화면에서 실제 방문 전송·중단·복구 범위를 보완하고 사진 업로드·복원, 여러 기기 삭제·병합(P3-10~12)을 진행합니다. 실제 사용자 DB에 합성 방문을 넣거나 가져오기를 임의 실행하지 않습니다.
3. 실제 이동·배터리·출시용 빌드와 Android 실기기 검증을 별도로 수행합니다. 현재 자동 검사나 에뮬레이터 결과로 수용 기준을 통과시키지 않습니다.

## 작업 폴더와 실행 상태

공통·iOS는 원래 checkout의 `codex/common-ios`, Android는 독립 worktree의 `codex/android-native`입니다. iOS 8081과 Android 8082를 구분하고 [분담 규칙](PARALLEL_DEVELOPMENT.md)을 따릅니다. [공통 PR #2](https://github.com/OhHyunSeo/travel-visit-tracker/pull/2), [Android PR #1](https://github.com/OhHyunSeo/travel-visit-tracker/pull/1)은 master 대상 초안입니다. 병합하지 않았습니다.

아이폰용 임시 합성 서버·DB·시험 계정 입력 파일은 정리했습니다. 사용자 마무리 요청에 따라 iOS Metro 8081 종료를 확인했습니다. 마지막 정리 때 아이폰 디버거에 다시 연결되지 않아 지도 복귀 요청은 적용하지 못했고, 앱 프로세스·기록 설정은 바꾸지 않았습니다. 마지막 성공한 보존 확인은 위의 게스트 9건·사진 0건·대기 9건입니다. Android 서버·에뮬레이터도 종료 상태입니다. 재개 시 중복 서버를 띄우기 전에 실제 프로세스·기기 상태를 확인합니다. Node 24.21.0으로 루트의 `bash scripts/verify-cloud.sh`를 사용합니다.

원본 결과는 이 PC의 Git 제외 `docs/test-results/ios-backup-20261016/`, 공간 정리는 `storage-cleanup-20261016/`에 있습니다. Android 원본은 해당 worktree의 `android-update-async-20261016/`입니다. 원본 DB·사진·스크린샷·기기 정보는 공개하지 않고 요약만 PR에 저장합니다.

## 저장 공간을 정리한 범위

확인 당시 여유 공간은 약 23GiB였습니다. 공통 폴더의 비활성 Android 컴파일 바이너리 895개(논리 4.88GiB)를 정리한 직후 여유 공간은 약 15.45MiB 늘었습니다. Android worktree의 3,265개(논리 2.04GiB) 정리 직후 증가는 약 154.19MiB였습니다. 파일 크기만큼 공간이 늘었다고 계산하지 않습니다. 다른 쓰기·공유 파일·APFS 영향은 분리하지 않았으며 스냅샷을 지워 맞추지 않습니다.

두 최종 APK는 내용이 달라 모두 보존했고, 소스·방문·사진·큐·백업·스냅샷·환경·서명·SDK·가상 기기·원본 로그도 보존했습니다. 빌드 중간 파일은 필요할 때 다시 생성됩니다. 이전 10월 15일 약 2.2GiB 증가는 과거 결과입니다.

## 이전 인계 기록


지난 실행 명령과 빌드 메모를 보존했습니다. 아래의 기록 수, 실행 상태와 날짜는 과거 시점의 값입니다.

<details>
<summary>이전 환경과 기기 기록 보기</summary>

# 최신 재개 상태

2026-10-14: 사용량 한도로 중단된 결과 저장·PR 갱신을 재개해 마무리했다. 10월 12일의 양쪽 30분 시험은 완료되어 반복하지 않았다. Android 최종 결과·증거 checker는 `55ed305`로 PR #1에 반영됐고, 공통 결과·종료 문서는 PR #2에 보존한다. 공통 동작 소스는 `70805c4`이며 이후는 문서 갱신이다. 두 PR 모두 draft/open·master 병합 전. Android emulator/8082/시험 runner 종료 확인, 새 개발·추가 시험 없음. iPhone 유선 pairing·개발자 모드와 기기 정보 조회 성공이며 현재 기기 기록 수를 새로 검증한 것으로 취급하지 않는다.

# 최신 병렬 개발 안내

2026-10-12 추가 갱신: 현재 채팅은 codex/common-ios의 공통·iOS, 별도 Android 개발·검증 채팅은 독립 worktree의 codex/android-native 담당이다. [역할·통합·캐시 보존 규칙](PARALLEL_DEVELOPMENT.md)을 먼저 읽는다. Android는 localhost 8082, iOS는 기존 8081을 유지한다. Android 원본 시험 자료는 해당 worktree에 있으며 전체 진행 문서는 공통 채팅에서 통합한다.

- 이번 작업 종료 요청: PR 및 Android 30분 결과 저장까지 마무리한다. Android 에뮬레이터 화면 꺼짐 1800.589초·31회 관측, 한 번 확정·화면 복귀/중지/재실행 보존 PASS. 방문/outbox 각 3건·사진 파일 1개, 시험 설정 복구. 원본은 Android worktree의 Git 제외 증거 폴더에 보존한다. 새 개발·추가 시험은 재개 요청 후 진행한다. 두 초안 PR #1/#2는 master 병합 전이다.
- 현재 체크리스트 19/54. P3-06 서버 인증·사진 소유권 기반 및 20개 backend 통합 검사 완료. 모바일 90개, 양쪽 생산용 JS/Hermes export PASS. 실제 앱 로그인·백업·UUID sync와 G3는 미완료다.
- iPhone 정지 상태 30분 잠금 1800.003초·32회 관측 PASS. 후보 초기화 없이 한 번 확정, 방문/outbox 각 6건 보존. 사용자가 잠금 해제 후 앱을 열었고 지역 카드 1개·상세 방문 6건, reload 후 제주 포함 초기 지도 확인. 시험 종료 뒤 새 관측 공백은 기존 방문을 지우지 않았다. 경계 이동·배터리·standalone Release와 Android 실기기는 미검증이다.
- 확인된 inactive 프로젝트 Xcode 캐시와 완료된 임시 Cloud 의존성·생성물만 정리했다. 기존 앱/APK·백업·스냅샷·소스·개인 데이터·서명·로그를 보존했다. Time Machine snapshot은 삭제하지 않았다.
- Android 제안에 따라 공통 담당이 Android 전용 절전 안내와 전체 경계 bounds 초기 지도를 적용했다. 모바일 검사와 iPhone 표시 확인, 새 Android 화면은 후속 검증 대기. 공통 PR #2와 Android PR #1은 초안이며 원격 master 병합 전이다.
- 아래 18/54, 6분 잠금·이전 source 상태는 앞선 시점의 이력이다. 최종 30분 결과와 최신 커밋을 PROGRESS와 새 검사 기록에서 우선한다.

# 개발 재개 안내

> 2026-10-12 Cloud 준비 갱신: 설치·검증, GitHub 브랜치와 PC ↔ Cloud 전환은 [루트 README](../README.md)와 [Cloud 준비 검증](test-results/2026-10-12-cloud-readiness.md)을 우선한다. 기존 기기 증거는 원래 PC에만 남으며 Cloud에는 아래 요약과 소스를 공유한다. 이 문서 아래의 미커밋·Git 읽기 전용 설명은 준비 전 이력이다. 실제 방문 지역과 LAN 주소는 공유용 표현으로 바꾸었고 문서 원문은 로컬 스냅샷에 보존했다.

마지막 갱신: 2026-10-12 20시, Asia/Seoul. **최신 사용자 지시: 이 새 채팅에서 이전 작업을 이어가며, 연결된 iPhone으로 iOS 검증을 재개한다.** 사용자에게 이번 검증 동안 LAN 개발 서버 연결을 허용받았다. 최신 결과는 [iPhone 재개 검증](test-results/2026-10-12-iphone-resume.md)을 먼저 읽는다.

## 다음 작업의 우선순위

1. iPhone의 foreground 실제 301.532초 확정·중복 방지·프로세스 재실행 유지와 background 364.385초 잠금·총 체류 300.001초 확정·추가 관측 중 중복 없음·잠금 해제 유지 확인. P1-04, P2-08 완료, **18/54**. 현재 GPS 방문·outbox 각 5건이다.
2. 사용자 요청한 해당 지역 기록 목록 중복 표시는 초기 계획대로 지역당 카드 한 개로 정리했다. 개별 방문 내역·사진 연결은 상세에 보존했다. 실제 iPhone 목록 1카드·상세 5건 확인. 지역별 grouping·정렬·이전 사진 유지·삭제 영향 회귀 포함 최신 자동 검사 **90개 PASS**.
3. 다음 iOS 시험은 30분 잠금, 실제 경계 이동·재방문, 긴 종료·관측 공백·권한 변화, 배터리·standalone Release이다. 이번 6분 Debug+USB+읽기 전용 inspector 결과로 전체 수용 시험을 통과시키지 않는다. 개인 기록을 삭제하거나 실제 위치를 가상 위치로 덮어쓰지 않는다.
4. Android 에뮬레이터는 중단 상태다. 복구 시 API 37/CPU 4개/host 그래픽 재시작 실패를 먼저 확인한다. 새 건강 점검 코드의 권한/GPS·공백·알림 거부·절전 native 검증은 대기다.
5. 이번 foreground 체류 재시작은 사용자가 확인한 앱 전환/잠금과 DB 중단 사유가 일치했다. 더 오래된 ‘위치 시각은 갱신되는데 지도 초가 늘지 않는’ 보고의 원인은 미확정이며 이번에는 재현되지 않았다. G1~G4는 실제 Android 기기·전체 성능·나머지 시나리오가 남아 미통과다.

## 현재 개발 연결

- Metro LAN 8081, Mac 주소 `<현재 Mac LAN 주소>`. 동적 주소이므로 재개 때 다시 확인한다. 공개 터널 없음. 이번 검증 동안의 LAN 허용이다.
- 기존 서명 앱에 최신 JS 소스를 연결했다. native 재빌드·재설치 없음. 앱은 화면 잠금 기록(background), GPS 방문·outbox 각 5건, 기록 목록은 수집 지역 카드 1개다.
- 읽기 전용 inspector 조회로 좌표·지역 ID·UUID·사진 경로를 제외한 진단 요약만 저장했다. 개인 DB·사진 복사 없음. 화면 확인용 원본 캡처는 임시 파일이며 보존하지 않는다.
- 최신 자동 검사: typecheck·lint·90개 PASS. `.snapshots/20261012-iphone-background-region-source/`에 소스·문서와 압축 검증을 보존한다.
- 아래 ‘개발 서버와 가상 기기’와 오래된 iPhone 설명은 이전 중단 시점의 이력이다. 현재 지시와 상태는 위 내용 및 최신 검증 문서를 우선한다.

## 저장 상태와 확인된 기반

- 저장소: `/Users/oh/Projects/trip_painting`. 기존 미커밋 변경이 많다. 초기 복원은 `.snapshots/20261011-151329-before-expo-rebuild`, 오전 최종 소스는 `.snapshots/20261012-final-source`, 이번 Android 수정 소스는 `.snapshots/20261012-android-background-source`, 마지막 체크리스트·건강 점검 소스는 `.snapshots/20261012-checklist-health-source`. 기존 변경을 reset하거나 상위 프로젝트에 Git을 초기화하지 않는다.
- 최신 소스·문서 스냅샷: `.snapshots/20261012-iphone-background-region-source/`. 직전 260개 소스 스냅샷은 `.snapshots/20261012-iphone-resume-source/`에 보존했다.
- 현재 완료: P1-01, P1-02, P1-03, P1-05, P1-06, P1-08, P1-09, P1-10, P1-11, P1-12, P2-01, P2-03, P2-04, P2-06, P2-10, P2-02를 포함해 P1-04, P2-08을 추가해 총 18/54. G1~G4 통과 전. Android 실제 휴대폰은 없다.
- 현재 최신 자동 검사: typecheck·lint와 테스트 90개 PASS. 이전 87개는 Android 건강 점검 이후 결과다. 활성 화면의 권한/GPS/공백 점검과 SQLite 후보 만료 회귀 11개를 추가했다. 이전 76개와 native 검증 이력은 PROGRESS에 남겼다.
- Android Debug 재빌드: 캐시만 쓰는 `--offline`, `BUILD SUCCESSFUL in 4m 2s`, 작업 497개. APK의 RECEIVE_BOOT_COMPLETED와 POST_NOTIFICATIONS 선언 확인 및 업데이트 설치 성공. [빌드 증거](test-results/2026-10-12-android-background-build.json).
- background 위치 시작 후 첫 관측에서 앱이 죽던 원인은 persisted JobScheduler에 필요한 RECEIVE_BOOT_COMPLETED 누락이었다. 설정에서 고쳐 prebuild와 재빌드로 반영했다. 새 가상 지역에서 후보가 진행되고 서비스 알림이 표시됨을 확인했다. 화면 꺼짐 중 301.031초 확정과 중복 방지, 기록 끄기·재실행 복원까지 확인했다.
- 오전 Android 지도·방문·사진 재실행 복원과 가상 GPS 300.986초 확정은 완료했다. iOS 시뮬레이터에서는 이전에 사진 복원과 300.215초 가상 GPS 확정을 확인했다. 이 결과를 실제 여행 수용 시험으로 표시하지 않는다.
- iPhone 13 Pro / iOS 27.0.1 서명 빌드·설치·실행 성공 이력은 있다. 개발자 모드·Apple 로그인·프로필 신뢰는 사용자가 이미 완료했다. 지금 연결 여부는 다시 요구하지 않는다.

## 개발 서버와 가상 기기

이번 사용자 중단 요청으로 Metro와 시험 에뮬레이터를 종료했다. 8081 리스너 없음과 adb 기기 없음 확인. 직전 Android 개발 서버는 `127.0.0.1:8081`에 바인딩돼 있었다. adb reverse로 에뮬레이터 안의 같은 주소를 Mac에 연결하므로 핫스팟 IP가 바뀌어도 해당 연결에는 영향이 없다. 공용 인터넷 터널은 만들지 않았다.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker
PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH" npm run android:local
```

가상 기기를 먼저 실행한다. 이 명령은 기존 Metro가 있으면 중복 서버를 띄우지 않고 앱을 연결한다. 서버를 처음 시작했을 때는 개발 앱의 수동 주소에 `http://127.0.0.1:8081`을 입력한다. 명령은 에뮬레이터만 대상으로 한다.

| 대상 | 이번 실행과 로그 |
| --- | --- |
| Metro | 종료 확인. 이전 localhost 8081 로그 `/private/tmp/trip-painting-metro-android-local.log` |
| Android 가상 기기 | 종료 확인, adb 기기 없음. 재시작 실패 로그 `/private/tmp/trip-painting-android-health-emulator.log` |
| Android 재빌드 | 완료. `/private/tmp/trip-painting-android-background-fix-build.log` |
| iOS | 이번에는 빌드·설치·실기기 시험을 실행하지 않았다 |

프로세스와 임시 로그는 Mac 재부팅 이후 사라질 수 있으므로 중복 실행 전에 실제 상태를 조회한다. 사용자 승인한 LAN 접속은 유지하며 iPhone을 연결할 때 별도로 서버를 LAN 모드로 실행할 수 있다. 이전 Wi-Fi 주소 `<이전 Mac LAN 주소>`를 현재 핫스팟 주소로 가정하지 않는다.

## Android 재실행 명령

1. `android/app/build/outputs/apk/debug/app-debug.apk`는 기존 ARM 에뮬레이터에 `install -r`로 설치 성공했다. 앱을 실행해 개발 서버를 연결한다. APK 생성·설치 성공과 앱 화면·기능 실행 성공을 별도로 기록한다.
2. 지도·SQLite·사진 재실행 복원과 가상 위치 확정은 완료했다. 화면 꺼짐 중 연속 기록·서비스 알림·끄기 시험도 완료했다. 남은 권한 변경과 전체 경계 성능을 검증한다. 이미 진행 중인 기기 시험이 있다면 중복 실행하지 않는다.
3. 네이티브 변경으로 다시 빌드할 때는 다음 JDK 17 명령을 사용한다. 시스템 Java와 전역 셸 설정은 바꾸지 않았다.

```sh
cd /Users/oh/Projects/trip_painting/travel_visit_tracker/android
JAVA_HOME="/Users/oh/Projects/trip_painting/.tooling/jdk17/jdk-17.0.20.1+1/Contents/Home" \
ANDROID_HOME="/Users/oh/Library/Android/sdk" \
PATH="/Users/oh/Projects/trip_painting/.tooling/node_modules/.bin:$PATH" \
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

Studio 내장 JDK 25에서는 Worklets Prefab/CMake 단계가 실패했다. Studio가 생성한 `gradle/gradle-daemon-jvm.properties`의 기준이 `JAVA_HOME`보다 우선했으므로 기준도 17로 변경했다. [Expo config plugin](../travel_visit_tracker/plugins/with-gradle-jdk.js)이 prebuild 때 `toolchainVersion=17`을 생성한다. JDK 선택 경로는 `.tooling/jdk17-home.txt`에 저장했다.

`android/local.properties`에 SDK 경로를 기록했고 생성 폴더 전체는 Git ignore 대상이다. 처음 설치된 API 37 시스템 이미지와 앱 compile/target SDK 36은 별개다. SDK 라이선스는 이미 사용자가 수락한 항목만 자동 설치에 이용했으며 `yes | sdkmanager --licenses` 같은 일괄 동의는 실행하지 않았다. 사용자는 Android 실기기를 보유하지 않아 에뮬레이터 결과를 실기기 결과로 쓰지 않는다.


CPU 1개 AVD 실행에서 지연이 있었으므로 다음에는 확인된 CPU 4개 옵션을 사용한다. AVD 기본 파일은 변경하지 않았다. 이전 시험 데이터가 남아 있으므로 foreground 자동 기록 설정도 재개 시 확인한다.

```sh
/Users/oh/Library/Android/sdk/emulator/emulator \
  -avd Medium_Phone_API_37.0 -no-snapshot -no-boot-anim \
  -cores 4 -gpu host -qt-hide-window -grpc-use-token
```

## iPhone 체류 재시작 현상 확인

- 사용자 확인: foreground 모드, 오후 4시경 방문 기록 유지, 새 체류 확인 진행. 새 진단 화면에서 실제 수집 방식 ‘앱을 화면에 연 동안’, 마지막 체류 재시작 ‘아직 없음’을 사용자에게 확인받았다. 진단 추가 전 현상을 소급해 설명하지 않는다. 사용자 위치 좌표는 필요하지 않다.
- 최신 사용자 답변: 기존 방문 2개 유지, 지도 초 증가 없음, 설정은 위치 수신 중이며 마지막 위치 시각이 오전 09:01:10 이후 계속 갱신, 오차 약 6m. 수신·후보 갱신·확정·지도 렌더링을 구분해 확인한다. 현재 원인은 미확정이다.
- 현재 정책: 연속 300초, 정확도 최대 50m, 관측 공백 최대 120초, 오래된 위치 최대 120초. 경계와 정확도 반경이 겹치거나 긴 공백이 생기면 후보를 초기화한다.
- 실내 GPS 불안정, foreground 모드에서의 실제 background 전환, 관측 공백과 경계 오차는 가능한 원인이다. 아직 현장 원인을 확정하지 않았다. 이미 저장한 방문은 체류 후보가 초기화돼도 남는다.
- 재현한 코드 문제: 오래된 중복 이벤트를 stale 검사보다 먼저 무시하도록 변경했고, iOS의 단순 `inactive`에서는 후보를 삭제하지 않도록 했다. 실제 background에서는 foreground 수집을 중단하며 시작·중단·생명주기 작업은 직렬 실행한다. 제거·교체된 수집기의 늦은 콜백과 저장 실패는 세대 검사로 SQLite 트랜잭션 안에서도 무시한다. 장치 시각 역행과 새로운 stale 이벤트 거절은 유지한다.
- 설정의 진단 정보에는 마지막 위치 시각·정확도·관측 간격·수신 지연, 마지막 초기화 이유·시각과 실제 수집 모드만 저장한다. 좌표·지역명은 저장하지 않으며 다음 정상 관측과 DB 재개방 후에도 초기화 이유를 유지한다. 이 정보로 현장 관측을 구분하고 [검증 기록](test-results/2026-10-11-foundation.md)에 추가한다.
- 실제 사진 선택, 30분 화면 잠금, 배터리 시험은 미완료다. [수용 시험](ACCEPTANCE_TESTS.md)의 실기기 결과를 가정으로 체크하지 않는다.

## iOS 빌드 주의

- 시뮬레이터 앱: `travel_visit_tracker/.build/ios/Build/Products/Debug-iphonesimulator/TripPainting.app`.
- iPhone 앱: `travel_visit_tracker/.build/device/Build/Products/Debug-iphoneos/TripPainting.app`.
- 로그: `/private/tmp/trip-painting-ios-build.log`, `/private/tmp/trip-painting-iphone-build.log`.
- Apple 서명 팀은 Git 제외·권한 0600인 앱 `.env.local`의 `APPLE_TEAM_ID`. 키·팀 정보를 문서나 공개 앱 환경 변수로 복사하지 않는다.
- 이번 Personal Team 프로필은 2026-10-18 만료, 이후 재서명·설치 필요.
- 느린 Maven 다운로드 때문에 이번 **Debug** pod 설치에 검증된 로컬 tarball을 일회성 선택했다. `RCT_TESTONLY_RNCORE_TARBALL_PATH`, `RCT_USE_LOCAL_RN_DEP`, `HERMES_ENGINE_TARBALL_PATH`는 저장된 실행 설정에 없다. **Release 빌드 전에는 해당 변수 없이 정상 pod install을 재실행**한다. 지금 Pods가 Debug 전용임을 잊지 않는다.

## 코드와 데이터의 현재 범위

Expo 57.0.27, RN 0.86.3, React 19.2.3, MapLibre 11.5.0, TypeScript 6.0.3. Node 24.21.0 / npm 11.21.0은 프로젝트 `.tooling`에만 설치했다. 이전 Expo 화면은 `prototype_reference/expo/`, 기존 Flutter 백업은 별도 폴더에 보존했다.

지도·지역 검색·상세·기록·수집·설정, 기기 SQLite, 사진 영속 저장, 연속 관측 판정, 권한과 foreground/background 수집 기반은 구현했다. 경계는 geoBoundaries 2020년 개발 자료 실제 228개이며 최신 출시 팩·안정적 지역 ID 검증은 남았다. 도로 지도 다운로드, 로그인·서버 동기화는 연결 전이다. npm audit 29개 경고는 SDK 호환성을 깨뜨리는 강제 downgrade 없이 남겨 두었고 출시 전 재검토한다.

파일을 저장한 상태이며 Git commit·push·배포는 하지 않았다. `.git`은 현재 읽기만 허용된다. 최신 계획과 실제 결과는 [PROJECT_PLAN](../PROJECT_PLAN.md), [PROGRESS](../PROGRESS.md), [종료 검증 기록](test-results/2026-10-12-validation.md)을 함께 확인한다.

직전 채팅 종료 때 Metro와 에뮬레이터는 종료했다. 당시 Android 자동 기록은 꺼져 있었고 새 Android native 시험은 완료하지 못했다. 이번에는 위의 iPhone 개발 서버를 재개했다. 앱·기기 데이터는 삭제하지 않았다. [최신 상태](test-results/2026-10-12-android-health.md)가 직전 실행 중 안내보다 우선한다.

</details>
