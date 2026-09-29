import type { LabelDto } from '@sing-along/shared';
import { useState } from 'react';
import { canCreateLabel, matchLabels } from '../lib/labels';

interface Props {
  labels: LabelDto[];
  /** Selected label ids in order: the first one colors the waveform. */
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Creates a custom label and resolves with it (it is then selected). */
  onCreate: (name: string) => Promise<LabelDto>;
}

/** Presets and custom labels with type-ahead; typing a new name offers "Create '<name>'". */
export function LabelPicker({ labels, selectedIds, onChange, onCreate }: Props) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = matchLabels(labels, query);
  const creatable = canCreateLabel(query, labels);
  const name = query.trim();

  const toggle = (id: number) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const create = async () => {
    if (!creatable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await onCreate(name);
      if (!selectedIds.includes(created.id)) onChange([...selectedIds, created.id]);
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the label');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="label-picker">
      <input
        type="text"
        aria-label="Find or create a label"
        placeholder="Find or create a label"
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); // never submits an enclosing form
            void create();
          }
        }}
      />
      <ul className="label-options">
        {visible.map((l) => (
          <li key={l.id}>
            <label>
              <input
                type="checkbox"
                checked={selectedIds.includes(l.id)}
                onChange={() => toggle(l.id)}
              />
              <span className="chip-dot" style={{ background: l.color }} />
              {l.name}
            </label>
          </li>
        ))}
      </ul>
      {creatable && (
        <button type="button" disabled={busy} onClick={() => void create()}>
          {`Create '${name}'`}
        </button>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
