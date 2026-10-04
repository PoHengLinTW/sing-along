# Stretch / V2 Planning

This document collects post-MVP feedback and stretch goals. The V2 feedback below was captured on **2026-10-03**, after the user reported the MVP finished. It describes the requested direction and proposals to evaluate before implementation; it is not a completed task list.

The existing **S1–S7** stretch backlog remains below, with only **S1 — Lyrics** broken down into implementation tasks. Its order follows PRD §9. The relative priority of the V2 workflow and those goals is still to be decided.

## V2 — Recording and track editing feedback

> **Status (2026-10-04):** built: the recording sheet with pause (V2-REC), Start time with drag (V2-TIME), and editing of **local drafts** only: split, trim, combine, undo/redo (V2-EDIT). Decisions in CONCLUDE Q24 and Q25. Not built: sections inside one saved track, re-recording a range, retained alternative takes, editing uploaded tracks.

### V2-REC — Recording controls in a bottom modal

**Feedback:** Actions in the current UI are hard to control. When recording, a modal should grow upward from the bottom, with the live waveform above the basic controls.

**Requested outcome:** A focused recording sheet with the waveform on top and clearly accessible **Pause, Resume, and Mic mute / Unmute** controls.

**Proposed design:**

- Open the sheet when starting a recording, with large controls usable on a phone and desktop.
- Add **Stop / Finish**, a recording / paused / muted status, elapsed recording time, and an input-level / clipping indicator. After stopping, offer preview, record another section, discard, and save/upload.
- Keep the target track and section visible so the user knows where the audio will go.
- Pause freezes both capture and backing playback; Resume continues at the same song position into a new section of the same track. Time spent paused adds no silence. Mic mute instead records silence while playback and the timeline continue.
- Closing or collapsing the sheet must have an explicit, predictable behavior that protects the active recording. Include focus management, accessible button labels, keyboard controls, and reduced-motion support.
- Show both **Song position** and **Recorded duration** with distinct labels; gaps and pauses make them different. Keep encoding and save/upload status visible, and disable duplicate actions while a transition is in progress.

**Questions before implementation:** Should the sheet remain expanded for preview? Should collapsing it keep recording with a compact status bar? Confirm the proposed pause behavior and whether a countdown / pre-roll would help.

**Recording-sheet sketch** (proposed hierarchy, not final visual styling):

```text
┌─────────────────────────────────────────────┐
│ Alto · Chorus · Recording                   │
│                                             │
│        Live microphone waveform             │
│    ▁▂▅▃▁▆▇▂▃▅▁▂▆▃▁                          │
│                                             │
│ Song 01:12.350    Recorded 00:08.200         │
│ Input level / clipping status               │
│                                             │
│ [ Pause ] [ Mute mic ] [ Finish recording ] │
└─────────────────────────────────────────────┘
                ↑ opens from bottom
```

Pause changes to Resume while paused, and Mute mic changes to Unmute when muted. Opening motion should be brief, respect reduced-motion settings and avoid animation throughout capture. Keep controls above the phone's safe area and reachable in landscape; use a text status alongside the waveform so neither sound level nor recording state relies on color alone.

**Validation to define:** A user can record, pause, resume, mute, unmute and finish without hunting for controls; status and waveform match the action; paused time and muted time produce the intended audio and placement.

### V2-TIME — Control track start time

**Feedback:** Remove the concept of controlling delay; let users control the start time of each track.

**Requested outcome:** Drafts and uploaded tracks expose **Start time** on the song timeline instead of a delay / latency slider.

**Proposed design:**

- Display an absolute time such as `00:12.350`, with direct entry, fine nudges, and timeline dragging. The waveform and playback update together.
- Example: changing a track's start from `00:12.350` to `00:12.200` moves the entire track 150 ms earlier.
- For a track containing several sections, moving the track start moves all sections together and preserves their spacing. Individual sections can be moved through the editing workflow.
- Migrate existing tracks without changing their audible placement: the current effective start is `start_offset_ms + latency_offset_ms`. Device compensation, if retained, is an internal concern rather than a second timing control users must balance.

**Questions before implementation:** How should material placed before timeline zero be represented or trimmed? What precision and bounds should the field allow? Define how future automatic calibration interacts with the displayed start time without applying correction twice.

**Validation to define:** Existing projects sound aligned after migration; start-time edits agree with the waveform and survive reload/upload; moving a multi-section track preserves the sections' relative positions.

### V2-TAKES — Multiple recording sections and re-recording

**Feedback:** Recording currently feels like one pass. Support multiple recording sections within one track so users can re-record parts and later combine them.

**Requested outcome:** A singer can build one logical track from several recorded sections and retry a section without starting the whole song again.

**Proposed design:**

- Treat a **track** as one named part with shared performer, labels and mixer controls; a **section / clip** is a placed portion of recorded or uploaded audio; a **take** is an alternative recording for a section.
- Let users choose **New track**, **Add section to this track**, or **Re-record selected section** explicitly.
- Example: keep a good verse, record the chorus into the same track, retry one chorus phrase, then choose the preferred take for that phrase.
- Keep earlier takes until the user chooses a replacement or explicitly discards them. Starting or canceling a retry must not erase the accepted section.
- While retrying, let the singer hear the backing mix with the target section temporarily silenced, so their old vocal does not compete with the new attempt. This should not permanently change their saved mix.
- Preserve timeline placement, preview against the other tracks, and recover local sections / alternatives after a reload or interrupted recording.
- A selected range can become a punch-in target, with a lead-in so the singer can prepare. Define selection, capture boundaries and what happens outside the range before building this flow.

**Questions before implementation:** Are section boundaries selected in advance, created on Stop/Pause, or both? Can playback continue while capture is paused as a separate workflow? How should alternative takes be presented, and which are retained/uploaded? How do section/take counts and durations fit the existing storage caps?

**Validation to define:** Add two sections to one track, retry one section, audition alternatives, cancel or accept the retry, reload/recover, and upload without losing the untouched audio or producing extra logical tracks.

### V2-EDIT — Edit tracks and combine sections

**Feedback:** Support track editing and combining the recorded sections.

**Requested outcome:** Users can assemble a coherent part from the sections they want to keep.

**Proposed initial editing scope:**

- Select a section, trim its beginning/end, split it, move it on the timeline, remove it, and undo/redo edits.
- Choose a preferred take for each section and audition the assembled track alongside the mix.
- Combine the selected sections into one logical track for playback and saving. Source recordings remain available so trimming and combining can be revised.
- Make gaps and overlaps visible. Decide whether overlaps replace an existing section, play together, or require a take choice; consider short fades at joins to avoid clicks.
- Explore an arrangement of references to immutable audio sources rather than overwriting uploaded files. Editable track arrangements would need a revision, while audio caching would use source identity instead of assuming a track ID always maps to one file.

**Questions before implementation:** Does “combine” also need to create a single rendered audio file, or is an editable arrangement sufficient? What gap/overlap behavior and fades are expected? Define saving, deletion/cleanup of shared sources, offline behavior and conflicts when someone else edits the arrangement.

**Validation to define:** Trim, split, move, remove, undo and combine sections; verify timing and audible joins; reload and reopen offline where supported; ensure discarded edits or source cleanup cannot break an accepted arrangement.

**Recommended edit semantics:** Start with edits that preserve the timing of unaffected sections. Moving or deleting one phrase should not silently shift the rest of the song.

| Edit | Proposed behavior |
|---|---|
| Trim beginning | Advance the source in-point and section start together; remaining audio keeps its song position and the end stays fixed. |
| Trim end | Shorten the source range; the start stays fixed. |
| Split | Divide a section at the selected song time into two adjacent source references, preserving exactly the same playback. |
| Move | Change the section's timeline position without changing its source range. |
| Remove | Remove the section from the working arrangement, leaving a gap; other sections stay in place. |
| Re-record range | Substitute the accepted retry only inside the selected range, keeping the old audio outside it. |
| Combine | Group the chosen sections as one track arrangement; do not implicitly close intentional gaps or move phrases. |

Use an explicit edit selection and visible handles so dragging a waveform to move a section cannot be mistaken for seeking or reordering a track. On a phone, offer precise time fields / nudges as an alternative to dragging tiny handles. The prototype should check these interactions alongside the recording controls.

### A concrete practice session

1. Open the song, choose a track such as **Alto**, place the playhead at the verse and choose **Add section**. The recording sheet grows from the bottom with the live waveform above the controls.
2. Sing the verse. Pause to take a break; both backing playback and capture stop. Resume at the same song position. Muting the mic during an interruption instead keeps the song running and records silence.
3. Finish and preview the recorded sections against the mix. Keep them in the Alto track. A local save and a shared save/upload have distinct status.
4. Move to the chorus and add another section to Alto. The empty time between the verse and chorus is a visible gap in that track, without needing a long silent recording.
5. Select a weak phrase and choose **Re-record selection**. Hear a lead-in, record the phrase, then compare the original and retry at the same timeline position. Cancel leaves the original intact; accepting the retry replaces only the selected phrase in the working arrangement.
6. Trim or move a section, inspect the join and preview the assembled track. **Start time** moves the entire Alto part when it needs alignment; moving one section adjusts that phrase alone.
7. Save the arrangement to the project. Reopening it plays the chosen sections as one track, with the same performer, labels, volume, mute and solo controls.

### Suggested track / section / take model

This is a design proposal, not a database schema commitment. Keep the user's vocabulary simple: **track**, **section**, **take**, **start time**. A separate immutable audio source is useful internally.

| Concept | Responsibility |
|---|---|
| Track | One musical part, stable identity, name/performer/labels, shared mixer controls, timeline start and arrangement revision. |
| Audio source | One immutable uploaded or encoded recording file, its sample rate, duration, peaks and storage identity. Multiple edited sections may reference it without copying the audio. |
| Section / clip | A reference to a source, the source range to play, and its position relative to the track start. Splitting creates two references; trimming changes the referenced range. |
| Take | A recording attempt offered as an alternative for a section or selected range. Only the chosen material plays in the normal mix. A take may supply several clips after pause/resume or editing; define how those clips stay grouped for comparison. |
| Local draft arrangement | Unsaved track changes, recordings and take choices kept in this browser until shared save/upload succeeds. |

**Timing proposal:** A section plays at `track start time + section relative start`. Its duration comes from its selected source range. Keep the track anchor stable when the first section is removed or trimmed; do not silently redefine the start-time field. A track at `00:20.000` with sections at relative `0 s` and `15 s` plays those sections at `00:20.000` and `00:35.000`. Changing the track start to `00:19.800` moves both 200 ms earlier.

Source trim boundaries should be represented precisely enough to avoid losing or duplicating samples at splits and pause/resume joins. Derive recording placement from captured frames on the audio clock, preserving the M2 approach; UI click timing and encoding completion must not place the section. Account for files recorded at different sample rates, and use one consistent project-timeline unit.

**Migration proposal:** Wrap every existing uploaded track and ready local draft as a one-section arrangement, preserving its identity, labels, performer, order and browser mix. Preserve effective placement (`start_offset_ms + latency_offset_ms`), including negative effective starts, without destructively trimming the source. Existing draft recovery and offline snapshots need a versioned migration path. Migrate pending uploads deliberately rather than treating them as already usable sources.

### Recording states and action semantics

These are proposed behaviors to confirm during design. Mic mute is an input flag, not a separate recording lifecycle state.

Use **Finish recording** for the action that ends the current recording session, preserves its sections and opens review. **Add section** starts another recording later; **Save to project** publishes the reviewed arrangement. Distinct action labels prevent Stop, Keep and Upload from feeling interchangeable.

| State | Main actions and expected behavior |
|---|---|
| Ready | Choose new track, add section or retry selection; select input and show target range. |
| Preparing / lead-in | Request the mic and prepare playback; visibly count down if enabled. Cancel preserves existing material. Do not imply capture is running before it starts. |
| Recording | Pause, mic mute/unmute and Finish. Show song position, capture duration and waveform. Seek, target switching and destructive edits stay unavailable. |
| Paused | Resume or Finish. The current section is durably closed; the playhead is frozen. Resume starts another section at the same position. A retained mute setting is visibly indicated before resuming. |
| Finalizing | Flush capture and encode; prevent duplicate Finish/Resume actions. Earlier completed sections remain available even if the new section cannot be encoded. |
| Review | Preview, compare takes, accept/retry, edit, save/upload or explicitly discard the new work. Keep the accepted arrangement intact until the user chooses otherwise. |
| Interrupted / error | Explain what was recovered, what remains local and how to retry. Never silently turn an interrupted retry into the accepted take. |

The sheet's collapse action, if offered, keeps a visible recording status and reachable Pause/Finish controls. Escape, clicking the backdrop and browser Back must not silently discard audio. During capture, a locked background also makes accidental timeline edits less likely; review can return to the full editor. Confirm the exact focus/close behavior in the prototype.

**Punch-in proposal:** A selected range `[A, B)` gives the replacement boundaries. Play the lead-in without committing that audio to the selected phrase, capture the target, and stop at B. The old audio before A and after B remains in the arrangement. Keep any extra captured frames as source material where useful, with the chosen clip trimmed to the range. A short or canceled attempt should not automatically fill the missing part with silence or erase the old phrase; offer an explicit choice in review. Keep A–B practice looping separate from replacement recording for the first release.

### Saving, recovery and resource limits

- **Local durability:** Persist recorded chunks, section placement and working edits locally. State transitions such as Pause and Finish must flush their data. Recovery distinguishes completed sections from an interrupted attempt and never labels recoverable memory-only work as saved.
- **Shared save:** Upload new source files directly to R2 using the existing presign/confirm pattern, then publish the arrangement only when every referenced source is confirmed. Save the arrangement as one revision so other users see a coherent old or new track. A failure leaves the local draft available for retry; a lost response must not create duplicate sources or arrangements on retry.
- **Preview versus publish:** Editing and choosing takes changes the local preview first. Use an explicit shared save action initially, with **Saved on this device**, **Uploading**, **Saved to project**, and failure states. This is a proposal to confirm; existing metadata autosave need not dictate how audio edits are published.
- **Concurrent changes:** A revision check can detect someone else's saved edit and stop a stale overwrite. Offer reload or preservation of the local work; real-time collaboration and automatic merging are unnecessary for the first slice.
- **Undo and deletion:** Proposed undo/redo covers the current local editing session. Undo removes an edit from the arrangement; it does not immediately delete its source file. Decide whether history survives reload before promising that behavior. Source cleanup must respect all accepted arrangements, retained takes and promised undo history. Project/track delete confirmation should include the sections and takes being removed.
- **Offline:** Play saved arrangements from cached sources, and preserve local recording drafts under the existing offline promise. Editing saved tracks while offline needs an explicit product decision because v1 O5 disables mutations. Do not imply shared edits were published while offline. Cache source audio by immutable source ID and version the arrangement metadata.
- **Caps:** Keep the distinction between logical tracks, source files and arrangement duration. Ten sections in one vocal track should not automatically consume ten track slots, but all uploaded retained takes consume storage. Preserve per-file and global byte enforcement; decide whether the 10-minute limit applies to a source, an arrangement's latest end, or both. Bound section/take counts to avoid bypassing mobile memory limits. Local storage exhaustion needs an actionable recovery state as well as server-cap errors.
- **Performance:** Share decoded buffers when several clips reference the same source, load alternatives for audition when needed, and release unused buffers. Stress-test many short sections and take alternatives on a phone; a ten-track cap alone no longer bounds decoded memory. Reuse source peaks for trimmed clips rather than re-encoding audio for every edit.

### Decisions to resolve before implementation

Recommendations below are starting points for review, not additional user-approved requirements.

| Decision | Recommended starting point | Why it matters |
|---|---|---|
| Pause behavior | Freeze capture and backing playback; resume at the same position into another section. | Avoids an unexplained gap while keeping mute's silence behavior distinct. |
| Sheet close behavior | Deliberate collapse to a compact control bar; no implicit discard or stop. | Keeps active recording visible and controllable. |
| Track timing | One absolute start-time field, relative section positions and precise source trim ranges. | Whole-track alignment and phrase editing need distinct operations. |
| Before timeline zero | Preserve source audio and negative placement internally; initially play only the portion at or after zero. Confirm how the field exposes this. | Migration must not shift or destroy already aligned material. |
| Calibration | Treat device compensation as capture placement; keep the visible start time equal to audible placement. | Prevents users from balancing two offsets or correcting twice. |
| Re-record scope | Explicit selection with lead-in and a review step; preserve material outside the range. | Makes replacement predictable and cancel safe. |
| Overlap policy | One active vocal choice per range; show accidental overlaps for resolution. Gaps play silence. | Layering two takes unintentionally sounds like a timing bug. |
| Joins | Audition boundaries; evaluate short configurable or automatic fades with a deterministic overlap rule. | Naive joins can click, while excessive fades can soften consonants. |
| Combine meaning | One editable arrangement played as one track; rendered-file export can be a later task. | Covers practice without requiring a new export pipeline. |
| Alternative take retention | Keep retries locally until a choice; explicitly decide which alternatives to retain in the shared project. | Preserving every take indefinitely has a storage cost. |
| Save and undo scope | Explicit shared save; local undo/redo; revision conflict detection. | Protects existing accepted work and clarifies what other singers can hear. |
| Offline edit scope and caps | Preserve v1 offline recording/playback first; define broader editing, section limits and duration limits before promising them. | Avoids an accidental offline-sync project or unbounded resources. |
| Delivery priority | Review this workflow against S1–S7 before scheduling. | Capturing feedback does not by itself reorder the stretch backlog. |

### Suggested delivery slices

This sequence follows dependencies rather than estimating dates. Each slice needs separate implementation tasks and user-flow acceptance criteria before work starts.

1. **Design and prototype:** Validate the recording sheet and Start time interaction on phone and desktop. Confirm the terminology, pause behavior and a complete verse/chorus/retry example. Settle the data model, migration, save and overlap rules.
2. **Recording and placement foundation:** Introduce one-section arrangements compatibly, migrate old tracks/drafts, expose Start time, and build the sheet with pause/resume/mute/finish and recovery. Keep legacy projects working throughout.
3. **Sections and retries:** Add sections to an existing track, select a phrase to re-record, audition/accept alternatives and publish the resulting arrangement. Include retryable uploads, caps and revision checks in this slice, rather than leaving saved assemblies fragile.
4. **Editing and assembly:** Add trim/split/move/remove, local undo/redo, gap/overlap resolution and join handling. Verify source cleanup and offline playback for edited arrangements.

The **first useful V2 release** should let a singer keep a verse, record a chorus, retry one phrase and save one assembled track. A new recording sheet alone improves controls but does not complete that workflow. Some trim and replacement tools from slice 4 may be needed in slice 3; do not defer them if the workflow depends on them.

**Candidates for later work:** A rendered single-track file or project mixdown, effects, live monitoring, automatic comping, looped recording of many alternative takes, beat-grid quantization, real-time collaborative editing and arbitrary offline synchronization. These require separate scope decisions; they are not implied by the four feedback requests. Countdown/pre-roll and take comparison remain useful workflow proposals rather than a full DAW feature set.

### Cross-workflow acceptance scenarios

Use these to draft task acceptance criteria and the E2E flow map. Audio quality and device interruptions still need real-device checks.

| Scenario | Expected result | Verification |
|---|---|---|
| Start from a nonzero playhead after a slow mic permission grant | The first captured frame gets the correct timeline placement, not the permission-click time. | Timing unit tests, E2E, listening. |
| Pause for 30 s, resume, then mute for 3 s | Paused wall time adds no silence; muted timeline time adds 3 s of silence; both sections remain in the same track. | Frame/timing tests, E2E, listening. |
| Finish while paused or double-tap Finish | One finalization, no duplicate section or track, all captured data preserved. | Lifecycle tests and E2E. |
| Keep a verse, add a chorus, retry a phrase inside the chorus | Cancel preserves the original; accept changes only the selected range; alternative takes do not all play together. | Arrangement tests, E2E and listening. |
| Move the whole track, then one section | Whole-track move preserves spacing; section move affects only that section; displayed times match playback. | Timing tests and E2E. |
| Trim and split at the same boundary, then undo/redo | No lost/duplicated samples; undo restores placement and take choice; joins sound acceptable. | Edit-math tests, E2E and listening. |
| Reload after a completed section and an interrupted retry | Completed material and working edits recover; the interrupted attempt is identified and does not replace accepted audio. | IndexedDB/recovery tests and E2E. |
| A source upload fails, or a successful save response is lost | The accepted shared track stays coherent; retry retains local material and does not duplicate sources/sections. | API/integration tests and E2E fault injection. |
| Another singer saves while this browser edits | Stale save is detected, local work remains available and no silent overwrite occurs. | Revision tests and two-client E2E. |
| Open a migrated project and an edited project offline | Existing alignment/mix persists; cached assemblies play correctly; pending local work has accurate status. | Migration/cache tests and offline E2E. |
| Reach file/global/section caps or local storage exhaustion | Explain the specific limit, preserve accepted work and recover what was durably stored; no automatic deletion to make room. | Cap/failure tests and E2E. |
| Use a phone, keyboard or screen reader; interrupt the mic or hide the app | Controls stay reachable and labeled; interruption behavior is explicit and recoverable. No claim of background recording without device verification. | Accessibility checks, E2E, desktop Safari/Chrome and iPhone manual checks. |

### Planning dependencies and next step

Design the shared track / section / take model and start-time semantics before implementing multi-section recording or editing. The recording-sheet prototype can be explored alongside that design. Multi-section recording then provides the material the editor assembles.

Before coding, resolve the questions above, update the V2 requirements in PRD §9.1 and the decision log, and break the work into implementation tasks with acceptance criteria. Cover the resulting user flows with Playwright and check recording, alignment and joins by ear on real devices under the project's Definition of Done.

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
| S2 | Automatic latency detection and correction | Start from the M0-05 measurements. Loopback click calibration vs. browser-reported latency; integrate with V2-TIME so the displayed start remains the audible placement. |
| S3 | Soft delete / trash | A `deleted_at` column, a 7-day purge job, and a trash view with restore |
| S4 | Vocal / stem separation | Demucs in a separate worker container, a job queue, progress UI, stems saved as labeled tracks. Watch the storage caps. |
| S5 | Pitch-preserving playback speed (0.5×–1×) | Needs time-stretching (e.g. SoundTouch/Rubber Band WASM) across synced tracks |
| S6 | Per-track pan | A StereoPannerNode per track, saved in the local mixer state |
| S7 | Pitch display | Live pitch while recording and/or a pitch curve per track (YIN/pYIN in a worklet) |
