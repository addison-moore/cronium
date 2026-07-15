#!/usr/bin/env bash
# Keep the container-image SDK copies in sync with their canonical source.
#
# apps/runtime/runtime-helpers/{python,nodejs,bash}/cronium.* is the canonical
# Cronium SDK: it carries the package.json / setup.py / README / tests and is the
# copy meant to be published and read by humans.
#
# The per-language execution container images build with a context of
# apps/runtime/container-images/<lang>/ and `COPY cronium.*` out of that context,
# so a byte-identical mirror of each helper lives there too. Nothing builds from
# runtime-helpers/ directly, so the two can silently drift.
#
# Default: assert the mirror matches the canonical source (used by CI).
#   --fix:  copy canonical -> mirror to repair drift.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON="$ROOT/apps/runtime/runtime-helpers"
MIRROR="$ROOT/apps/runtime/container-images"

# Relative paths that must be identical in both trees.
PAIRS=(
  "python/cronium.py"
  "nodejs/cronium.js"
  "nodejs/cronium.d.ts"
  "bash/cronium.sh"
)

mode="check"
if [ "${1:-}" = "--fix" ]; then
  mode="fix"
fi

drift=0
for rel in "${PAIRS[@]}"; do
  src="$CANON/$rel"
  dst="$MIRROR/$rel"
  if [ ! -f "$src" ]; then
    echo "MISSING canonical source: apps/runtime/runtime-helpers/$rel"
    drift=1
    continue
  fi
  if [ ! -f "$dst" ]; then
    echo "MISSING container mirror: apps/runtime/container-images/$rel"
    drift=1
    continue
  fi
  if ! diff -q "$src" "$dst" >/dev/null 2>&1; then
    if [ "$mode" = "fix" ]; then
      cp "$src" "$dst"
      echo "synced: runtime-helpers/$rel -> container-images/$rel"
    else
      echo "DRIFT: container-images/$rel differs from canonical runtime-helpers/$rel"
      drift=1
    fi
  fi
done

if [ "$mode" = "check" ]; then
  if [ "$drift" -ne 0 ]; then
    echo ""
    echo "The container-image SDK mirror has drifted from runtime-helpers/ (canonical)."
    echo "Edit the helper under apps/runtime/runtime-helpers/, then run:"
    echo "    bash scripts/check-sdk-sync.sh --fix"
    exit 1
  fi
  echo "SDK copies in sync (runtime-helpers <-> container-images)."
fi
