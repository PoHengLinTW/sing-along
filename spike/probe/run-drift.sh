#!/bin/sh
# Sequential five-minute drift probes. Run from spike/ with Vite already serving HTTPS.
# Usage: sh probe/run-drift.sh <outdir> <file1> <file2> <file3>
set -eu
if [ "$#" -ne 4 ]; then
  echo 'Usage: sh probe/run-drift.sh <outdir> <file1> <file2> <file3>' >&2
  exit 2
fi
out=$1
shift
mkdir -p "$out"
node probe/wave-check.mjs a chromium 300 "$@" > "$out/drift-a.out" 2>&1
node probe/wave-check.mjs b chromium 300 "$@" > "$out/drift-b.out" 2>&1
echo done > "$out/drift.done"
