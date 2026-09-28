# Stretch Goals

Only **S1 — Lyrics** is broken down in detail. The others are placeholders to break down once v1 has shipped. The order follows PRD §9.

---

## S1 — Lyrics (LRC)

**Goal:** Upload or paste an LRC file per project, see the current line highlighted as the song plays, and click a line to jump to it with a 3 s lead-in.

### S1-01 Lyrics storage and API
**Depends on:** M1-04
**Scope:** A `lyrics_lrc` text column on `projects`, and `PUT/DELETE /api/projects/:id/lyrics`.

**AC:**
- [ ] A migration adds a nullable `lyrics_lrc` text column.
- [ ] `PUT` accepts up to 64 KB of text. It rejects anything larger with 413, and rejects text with no valid timed lines with 422 `INVALID_LRC`, using the shared parser from S1-02.
- [ ] `DELETE` clears the lyrics. `GET /projects/:id` includes the lyrics.
- [ ] Lyrics don't count toward the R2 storage budget.
- [ ] Unit tests cover the above.

### S1-02 LRC parser (shared)
**Depends on:** M1-01
**Scope:** A pure parser in `packages/shared` that turns LRC text into a sorted list of `{timeMs, text}` plus metadata.

**AC:**
- [ ] Parses `[mm:ss.xx]`, `[mm:ss.xxx]` and `[mm:ss]` timestamps.
- [ ] A line with several timestamps (`[00:12.00][01:30.00]Chorus`) produces one entry per timestamp.
- [ ] Reads the `[ti:]`, `[ar:]` and `[offset:±ms]` metadata tags and applies `offset` to every time.
- [ ] Skips lines without timestamps and malformed lines without throwing, and returns a count of skipped lines.
- [ ] The output is sorted by time. Lines with empty text are kept (they're instrumental gaps).
- [ ] Unit tests cover all of the above and a real-world LRC file fixture.

### S1-03 Lyrics upload / paste UI
**Depends on:** S1-01, S1-02
**Scope:** Add lyrics to a project from a `.lrc` file or by pasting text, with a preview. Replacing existing lyrics asks for confirmation.

**AC:**
- [ ] "Add lyrics" accepts a `.lrc` or `.txt` file, or pasted text.
- [ ] A preview shows the parsed lines with their times and "N lines skipped" if any were. Saving is blocked if there are no valid lines.
- [ ] Replacing existing lyrics opens `ConfirmDialog` ("Replace current lyrics?"). Removing lyrics also asks for confirmation.
- [ ] Offline, adding or replacing lyrics is disabled. Lyrics already saved show offline if the project is available offline (M4-04 snapshot).

### S1-04 Lyrics panel with current-line highlight
**Depends on:** S1-03, M1-10
**Scope:** Show the lyrics panel (desktop: right side; phone: a "Lyrics" tab or sheet), highlighting the current line from the playhead and scrolling automatically.

**AC:**
- [ ] The current line is the last line with `timeMs ≤ playhead`, found by a unit-tested binary search.
- [ ] The current line is highlighted, and the next line is shown slightly faded as a preview.
- [ ] The panel scrolls smoothly to keep the current line centered. If the user scrolls by hand, auto-scroll pauses for 5 s, or until they tap "Follow."
- [ ] The highlight follows seeks, loops and restarts within 1 frame.
- [ ] Before the first timestamp, no line is highlighted.

### S1-05 Click a line to seek with a pre-roll
**Depends on:** S1-04
**Scope:** Clicking or tapping a lyric line seeks to its time minus a 3 s pre-roll.

**AC:**
- [ ] Clicking a line seeks to `max(0, timeMs − 3000)`.
- [ ] If playback is running, it continues from the new position. If it's paused, the playhead moves and stays paused.
- [ ] Seeking by clicking a line is disabled while recording (consistent with M2-04).
- [ ] Lines work with the keyboard (focusable, Enter seeks) and have an accessible label with the time.

> Open question (FOLLOW_UP.md): adjustable pre-roll, loop-from-lyrics, global lyrics offset, in-app LRC editing — add as S1-06+ if approved.

---

## Placeholders (to break down later)

| ID | Goal | Notes |
|---|---|---|
| S2 | Automatic latency detection and correction | Start from the M0-05 measurements. Loopback click calibration vs. browser-reported latency. |
| S3 | Soft delete / trash | A `deleted_at` column, a 7-day purge job, and a trash view with restore |
| S4 | Vocal / stem separation | Demucs in a separate worker container, a job queue, progress UI, stems saved as labeled tracks. Watch the storage caps. |
| S5 | Pitch-preserving playback speed (0.5×–1×) | Needs time-stretching (e.g. SoundTouch/Rubber Band WASM) across synced tracks |
| S6 | Per-track pan | A StereoPannerNode per track, saved in the local mixer state |
| S7 | Pitch display | Live pitch while recording and/or a pitch curve per track (YIN/pYIN in a worklet) |
