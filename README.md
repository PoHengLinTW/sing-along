# Sing-along

A public multitrack harmony-practice web app. A group keeps one **project** per song, uploads
each singer's part as a track, and practices with all of them at once: play them in sync, set a
volume per track, mute or solo, loop a tricky bar, and seek by clicking the waveform.

There are **no accounts and no permissions, by design**: anyone with the URL can edit or delete
anything. Don't put it anywhere you wouldn't want that.

## Status

| Milestone | State |
|---|---|
| M0 Audio spike | Done, apart from manual device checks (`spike/SPIKE_NOTES.md`) |
| M1 Core player | **Implemented** (this is what runs today) |
| M2 Recording | **Implemented**; desktop pass done, iPhone and Safari checks still open (`tasks/M2.md`) |
| M3 Hardening and deploy | **Built** (caps, cleanup, error states, Docker image, compose stack); the first real deploy and its smoke test are still to do (`tasks/M3.md`) |
| M4 PWA and mobile | Not started |

### What works today (M1)

- Create, rename, edit notes for, and delete projects (deleting asks you to type the title).
- Upload audio (mp3, m4a/aac, wav, ogg, webm/opus, flac) by picking or dropping files. Files go
  from the browser **straight to storage**; the API only hands out signed URLs.
- Waveforms are drawn immediately from stored peaks; audio downloads in the background.
- Synced playback with per-track volume (0-150%), mute and solo. Space, Home, Left and Right
  work as shortcuts (ignored while you type in a field).
- A-B loop with no gap at the wrap: click "Set A" / "Set B", or drag on the ruler.
- Zoom (buttons or Ctrl/Cmd + scroll), auto-follow of the playhead, click or drag to seek.
- Labels (Soprano, Alto, Bass, ... or your own) with colored chips, a filter, and "mute all Alto".
- Your mix and zoom are remembered **in this browser only** and never sent to the server.

### Recording (M2)

- **Record** (or press `R`) starts a take at the playhead while the other tracks play. Use
  headphones: the microphone is opened with echo cancellation, noise suppression and automatic
  gain **off**, so speaker sound would leak into the take. Pick the input and check its level with
  "Check input level" first; the meter warns when the signal clips. `M` mutes the microphone (the
  take keeps its length, the muted part is silent).
- The take is written to your browser's storage **while you record**, so a crash or a closed tab
  does not lose it: reload the project and the take comes back as a draft. Closing the tab
  mid-take asks for confirmation.
- On Stop the take is encoded to FLAC (WAV if the encoder can't load) and appears as a dashed
  **Draft** lane below the tracks. It exists only in this browser until you press **Upload**.
  Drafts play with the mix, can be renamed and discarded.
- Every track and draft has a **latency offset** (±1000 ms). Drag the slider, nudge with the arrow
  keys (Shift = 10 ms) or type a value; "↻ 4 s" loops the 4 seconds around the playhead so you can
  judge the alignment by ear. Align a take once and it stays aligned for everyone.
- Recording stops by itself at 10 minutes.

### Known issues

- **Bluetooth headphones add a delay** (often 100-300 ms and it can drift), so a take recorded
  while wearing them arrives late. Use the latency offset to line it up, or use wired headphones.
  Recording has not been checked on real Bluetooth hardware yet.
- The microphone only works on `https://` pages and on `localhost`. Opening the dev server from
  another device over plain `http://<lan-ip>` will not get microphone access.
- Recording has been exercised end to end in Chromium with a fake microphone; a real microphone on
  iPhone Safari and desktop Safari is still to be checked (see `tasks/M2.md`, M2-11).

## How it fits together

```
Browser (React + Vite)                 API (Fastify)              Storage
  Web Audio engine  <--- audio bytes ------------------------->  S3-compatible
  wavesurfer (draws peaks only)                                   (RustFS in dev, R2 in prod)
  zustand stores                       PostgreSQL (Drizzle)
        |  JSON (projects, tracks, labels, signed URLs)  |
        +------------------------------------------------+
```

- `apps/web`: React 19, Vite, TanStack Query, zustand, wavesurfer.js v7.
- `apps/api`: Fastify 5, Drizzle ORM, PostgreSQL, AWS SDK (S3).
- `packages/shared`: zod schemas and types used by both apps.
- `spike/`: the throwaway M0 audio experiment. It has its own lockfile and is not part of the
  workspace.

The upload flow: the browser asks `POST /api/projects/:id/tracks/upload-url` (creates a
`pending` track, returns a PUT URL signed for the exact size and type), PUTs the file to storage,
then calls `POST /api/tracks/:id/confirm` (the API checks the object and marks the track
`active`). Tracks can't be changed after upload; a new take is a new track.

## Requirements

- **Node 22** (see `.nvmrc`) and **pnpm 10** (`corepack enable` picks the version from
  `package.json`).
- **Docker**, for a local PostgreSQL and an S3-compatible store.
- A modern desktop browser (Chrome, Safari, Firefox). The microphone needs `localhost` or HTTPS.

## Run it locally

```bash
pnpm install
cp .env.example .env                              # defaults match docker-compose.dev.yml
docker compose -f docker-compose.dev.yml up -d    # Postgres on 5433, S3 on 9000, creates the bucket
pnpm db:migrate                                   # applies migrations and seeds the preset labels
pnpm dev                                          # API on :3100 and web on :5173 (proxies /api)
```

Open http://localhost:5173, create a project, and drop a few audio files onto it.

| Service | Port | Notes |
|---|---|---|
| Web (Vite) | 5173 | proxies `/api` to the API |
| API (Fastify) | 3100 | `GET /api/health` |
| PostgreSQL | 5433 | 5433 rather than 5432 so it doesn't clash with another local Postgres |
| S3 stand-in (RustFS) | 9000 | MinIO's images are no longer published, so we use RustFS |

Stop everything with `docker compose -f docker-compose.dev.yml down` (add `-v` to also delete the
data volumes).

### Configuration

Every variable is validated when the API starts; if one is missing or invalid it refuses to start
and names it. See `.env.example` for the full list:

| Variable | Meaning |
|---|---|
| `PORT` | API port (default 3100) |
| `DATABASE_URL` | PostgreSQL connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | Storage location |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Storage credentials |
| `S3_FORCE_PATH_STYLE` | `true` for the local stand-in, `false` for Cloudflare R2 |
| `PUBLIC_ORIGIN` | Origin the browser loads the app from |
| `PRESIGN_TTL_SECONDS` | Lifetime of signed URLs (default 900) |
| `MAX_FILE_MB`, `MAX_TRACK_MINUTES` | Per-file caps (defaults 60 MB, 10 min) |
| `MAX_TRACKS_PER_PROJECT`, `MAX_PROJECTS`, `MAX_STORAGE_GB` | Project caps (defaults 10, 100, 8 GB) |
| `CLEANUP_CRON` | When the nightly cleanup of abandoned uploads runs (default `30 3 * * *`; `off` disables) |
| `WEB_DIST_DIR`, `MIGRATIONS_DIR` | Set by the Docker image only: the built web app to serve and the migrations folder |

## Commands

```bash
pnpm dev                                 # web + api together
pnpm lint                                # Biome (lint + format check)
pnpm format                              # Biome, fix what it can
pnpm typecheck                           # TypeScript 7, all packages
pnpm test                                # Vitest, all packages
pnpm --filter @sing-along/web exec vitest run src/audio/engine.test.ts   # one test file
pnpm db:generate                         # new Drizzle migration after editing db/schema.ts
pnpm db:migrate                          # apply migrations + seed labels (safe to repeat)
pnpm cleanup --dry-run                   # show which abandoned uploads / orphaned files would be deleted
pnpm cleanup                             # ...and delete them (this also runs nightly inside the API)
pnpm build                               # production build of web and api (the Docker image does this)
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck and test on every push and pull request,
with PostgreSQL and the S3 stand-in as services.

`main` is protected: changes go in through a pull request, and the `check` job must pass
before it can merge.

### About the tests

- API tests create a **throwaway Postgres database per test file**, so they never touch your dev
  data. They need the compose stack running (`docker compose ... up -d`). One storage test talks
  to the real S3 stand-in and skips itself if it isn't running.
- Web tests use a fake `AudioContext` (`apps/web/src/audio/fake.ts`) and mock wavesurfer, so no
  audio device or canvas is needed.
- Audio you can *hear* (sync, latency, iPhone behaviour) is checked by hand.

## Deploy

The production stack is `docker-compose.yml`: the app (one image: the API plus the built web
app), PostgreSQL on a named volume, and `cloudflared`, which connects the app to Cloudflare. **No
port is published on the host**; the tunnel is the only way in, and it supplies the HTTPS that the
microphone and the service worker need. Audio is stored in Cloudflare R2 (see "R2 setup" below).

You need a machine with Docker and Compose v2, a domain on Cloudflare, and the R2 bucket.

### 1. Create the tunnel

In Cloudflare **Zero Trust > Networks > Tunnels > Create a tunnel**, choose *Cloudflared*, name it,
and copy the **tunnel token** (the long string after `--token` in the install command). Then add a
**public hostname**: your domain (for example `sing.example.com`), service type **HTTP**, URL
`app:3100`. `app` is the name of the app container on the compose network.

### 2. Configure

```bash
git clone <this repo> && cd sing-along
cp .env.production.example .env      # then edit .env
```

| Variable | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | Database password. Letters and digits only. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | The R2 bucket and its bucket-scoped token |
| `PUBLIC_ORIGIN` | `https://<your domain>`: the origin the R2 CORS policy must allow |
| `TUNNEL_TOKEN` | The tunnel token from step 1 |
| `MAX_*`, `CLEANUP_CRON` | Optional: caps and cleanup schedule (defaults in `.env.production.example`) |

Compose refuses to start and names any required variable that is missing.

### 3. First start

```bash
docker compose up -d --build
docker compose ps                    # postgres, app and cloudflared should be running / healthy
docker compose logs -f app           # "Cleanup scheduled ..." means it is up
curl https://<your domain>/api/health    # {"status":"ok"}
```

The app waits for PostgreSQL to be healthy, applies the migrations and seeds the preset labels
before it starts listening, and cloudflared waits for the app to be healthy.

### Updating

```bash
git pull
docker compose up -d --build         # rebuilds the image; new migrations run on start
```

The database volume is untouched. If you publish the image to a registry instead, set `APP_IMAGE`
in `.env` and use `docker compose pull && docker compose up -d`. Migrations only go forward, so a
rollback means restoring the database you backed up yourself (there are no automatic backups by
design).

### Day to day

- `docker compose down` stops everything and **keeps** the data; `docker compose down -v` deletes
  the database volume too.
- The API deletes abandoned uploads every night. To look first:
  `docker compose exec app node dist/cleanup-cli.js --dry-run`.
- For debugging, uncomment the `ports:` lines of the `app` service to reach it on
  `127.0.0.1:3100` from the server itself.

## Troubleshooting

- **`EADDRINUSE` on 3000 / 5432**: another program owns the port. This project deliberately uses
  3100 and 5433; if those are taken too, change `PORT`, the Vite proxy in
  `apps/web/vite.config.ts`, and the port mapping in `docker-compose.dev.yml`.
- **API exits with "Invalid environment configuration"**: copy `.env.example` to `.env`.
- **Uploads fail with a network or CORS error**: check the S3 container is up
  (`docker compose -f docker-compose.dev.yml ps`); the compose file allows the dev origin.
- **API tests can't connect**: start the compose stack, or set `TEST_DATABASE_URL`.
- **No sound**: browsers keep audio suspended until you click or press a key on the page.
- **Vite says "Port 5173 is in use, trying another one"**: it moved to the next free port (see the
  `pnpm dev` output). Nothing else needs changing: the API is reached through Vite's proxy and the
  dev storage accepts any origin.
- **Record says the microphone is blocked**: allow the microphone for the site in the browser's
  site settings (the lock icon by the address), then press Record again.

## Project documents

| File | What it is |
|---|---|
| `PRD.md` | Requirements (the source of truth) |
| `tasks/` | Milestone task lists with acceptance criteria |
| `CONCLUDE.md` | Decisions and why they were made |
| `FOLLOW_UP.md` | Open questions and parked ideas |
| `CLAUDE.md` | How AI coding agents work in this repo (TDD, one commit per task, ...) |
| `spike/SPIKE_NOTES.md` | Findings from the M0 audio spike |
