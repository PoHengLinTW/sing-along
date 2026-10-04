import { useEffect, useRef } from 'react';
import { type AudioController, getAudioController } from './controller';
import type { DraftView } from './recorder/draftView';
import { AudioSync } from './sync';

interface Deps {
  controller: Pick<AudioController, 'addTrack' | 'removeTrack' | 'setOffsets'>;
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
}

/** Identifies a draft's audio file, so an edit is noticed but a rename or a re-read is not. */
export function audioVersion(d: DraftView): string {
  let sum = 0;
  for (const p of d.peaks) sum = (sum * 31 + Math.round(p * 1000)) % 1_000_003;
  return `${d.blob.size}:${d.durationMs}:${d.peaks.length}:${sum}`;
}

/** Plays the project's drafts in the engine next to the uploaded tracks, under their own ids. */
export function useDraftAudio(drafts: DraftView[], deps?: Partial<Deps>): void {
  const sync = useRef<AudioSync | null>(null);
  const blobs = useRef(new Map<number, Blob>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are injected in tests only
  useEffect(() => {
    const controller = deps?.controller ?? getAudioController();
    const decode = deps?.decode ?? ((data) => getAudioController().engine.decode(data));
    sync.current = new AudioSync(controller, async (t) => {
      const blob = blobs.current.get(t.id);
      if (!blob) throw new Error('draft audio missing');
      return decode(await blob.arrayBuffer());
    });
    return () => {
      sync.current?.dispose();
      sync.current = null;
    };
  }, []);

  useEffect(() => {
    blobs.current = new Map(drafts.map((d) => [d.engineId, d.blob]));
    sync.current?.sync(
      drafts.map((d) => ({
        id: d.engineId,
        startOffsetMs: d.startOffsetMs,
        latencyOffsetMs: d.latencyOffsetMs,
        version: audioVersion(d),
      })),
    );
  }, [drafts]);
}
