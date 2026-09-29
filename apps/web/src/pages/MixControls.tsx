import type { ReactNode } from 'react';
import { mixerStore, useMix } from '../audio/mixerStore';

/** Volume, mute and solo for one engine id (an uploaded track or a draft), plus row-specific buttons. */
export function MixControls({ id, children }: { id: number; children?: ReactNode }) {
  const mix = useMix(id);
  return (
    <div className="panel-mix">
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={150}
        step={1}
        value={Math.round(mix.volume * 100)}
        onChange={(e) => mixerStore.getState().setVolume(id, Number(e.target.value) / 100)}
      />
      <span className="vol-readout">{Math.round(mix.volume * 100)}%</span>
      <button
        type="button"
        aria-pressed={mix.muted}
        onClick={() => mixerStore.getState().toggleMute(id)}
      >
        Mute
      </button>
      <button
        type="button"
        aria-pressed={mix.solo}
        onClick={() => mixerStore.getState().toggleSolo(id)}
      >
        Solo
      </button>
      {children}
    </div>
  );
}
