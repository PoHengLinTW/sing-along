import type { TrackDto } from '@sing-along/shared';
import { mixerStore } from '../audio/mixerStore';
import { labelsInProject, tracksWithLabel } from '../lib/labels';

interface Props {
  tracks: TrackDto[];
  filter: number[];
  onFilterChange: (ids: number[]) => void;
}

/**
 * Filter the view by label and bulk-mute by label. Filtering only hides rows: hidden tracks stay
 * loaded and keep playing according to their mute state, and "Mute all" reaches them too.
 */
export function LabelFilterBar({ tracks, filter, onFilterChange }: Props) {
  const labels = labelsInProject(tracks);
  if (labels.length === 0) return null;

  const toggle = (id: number) =>
    onFilterChange(filter.includes(id) ? filter.filter((x) => x !== id) : [...filter, id]);
  const setMuted = (labelId: number, muted: boolean) => {
    for (const id of tracksWithLabel(tracks, labelId)) mixerStore.getState().setMuted(id, muted);
  };

  return (
    <fieldset className="label-filter" aria-label="Labels">
      {labels.map((l) => (
        <span key={l.id} className="label-filter-item">
          <button
            type="button"
            aria-label={`Show only ${l.name}`}
            aria-pressed={filter.includes(l.id)}
            className="label-filter-chip"
            style={{ borderColor: l.color }}
            onClick={() => toggle(l.id)}
          >
            {l.name}
          </button>
          <button
            type="button"
            aria-label={`Mute all ${l.name}`}
            title={`Mute all ${l.name}`}
            onClick={() => setMuted(l.id, true)}
          >
            🔇
          </button>
          <button
            type="button"
            aria-label={`Unmute all ${l.name}`}
            title={`Unmute all ${l.name}`}
            onClick={() => setMuted(l.id, false)}
          >
            🔊
          </button>
        </span>
      ))}
      {filter.length > 0 && (
        <button type="button" onClick={() => onFilterChange([])}>
          Clear filter
        </button>
      )}
    </fieldset>
  );
}
