# Handover: M2 is built, waiting for the device pass

Written at the end of the M2 session (branch `m2-recording`, 2026-09-28) for the next Claude session.
Read this after `CLAUDE.md` and before touching code. If something here disagrees with the code,
the code wins: fix this file.

## 1. Where the project stands

| Milestone | State |
|---|---|
| M0 spike (`spike/`) | Code done and unit-tested. Most acceptance criteria in `tasks/M0.md` are real-device, listening or measurement items and are still open. Verdict in `spike/SPIKE_NOTES.md` is a *conditional* go. |
| M1 core player | Implemented. 78 of 87 criteria ticked in `tasks/M1.md`; each unticked one has an `_(open: ...)_` note. Merged to `main`. |
| M2 recording | **M2-01 to M2-10 implemented**, one commit each on branch `m2-recording` (not pushed, no PR yet). **M2-11 (manual device pass) is the user's job**: its checklist is in `tasks/M2.md`. Unticked M2 criteria all carry an `_(open: ...)_` note saying what only a device or an ear can settle. |
| M3, M4 | Not started. E2E (Playwright) is first required in M3 and must cover the M1 and M2 user flows. |

Gate on the branch at the end: `pnpm lint && pnpm typecheck && pnpm test` green (shared 31, api 66, web 543).

## 2. How we work (rules that were enforced, not just written)

- `CLAUDE.md` is the source of truth for the process: **TDD** (failing tests first), **one commit per task** (subject `M2-03: ...`, body = design decisions), `main` is protected (branch, push, PR, green `check` job), gate every commit with `pnpm lint && pnpm typecheck && pnpm test`.
- When a decision changes, update `PRD.md`, `CONCLUDE.md` (latest entry is **Q21**, M2 decisions) and the task's criteria together. Tick a `- [ ]` only when verified; use `_(open: ...)_` for what is missing.
- Commit messages: write the body to a file in the scratchpad and use `git commit -F <file>` (see gotchas).

## 3. What M2 delivered (short map; details in `CLAUDE.md` "Where things are (M2)")

Mic setup and permission errors, input picker, headphone hint → AudioWorklet capture on the playback clock → chunks to IndexedDB every ~1 s → live lane and level meter (also as an input check before recording) → FLAC/WAV encode in a worker → dashed Draft lanes with mix, rename, discard → live latency offset (±1000 ms) with a 4 s loop preview → upload as a `recording` track (with `latencyOffsetMs`) → `R`/`M` shortcuts, mic mute, "Leave site?" guard, crash recovery of cut-short takes. API change: `upload-url` accepts `latencyOffsetMs`.

Verified in a real browser (Chromium 145, fake microphone, dev stack; probes in `spike/probe/`): `m2-record-smoke.mjs` 24/24 (record over a track, live lane painted, mute, stop, real FLAC worker, draft, latency, upload, server row has FLAC + `latencyOffsetMs -50`, crash recovery), `m2-take-length.mjs` (60 s take = 59 996 ms), `m2-encode-worker.mjs` (built worker in Chromium/Firefox/WebKit, 4 min take encodes in 0.5-0.7 s, FLAC decodes).

## 4. What only the user can do (real devices), and honest limits

- Run the **M2-11 checklist** in `tasks/M2.md` on desktop Chrome, desktop Safari, iPhone Safari (and Android Chrome if available), with wired and Bluetooth headphones. Nothing audible has been judged: alignment by ear, glitches while recording, mute silence, Bluetooth delay numbers (README "Known issues" wants them).
- Never verified on real hardware: mic capture on iPhone/desktop Safari, iPhone CPU while recording with the live waveform, iPhone FLAC encode time (desktop is under a second), a screen lock or app switch mid-take, real Safari playback of the encoded FLAC.
- Known gaps, by choice: drafts have no label editor (labels are set on the uploaded track); a lost response after a successful confirm could create a duplicate track on retry; only ready drafts get lanes (recording/encoding show in the live lane and `EncodeStatus`).
- mp3/m4a decoding was never tested per browser even though uploads accept them.

## 5. Open items from the earlier audits (not touched in M2; fix or consciously defer)

1. **Loop leaks between projects**: `useProjectAudio` cleanup never calls `clearLoop()`; engine and transport store are singletons, so a loop set in one project stays live in the next. Add a regression test.
2. **Play at the very end** starts and stops immediately (`pausedPlayhead == duration`). Decide: rewind to 0 on Play (but not when recording starts: `play()` is called after `beginRecording`).
3. **Project load error**: a non-404 failure leaves `ProjectPage` on "Loading…" (only a toast). Add an error state with Retry.
4. **API logger is off** (`logger: false` in `app.ts`), so failed storage deletes are silent. Enable at least error logging before M3's cleanup relies on them.
5. **Loop scheduler timer** (`engine.ts`, 40 ms `setInterval`, 250 ms lookahead) may be throttled in hidden tabs. Related for M2: a take running in a hidden tab has not been tried.
6. Untested spots: `server.ts` bad-env exit, `installGestureUnlock`, track-order transaction atomicity, boundaries 600000 ms and 30-char label.
7. Doc drift: `.env.example` line 12 still says MinIO; `PUBLIC_ORIGIN` is validated but unused (dead until M3); a stale comment in `mixerStore.ts`; the README states "no gap at the wrap" as fact, but it was only shown on a fake clock and in one headless Chromium run.

## 6. Environment gotchas (each one cost time)

- **Ports**: web 5173 (something else on this machine often holds it, so Vite silently moves to 5174/5175: read the `pnpm dev` output and pass `BASE` to probes), API 3100, Postgres 5433, S3 9000. Ports 3000 and 5432 are used by the user's other containers: do not stop those, and do not kill whatever holds 5173.
- **Docker stack can be down** between sessions (`ECONNREFUSED ::1:5433` in API tests): `docker compose -f docker-compose.dev.yml up -d`, then `pnpm db:migrate` before `pnpm dev`. RustFS replaced MinIO.
- **Headless Chromium's fake microphone works now** (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, page on `http://localhost`): the M0 note that it never resolved no longer holds. Press keys only after the page has mounted (wait for the Record button), or the shortcut listener is not attached yet.
- **Shell tool**: the permission classifier intermittently returns "no verdict", mostly for big or multi-file commands and heredocs, sometimes for tiny ones. Write files with Write/Edit, keep Bash commands short, retry once, and continue with non-Bash work meanwhile. macOS has no `timeout` command: use the Bash tool's `timeout`. zsh: unmatched globs are errors (`--include=*.ts` fails: quote it), `sed -i ''` needs the empty string.
- **TypeScript 7 + Biome**: `biome check --write` must cover `apps packages` (it only fixed what it was given). `biome migrate` once rewrote `recommended: true` to `preset: none`; check with a deliberately bad file if you touch `biome.json`. Biome flags `role="meter"` on a div (use `<meter>`), assignments inside expressions, and forEach callbacks that return.
- **Tests**: jsdom has no `<dialog>` modal (emulated in `apps/web/src/test/setup.ts`, which now tolerates the node environment). `fake-indexeddb` drops jsdom's `Blob` on read-back (seed with `node:buffer`'s `Blob`) and its timers clash with fake timers (fake only `setInterval`). The FLAC test needs `// @vitest-environment node`. Entering a project restores its remembered mix, so set mix state in a test *after* the page has loaded. `getDraftStore()` is cached at module level: call `resetDraftStoreForTests()` per test.
- **CI**: `.github/workflows/ci.yml` runs lint, typecheck and test with Postgres and RustFS as services; ~1 minute.
- `spike/` is throwaway and outside the pnpm workspace (own lockfile). It still holds the M0 code that M2 ported; delete it only when the user says so.

## 7. Suggested first steps for the next session

1. `git status`, read `CLAUDE.md`, this file, `tasks/M2.md` (M2-11 section).
2. If the user has run the device pass: fix or ticket what they found (`tasks/M2.md` M2-11), tick the boxes they confirm, add Bluetooth numbers to the README.
3. Push `m2-recording` and open the PR (the user has not asked for that yet; ask), wait for the `check` job, merge, pull `main` before starting M3.
4. Consider the audit items in section 5, in order, as small commits before or at the start of M3. M3 needs the Playwright suite covering the M1 and M2 flows: `spike/probe/m2-record-smoke.mjs` is a good starting script for the recording flow.
