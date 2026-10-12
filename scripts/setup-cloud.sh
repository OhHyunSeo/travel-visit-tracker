#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXPECTED_NODE="$(tr -d '[:space:]' < .nvmrc)"
ACTUAL_NODE="$(node -p 'process.versions.node')"
if [[ "$ACTUAL_NODE" != "$EXPECTED_NODE" ]]; then
  echo "Node $EXPECTED_NODE is required (.nvmrc); current version is $ACTUAL_NODE." >&2
  echo 'Select this runtime in the cloud environment, or run nvm install && nvm use locally.' >&2
  exit 1
fi

# Include test tools even if the caller has NODE_ENV=production.
npm --prefix travel_visit_tracker ci --include=dev --no-audit --no-fund
npm --prefix backend ci --include=dev --no-audit --no-fund
echo 'Dependencies installed. Verify with: bash scripts/verify-cloud.sh'
