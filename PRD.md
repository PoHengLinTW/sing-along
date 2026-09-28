# PRD: Sing-Along — Multitrack Harmony Practice PWA

| | |
|---|---|
| **Status** | Draft v1 |
| **Date** | 2026-09-28 |
| **Owner** | hlin356 |
| **Type** | Personal side project, self-hosted on a homelab |

Decision log and rationale: [`CONCLUDE.md`](./CONCLUDE.md). Open items: [`FOLLOW_UP.md`](./FOLLOW_UP.md). Task list: [`TODO.md`](./TODO.md).
Milestone tasks with acceptance criteria: [`tasks/`](./tasks/README.md).

---

## 1. Problem

When a small group practices harmony singing, each person records their part separately. Practicing with those recordings is awkward: you need a backing track without vocals, the other singers' parts, your own new take, control over each track's volume, and a way to jump around in the song. General-purpose DAWs are too heavy, and voice-memo apps can't play several tracks in sync.

## 2. Goal

A public, installable web app (PWA) where a group can:
- keep one **project** per song,
- play **several audio tracks in sync** with an independent volume for each,
- **record** their own part in lossless quality while listening to the others,
- line that take up with the others, and
- upload it so everyone can practice with it, including **offline**.

### Non-goals (v1)
- User accounts, permissions, ownership, multi-tenancy
- Audio processing on the server (transcoding, stem separation)
- Mixing, effects, exporting a final mixdown
- Live monitoring (hearing your own voice through the app)
- Creating or editing projects offline, sync or conflict resolution
- Backups, rate limiting, audit logs

## 3. Users

A small, trusted singing group. Anyone who has the URL can use the app. There is no sign-in. A free-text **performer** name (remembered per browser) records who sang a take.

## 4. Success criteria

1. The group can practice a real song with at least 1 backing track and 3 harmony takes.
2. After a one-time manual offset adjustment, recorded takes stay in sync by ear across repeated playback.
3. It works as an installed PWA on at least one iPhone and one desktop.

---

## 5. Functional requirements

### 5.1 Projects
- **P1:** The home page publicly lists all projects (title, artist, number of tracks, last updated), shows a **storage indicator** (e.g. "5.2 / 8 GB") and has a "Create project" button.
- **P2:** A project has a title (required), artist and notes. Stretch: bpm, key.
- **P3:** Projects are addressed by incremental ID: `/project/:id`.
- **P4:** Edit inline with autosave (text saves on blur or Enter).
- **P5:** Delete asks for confirmation in a modal that lists what will be lost and requires **typing the project title**. Deleting cascades to the tracks and their R2 objects.

### 5.2 Tracks
- **T1:** Add a track by **uploading a file** (mp3, m4a/aac, wav, ogg, webm/opus, flac) or by **recording** one.
- **T2:** Track fields:
  - name, performer, labels
  - `start_offset_ms`, `latency_offset_ms`, `duration_ms`
  - `mime_type`, `size_bytes`, `storage_key`, `peaks`
  - `source` (`upload` | `recording`), `sort_order`, `created_at`
- **T3:** A track's **audio can't be changed** after upload. Name, performer, labels, offsets and order can be edited.
- **T4:** Drag tracks to change their order.
- **T5:** Deleting a track needs a confirmation modal.
- **T6:** Originals are stored unchanged (no transcoding).

### 5.3 Labels
- **L1:** A track can have **several labels**.
- **L2:** Presets: Instrumental/Backing, Vocal, Lead, Harmony, Soprano, Alto, Tenor, Bass, Guitar, Piano, Drums, Other. Users can create custom labels, which are then suggested to everyone.
- **L3:** Labels show as colored chips. A track's waveform color comes from its first label.
- **L4:** Filter tracks by label, and mute or unmute every track with a given label at once.

### 5.4 Playback and mixer
- **M1:** All unmuted tracks play in sync (Web Audio), each placed at its `start_offset_ms + latency_offset_ms`.
- **M2:** Per-track **volume** (adjustable while playing or stopped), **mute** and **solo**.
- **M3:** **A–B loop** region on the timeline.
- **M4:** Mixer state is saved **per browser** (localStorage, keyed by project), not on the server.
- **M5:** A shared playhead: click or drag on the timeline or overview to seek.

### 5.5 Transport and quick actions

| Action | Button | Shortcut |
|---|---|---|
| Play / Pause / Resume | ✓ | Space |
| Restart from start | ✓ | Home |
| Back 10 s | ✓ | ← |
| Forward 10 s | ✓ | → |
| Record / Stop | ✓ | R |
| Mute mic (silences input mid-take; the take keeps running) | ✓ | M |

### 5.6 Recording
- **R1:** Recording starts at the **current playhead**. The take's `start_offset_ms` is set to that position, and the other tracks keep playing.
- **R2:** Mic capture with `echoCancellation`, `noiseSuppression` and `autoGainControl` all **off**, mono.
- **R3:** A "use headphones" hint appears the first time someone records.
- **R4:** Audio is captured through an **AudioWorklet** at the native sample rate. Raw chunks are written to **IndexedDB during recording**, so a crash doesn't lose the take.
- **R5:** On Stop, the take is encoded to **FLAC 16-bit mono** in the browser (WASM encoder, e.g. libflac.js). If the encoder can't load, it's saved as **WAV 16-bit mono** instead.
- **R6:** The take becomes a **local draft**. It can be played back with the mix, re-recorded, discarded (confirmation modal) or **uploaded**. Several drafts can exist at once.
- **R7:** A **live waveform** of the mic input is drawn while recording.
- **R8:** A `beforeunload` warning appears if the user leaves the page mid-recording.
- **R9:** No punch-in and no live monitoring.

### 5.7 Latency alignment
- **A1:** Each track has a **latency offset slider** (±ms). It's available on drafts and uploaded tracks, and the user adjusts it by ear against the mix.
- **A2 (stretch):** Automatic latency estimation (browser-reported latency and/or loopback click calibration).

### 5.8 Visualization
- **V1:** A multitrack **waveform** view (wavesurfer.js v7 + multitrack plugin) with a zoomable, scrollable shared timeline.
- **V2:** **Peaks** are computed in the browser when a file is uploaded or a take is created, then stored with the track. Waveforms draw before the audio finishes loading.

### 5.9 Storage caps

| Limit | Value |
|---|---|
| Max file size | 60 MB |
| Max track duration | 10 min |
| Max tracks per project | 10 |
| Max projects | 100 |
| Global storage budget | 8 GB |

- **C1:** Caps are checked **before** a presigned upload URL is issued. The URL is signed with the exact `Content-Length`.
- **C2:** After upload, the browser calls **confirm**. The server checks the object's real size and deletes it on mismatch.
- **C3:** A nightly job deletes unconfirmed or orphaned R2 objects.
- **C4:** When a cap is reached, the upload is refused with a clear message. Nothing is ever removed automatically.

### 5.10 PWA and offline
- **O1:** Installable: manifest, icons, full-screen, service worker caching the app shell.
- **O2:** Audio is cached **by track ID** (tracks never change), so re-opening a project doesn't download the files again.
- **O3:** Opt-in **"Make available offline"** per project caches its metadata and audio. The project can then be opened, played, mixed and recorded into with no connection.
- **O4:** Drafts survive going offline. A "N drafts not uploaded" badge appears, and the user uploads them once back online.
- **O5:** Mutating actions are disabled while offline, with a clear message.

### 5.11 Layout
- **Desktop / tablet:**
  - Top transport bar.
  - Track rows: a control panel (name, label chips, volume, mute/solo, offset) plus the waveform, on a shared timeline with the A–B loop region.
  - Lyrics panel on the right (stretch).
- **Phone:**
  - Compact overview waveform.
  - Track list with volume and mute/solo per row.
  - Large bottom transport bar.
  - Tapping a track opens a detail sheet with its waveform and offset.
- **Browsers:** Chrome and Safari first (desktop, iOS, Android), then Firefox. On iOS, installing to the home screen is recommended.

---

## 6. Technical design

```
Browser (PWA: React + Vite, Zustand, TanStack Query, wavesurfer.js,
         Web Audio, AudioWorklet, WASM FLAC, IndexedDB, Cache API)
   │  REST (metadata, presign)          │  PUT/GET audio (presigned)
   ▼                                     ▼
Cloudflare Tunnel ──► Fastify API ──► PostgreSQL        Cloudflare R2 (bucket)
                     (Drizzle, zod)                     (CORS: app origin PUT/GET)
            └────────── Docker Compose on the homelab ──────────┘
```

- **Repo:** pnpm monorepo with `apps/web`, `apps/api`, `packages/shared` (types + zod schemas).
- **Data model:** `projects`, `tracks`, `labels`, `track_labels` (many-to-many). Peaks stored as JSON(B) on `tracks`.
- **Key API endpoints (sketch):**
  - `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`
  - `POST /projects/:id/tracks/upload-url` → checks caps and returns a presigned PUT + pending track ID
  - `POST /tracks/:id/confirm` → verifies the object and activates the track
  - `PATCH/DELETE /tracks/:id`, `PATCH /projects/:id/track-order`
  - `GET /tracks/:id/audio-url` → presigned GET
  - `GET/POST /labels`, `GET /storage` (usage)
- **HTTPS** through Cloudflare Tunnel is required for the mic (`getUserMedia`) and the service worker.
- **R2:** Needs a payment method on file. Stay under the free tier (10 GB storage, 1M writes and 10M reads per month, free egress). Check the current pricing before setup.

## 7. Known limitations and risks

| Risk | Impact | Mitigation |
|---|---|---|
| Anyone with the URL can delete anything | Data loss | Accepted. Typed-title confirmation. Soft delete is a stretch goal. |
| Decoded audio held in RAM (~11.5 MB/min mono, 23 MB/min stereo) | ~500 MB for a typical project; may be tight on older phones or iOS | 10-track cap. Documented. |
| Round-trip latency differs by device, and Bluetooth is much worse | Takes land off-beat | Manual offset slider (v1), headphone hint, automatic calibration (stretch) |
| iOS Safari quirks (AudioContext unlock, storage eviction, background suspension) | Playback, recording or offline cache problems | Test on iPhone from M0. Recommend installing the PWA. |
| R2 free tier exceeded | Small bill | 8 GB global cap. Optional Cloudflare billing alert. |

## 8. Milestones

| # | Scope |
|---|---|
| **M0 – Spike** | Plain page: 3 local files in sync, a FLAC take recorded at the playhead, offset slider. Tested on desktop and iPhone. |
| **M1 – Core player** | Scaffold, Postgres/Drizzle, R2 presign, project/track CRUD, multitrack waveform, volume/mute/solo, transport + shortcuts, A–B loop, labels |
| **M2 – Recording** | AudioWorklet → IndexedDB drafts → FLAC upload, live waveform, headphone hint, mic mute, offset slider |
| **M3 – Hardening and deploy** | Caps + enforcement, storage indicator, orphan cleanup, confirmation modals, Docker Compose + Tunnel + R2 CORS |
| **M4 – PWA and mobile** | Manifest/service worker, phone layout, audio cache, per-project offline, drafts badge |

## 9. Stretch goals (in priority order)

1. **Lyrics (LRC):** One file per project, stored in Postgres. Highlighted, auto-scrolling panel. Clicking a line seeks to its timestamp − 3 s. (Tap-to-sync and word-level timing are out of scope.)
2. **Automatic latency detection** and correction.
3. **Soft delete** / trash.
4. **Vocal/stem separation** with free tools (Demucs/Spleeter).
5. **Pitch-preserving playback speed** (0.5×–1×).
6. **Per-track pan.**
7. **Pitch display** (live and/or per-track pitch curve).

## 10. Open questions
- Lyrics extras: adjustable pre-roll, "loop these lines," a global lyrics offset, in-app LRC editing. Should they be in the stretch goal?
- Pitch display: confirm it stays a stretch idea.
