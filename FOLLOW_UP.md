# Follow-up

Open questions to revisit.

- ~~Storage provider~~ → resolved: Cloudflare R2
- ~~Exact caps~~ → resolved in Q10
- ~~Soft delete / trash~~ → resolved: stretch goal

## V2 recording and editing

Feedback captured **2026-10-03** after the user reported the MVP finished: bottom recording modal, start-time controls, multiple sections / re-recording within a track, and section editing / combining. Requirements are in PRD §9.1; the detailed proposal and decision table are in [`tasks/STRETCH.md`](./tasks/STRETCH.md#v2--recording-and-track-editing-feedback). Resolve those questions and delivery priority before implementation; this document links there to keep the V2 design in one place.

## Stretch goals (parked)
- Soft delete / trash — stretch (resolved, see CONCLUDE.md)
- Automatic latency detection/compensation — stretch
- Punch-in recording — out of v1; now part of the V2 sectional re-recording exploration above
- Vocal/stem separation (Demucs/Spleeter etc.) — stretch
- Pitch curve / live pitch display for harmony accuracy — stretch idea (confirm)
- Pitch-preserving playback speed — stretch
- Per-track pan — stretch
- Lyrics extras — adjustable pre-roll, loop-from-lyrics, global lyrics offset, in-app LRC text editing: include in the stretch goal or not?
- Lyrics tap-to-sync for plain text / word-level highlighting — out of scope (later)
- Backups / rate limiting / activity log — explicitly not needed (declined in Q13); revisit only if abuse occurs

## Planning decisions to confirm (from task breakdown, see tasks/README.md)
1. Confirmation modals built in M1 alongside deletes (PRD plan said M3)
2. RustFS as local/CI stand-in for R2 (was MinIO; see CONCLUDE Q19)
3. Single production app container (Fastify serves API + static web)
4. Record-while-stopped starts playback + recording; Stop pauses playback
5. Input device picker (choose USB mic) added in M2
6. ~~wavesurfer.js for rendering only; own Web Audio engine for playback~~ → confirmed by M0-07 (see CONCLUDE Q18)
7. Track duration is client-reported (server doesn't decode)
