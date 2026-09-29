# Sing-Along PWA — Decisions

Decisions reached during the PRD grilling session, with rationale.

## Initial idea (from user)

A fullstack Progressive Web App for practicing group harmony singing:

1. Multiple audio tracks played in sync, with a seek/timeline panel
2. Per-track volume, adjustable during playback
3. Record locally, then confirm before uploading to the server
4. Songs are projects; CRUD on projects and tracks, destructive actions require confirmation
5. Waveform/frequency visualization per track
6. Quick actions: restart, -10s, +10s, pause, resume, record, mute mic
7. Track labels (music, singer, instrument, guitar, piano, …)
8. Stretch: lyrics with timestamps, jump to a line (with ~3s pre-roll)

## Q1: Users and collaboration model

**Decision:** Multi-user, fully public, **no accounts, no permissions, no ownership, no tenancy** in v1. Anyone with a project's link can open it and use it directly.

**Rationale:** This is a personal side project hosted on a homelab. Auth and permission systems are more work than they're worth at this stage.

**Consequences:**
- Storage has to be **capped** (max number of projects and tracks) because anyone can upload.
- Audio files may live in a **free third-party object store** (S3-compatible) instead of on the homelab disk.
- The project link itself is the only access control.

## Q2: Project discovery and IDs

**Decision:**
- **2a:** There is a **public home page that lists all projects**. Anyone who finds the homelab URL can see, edit and delete every project. This is accepted.
- **2b:** Projects use **incremental IDs** (e.g. `/project/42`). Enumerable URLs are accepted.
- Metadata (projects, tracks, labels, and so on) is stored in a **local PostgreSQL** database on the homelab.

**Rationale:** Keep it simple. It's a hobby project for a small trusted group, so the open-access risk is accepted.

## Soft delete (follow-up to Q2)

**Decision:** Soft delete / trash is a **stretch goal**. v1 uses confirmation dialogs only.

## Q3: Recording alignment, latency, bleed, takes

**Decision:**
1. **Timeline position:** Recording starts at the current playhead (e.g. pressing Record at 1:23 means the take starts at 1:23). Each track stores a `start_offset` in ms. Uploaded files default to 0.
2. **Latency:**
   - **v1:** A manual latency-adjustment tool. After recording, the user drags a slider to shift the take (±ms) until it lines up with the other tracks.
   - **Stretch:** Automatic latency detection and correction, following existing approaches (browser-reported latency and/or a loopback click calibration).
3. **Bleed:**
   - Show a "use headphones" hint the first time a user records.
   - Capture the mic with `echoCancellation`, `noiseSuppression` and `autoGainControl` turned **off**.
4. **Takes:**
   - Stopping a recording creates a **local draft take**, stored in IndexedDB so it survives a reload.
   - A draft can be played back with the mix, re-recorded or discarded.
   - "Upload" turns a draft into a server track.
   - Several drafts can exist at once.
5. **Punch-in** (re-recording only part of a take) is **out of scope for v1**. Users record a whole new take instead.

**Rationale:** The manual slider is simple and reliable. Automatic latency detection is known to be error-prone across devices, so it's worth doing only after the core works.

## Q4: Instrumental source, formats, transcoding

**Decision:**
- **v1:** Users upload their own instrumental or karaoke files as ordinary tracks. The app does **no audio processing**.
- **Stretch:** Server-side vocal/stem separation using free, open-source tools (e.g. Demucs, Spleeter), so users don't have to prepare instrumentals themselves.
- **Accepted upload formats:** mp3, m4a/aac, wav, ogg, webm/opus, flac.
- **In-browser recordings:** webm/opus (Chrome/Firefox) or mp4/aac (Safari), whichever the browser's MediaRecorder supports.
- **Storage:** Originals are stored **as-is. No server-side transcoding** in v1. Storage use is controlled by the file-size cap.

**Rationale:** Stem separation needs a lot of compute plus a job queue, progress reporting and a Python ML dependency, which is a subsystem of its own. Skipping transcoding keeps the upload path simple.

## Q5: Visualization

**Decision (all v1):**
- A **waveform** (not a spectrogram) for every track, in a stacked multitrack view with a shared playhead. Clicking or dragging the playhead seeks, which also covers the "jump to timestamp" panel.
- A **live waveform of the mic input while recording**, drawn in real time as the user sings.
- **Peaks:** Computed in the browser when a file is uploaded or a take is created, then uploaded as small JSON alongside the audio. The server stores the peaks with the track so waveforms draw before the audio finishes loading.
- **Library:** wavesurfer.js v7 plus its multitrack plugin (per-track offset, volume, precomputed peaks). A record-plugin–style live waveform is used while recording.
- A pitch-curve display is **not** part of v1. It stays a stretch idea.

**Rationale:** A waveform is what the user meant. It shows where phrases start, which is what the latency slider needs. Using the library avoids building a multitrack renderer from scratch.

## Q6: Mixer and transport controls

**Decision:**
- **v1:**
  - Per-track volume (adjustable while playing or stopped), mute and solo
  - A–B loop
  - Quick actions: restart from head, −10s, +10s, pause, resume, record, mute mic
  - Keyboard shortcuts (Space = play/pause, R = record, ←/→ = ∓10s, Home = restart, M = mute mic)
  - Mixer state (volume/mute/solo) saved **per browser in localStorage**, keyed by project, so users don't overwrite each other's mix on the shared server
- **Mic mute:** Silences the captured input *during* a recording. The take keeps running and the muted section is silent.
- **No live monitoring** (hearing your own voice through the app) in v1, because browser latency makes it feel delayed and disorienting.
- **Stretch:** Pitch-preserving playback speed (0.5×–1×), per-track pan.

**Rationale:** Mute, solo and loop are the core harmony-practice tools and cheap to build. Time-stretching synced tracks is complex.

## Q7: Data model and labels

**Decision:**
- **Project:** `id`, `title` (required), `artist`, `notes`, `created_at`, `updated_at`. Stretch: `bpm`, `key`.
- **Track:**
  - Identity: `id`, `project_id`, `name`, `performer` (free text; the last value typed is remembered in localStorage and pre-filled), `labels`
  - Timing: `start_offset_ms`, `latency_offset_ms`, `duration_ms`
  - Storage: `mime_type`, `size_bytes`, `storage_key`, `peaks` (JSON)
  - Other: `source` (`upload` | `recording`), `sort_order` (tracks can be dragged into a new order), `created_at`
- **Labels (option B):**
  - A track can have several labels, taken from a preset list plus free-form custom labels. Custom labels are suggested to everyone afterwards.
  - Presets: Instrumental/Backing, Vocal, Lead, Harmony, Soprano, Alto, Tenor, Bass, Guitar, Piano, Drums, Other.
  - Labels show as colored chips. A track's waveform color comes from its first label.
  - Tracks can be filtered by label, and every track with a label can be muted at once (e.g. all Harmony tracks).

**Rationale:** Several labels allow combinations like "Vocal + Harmony + Alto". `performer` stands in for user accounts.

## Q8: Tech stack

**Decision:**
- **Language:** TypeScript end to end. pnpm-workspaces monorepo: `apps/web`, `apps/api`, `packages/shared` (shared types plus zod schemas).
- **Frontend:**
  - React + Vite
  - vite-plugin-pwa (Workbox)
  - Zustand for transport/mixer state
  - TanStack Query for server data
  - wavesurfer.js v7
- **Backend:** Node + Fastify (or Hono) REST API, Drizzle ORM with migrations, PostgreSQL.
- **Audio storage:** The browser uploads to and downloads from the S3-compatible bucket directly, using **presigned URLs**. The API only issues the URLs and stores metadata.
- **Deploy:** Docker Compose (api + web + postgres) on the homelab.

**Rationale:** Almost the whole app is client-side audio, so an SPA plus a small API is simpler than an SSR framework. Presigned URLs keep large files off the homelab's bandwidth. The user already knows most of this stack.

## Q9: Hosting, HTTPS, storage provider

**Decision:**
- **Exposure:** The homelab is exposed through **Cloudflare Tunnel** on the user's domain (already set up). This gives HTTPS, which the mic (`getUserMedia`) and the service worker require, with no open router ports.
- **Storage:** **Cloudflare R2**, free tier: 10 GB storage, 1M writes and 10M reads per month, free egress. No paid Cloudflare plan is needed, but R2 needs a payment method on file and charges usage above the free tier. **Check the current R2 pricing page before setup.**
- The R2 bucket needs a **CORS policy** allowing PUT/GET from the app's origin, for presigned direct uploads and downloads.

**Rationale:** Free egress matters for an app that streams audio over and over. Tunnel and R2 are in the same ecosystem the user already has.

## Q10: Recording quality and storage caps

**Decision:**
- **Default recording format: lossless FLAC, mono, 16-bit, at the device's native sample rate (44.1 or 48 kHz).**
  - Captured through an **AudioWorklet** and encoded in the browser with a WASM FLAC encoder (e.g. libflac.js).
  - **Fallback:** 16-bit mono **WAV** if the WASM encoder can't load.
  - Raw audio chunks are written to IndexedDB *during* recording, so a crash doesn't lose the take. Encoding happens on Stop.
  - `MediaRecorder` is **not** used for recording. The live waveform is drawn from our own audio node (AnalyserNode/worklet), not wavesurfer's record plugin.
  - *This replaces the Q4 note about webm/opus or mp4/aac recordings, and moves lossless recording from a stretch goal into v1.*
- **Caps:**

  | Limit | Value |
  |---|---|
  | Max file size | 60 MB |
  | Max track duration | 10 min |
  | Max tracks per project | **10** |
  | Max projects | 100 |
  | Global storage budget | 8 GB (buffer under R2's free 10 GB) |

- **Enforcement:**
  - The API checks the caps before issuing a presigned URL, which is signed with the exact `Content-Length`.
  - After upload, a confirm step checks the object's real size and deletes it on mismatch.
  - A nightly job deletes unconfirmed or orphaned objects.
  - When a cap is reached, the upload is refused with a clear error. Nothing is ever removed automatically.
  - The home page shows storage used (e.g. "5.2 / 8 GB").
- **Capacity estimate:** A typical project (1 mp3 backing + 9 four-minute FLAC takes) is about 135 MB, so about 60 projects fit. The worst case is about 13 projects.
- **Known limitation (accepted):** Web Audio decodes all tracks into RAM (about 11.5 MB/min mono, 23 MB/min stereo), so a typical 4-minute project needs about 500 MB of browser memory. This may be tight on older phones or iOS Safari.

**Rationale:** The user wants the best recording quality by default. Recording mono halves the lossless size, and 16-bit is audibly transparent for browser-reachable mics. The 10-track cap limits both storage and browser memory.

## Q11: PWA and offline scope

**Decision:**
- **Installable app shell:** Manifest, icons, full-screen, and a service worker that caches the app's code so it opens instantly.
- **Drafts survive going offline:** Unsent takes stay in IndexedDB. A "N drafts not uploaded" badge appears, and the user uploads them once back online.
- **Opt-in "Make available offline" per project:** Caches the project's metadata and audio files (Cache API), so the user can open it, play it, mix and record takes with no connection. Opt-in because of device storage limits (especially iOS).
- **Audio caching when online:** Tracks never change after upload, so audio is cached **keyed by track ID** (not by presigned URL, which expires). Re-opening a project doesn't download the files again.
- **Not supported offline:** Creating, editing or deleting projects, tracks or metadata. These need a connection, so no sync or conflict handling is required.

**Rationale:** The user wants people to be able to practice with no internet connection. This delivers that without the complexity of offline-first sync.

## Q12: Lyrics (stretch goal)

**Decision:** Option A, **LRC files only**.
- One lyrics file per project, uploaded as `.lrc` or pasted. Stored as text in Postgres, so it doesn't count against the R2 budget.
- Lyrics panel: the current line is highlighted and auto-scrolls, and the next line is previewed.
- Clicking a line seeks to its timestamp **minus a pre-roll (default 3 s)**.
- **Out of scope:** tap-to-sync for plain-text lyrics, and word-level (enhanced LRC) karaoke highlighting.
- *Assumed, to confirm:* the smaller extras from the proposal — adjustable pre-roll (0–10 s), "loop these lines" as an A–B loop, a global lyrics offset slider, and basic text editing of the LRC.

**Rationale:** LRC files are easy to find and to parse. Tap-to-sync and word-level timing add complexity to what is already a stretch goal.

## Q13: Backups, abuse protection, activity log

**Decision:** **None in v1.** No scheduled backups, no rclone mirror of R2, no rate limiting, no activity log. The global caps from Q10 are the only abuse protection.

**Rationale:** It's a fun side project, and the risk of data loss or abuse is accepted. (Soft delete is still a stretch goal from Q2.)

## Q14: Target devices and layout

**Decision:** Option C, **responsive with two layouts**.
- **Desktop / tablet (landscape):**
  - Top transport bar (quick actions + time display).
  - Stacked track rows: a left control panel (name, label chips, volume, mute/solo, offset slider) plus the waveform, all on one shared scrollable, zoomable timeline with the playhead and A–B loop region.
  - Lyrics panel on the right (stretch).
- **Phone (portrait):**
  - Compact overview waveform for seeking.
  - Track list with volume and mute/solo per row.
  - Large bottom transport bar (restart, −10, play/pause, +10, record, mic mute).
  - Tapping a track opens a detail sheet with its waveform and offset slider.
- **Browser priority:** Current Chrome and Safari (desktop, iOS, Android), then Firefox. On iOS, installing to the home screen is the recommended way to use the app.

**Rationale:** It's a PWA used on phones as well as for detailed alignment work on bigger screens.

## Q15: Editing and destructive-action confirmations

**Decision:**
- **Editable:**
  - Project: title, artist, notes (and lyrics, stretch).
  - Track: name, performer, labels, start/latency offsets, order.
- **A track's audio can't be changed.** A new take means a new track. Track ID → audio never changes, which keeps caching correct.
- **Autosave:** Sliders and reordering save after ~500 ms of no changes. Text fields save on blur or Enter. No global Save button.
- **Confirmations:**
  - Delete project: modal listing what will be lost, plus **typing the project title**.
  - Delete track: modal.
  - Discard a local draft take: modal.
  - Replace existing lyrics (stretch): modal.
  - Leave the page mid-recording: browser `beforeunload` warning.
  - Remove a project's offline copy: no confirmation (it can be downloaded again).
- **Deleting a project** cascades to its tracks in Postgres and deletes their R2 objects, freeing the storage budget straight away.

**Rationale:** Meets the "confirm destructive actions" requirement. The typed-title check is extra protection for the most destructive action, given there's no soft delete in v1.

## Q16: Milestones and success criteria

**Decision:**
- **M0 – Spike:** Plain page. 3 local files in sync, a FLAC take recorded at the playhead, offset slider. Tested on desktop and iPhone.
- **M1 – Core player:**
  - Monorepo, Postgres/Drizzle, R2 presigned upload
  - Project/track CRUD, multitrack waveform
  - Volume/mute/solo, transport + shortcuts, A–B loop, labels
- **M2 – Recording:** AudioWorklet → IndexedDB drafts → FLAC upload, live waveform, headphone hint, mic mute, offset slider.
- **M3 – Hardening and deploy:**
  - Caps and enforcement, storage indicator, orphan cleanup, confirmation modals
  - Docker Compose + Cloudflare Tunnel + R2 CORS
- **M4 – PWA and mobile:** Manifest/service worker, phone layout, audio cache, per-project offline mode, drafts badge.
- **Stretch** (in order): lyrics (LRC) → automatic latency detection → soft delete → stem separation → playback speed → pan → pitch display.

**Success criteria:**
1. The group can practice a real song with at least 1 backing track and 3 harmony takes.
2. After a one-time manual offset adjustment, recorded takes stay in sync by ear across repeated playback.
3. It works as an installed PWA on at least one iPhone and one desktop.

**Rationale:** Building the risky audio core first surfaces deal-breakers before time goes into CRUD and UI.

---

## Summary

| Area | Decision |
|---|---|
| Users / access | Multi-user, fully public, no accounts or permissions. A public home page lists all projects, and anyone can edit or delete them. Incremental IDs. |
| Metadata | PostgreSQL on the homelab (Drizzle ORM) |
| Audio storage | Cloudflare R2 free tier. The browser uploads and downloads directly with presigned URLs. Originals stored as-is (no transcoding). |
| Hosting | Docker Compose on the homelab, exposed through Cloudflare Tunnel (HTTPS, required for mic and PWA) |
| Stack | TypeScript monorepo: React + Vite + vite-plugin-pwa, Zustand, TanStack Query, wavesurfer.js v7 multitrack; Fastify API; zod shared schemas |
| Tracks | Several play in sync. Each has a `start_offset_ms` and a `latency_offset_ms`. Several labels per track (presets + custom), colored chips, filter/bulk-mute by label. A free-text performer name stands in for accounts. The audio can't be changed. |
| Instrumentals | v1: users upload their own. Stretch: stem separation (Demucs/Spleeter). |
| Upload formats | mp3, m4a/aac, wav, ogg, webm/opus, flac |
| Recording | Starts at the playhead. **Lossless FLAC 16-bit mono** through AudioWorklet + WASM encoder (WAV fallback). Crash-safe chunks in IndexedDB. Local draft takes: preview, re-record, discard, upload. Browser DSP (echo cancellation, noise suppression, auto-gain) off, plus a headphone hint. No live monitoring. No punch-in. |
| Latency | v1: manual per-track offset slider. Stretch: automatic detection. |
| Visualization | Waveforms (peaks computed in the browser and stored with each track), live mic waveform while recording. Pitch display is a stretch idea. |
| Mixer / transport | Volume, mute, solo per track. A–B loop. Restart, ±10 s, play/pause, record, mic mute (silences input mid-take). Keyboard shortcuts. Mixer state saved per browser. Stretch: speed, pan. |
| Caps | 60 MB per file, 10 min per track, **10 tracks per project**, 100 projects, 8 GB total. Enforced before issuing upload URLs and verified after upload. Nightly cleanup of orphaned objects. Storage indicator on the home page. |
| PWA / offline | Installable app shell. Drafts survive going offline. Opt-in per-project offline cache. Audio cached by track ID. No offline editing. |
| Layout | Responsive: full multitrack timeline on desktop/tablet; compact practice mode with a big bottom transport bar on phones. Chrome and Safari first. |
| Editing / safety | Inline autosave. Confirmation modals for deleting projects (type the title) and tracks, discarding drafts, and replacing lyrics. `beforeunload` warning while recording. No backups, rate limiting or activity log (not needed). Soft delete is a stretch goal. |
| Lyrics (stretch) | LRC only. Highlighted, auto-scrolling panel. Clicking a line seeks with a 3 s pre-roll. No tap-to-sync or word-level timing. |
| Known limitations | Decoded audio uses about 500 MB of RAM for a typical project, which may be tight on older phones. Anyone with the URL can delete anything. |
| Milestones | M0 spike → M1 core player → M2 recording → M3 hardening/deploy → M4 PWA/mobile → stretch goals |

---

## Q17: Task breakdown format (post-PRD)

**Decision:**
- One task file per milestone in `tasks/` (`M0.md` … `M4.md`, plus `STRETCH.md`), with conventions and Definition of Done in `tasks/README.md`.
- **Acceptance criteria:** checklist style.
- **Task size:** about 0.5–1 day each (roughly one PR per task).
- **Stretch goals:** only Lyrics is broken down. The others are one-line placeholders.
- **Definition of Done (pragmatic):**
  - Vitest unit tests for logic (API, caps, parsers, timing math).
  - Playwright e2e only for a few critical flows.
  - Manual device checks for audio.
  - Lint + typecheck + tests in GitHub Actions CI.
- **M0 spike is throwaway:** plain Vite + vanilla TS in `spike/`. Findings go into `SPIKE_NOTES.md`, and the audio engine code is ported to M1 deliberately.

---

## Q18: M0 spike findings

**Decision:**
- **Playback:** own Web Audio engine; wavesurfer.js v7 only renders precomputed peaks. The multitrack plugin is a separate stale package (`wavesurfer-multitrack` 0.4.12) that plays through media elements. A five-minute headless Chromium probe found a fixed 168.3 ms inter-track spread at 300 s; the rendered playhead in our approach stayed within 11.7 ms of its AudioContext timeline.
- **FLAC encoder:** libflacjs (asm.js build) in a Web Worker, WAV as the fallback. A same-input comparison with Mediabunny WASM in headless Chromium, Firefox and WebKit kept libflacjs as the provisional choice based on smaller integration and faster results in two engines. Both made valid 16-bit mono FLAC; iPhone timing still needs measurement.
- **Still manual:** mic capture on real devices, iPhone memory and latency, Bluetooth offsets, and audible sync. A fake-mic Chromium probe at a nonzero playhead captured 60.018 s of audio in a nominal 60 s run; the earlier apparent shortfall came from intentional trimming before timeline zero.

Details and numbers: `spike/SPIKE_NOTES.md`.

---

## Q19: Local S3 stand-in is RustFS, not MinIO; lint/format is Biome

**Decision:**
- **RustFS** (`rustfs/rustfs`) replaces MinIO in `docker-compose.dev.yml`. MinIO's official images (`minio/minio`, `minio/mc`, quay.io) can no longer be pulled. Verified against RustFS before adopting: a presigned PUT signed with `Content-Length` and `Content-Type` returns 403 on a different size or type, HEAD returns size and type, and CORS works with `RUSTFS_CORS_ALLOWED_ORIGINS`. The bucket is created by a one-shot `amazon/aws-cli` container. Host ports: Postgres 5433 (5432 is often taken), S3 9000, API 3100 (3000 is often taken).
- **Biome** replaces ESLint + typescript-eslint + Prettier. typescript-eslint did not support TypeScript 7, which had forced us onto TypeScript 5. Biome parses TypeScript itself, so the repo runs on TypeScript 7. `biome migrate` rewrote `recommended: true` to `preset: none`, which silently disables every rule; it is set to `recommended` and checked with a deliberately bad file.

---

## Q20: M1 implementation decisions

**Decision (details are in each task's commit message):**
- **Loops** are scheduled ahead on the AudioContext clock as back-to-back segments (`start(when, offset, duration)`), so the A→B wrap has no gap (limit: 50 ms). Editing the loop while playing hands over at `now + 100 ms`, without a jump.
- **Label filter** shows a track when it has at least one of the chosen labels; it only hides rows (hidden tracks keep playing and keep their mute state). Reordering is disabled while a filter is active. "Mute all <label>" reaches hidden tracks too.
- **Mix persistence** (`sing-along:mix:<projectId>` in localStorage) covers volume, mute, solo and zoom; deleted tracks are pruned; "Reset mix" resets the mix but not the zoom. It is never sent to the server.
- **Track order / labels** are saved through explicit endpoints; the order request needs the full id list, saved optimistically with rollback and a toast.
- **Bad uploads:** confirm deletes both the object and the pending row when the object is missing or its size differs.
- **Verified in a real browser** (throwaway Playwright probes in `spike/probe/`, headless Chromium against the dev stack): create project, upload three labelled tracks, play in sync, mix, seek, loop wrap, reload restores the mix, deletes ask for confirmation, no console errors. Audible checks and Safari/iPhone are still manual.

---

## Q21: M2 implementation decisions

**Decision (details are in each task's commit message):**
- **Recording pipeline:** mic (raw constraints, chosen device) → AudioWorklet on the *playback* AudioContext → ~1 s chunks written to IndexedDB while recording → on Stop a worker encodes FLAC 16-bit mono (WAV fallback) → the draft holds the encoded blob, peaks and duration, and the raw chunks are deleted only after that is saved. A crash at any point leaves a recoverable draft; reload finishes interrupted takes.
- **Placement:** the mic opens first, then playback starts; a take's position is the timeline time of its *first captured frame* (pure function over the engine's scheduled passes, unclamped), so the mic-open delay never shifts it. Frames that fall before timeline 0 are trimmed when encoding.
- **Drafts in the engine** use a stable negative id derived from the draft UUID, so the engine, mixer and mix persistence treat them like tracks and a draft keeps its mix across reloads. Uploading moves that mix to the new track id.
- **Latency offset** is edited live through a pending-offsets store (so the waveform and engine move at once) and saved after 500 ms of quiet: PATCH for tracks, IndexedDB for drafts. A failed save reverts.
- **API change:** `POST /projects/:id/tracks/upload-url` accepts an optional `latencyOffsetMs` (default 0, ±600000 like PATCH), so a recorded take arrives already aligned. Rejected: a follow-up PATCH, which leaves a window where the take is misaligned for other listeners.
- **Upload of a draft** reuses the normal `upload-url → PUT → confirm` pipeline with `source = recording`; the local draft is deleted only after the server confirmed, so a failure or a reload mid-upload can simply be retried (a lost *response* after a successful confirm could create a duplicate track: accepted, the user can delete it).
- **Labels for a draft** are sent if the draft has them, but there is no label editor on drafts yet: assign labels on the uploaded track. Follow-up if wanted.
- **Not verifiable without hardware** (left open in `tasks/M2.md`): real microphone capture on iPhone and desktop Safari, CPU headroom while recording on iPhone, iPhone encode time, audible alignment. The built encoder worker was verified in Playwright's Chromium, Firefox and WebKit.

---

## Q22: M3 implementation decisions

**Decision (details are in each task's commit message):**
- **Caps (M3-01):** defaults live in `packages/shared/src/caps.ts` (`DEFAULT_CAPS`), overridable through env (`MAX_FILE_MB`, `MAX_TRACK_MINUTES`, `MAX_TRACKS_PER_PROJECT`, `MAX_PROJECTS`, `MAX_STORAGE_GB`). 1 MB = 2^20 bytes, 1 GB = 2^30. Every cap rejection carries `code` (`FILE_TOO_LARGE` 413, `TRACK_TOO_LONG` 422, `TRACK_LIMIT` 409, `STORAGE_FULL` 507, `PROJECT_LIMIT` 409). Size and duration are checked before any DB write; track, project and storage checks run inside a transaction that first takes one global Postgres advisory lock (`pg_advisory_xact_lock`), so concurrent requests can't both pass. Rejected: `SELECT ... FOR UPDATE` on the project row (does not cover the global budget or the project count), and a DB constraint (cannot express a sum).
- **Storage usage (M3-02):** `GET /api/storage` returns the four AC fields plus the live per-file, per-track-length and tracks-per-project caps, so the client never hard-codes limits that an env var may have changed. `usedBytes` counts active tracks only; enforcement (M3-01) counts pending too. The client keys the query `['projects','storage']`, so every existing `invalidateQueries(['projects'])` (create/delete project, upload/delete track) refreshes the meter without new wiring. The meter is silent if the request fails.
- **Cap-aware UX (M3-03):** the client checks file size (before decoding) and decoded duration (before asking for a URL) against the *live* caps from `/api/storage` (PRD defaults until it loads). At the track cap the file chooser is disabled with the tooltip and a visible line; recording stays allowed and a draft upload shows the server's `TRACK_LIMIT` message. Server messages are written as the final user-facing text, so the client shows them as-is; `ApiRequestError.code` is kept for later use. The client counts only active tracks, so another person's pending upload can still cause a server-side rejection: accepted. Informational queries opt out of the global error toast with `meta: { silent: true }`.
- **Cleanup (M3-04):** `runCleanup` lists `projects/` in the bucket once, then reads the DB. It removes stale `pending` tracks (>24 h, object first, row second, so a storage failure leaves rows for the next run) and objects with no row that are older than 24 h. The 24 h margin is the longest allowed presigned URL (`PRESIGN_TTL_SECONDS` max 86400). Active tracks are never touched. Scheduled in the API process with croner (`CLEANUP_CRON`, default `30 3 * * *`, `off` disables; `protect` prevents overlapping runs); `pnpm cleanup [--dry-run]` runs it once. `S3Storage.deleteObjects` now throws on per-key errors (Quiet mode hides them otherwise).
