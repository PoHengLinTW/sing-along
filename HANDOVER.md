# Handover: M3 deploy and UI redesign review remain

Updated on branch `ui-studio-redesign`, 2026-09-29, for the next coding session
and for the user's QA. Read this after `CLAUDE.md` and before touching code. If something here
disagrees with the code, the code wins: fix this file.

**Planning update (2026-10-03):** The user reports the MVP finished and requested V2 feedback documentation. See PRD §9.1, CONCLUDE Q23 and `tasks/STRETCH.md` for the recording sheet, start-time controls, sectional re-recording and editing plan. This was documentation-only work; the older milestone/QA status below has not been re-audited or newly verified. Resolve the V2 design questions before implementing it.

**V2 update (2026-10-04):** the first V2 slice is built and covered by E2E (83 tests green): recording sheet with Pause/Resume/Mute/Finish, and Start time replacing the latency UI (CONCLUDE Q24). Also built: drag a lane's grip to set its start time, and editing of local drafts (split, trim, combine, undo/redo; CONCLUDE Q25; 92 E2E tests). Still open from `tasks/STRETCH.md`: sections inside one saved track, re-record a range, editing uploaded tracks (needs a migration the user declined for now). Not re-verified by ear or on devices.

## 1. Where the project stands

| Milestone | State |
|---|---|
| M0 spike (`spike/`) | 11 of 32 criteria ticked in `tasks/M0.md`; device and listening checks remain. Conditional go (`spike/SPIKE_NOTES.md`). |
| M1 core player | Implemented, merged. |
| M2 recording | Implemented, merged (PR #3). Desktop pass confirmed by the user; iPhone deferred by the user; Bluetooth numbers and desktop Safari / Android Chrome open (`tasks/M2.md`). |
| M3 hardening and deploy | **M3-01 to M3-07 and M3-10 built**, one commit each on `m3-hardening` (pushed, PR #5). **M3-08 and M3-09 need the user** (Cloudflare account and domain). |
| M4 PWA and mobile | Not started. Its E2E flows must be added to `e2e/` (CLAUDE.md rule). |
| UI redesign | Implemented on local branch `ui-studio-redesign` from the approved HTML mockup; not pushed or merged. The user is reviewing it in the live dev app. |

The redesign keeps the M1–M3 flows and uses a new `apps/web/src/theme.css` after the existing styles. The layout, library hero/cards, studio header, transport, microphone strip, panels, dialogs and waveform bars are updated. Timeline zoom lives beside the track heading on project pages so it remains visible on narrow screens. A follow fix keeps playback-driven scroll events from turning follow off; horizontal wheel input and scrollbar drags still turn it off. Local gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` (38 shared, 141 API, 596 web), and the 14 player Chromium tests pass. The redesign passed `pnpm e2e` (75 Chromium) before the follow fix. Desktop and 390 px screenshots were inspected. The branch still needs the user's review of the follow fix, then push and PR.

Gate at the end of the branch: `pnpm lint && pnpm typecheck && pnpm test` green (shared 38, api 141, web 591), and `pnpm e2e` green: 75 tests, three consecutive local runs. The `e2e` and `docker` CI jobs run on GitHub (PR #5): green three times in a row after one test fix. `main` requires only `check`; making `e2e` and `docker` required is the user's choice in branch protection.

## 2. How we work

Unchanged (see `CLAUDE.md`): TDD, one commit per task with the design decisions in the body, `main` is protected (branch, push, PR, green `check`). Decisions go to `CONCLUDE.md` (latest: **Q22**, all M3 decisions) and the task's criteria. Commit messages: write the body to a file in the scratchpad and `git commit -F`.

## 3. What only the user can do (the QA list)

1. **Review and merge PR #5** (`m3-hardening`); all three CI jobs are green.
2. **R2 (M3-08):** README "R2 setup": enable R2 (payment method needed), create the bucket, a bucket-scoped Object Read & Write token, paste `deploy/r2-cors.json` with the real origin, set a billing alert (dashboard label may differ from the README wording), then run `pnpm check:cors`. The tool was only run against the dev store.
3. **Tunnel and deploy (M3-07 routing, M3-09):** README "Deploy": add a public hostname to your *existing* tunnel pointing at `http://sing_along_app:3100` (the app joins the external `proxy` network; no tunnel token, no second tunnel), fill `.env`, `docker compose up -d --build`. Then the M3-09 smoke test in `tasks/M3.md` (create project, upload, record and upload a take, play in sync, delete track, delete project; the bucket must be empty afterwards; mic prompt on the production origin; storage figure; desktop and iPhone).
4. **Things no automated test covers:** how it sounds (sync, latency alignment, loop wrap), real microphones, iPhone and Safari, Bluetooth delay numbers, real-browser drag and drop feel, amber and red storage bar colors by eye, the crash page (`RouteError`).

## 4. What M3 delivered (map in `CLAUDE.md` "Where things are (M3)")

Server-side caps with codes and one advisory lock (413/422/409/507, project cap 409); `GET /api/storage` and the home meter; client checks against the live caps, disabled upload at 10 tracks and Create at 100 projects; nightly cleanup (croner, `pnpm cleanup [--dry-run]`); Retry states for every fetch, per-track audio Retry, one automatic refresh of an expired signed URL, empty-project actions, route error page, API error logging; a 258 MB non-root image with migrations at start and `/api/health` 200/503; compose stack (postgres + app, no host ports, joins the user's external `proxy` network); R2 docs, CORS policy and `check:cors`; the Playwright suite.

Verified for real: the Docker image and compose stack (start order, health, no published ports, data surviving `down && up`, migration of a fresh database, 503 with the database gone), the cleanup CLI and S3 listing against RustFS, and the whole UI through Playwright. Not verified: R2, the tunnel, GitHub CI.

## 5. Open audit items (from earlier sessions; not part of M3, fix or consciously defer)

Done in M3: project load error state (was item 3), API error logging (item 4).
Still open:
1. **Loop leaks between projects**: `useProjectAudio` cleanup never calls `clearLoop()`; engine and transport store are singletons, so a loop set in one project stays live in the next. Add a regression test.
2. **Play at the very end** starts and stops immediately (`pausedPlayhead == duration`). Decide: rewind to 0 on Play (but not when recording starts: `play()` runs after `beginRecording`).
3. **Loop scheduler timer** (`engine.ts`, 40 ms `setInterval`) may be throttled in hidden tabs; a take running in a hidden tab has not been tried.
4. Untested: `server.ts` bad-env exit, `installGestureUnlock`, track-order transaction atomicity, boundaries 600000 ms and 30-char label.
5. Doc drift: `PUBLIC_ORIGIN` is validated but unused by the server (only the CORS policy and docs use it); a stale comment in `mixerStore.ts`; the README states "no gap at the wrap" as fact, though it was only shown on a fake clock and in headless Chromium (the E2E wrap test checks the position, not the sound).
6. Known gaps by choice: drafts have no label editor; a lost response after a successful confirm could create a duplicate track on retry; a very short take (about 1 s or less) produces no draft; mp3/m4a decoding untested per browser; `POSTGRES_PASSWORD` must be letters and digits.

## 6. Environment gotchas

- **Ports**: web 5173 (Vite silently moves to 5174/5175 if taken), API 3100, Postgres 5433, S3 9000, E2E app 3300. Ports 3000 and 5432 belong to the user's other containers: do not stop them.
- **The dev compose stack goes down between sessions** (and sometimes mid-session): `docker compose -f docker-compose.dev.yml up -d`. API tests and `pnpm e2e` both need it (`ECONNREFUSED ::1:5433` means it is down). The dev database and the E2E database are different.
- **E2E**: `pnpm e2e` builds first (a stale `apps/*/dist` runs old code: rebuild after changing app code). Chromium is installed once with `pnpm --filter @sing-along/e2e exec playwright install chromium`. Selector traps: `.upload-items > li` (the label picker has nested `li`), `getByRole` names are substrings (`exact: true` for "Mute all X" vs "Unmute all X"), Playwright refuses in-memory files over 50 MB (write to disk), and the timeline viewport is ~830 px at 50 px/s (positions beyond ~16 s need scrolling).
- **Docker build** copies the whole workspace; `.dockerignore` excludes `spike`, `tasks`, `*.md`. The API runs from esbuild bundles, so a new native or non-bundlable dependency needs `build.mjs` attention.
- **Shell tool**: the permission classifier sometimes returns "no verdict" for big commands; keep Bash commands short and write files with Write/Edit. macOS has no `timeout`. zsh: unmatched globs are errors, `dc` is an alias (use a script file for compose wrappers), `sed -i ''` needs the empty string.
- **TypeScript 7 + Biome**: `biome check --write` must cover `apps packages e2e`. Biome flags `role="meter"` on a div (use `<meter>`), assignments inside expressions and forEach callbacks that return.
- **Tests (Vitest)**: jsdom has no `<dialog>` modal (emulated in `apps/web/src/test/setup.ts`); `fake-indexeddb` drops jsdom's `Blob` on read-back; the FLAC test needs `// @vitest-environment node`; failed queries toast globally unless `meta: { silent: true }`.
- `spike/` is throwaway and outside the workspace (own lockfile); delete it only when the user says so.

## 7. Suggested first steps

1. `git status`, read `CLAUDE.md` and this file. If the user has merged `m3-hardening`: `git checkout main && git pull`, then a new branch.
2. Bring the user's QA findings in: fix, or record them in the matching task (`tasks/M3.md` M3-08/M3-09, `tasks/M2.md` for device results), tick boxes only when verified, and update the README "Known issues".
3. Consider the audit items in section 5 (1 and 2 first) as small commits before M4, then M4 (PWA, offline; its E2E flows go in `e2e/`).
