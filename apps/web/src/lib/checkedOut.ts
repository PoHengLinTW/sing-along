import type { TrackDto } from '@sing-along/shared';

/**
 * Saved tracks that are out for editing: the one a take will overwrite, and those combined into
 * it. They are hidden and silent while the take exists, so the audio is never heard twice.
 */
export function hiddenTrackIds(
  drafts: { replacesTrackId?: number; deletesTrackIds?: number[] }[],
): Set<number> {
  const ids = new Set<number>();
  for (const d of drafts) {
    if (d.replacesTrackId !== undefined) ids.add(d.replacesTrackId);
    for (const id of d.deletesTrackIds ?? []) ids.add(id);
  }
  return ids;
}

/** The same array when nothing is hidden, so callers that compare by identity do not re-run. */
export function withoutCheckedOut(tracks: TrackDto[], hidden: Set<number>): TrackDto[] {
  return tracks.some((t) => hidden.has(t.id)) ? tracks.filter((t) => !hidden.has(t.id)) : tracks;
}
