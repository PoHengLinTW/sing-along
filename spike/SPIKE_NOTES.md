# Spike notes (M0)

Findings from the throwaway audio spike. Fill in as each task is verified by hand. A passing build or unit test does not count as an audible or device check.

## Checklist audit (2026-09-28)

`tasks/M0.md` has **11 of 32** acceptance criteria checked: M0-01 (2/4), M0-02 (1/6), M0-03 (2/4), M0-04 (1/5), M0-05 (0/3), M0-06 (1/3), M0-07 (4/4), M0-08 (0/3). M0-07's acceptance criteria are met by headless measurements, but its desktop Chrome/Safari listening checks in `tasks/README.md` remain open. The spike currently builds and its 48 Vitest tests pass. Those tests cover logic, not the pending listening and hardware results.

The remaining work has three parts:

1. **Real devices and listening:** desktop Chrome, desktop Safari, and iPhone Safari mic permission/settings; three-file playback, pause/seek/volume and five-minute audible drift; a 60-second recording; FLAC/WAV playback; wired and Bluetooth clap offsets; real-tab crash recovery; and iPhone glitches, encode time, storage quota, and 10-track memory limit.
2. **Real-browser format and waveform checks:** the five-minute headless comparison and headless mp3/m4a/wav/flac decoding now pass as recorded below. Confirm playback and waveform behavior in desktop Chrome and Safari and record any format gaps there.
3. **Encoder decision:** the independent Mediabunny WASM comparison is now measured below. Confirm the chosen encoder on iPhone before treating the choice as final.

## Device / browser matrix

| Device | Browser | Mic prompt (M0-01) | Sample rate | getSettings (AEC/NS/AGC/channels) | Notes |
|---|---|---|---|---|---|
| Mac desktop | Chrome 153 | Granted; whether a prompt appeared was not reported | Mic track 24 kHz; AudioContext 48 kHz | AEC/NS/AGC false; 1 channel | Three MP3 files loaded; user reports resume works fine |
| Desktop | Safari | _manual_ | _manual_ | _manual_ | |
| iPhone | Safari | _manual_ | _manual_ | _manual_ | |

User report after the device-check request: **“all looks good. No anomaly.”** This is a positive qualitative result. When asked for the numerical logs, the user replied **“not measured.”** The report did not identify which individual checks were run or provide the sample counts, settings, offsets, quotas, encode times or memory results required below; those entries remain open until recorded.

Subsequent real desktop Chrome 153 report (2026-09-29): capture began at timeline **20.801 s** (first frame `ctx.currentTime=117.477 s`) and stopped at `140.795 s`. Raw and placed take length were **23.317 s**, matching the 23.318 s context-clock interval to about 1 ms. FLAC encoded in **98 ms** to **0.70 MB** (1.80 MB/min for this particular voice take), and FLAC/WAV both decoded as 23.32 s mono, 48 kHz. The report also says **“Resume works fine.”** This was a 23 s take, so it does not satisfy the 60 s real-device check; the roughly 3–3.5 MB/min voice-size expectation was not met by this content and needs a full-minute sample before deciding whether to revise that estimate.

Automated (Playwright, headless, `probe/`): FLAC and WAV output decode with `decodeAudioData` in **Chromium 145, Firefox 146, WebKit 26.0** (desktop). Headless WebKit is not a real desktop or iPhone Safari check. An earlier fake-mic run hung at `getUserMedia`; the current run below succeeded outside the sandbox. M0-03 and M0-06 still require real-browser checks.

The fake-mic probe now resolves in headless Chromium 145 when launched outside the sandbox. The fake device reported **2 channels despite requesting 1**, while AEC/NS/AGC were false; the worklet is configured to downmix explicitly to mono. At a verified 5.000 s playhead, a nominal 60-second run captured **60.018 s** of samples at 44.1 kHz (18 ms over target), and stored start offset **4,941 ms**, mapped from first-frame AudioContext time. The first captured frame preceded the scheduled playback anchor by 59 ms. Earlier tests at timeline zero appeared 71–111 ms short because the spike intentionally trims samples captured before timeline zero; the raw recording was longer. Killing the tab after 30 s offered a recovered **30.0 s** take on reopen, and its transport advanced to 1.90 s after Play. The recovered audio was not listened to. These results do not substitute for the three real-device checks.

Four two-second files made from one sine source with FFmpeg loaded through the spike file input in headless Chromium 145, Firefox 146 and WebKit 26.0: **mp3, m4a, wav and flac all decoded**. Reproduce with `node probe/formats-check.mjs <browser> <mp3> <m4a> <wav> <flac>`. Playback and actual Safari compatibility still need real-browser checks.

## Latency (M0-05)

| Device | Output | Offset that lines up (ms) | outputLatency + baseLatency (ms) |
|---|---|---|---|
| Desktop Chrome 153 | Wired | **−27** (user confirmed aligned) | _not assigned to this output path; page logged 176.3 and 5.3 at different times_ |
| Desktop Chrome | Bluetooth | _manual_ | _manual_ |
| Desktop Safari | Wired | _manual_ | _manual_ |
| Desktop Safari | Bluetooth | _manual_ | _manual_ |
| iPhone Safari | Wired | _manual_ | _manual_ |
| iPhone Safari | Bluetooth | _manual_ | _manual_ |

The Chrome report logged reported latency **176.3 ms** (5.3 base + 171.0 output), then **5.3 ms** (5.3 base + 0.0 output). A slider value of **−27 ms** was logged while the app's output label was still “unspecified”; the user confirmed it was the aligned **wired** offset. Neither reported-latency reading was tied unambiguously to that output path, so both are retained here rather than assigned to a row.

## FLAC encoder (M0-04)

| Candidate | License | Size | Speed, 4 min mono 48 kHz | Maintenance | Verdict |
|---|---|---|---|---|---|
| `libflacjs` 5.6.0, asm.js build (`dist/libflac.js`) | MIT wrapper, libFLAC is BSD | worker bundle **368 kB** (minified, bundled) | 4 min / 48 kHz: Chromium **581 ms**, Firefox **645 ms**, WebKit **476 ms** in headless desktop; iPhone _TBD_ | Published 2026-07 | **Chosen provisionally**: smaller bundle, simpler worker integration and faster on 2 of 3 desktop engines; permissive license. Round-trips to 16-bit mono. ~3.70 MB/min on this synthetic signal |
| `libflacjs` 5.6.0, wasm build (`libflac.min.wasm.js`, 131 kB .wasm) | same | ~240 kB | Not measured: fails to load under Node (`fetch` of the .wasm path); not tried in a browser worker | same | Not evaluated. Try only if the asm.js build is too slow on iPhone |
| `@audio/encode-flac` 1.4.1 | MIT | tiny wrapper | n/a | 2026-09 | **Not independent**: thin wrapper over libflacjs (same engine), so not a real alternative |
| `@mediabunny/flac-encoder` 1.60.0 + `mediabunny` 1.60.0 | MPL-2.0 for both packages | comparison page bundle **416 kB** (minified, tree-shaken, WASM inlined; includes page logic) | Same input: Chromium **493 ms**, Firefox **2005 ms**, WebKit **910 ms** in headless desktop; iPhone _TBD_ | Published 2026-09, actively maintained | Valid 16-bit mono FLAC and lossless round trip. Faster in Chromium, slower in Firefox/WebKit; larger integration, so not chosen provisionally |
| `wasm-media-encoders` | MIT | 3 MB | n/a | 2024-05 | Only MP3/Vorbis; no FLAC. Excluded |
| `ffmpeg.wasm` (`@ffmpeg/core`) | GPL-2.0-or-later | 65 MB | n/a | n/a | Excluded: size and license |

The browser comparison is reproducible at `/compare.html` or with `node probe/compare-check.mjs <chromium|firefox|webkit>` while Vite runs. Both outputs were decoded in each headless engine as 240.000 s, 1 channel, 48 kHz; maximum sample error versus the Float32 input was 0.000034 or less (16-bit quantization). Both files were about 14.80 MB for four minutes of synthetic noisy signal. These numbers are desktop headless measurements and include different wrapper overhead, so the iPhone result is still decisive.

## Storage quota (M0-06)

`navigator.storage.estimate()` quota (headless, so not representative of real profiles): Chromium ~1.7-2.3 GB, Firefox 10.7 GB, WebKit 1.05 GB. Real devices: _manual_ (logged on page load). Chunk persistence and recovery logic is covered by Vitest with fake-indexeddb; the real reload/kill test is manual.

| Device / browser | Reported quota (GB) | Recovered duration after 30 s kill | Take plays / glitches |
|---|---:|---:|---|
| Desktop Chrome 153 | 10.74–10.75 | User confirmed ≥28 s after a 30 s tab kill (exact duration not pasted) | Recovered take played; no audible glitch reported in 10-track mix |
| Desktop Safari | _manual_ | _manual_ | _manual_ |
| iPhone Safari | _manual_ | _manual_ | _manual_ |

## wavesurfer decision (M0-07)

**Decision: (b). Our Web Audio engine plays; wavesurfer.js only renders waveforms from precomputed peaks.**

- **Packages:** wavesurfer.js latest is 8.0.1; the PRD says v7, so the spike pins `wavesurfer.js@^7` (7.12.12). The multitrack plugin is **not** part of wavesurfer.js v7/v8 any more: it is the separate package `wavesurfer-multitrack` 0.4.12 (BSD-3, last published 2024-07, depends on wavesurfer.js ^7.6.3). It plays through `HTMLMediaElement`s, has no mute/solo, and looks unmaintained.
- **(a) multitrack plays audio** (Chromium 145 headless, three 310 s / 22 kHz mono tones, offsets 0/2000/4000 ms): signed positions of its media elements had **168.3 ms inter-track spread at 300 s**. The spread stayed 168.3 ms from 40 s through 300 s; at 10–20 s it was 249.3 ms. This is fixed misalignment, not growing drift, but large enough to reject media-element playback for harmony practice.
- **(b) our engine plays, wavesurfer renders** (same three files, five minutes): the rendered playhead's sampled error versus the AudioContext timeline was **-11.7 to 0.0 ms**, with no growth. AudioContext clock versus wall clock was **-0.6 to +6.4 ms** over the samples. Browser-reported output latency was 37.8 ms (headless fake sink). These measurements establish display sync, not audible output sync.
- **Peaks-only rendering works**: `WaveSurfer.create({ peaks: [Float32Array], duration })` renders without fetching or decoding audio. Positioning by start offset works (we move the lane by `trackLeftPx`). `ws.zoom()` throws "No audio loaded" in this mode; use `ws.setOptions({ minPxPerSec })` instead.
- **Measurement limit:** five-minute probes ran in headless Chromium with a fake audio sink; no real Safari, iPhone or audible output was measured. They were run concurrently, so browser load may influence frame timing. `probe/run-drift.sh` runs them sequentially for a repeat check.

## Memory (M0-08)

Synthetic 10 x 4 min tracks (1 stereo + 9 mono) at 44.1 kHz, "Memory" section of the spike page:

| Where | Result |
|---|---|
| Chromium 145 headless | Loaded and playing. **~466 MB decoded PCM**, JS heap ~468 MB. Formula: duration x rate x channels x 4 bytes (`engine/memory.ts`). At 48 kHz expect ~507 MB |
| Mac desktop Chrome 153 (48 kHz) | 10 synthetic four-minute tracks loaded and played. Page log: **~507 MB decoded PCM**, **522 MB JS heap** after track 10. User confirmed the mix passed without audible glitches; DevTools peak was not reported. |
| Safari desktop / iPhone | _manual_: note the highest track count that survives, and any reload/crash |

If the iPhone can't hold 10 tracks, record the working count here and update the PRD risk table (it already flags iOS memory as a risk and now quotes the desktop figure).

## Go / no-go

**Conditional GO for further prototyping** of the approach in `PRD.md`. The M0 exit criteria are not met yet:
- Proven by tests/probes: sync playback engine math, FLAC 16-bit mono encode and WAV fallback (decodes in 3 desktop engines), IndexedDB chunk persistence logic, peaks-only waveform rendering, 466 MB for the 10-track worst case on desktop.
- **Still needed before M0 can close:** mic capture and the 60 s sample count on real browsers, iPhone (mic prompt, encode time, memory, latency), audible sync/no-flam, crash recovery and playback in a real tab, and wired/Bluetooth offsets. M1 exists, but its implementation does not supply this missing M0 evidence. If mic capture fails on iPhone Safari, the recording approach is a no-go and needs rethinking.

Manual checklist: run `pnpm dev` in `spike/` and open `https://<lan-ip>:5173/` on each device, accepting the local certificate. After each device's checks, use **Copy report** or **Download report** and send its text. Select **Wired headphones** or **Bluetooth headphones** before each clap test; the output choice and committed latency slider value are logged. Add listening observations and any crash/reload to the report. Record the browser/device version and results in the tables above.

1. Click **Enable mic**, note whether a prompt appears, and copy the reported settings. Load three files. Play for five minutes, then pause/resume, seek, and change each volume while listening for flams, drift, and clicks. Try mp3, m4a, wav, and flac on each target browser.
2. Record for 60 seconds at a known nonzero playhead. Copy the `Take:` sample count and start offset; compare duration with 60 seconds (±50 ms). Play the FLAC and WAV downloads and listen to the take.
3. Make a clap-along take with wired headphones and another with Bluetooth on each device. Move the latency slider in 1 ms steps, replay or seek after each change, and record the aligned offset and the logged base/output latency.
4. Start another recording, reload or kill the tab after 30 seconds, then use **Recover**. Confirm at least 28 seconds survived and the take plays. Listen for glitches during a separate recording. Copy the reported storage quota.
5. On iPhone, click **Encode synthetic 4-min take** and record FLAC time and size. Also open `/compare.html` and run the two-candidate comparison. Click **Load N synthetic 4-min tracks** with N=10; note the highest playable count, any reload, and the memory figure from Safari Web Inspector if available. If fewer than 10 work, update the PRD risk table.
6. For M0-07, with Vite still running and three files of at least five minutes, run `sh probe/run-drift.sh <outdir> <file1> <file2> <file3>` from `spike/`. Save the two output files and report five-minute inter-track/playhead measurements here. This browser probe does not replace listening on the target devices.

## Code to port to M1/M2

- `src/engine/timing.ts`, `engine.ts` (placement, solo/mute gain, playhead anchor math, latency clamp) -> M1 playback engine, with its tests.
- `src/capture/recorder.worklet.ts`, `recorder.ts`, `take.ts` (worklet batching, first-frame timeline mapping, trim before zero) -> M2.
- `src/capture/store.ts` (`TakeStore`, `ChunkWriter`) -> M2 drafts.
- `src/encode/` (`pcm.ts`, `flac.ts`, worker + client) -> M2 encode step.
- `src/waveform/peaks.ts` -> M1 peaks (V2).
- `src/engine/memory.ts` -> optional client-side track-count warning.
- Findings to carry over: use `setOptions({minPxPerSec})` not `zoom()` with peaks; input must reach the destination through a silent gain for the worklet to run; pin wavesurfer.js to ^7.
