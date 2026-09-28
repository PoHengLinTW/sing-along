# Delivery Tasks

Tasks for each milestone in [`PRD.md`](../PRD.md). Each task is about 0.5–1 day of work, roughly one PR.

| File | Milestone | Tasks |
|---|---|---|
| [M0.md](./M0.md) | Spike: prove the audio core works (throwaway) | 8 |
| [M1.md](./M1.md) | Core player | 17 |
| [M2.md](./M2.md) | Recording | 11 |
| [M3.md](./M3.md) | Hardening and deploy | 10 |
| [M4.md](./M4.md) | PWA and mobile | 10 |
| [STRETCH.md](./STRETCH.md) | Lyrics (detailed) + other stretch goals (placeholders) | 5 + 6 |

## Conventions

- **Task ID:** `M<milestone>-<nn>`, e.g. `M1-07`. Stretch tasks use `S<goal>-<nn>`.
- **Depends on:** Tasks that must be merged first. Tasks without dependencies can run in parallel.
- **AC:** A checklist. A task is done when every box is ticked **and** the Definition of Done below is met.
- **PRD refs:** Requirement IDs from `PRD.md` §5 (e.g. `R4`, `C1`).

## Definition of Done (applies to every task unless stated otherwise)

- [ ] Lint, typecheck and unit tests pass locally and in CI (from M1-01 onward).
- [ ] New logic (API handlers, cap checks, parsers, timing/offset math, stores) has **Vitest** unit tests.
- [ ] Audio-facing behavior is **checked by hand** in desktop Chrome and desktop Safari. Tasks marked 📱 also need a check on an **iPhone** (Safari or installed PWA).
- [ ] No unhandled promise rejections or console errors in the flows the task touches.
- [ ] Shared request/response types and zod schemas live in `packages/shared`.
- [ ] Any new env var is documented in `.env.example`.

## Planning decisions to confirm

These were decided while writing the tasks and aren't in the PRD. Confirm or change them:

1. **Confirmation modals are built in M1** together with the delete actions (the PRD plan put them in M3). A delete button with no confirmation shouldn't exist even for a short time.
2. **RustFS (S3-compatible) in the local dev Compose file** stands in for R2, so development and CI need no Cloudflare credentials.
3. **Production runs as one app container:** Fastify serves the API *and* the built web assets (`@fastify/static`). The stack is then app + postgres + cloudflared, with no separate web server.
4. **Recording while stopped** starts playback from the playhead and recording at the same moment. **Stop** ends the take and pauses playback.
5. **Input device picker:** Users can choose their mic (e.g. a USB mic instead of the built-in one). Cheap to build and important for quality.
6. **wavesurfer.js renders waveforms only.** Playback uses our own Web Audio engine, pending the M0-07 finding. The multitrack plugin plays through separate media elements, which risks drift between tracks.
7. **Track duration is reported by the client** (the server doesn't decode audio). This is accepted for a hobby app.
