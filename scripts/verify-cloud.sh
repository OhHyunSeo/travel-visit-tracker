#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export CI=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1

npm --prefix travel_visit_tracker run check
node --test qa/map-transport/fixture/server.test.mjs
python3 -m unittest discover -s qa/map-transport/android -p 'test_*.py'
python3 -m unittest discover -s qa/map-transport/ios -p 'test_http_exchange.py'
node --check backend/server.js
npm --prefix backend test
(
  cd travel_visit_tracker
  node --import tsx ../scripts/check-visit-sync.mts
  node --import tsx ../scripts/check-auth-deadline.mts
  node --import tsx ../scripts/check-photo-sync.mts
)
(
  cd backend
  node -e "for (const name of ['sharp', 'bcrypt', 'sqlite3']) require(name); console.log('Backend native dependencies loaded');"
)
(
  cd travel_visit_tracker
  npx --no-install expo export --platform android --platform ios --output-dir dist
)
