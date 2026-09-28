# Spike notes (M0)

Findings from the throwaway audio spike. Fill in as each task is verified by hand.

## Device / browser matrix

| Device | Browser | Mic prompt (M0-01) | Sample rate | getSettings (AEC/NS/AGC/channels) | Notes |
|---|---|---|---|---|---|
| Desktop | Chrome | | | | |
| Desktop | Safari | | | | |
| iPhone | Safari | | | | |

## Latency (M0-05)

| Device | Output | Offset that lines up (ms) | outputLatency + baseLatency (ms) |
|---|---|---|---|
| | Wired | | |
| | Bluetooth | | |

## FLAC encoder (M0-04)

| Candidate | License | Size | Speed, 4 min mono 48 kHz | Maintenance | Verdict |
|---|---|---|---|---|---|
| `libflacjs` 5.6.0, asm.js build (`dist/libflac.js`) | MIT wrapper, libFLAC is BSD | worker bundle 368 kB (minified, bundled) | Node/desktop: **722 ms** (`bench/encoders.mjs`); iPhone: _TBD, run "Encode synthetic 4-min take"_ | Published 2026-07 | **Chosen (provisional)**: only the asm.js build is wired up. Round-trips losslessly in Vitest (libFLAC decoder). ~3.7 MB/min on synthetic noisy voice |
| `libflacjs` 5.6.0, wasm build (`libflac.min.wasm.js`, 131 kB .wasm) | same | ~240 kB | Not measured: fails to load under Node (`fetch` of the .wasm path); not tried in a browser worker | same | Not evaluated. Try only if the asm.js build is too slow on iPhone |
| `@audio/encode-flac` 1.4.1 | MIT | tiny wrapper | n/a | 2026-09 | **Not independent**: thin wrapper over libflacjs (same engine), so not a real alternative |
| `@mediabunny/flac-encoder` 1.60 | MPL-2.0 | 1.6 MB pkg + peer dep `mediabunny` (10 MB unpacked) | Not run (needs the WebCodecs/mediabunny pipeline, browser only) | 2026-09, actively maintained | Paper evaluation only: heavier and MPL-licensed, for a single encode call. Rejected unless libflacjs fails |
| `wasm-media-encoders` | MIT | 3 MB | n/a | 2024-05 | Only MP3/Vorbis; no FLAC. Excluded |
| `ffmpeg.wasm` (`@ffmpeg/core`) | GPL-2.0-or-later | 65 MB | n/a | n/a | Excluded: size and license |

**Honest gap:** the task asks to compare at least 2 candidates by running them. Only the libflacjs asm.js build was actually benchmarked; the alternatives were evaluated from package metadata. Revisit if the iPhone result is bad.

## Storage quota (M0-06)

## wavesurfer decision (M0-07)

## Memory (M0-08)

## Go / no-go

## Code to port to M1/M2
