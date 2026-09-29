import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { getDraftEncoder } from './encoder';
import { type EncodeState, encodeStore } from './encodeStore';

interface Props {
  state?: StoreApi<EncodeState>;
  /** Draft id to display name, for the messages. */
  names?: Record<string, string>;
  onRetry?: (draftId: string) => void;
}

/** Progress, failure-with-retry and the WAV-fallback notice for takes being encoded. */
export function EncodeStatus({ state = encodeStore, names = {}, onRetry }: Props) {
  const byId = useStore(state, (s) => s.byId);
  const notice = useStore(state, (s) => s.notice);
  const retry = onRetry ?? ((id: string) => void getDraftEncoder().encode(id));
  const entries = Object.entries(byId);

  return (
    <div className="encode-status">
      {entries.map(([id, entry]) => {
        const name = names[id] ?? 'take';
        return entry.error ? (
          <p key={id} role="alert">
            Encoding {name} failed: {entry.error}{' '}
            <button type="button" onClick={() => retry(id)}>
              Retry
            </button>
          </p>
        ) : (
          <p key={id}>
            <label>
              Encoding {name}…{' '}
              <progress max={1} value={entry.fraction} aria-label={`Encoding ${name}`} />
            </label>
          </p>
        );
      })}
      {notice && (
        <p role="status">
          {notice}{' '}
          <button type="button" onClick={() => state.getState().setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
