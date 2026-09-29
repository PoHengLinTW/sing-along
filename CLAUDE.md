# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**M0** (audio spike, `spike/`) has 11 of 32 acceptance criteria checked. Device and listening checks remain open (see `tasks/M0.md` and `spike/SPIKE_NOTES.md`). **M1** (core player) is implemented: project/track/label API, direct-to-storage upload, waveform view, mixer, transport, A–B loop, labels UI, per-browser mix. **M2** (recording) is implemented (branch `m2-recording`, PR #3) and its desktop device pass is confirmed; the iPhone criteria are deferred by the user, and Bluetooth numbers plus desktop Safari / Android Chrome are still open (see `tasks/M2.md`). Caps/deploy (M3) and PWA (M4) are not built yet. Update this file as real code and commands land.

### Where things are (M1)

- `apps/api/src`: `app.ts` (Fastify built from injected `{db, storage}`), `routes/` (projects, tracks, labels), `db/` (Drizzle schema, seed, repo queries), `storage/` (`Storage` interface + S3 impl), `config.ts` (zod-validated env), `errors.ts` (`{message, fields?}` error shape).
- `apps/web/src`: `audio/` (engine, pure scheduling and loop math, controller, zustand transport and mixer stores, sync, shortcuts, mix persistence), `timeline/` (waveform view, ruler, zoom, follow), `pages/` (Home, ProjectPage, panels, upload, labels), `ui/` (Modal, ConfirmDialog, EditableText, LabelPicker, toasts), `api/` (typed fetch, upload, XHR PUT), `lib/` (pure helpers).
- `packages/shared/src`: zod schemas and types shared by both apps (projects, tracks, labels, audio MIME map).
- Tests: Vitest everywhere. API tests use a throwaway Postgres database per file (`createTestDb`) and a fake storage, plus one integration test against the real S3 stand-in (skipped if it is not running); start both with `docker compose -f docker-compose.dev.yml up -d`. Web tests use a fake `AudioContext` (`audio/fake.ts`) and mock `wavesurfer.js`.
- Ports: web 5173, API 3100 (3000 and 5432 are often taken locally), Postgres 5433, S3 9000.
- The engine plays the timeline as scheduled "segments" on the AudioContext clock; loops are scheduled ahead so wraps have no gap. The position lives in a zustand store written per animation frame: read it with selectors or a store subscription, never from broad React state.
- Never run long waits without a timeout; and gate every commit on `pnpm lint && pnpm typecheck && pnpm test`.

### Where things are (M2, recording)

- `apps/web/src/audio/recorder/`: `mic.ts` (constraints, device, errors), `MicSetup`/`LevelMeter`/`RecordControls`/`EncodeStatus` (UI), `recorder.ts` + `recorder.worklet.ts` + `chunker.ts` (worklet capture, ~1 s chunks, mute = zeros), `level.ts` + `liveWave.ts` (meter and live-lane maths), `draftStore.ts` (IndexedDB drafts + `ChunkWriter`), `session.ts` (`RecordingSession`: mic → playback → chunks → draft), `encode/` (pure `encodeTake`, FLAC via libflacjs, WAV fallback, worker + client, `finalizeDraft`), `encoder.ts` (`DraftEncoder`), `useDrafts.ts` (list + crash recovery), `uploadDraft.ts`, `timing.ts` (take placement), `draftView.ts` (engine id of a draft).
- A draft's engine/mixer id is a stable **negative** number derived from its UUID (`draftEngineId`), so drafts flow through the same engine, mixer and mix persistence as tracks. Only `ready` (encoded) drafts get lanes and panels.
- The playback controller has a recording lock (`beginRecording`/`endRecording`): seek, loop and pause are no-ops while a take runs, and the playhead may pass the last track (`engine.setOpenEnded`).
- Latency offsets are edited through `audio/latency.ts` (pending values applied to tracks and drafts at once, saved after 500 ms: PATCH for tracks, IndexedDB for drafts).
- `POST /api/projects/:id/tracks/upload-url` takes an optional `latencyOffsetMs`; a draft uploads with `source = 'recording'` through `uploadPrepared` (`api/upload.ts`).
- Real-browser probes for M2 live in `spike/probe/` (`m2-record-smoke.mjs` drives the whole flow with Chromium's fake microphone against the dev stack; it needs `pnpm dev`, and Vite may pick a port other than 5173: pass `BASE`). Vitest's fake-indexeddb drops jsdom's `Blob`: seed test drafts with `node:buffer`'s `Blob` if a test reads them back.

## Handover (read this first in a new session)

`HANDOVER.md` is a note from the previous session to the next one: current state of each milestone, what to build on, open audit findings, what only the user can verify on real devices, environment gotchas, and suggested first steps. **At the start of every new session, read `HANDOVER.md` after this file** and run `git status` (another session may have uncommitted work in the tree). If you finish a stretch of work and another session will pick it up, update `HANDOVER.md` (keep it short and current: replace stale facts, don't append a diary). If it disagrees with the code, the code wins; fix the note.

## Planning documents

| File | Role |
|---|---|
| `PRD.md` | The source of truth for requirements. Requirement IDs (e.g. `R4`, `C1`, `O3`) are referenced by the tasks. |
| `tasks/M0.md` … `tasks/M4.md`, `tasks/STRETCH.md` | Tasks for each milestone (`M1-07` style IDs), each with dependencies and a checklist of acceptance criteria. |
| `tasks/README.md` | The **Definition of Done** that every task inherits, plus planning decisions still waiting for confirmation. |
| `CONCLUDE.md` | Log of decisions and their rationale (Q1–Q17). Check here before questioning a design choice. |
| `FOLLOW_UP.md` | Open questions and parked stretch goals. |
| `TODO.md` | Flat checklist from the planning session (the task files replace it for tracking). |

When a decision changes: update `PRD.md`, add the decision and rationale to `CONCLUDE.md`, and adjust the affected task's acceptance criteria. Don't let these documents drift apart.

## Architecture (PRD §6)

- **What it is:** A public multitrack harmony-practice PWA. **No accounts, no permissions, by design.** Anyone with the URL can edit or delete anything. Don't add auth, backups or rate limiting unless asked; they were explicitly declined.
- **Monorepo (pnpm workspaces):**
  - `apps/web`: React + Vite + vite-plugin-pwa, Zustand, TanStack Query, wavesurfer.js v7
  - `apps/api`: Fastify + Drizzle + PostgreSQL
  - `packages/shared`: types, zod schemas, pure logic such as the LRC parser
- **Audio never passes through the API.** The browser uploads to and downloads from Cloudflare R2 directly with **presigned URLs**. The flow is `upload-url` (cap checks, creates a `pending` track, returns a PUT URL signed with the exact Content-Length) → PUT → `confirm` (HEAD check, marks the track `active`). RustFS (an S3-compatible store; MinIO images are no longer published) stands in for R2 in dev and CI.
- **Playback:** Uses our own Web Audio engine (`AudioBufferSourceNode` + a GainNode per track). wavesurfer.js only *renders* waveforms from precomputed peaks (decided in M0-07; pinned to v7). A track plays at `start_offset_ms + latency_offset_ms`. The scheduling, solo and loop math are pure functions with unit tests.
- **Recording (M2, built; see "Where things are (M2)"):**
  - AudioWorklet mono capture with echoCancellation, noiseSuppression and autoGainControl **off**.
  - PCM chunks are written to IndexedDB *during* recording, so a crash doesn't lose the take.
  - On Stop, a Web Worker encodes FLAC 16-bit mono (libflacjs asm.js build; WAV as the fallback).
  - The take becomes a local draft, and is uploaded only when the user confirms. `MediaRecorder` is not used.
- **Tracks can't be changed after upload.** A new take means a new track. The audio cache (Cache API) is keyed by **track ID**, not by presigned URL, and depends on this.
- **Mixer state** (volume, mute, solo, zoom) lives only in each browser's localStorage and is never sent to the server.
- **Caps** (enforced on the server, set by env vars): 60 MB per file, 10 min per track, 10 tracks per project, 100 projects, an 8 GB global total (active + pending sizes). Nothing is ever removed automatically to make room.
- **Production:** One Docker image (Fastify serves `/api` plus the built SPA) + postgres + cloudflared (Cloudflare Tunnel supplies the HTTPS that the mic and service worker need).

## Commands (`pnpm cleanup` is still planned, M3)

```bash
pnpm dev                                        # web + api; web proxies /api
pnpm lint && pnpm typecheck && pnpm test        # CI runs these (lint = Biome; TypeScript 7)
pnpm --filter <web|api|shared> exec vitest run <file>   # single test file (Vitest)
docker compose -f docker-compose.dev.yml up     # local Postgres + RustFS (S3)
pnpm db:generate && pnpm db:migrate             # Drizzle migrations
pnpm cleanup --dry-run                          # orphan/pending storage cleanup preview
```

The M0 spike lives in `spike/` (Vite + vanilla TS, served over HTTPS on the LAN for iPhone mic testing). It's **throwaway**, and its findings go in `spike/SPIKE_NOTES.md`.

## Development mode

- **TDD, always.** For every task, write the failing tests first (from the task's acceptance criteria), confirm they fail for the right reason, then implement until they pass, then refactor. Don't write implementation code before its tests exist. For work that can't be unit-tested (e.g. M0 spike, hardware audio behavior), say so in the commit and record the manual check instead.
- **One commit per finished task.** Commit when a task's acceptance criteria are all met and lint, typecheck and tests pass. Don't batch several tasks into one commit, and don't commit half-done work to `main`.
  - Subject line: the task ID and a short summary, e.g. `M1-07: add upload-url cap checks`.
  - Body: the **design decisions** made in the task. Say what was chosen, why, and which alternatives were rejected. If there were none, say "No design decisions."
  - Any decision that changes the plan also goes in `PRD.md` / `CONCLUDE.md` in the same commit (see the drift rule above).
  - Follow the attribution lines the harness specifies for commits.
- **Branch and PR.** `main` is protected on GitHub: nothing is pushed to it directly, not even by admins. Work on a branch (e.g. `m2-recording`, one per milestone or chore), keep one commit per task, push, and open a PR. The `check` job (lint, typecheck, test) must be green and the branch up to date with `main` before it can merge. Pull the merged `main` before starting the next branch.
- **E2E from M3 on.** Before M3 and M4 are closed, add Playwright E2E tests covering **every user flow** the milestone delivers (not just smoke flows), and run them green. The final task of the milestone is "E2E for M<n> user flows". List the flows in that task, then map each flow to a test. A milestone with a user flow that has no E2E test is not done.
  - M0, M1 and M2 have **no E2E requirement**. They rely on unit/integration tests (TDD) and manual checks. M3's E2E suite must still cover the user flows delivered in M1 and M2, since M3 is where the suite is first built.
  - M0 is a throwaway spike. Record its findings in `spike/SPIKE_NOTES.md`.
  - E2E runs against the Compose stack (Postgres + RustFS). Use Chromium's fake media device flags for mic flows. Real-device audio checks stay manual.

## Testing expectations (Definition of Done)

- Vitest for logic: API handlers, cap checks, parsers, timing and offset math, stores. Written before the code (TDD, see above).
- Playwright E2E covering all user flows, built in M3 and extended in M4 (none required for M0–M2; see "Development mode"). M3-10 becomes the CI wiring plus the full-flow suite, not just a few smoke flows.
- Audio behavior is checked by hand in desktop Chrome and Safari. Tasks marked 📱 also need an iPhone check.
- Keyboard shortcuts must be ignored while focus is in text inputs.
