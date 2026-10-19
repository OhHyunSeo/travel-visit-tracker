# Trip Painting development rules

## Start here

- Read `README.md`, `PROGRESS.md`, `PROJECT_PLAN.md`, `docs/CHECKLIST_STATUS.md`, and `docs/RESUME.md` before changing behavior. Newer dated updates take precedence over older reports.
- The active app is `travel_visit_tracker/`: Expo 57, React Native, TypeScript, Expo Router, Zustand, SQLite, MapLibre and background GPS. This is a visit tracker, with no implemented pedometer or HealthKit/Health Connect integration.
- `backend/` is a separate Express/SQLite API. The active Expo app connects optional login and account-scoped local records. Manual visit backup and per-account opt-in automatic visit backup (off by default) are wired to foreground checks. Photo upload is manual and requires a separate account/server confirmation on every run; it preserves attachment bytes, waits for visits and uses atomic guarded ACKs. Mobile DB v2 adds photo transfer metadata; backend DB v3 provides the idempotent visit-photo API. Both platforms passed isolated native photo file/HTTP/retry checks. iPhone user-operated consent and Android emulator one-photo UI upload passed. Automatic photo upload and restoration remain pending.
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

The verifier runs mobile typecheck, ESLint, Vitest, backend syntax/native dependency loading, synthetic mobile-to-backend visit sync, and production Android/iOS JS/Hermes export. It sets offline Expo mode, does not start a persistent service, and does not read personal databases. The sync check uses temporary mobile/server databases and a short-lived loopback server.

For focused iteration use `npm --prefix travel_visit_tracker run check`. If changing the backend, run `npm --prefix backend test` too; it starts isolated loopback servers with temporary databases and synthetic images. Do not start the actual server against personal data for verification. For native configuration changes, report that native rebuild/device verification is still required if unavailable.

Cloud Linux checks cannot prove signed iOS/Android builds, GPS permission behavior, screen-lock collection, battery behavior, real photos, or future step/health permission integrations. State exactly which commands passed and what remains for a phone.
