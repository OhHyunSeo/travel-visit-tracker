#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export CI=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1

npm --prefix travel_visit_tracker run check
node --check backend/server.js
npm --prefix backend test
(
  cd travel_visit_tracker
  node --import tsx ../scripts/check-visit-sync.mts
)
(
  cd backend
  node -e "for (const name of ['sharp', 'bcrypt', 'sqlite3']) require(name); console.log('Backend native dependencies loaded');"
)
(
  cd travel_visit_tracker
  npx --no-install expo export --platform android --platform ios --output-dir dist
)
