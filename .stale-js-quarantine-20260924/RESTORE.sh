#!/usr/bin/env bash
# Restores every quarantined stale .js file back to its original src/ location.
# Run from the repo root: bash .stale-js-quarantine-20260924/RESTORE.sh
set -euo pipefail
manifest="$(dirname "$0")/MANIFEST.tsv"
while IFS=$'\t' read -r original quarantined; do
  [ -n "$original" ] || continue
  mkdir -p "$(dirname "$original")"
  mv -- "$quarantined" "$original"
done < "$manifest"
echo "Restored $(wc -l < "$manifest") files."
