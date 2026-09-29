import { LABEL_NAME_MAX, type LabelDto, type TrackDto } from '@sing-along/shared';

export const NEUTRAL_COLOR = '#94a3b8';

const norm = (s: string) => s.trim().toLowerCase();

/** Type-ahead: labels whose name contains the query, names that start with it first. */
export function matchLabels(labels: LabelDto[], query: string): LabelDto[] {
  const q = norm(query);
  if (!q) return labels;
  const hits = labels.filter((l) => norm(l.name).includes(q));
  return [
    ...hits.filter((l) => norm(l.name).startsWith(q)),
    ...hits.filter((l) => !norm(l.name).startsWith(q)),
  ];
}

/** "Create '<name>'" is offered for a new name (not already a label), 1-30 characters. */
export function canCreateLabel(query: string, labels: LabelDto[]): boolean {
  const q = norm(query);
  return q.length > 0 && q.length <= LABEL_NAME_MAX && !labels.some((l) => norm(l.name) === q);
}

/** Every label used in the project, once, in order of first appearance (for the filter bar). */
export function labelsInProject(tracks: TrackDto[]): LabelDto[] {
  const seen = new Map<number, LabelDto>();
  for (const t of tracks) for (const l of t.labels) if (!seen.has(l.id)) seen.set(l.id, l);
  return [...seen.values()];
}

/** Tracks with at least one of the chosen labels; no filter shows everything. View-only: playback is unaffected. */
export function filterByLabels(tracks: TrackDto[], labelIds: number[]): TrackDto[] {
  if (labelIds.length === 0) return tracks;
  return tracks.filter((t) => t.labels.some((l) => labelIds.includes(l.id)));
}

export function tracksWithLabel(tracks: TrackDto[], labelId: number): number[] {
  return tracks.filter((t) => t.labels.some((l) => l.id === labelId)).map((t) => t.id);
}

/** A track's waveform color comes from its first label (PRD L3). */
export function waveformColor(track: Pick<TrackDto, 'labels'>): string {
  return track.labels[0]?.color ?? NEUTRAL_COLOR;
}
