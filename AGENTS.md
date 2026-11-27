# Trip Painting development rules

## 공유 5시간 한도와 저장

- 2026-11-16부터 공통·iOS와 Android는 각 항목을 시작하거나 저장할 때 공유 5시간 한도를 확인합니다. `get_usage_limits`의 300분 창에서 `100 - usedPercent`로 잔여량을 계산합니다.
- 잔여 10% 미만(`usedPercent > 90`)이거나 사용자가 중지를 요청하면 진행 중인 항목만 정리합니다. 확인한 결과, 미완료·미실행 범위, 저장한 Git 지점과 다음에 할 일을 Android 진행 기록에 남기고 체크리스트 채팅에 상태를 전달합니다.
- 중지한 뒤에는 사용자가 다시 진행을 요청할 때 재개합니다.

## Start here

- Read `README.md`, `PROGRESS.md`, `PROJECT_PLAN.md`, `docs/CHECKLIST_STATUS.md`, and `docs/RESUME.md` before changing behavior. Newer dated updates take precedence over older reports.
- The active app is `travel_visit_tracker/`: Expo 57, React Native, TypeScript, Expo Router, Zustand, SQLite, MapLibre and background GPS. This is a visit tracker, with no implemented pedometer or HealthKit/Health Connect integration.
- `backend/` is a separate Express/SQLite API. The active Expo app does not yet connect login or server synchronization.
- `prototype_reference/` and `travel_visit_tracker_flutter_backup/` are reference source. Do not install, modify or migrate these folders unless the task specifically needs them.

## Preserve work and data

- Inspect Git status first. Preserve existing edits; do not reset, clean, force-push or initialize Git in a parent folder. Use task branches named `codex/<topic>` based on the latest `origin/master`, and submit a PR targeting `master`.
- Keep personal DBs, photos, raw device diagnostics, screenshots, credentials, `.env*` values, `.snapshots/`, `.tooling/`, and signing files out of commits. Environment examples contain names and placeholders only. Do not bypass `.gitignore` with `git add -f`.
- `docs/test-results/` contains local-only evidence, except the tracked cloud-readiness report. Older links to excluded evidence work only on the original PC; use the shared progress summary and do not invent missing evidence.
- Preserve saved visits, photo associations, owner isolation and outbox transactions. Test with synthetic data. Do not delete or reseed a user's device DB to validate a change.
- Declare reusable native changes in `app.config.ts` or config plugins. `travel_visit_tracker/ios/` and `android/` are generated and excluded; do not commit machine paths, generated native folders or signing settings.
- Preserve boundary source/license attribution and distinguish the bundled 2020 development dataset (228 regions) from current official boundaries.
- Keep measured results, emulator tests and actual-device tests distinct. Do not mark the acceptance gates complete from JS tests or bundle export. Update `PROGRESS.md` and applicable checklists for substantive work.
- Keep dependency changes focused; commit the associated `package-lock.json`. Do not run forced audit fixes or upgrade the Expo/RN stack incidentally.

## Install and verify

Use Node **24.21.0** from `.nvmrc`. Run commands from the repository root:

```sh
bash scripts/setup-cloud.sh
bash scripts/verify-cloud.sh
```

The verifier runs mobile typecheck, ESLint, Vitest, backend syntax/native dependency loading, and production Android/iOS JS/Hermes export. It sets offline Expo mode, does not start a persistent service, and does not read personal databases.

For focused iteration use `npm --prefix travel_visit_tracker run check`. If changing the backend, run an isolated temporary-database API smoke check too; the backend currently has no automated test suite. For native configuration changes, report that native rebuild/device verification is still required if unavailable.

Cloud Linux checks cannot prove signed iOS/Android builds, GPS permission behavior, screen-lock collection, battery behavior, real photos, or future step/health permission integrations. State exactly which commands passed and what remains for a phone.
