# 공통 채팅에 전달할 Android 변경 제안

기준: `0cf402a`, 2026-10-12. 공통 담당 파일은 이 worktree에서 수정하지 않았다. 아래 제안은 공통 채팅의 적용·회귀 검증과 Android native 재확인이 필요하다.

## 절전과 강제 종료 안내 보완

상태: **FAIL (절전 안내 요구사항), 수집 장애 재현 아님**.

재현: API 37 Emulator 37.2.12에서 background 기록 시작 → 합성 전원 unplug/배터리 15% → `cmd power set-mode 1` → `settings get global low_power`가 `1`인 상태에서 설정 화면 확인. foreground 위치 서비스와 약 15초 관측은 유지됐다. 설정에는 현재 기록 모드, 위치 품질·공백과 일반 권한 안내가 있으나 절전/배터리 제한에 대한 설명은 없다. 절전이 실제로 위치를 중단했다고 주장하지 않는다.

로컬 증거: `docs/test-results/android-native-20261012/battery-saver-settings.png`, `battery-saver-power.txt`, `battery-saver-start.json`, `battery-saver-active.json`. 원본은 Git 제외이며 공유 summary는 Android 진행 문서에 기록한다.

수정 대상: 공통 담당 `travel_visit_tracker/app/(tabs)/settings.tsx`. Android 안내 영역에 절전 및 제조사 배터리 제한이 위치 수신을 늦추거나 중단할 수 있음, 긴 관측 공백에서는 체류를 다시 확인하고 확정 방문·사진은 유지됨, 필요 시 휴대폰의 앱 배터리 설정을 확인해야 함을 사용자 언어로 설명한다. 기존 권한 설정 버튼을 활용할 수 있다. 절전 예외를 자동 설정하거나 제한 해제를 강제하지 않는다.

예시 문구: “절전 모드나 앱 배터리 제한 때문에 위치가 늦게 들어올 수 있습니다. 2분 넘게 위치가 끊기면 체류 확인을 다시 시작합니다. 이미 저장한 방문과 사진은 남아 있습니다. 잠금 중 기록이 멈춘다면 휴대폰 설정에서 이 앱의 위치 권한과 배터리 제한을 확인해 주세요.”

실시간 절전 감지가 필요하다면 Android PowerManager를 읽는 native 모듈 또는 기존 지원 API 여부를 먼저 확인해야 한다. 이번 검증만으로 새로운 native 의존성을 추가할 근거는 부족하다. 안내 적용 후 Android 설정 화면과 큰 글자, 권한 회수·긴 공백 안내를 다시 확인한다.

## 통합 시 실행 안내 갱신

Android 담당 스크립트 `android-local.sh`의 기본 포트가 `8082`로 바뀌었으며 `8081`은 거절한다. 병렬 작업을 끝낸 뒤에도 포트를 분리해 운영할지 공통 채팅에서 결정하고, 루트/모바일 README와 RESUME의 기존 8081 Android 실행 설명을 실제 운영 방식에 맞춰 갱신한다. 스크립트의 `ANDROID_METRO_PORT`로 8081 이외의 포트를 선택할 수 있다. 외부 Node 읽기 전용 재사용은 `TRIP_NODE_BIN`으로 지정한다.

## 전체 팩 초기 지도 범위

상태: 개선 제안. 초기 viewport에서 본토 전체가 표시되지만 제주 도형 일부가 지도 아래 경계에 잘린다. API 37 / 1080×2400 / 현재 초기 center·zoom에서 `map-full.png`로 확인했다. 선택 후 fitBounds와 지도 이동은 동작한다.

공통 담당 `src/ui/RegionMap.native.tsx`에서 초기 지도도 전체 개발 팩 bounds와 실제 map 영역 크기에 맞춰 fitBounds할지 검토한다. 기존 선택 지역 zoom 동작과 attribution을 보존하고 작은 화면에서도 본토·제주가 처음부터 들어오는지 확인한다. 228개 데이터 로딩 실패나 지역 판정 장애로 해석하지 않는다.

## 성능 후속 검증

Debug+SwiftShader에서 전체 앱 PSS 약 396~397MiB, 검색/지도 조작 후 약 427MiB이며 HWUI 지연 지표가 높다. 현 단계에서 공통 geometry 단순화나 지도 구조 변경을 바로 적용하지 않는다. 동일 조건 host GPU 재실행 안정성, Release 앱, 실제 Android 기기에서 지도 표시 완료 이벤트·메모리·프레임을 분리 계측한 뒤 조정할 필요가 있다. 이 결과로 P1-13/P4-07의 실제 기기 완료 기준을 체크하지 않는다.
