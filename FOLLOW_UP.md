# Follow-up

Open questions to revisit.

- ~~Storage provider~~ → resolved: Cloudflare R2
- ~~Exact caps~~ → resolved in Q10
- ~~Soft delete / trash~~ → resolved: stretch goal

## Stretch goals (parked)
- Soft delete / trash — stretch (resolved, see CONCLUDE.md)
- Automatic latency detection/compensation — stretch
- Punch-in recording — out of v1
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
6. wavesurfer.js for rendering only; own Web Audio engine for playback (pending M0-07)
7. Track duration is client-reported (server doesn't decode)
