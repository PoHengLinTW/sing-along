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

**Decision: (b). Our Web Audio engine plays; wavesurfer.js only renders waveforms from precomputed peaks.**

- **Packages:** wavesurfer.js latest is 8.0.1; the PRD says v7, so the spike pins `wavesurfer.js@^7` (7.12.12). The multitrack plugin is **not** part of wavesurfer.js v7/v8 any more: it is the separate package `wavesurfer-multitrack` 0.4.12 (BSD-3, last published 2024-07, depends on wavesurfer.js ^7.6.3). It plays through `HTMLMediaElement`s, has no mute/solo, and looks unmaintained.
- **(a) multitrack plays audio** (Chromium 145 headless, 3 x 22 kHz mono tones, offsets 0/2000/4000 ms, 30 s): audio elements sit **~25 / ~205 / ~45 ms** away from the shared playhead from the first sample, and the offset did not shrink (205 -> 204 -> 212 ms). Not drift growth within 30 s, but a fixed misalignment that we cannot correct, plus the media-element scheduling risk in `tasks/README.md` #6.
- **(b) our engine plays, wavesurfer renders**: AudioContext clock vs wall clock stayed within **-5.3 to +0.5 ms** over 30 s (no growth). Browser-reported output latency 37.8 ms (headless fake sink).
- **Peaks-only rendering works**: `WaveSurfer.create({ peaks: [Float32Array], duration })` renders without fetching or decoding audio. Positioning by start offset works (we move the lane by `trackLeftPx`). `ws.zoom()` throws "No audio loaded" in this mode; use `ws.setOptions({ minPxPerSec })` instead.
- **Deviation from the AC:** measured over 30 s, not 5 min, by agreement (drift can be handled if it shows up in production). Headless Chromium with a fake audio sink only: no Safari, no iPhone, nothing audible.

## Memory (M0-08)

## Go / no-go

## Code to port to M1/M2
