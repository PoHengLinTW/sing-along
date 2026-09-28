#!/bin/sh
# Sequential 5-minute drift probes (a then b), bounded by design. Usage: sh probe/run-drift.sh <outdir> <files...>
out=$1; shift
node probe/wave-check.mjs a chromium 30 "$@" > $out/drift-a.out 2>&1
node probe/wave-check.mjs b chromium 30 "$@" > $out/drift-b.out 2>&1
echo done > $out/drift.done
