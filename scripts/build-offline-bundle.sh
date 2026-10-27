#!/usr/bin/env bash
# Offline-bundle dry-run (architecture 18.7 N4).
# Writes the intranet layout and checksums. Does not install packages or pull images.
# Image tars are produced on a networked build machine and copied in later.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OFFLINE_BUNDLE_OUT:-$ROOT/deploy/offline-bundle/dry-run}"

rm -rf "$OUT"
mkdir -p "$OUT/configs" "$OUT/images" "$OUT/npm" "$OUT/migrations" "$OUT/hub-shell-dist"

cp "$ROOT/deploy/compose/compose.intranet.yml" "$OUT/configs/compose.intranet.yml"
if compgen -G "$ROOT/packages/db/drizzle/*.sql" > /dev/null; then
  cp "$ROOT/packages/db/drizzle/"*.sql "$OUT/migrations/"
fi

cat > "$OUT/VERSION.txt" <<EOF
name=agenthubex-offline-bundle
profile=intranet
mode=dry-run
note=no package registry and no image pull; image tars are added by a networked build machine
EOF

cat > "$OUT/images/README.txt" <<EOF
Place private-registry image tars here. This dry-run does not pull images.
EOF

cat > "$OUT/npm/README.txt" <<EOF
Production hosts do not run a package install. This directory stays empty in dry-run.
EOF

cat > "$OUT/hub-shell-dist/README.txt" <<EOF
Copy the built hub-shell dist here on the build machine. The SPA has no CDN links.
EOF

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

(
  cd "$OUT"
  find . -type f ! -name 'checksums.sha256' | sort | while read -r file; do
    hash_file "$file"
  done
) > "$OUT/checksums.sha256"

echo "offline-bundle dry-run: $OUT"
exit 0
