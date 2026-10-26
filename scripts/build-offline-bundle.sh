#!/usr/bin/env bash
# P1 placeholder: build offline-bundle for intranet / airgap install.
# Acceptance: docs/architecture/18-intranet-offline.md §18.7 N4
# Layout:     deploy/offline-bundle/README.md
#
# TODO(P1-08): implement docker save, hub-shell dist copy, migrations copy,
#              checksums, VERSION.txt. Do not require npm registry on target.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OFFLINE_BUNDLE_OUT:-$ROOT/deploy/offline-bundle}"

echo "build-offline-bundle.sh (P1 placeholder)"
echo "  repo root:  $ROOT"
echo "  bundle dir: $OUT"
echo "  expected:   images/  npm/  configs/  (+ hub-shell-dist migrations on real build)"
echo "  acceptance: N4 — install/upgrade from bundle only (see 18.7 / P1-08)"
echo "TODO(P1): produce VERSION.txt, checksums.sha256, image tars, and configs copy."
exit 0
