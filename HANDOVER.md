# Handover: starting M2 (recording)

Written at the end of the M0/M1 session (main at `8844ebb`, 2026-09-29) for the next Claude session.
Read this after `CLAUDE.md` and before touching code. If something here disagrees with the code,
the code wins: fix this file.

## 1. Where the project stands

| Milestone | State |
|---|---|
| M0 spike (`spike/`) | Work continues in the `m0-completion` worktree. **11 of 32 acceptance criteria ticked** in `tasks/M0.md`; real-device and listening checks remain. Verdict in `spike/SPIKE_NOTES.md` is a *conditional* go. |
| M1 core player | Implemented. **78 of 87 criteria ticked** in `tasks/M1.md`; each unticked one has an `_(open: ...)_` note. CI is green on `main`. |
| M2 recording | **Not started. This is your job.** Tasks are in `tasks/M2.md` (M2-01 .. M2-11). |

Two independent audits (one per milestone) were run; their conclusions are folded into sections 4 and 5.

## 2. How we work (rules that were enforced, not just written)

- `CLAUDE.md` is the source of truth for the process. The essentials:
  - **TDD**: write the failing tests first (they must fail for the right reason), then implement.
  - **One commit per task**, subject `M2-03: ...`, body = the **design decisions** (what, why, what was rejected).
  - **`main` is protected**: no direct pushes, not even for admins. Work on a branch (`m2-recording`), push, open a PR, merge when the `check` job is green and the branch is up to date. Squash or merge as you like; keep the per-task commits on the branch.
  - Gate every commit on `pnpm lint && pnpm typecheck && pnpm test` (chain them with `&&`; an earlier commit slipped through with lint errors).
  - E2E (Playwright) is only required from M3 on; M2 relies on unit/integration tests plus manual checks.
- When a decision changes, update `PRD.md`, `CONCLUDE.md` (latest entry is Q20) and the task's criteria together.
- Tick a task's `- [ ]` boxes only when verified; use `_(open: ...)_` notes for what is missing.

## 3. What M2 can build on (already in the repo)

- **Spike code to port** (list also in `spike/SPIKE_NOTES.md`): `spike/src/capture/` (`recorder.worklet.ts`, `recorder.ts`, `take.ts`, `store.ts` with `TakeStore` + `ChunkWriter`), `spike/src/encode/` (`pcm.ts`, `flac.ts`, `encode.worker.ts`, `client.ts`), `spike/src/mic.ts`. They have tests; port the tests with them. FLAC: `libflacjs` asm.js build (chosen provisionally after comparison with Mediabunny WASM in three headless desktop engines; iPhone timing remains open).
- **Timeline math you need already exists** in `apps/web/src/audio/`: `loop.ts` has `positionAt(segments, ctxTime)`; the engine plays "segments" scheduled on the AudioContext clock (`engine.ts`). To place a take, map the first captured frame's `currentTime` onto the timeline with that, as the spike did with `timelineAt`, and trim samples that fall before timeline 0.
- **Upload pipeline** is reusable: `apps/web/src/api/upload.ts` (`uploadTrack`, already supports `source: 'upload' | 'recording'` in the API; the client currently sends `'upload'`), `put.ts` (XHR with progress), `pages/UploadPanel.tsx`.
- **Latency offset**: `AudioEngine.setOffsets(id, {latencyOffsetMs})` reschedules only that track; the API already stores `latency_offset_ms` (PATCH `/api/tracks/:id`, +-600000 ms). The M2-08 slider only needs UI + PATCH.
- **Stores**: transport (`transportStore.ts`, written per frame: use selectors or a store subscription), mixer (`mixerStore.ts`, persisted per project by `useMixPersistence`), view (`timeline/viewStore.ts`).
- **Shortcuts**: `audio/shortcuts.ts` is a pure function; add `R` (record/stop) and `M` (mic mute) there, keeping the "ignored while typing" rule.
- **Test tools**: `audio/fake.ts` (fake AudioContext), `fake-indexeddb` is already used in the spike (add it to `apps/web` for the draft store).

## 4. Open items from the audits (fix or consciously defer)

Highest value first. None block starting M2, but the first two touch code M2 will use.

1. **Loop leaks between projects**: `useProjectAudio` cleanup never calls `clearLoop()`; engine and transport store are singletons, so a loop set in one project stays live in the next. Add a regression test.
2. **Play at the very end** starts and stops immediately (`pausedPlayhead == duration`). Decide: rewind to 0 on Play.
3. **Project load error**: a non-404 failure leaves `ProjectPage` on "Loading…" (only a toast). Add an error state with Retry.
4. **API logger is off** (`logger: false` in `app.ts`), so failed storage deletes are silent. Enable at least error logging before M3's cleanup relies on them.
5. **Loop scheduler timer** (`engine.ts`, 40 ms `setInterval`, 250 ms lookahead) may be throttled in hidden tabs.
6. Untested spots: `server.ts` bad-env exit, `installGestureUnlock`, track-order transaction atomicity, boundaries 600000 ms and 30-char label.
7. Doc drift: `.env.example` line 12 still says MinIO; `PUBLIC_ORIGIN` is validated but unused (dead until M3); a stale comment in `mixerStore.ts`; the README states "no gap at the wrap" as fact, but it was only shown on a fake clock and in one headless Chromium run.

## 5. What only the user can do (real devices), and honest limits

- **Never verified on real hardware:** mic capture on iPhone Safari (the make-or-break item for recording), desktop Safari, Bluetooth latency, anything audible (sync, flams, glitches), iPhone memory with 10 tracks, iPhone FLAC encode time. The M0 checklist is at the bottom of `spike/SPIKE_NOTES.md`.
- **mp3/m4a decoding was never tested per browser** even though uploads accept them.
- A headless Chromium fake-mic run now completed outside the sandbox: recording at a 5 s playhead produced a 60.018 s take (within the ±50 ms AC), and a tab killed after 30 s offered a recovered 30.0 s take whose transport advanced. The fake input reported two channels despite requesting one. Real hardware and listening checks remain necessary; see `spike/SPIKE_NOTES.md`.
- The user may have another session working on M0 follow-ups in the same working tree (uncommitted edits to `spike/SPIKE_NOTES.md`, `spike/probe/run-drift.sh`, `spike/src/wave.ts` and a line in `CLAUDE.md` existed when this was written). Run `git status` first and do not overwrite or revert changes you did not make.

## 6. Environment gotchas (each one cost time)

- **Ports**: web 5173, API 3100, Postgres 5433, S3 9000. Ports 3000 and 5432 are used by the user's other containers: do not stop those.
- **MinIO is gone** (images no longer pullable): the S3 stand-in is RustFS (`docker-compose.dev.yml`). Start the stack with `docker compose -f docker-compose.dev.yml up -d`, then `pnpm db:migrate`, then `pnpm dev`. API tests need Postgres and S3 running.
- **TypeScript 7 + Biome** (typescript-eslint doesn't support TS 7). `biome migrate` once rewrote `recommended: true` to `preset: none` (all rules off): check with a deliberately bad file if you touch `biome.json`.
- **zsh**: `"$i:latest"` lowercases (`:l`), and unquoted `pkg@workspace:*` globs. Quote and use `${i}`.
- **Shell tool**: large commands and heredocs were intermittently refused by the permission classifier ("no verdict"). Write big files with the Write/Edit tools and keep Bash commands short.
- **Never wait without a timeout.** A background wait once hung for an hour because it waited for a file that would never appear.
- **Playwright** (in `spike/`) is pinned to 1.58 to match the browsers cached on this machine. Throwaway probes live in `spike/probe/` (`m1-exit-smoke.mjs` drives the whole M1 flow against the dev stack); they need `pnpm dev` running and test tone files (generate with Python's `wave` module).
- **Tests**: jsdom has no `<dialog>` modal (emulated in `apps/web/src/test/setup.ts`), which also clears `localStorage` before every test (the mix is remembered per project and would leak).
- **CI**: `.github/workflows/ci.yml` runs lint, typecheck and test with Postgres and RustFS as services; ~1 minute.
- `spike/` is throwaway and outside the pnpm workspace (own lockfile). Delete it only after M2 has ported what it needs.

## 7. Suggested first steps for the M2 session

1. `git status`, `git pull`, read `CLAUDE.md`, this file, `tasks/M2.md`, PRD section 5.6 and `spike/SPIKE_NOTES.md`.
2. Branch `m2-recording`. Optionally do audit items 1-3 first as small commits (they touch `useProjectAudio` and `ProjectPage`, which recording will extend).
3. Start with M2-01 (mic setup, device picker, headphone hint). Ask the user for an iPhone/Safari mic check early: it decides whether the whole approach holds.
4. Keep every task's manual checks written down (what to press, what to expect) so the user can run them quickly.
