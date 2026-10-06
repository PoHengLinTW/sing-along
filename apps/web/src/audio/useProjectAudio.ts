import type { TrackDto } from '@sing-along/shared';
import { useCallback, useEffect, useRef } from 'react';
import { getAudioController } from './controller';
import { loadTrackBuffer } from './loadTrackBuffer';
import { AudioSync } from './sync';

/** Identifies a saved track's audio file, which an overwrite changes (and a rename does not). */
export function trackVersion(t: TrackDto): string {
  let sum = 0;
  for (const p of t.peaks) sum = (sum * 31 + Math.round(p * 1000)) % 1_000_003;
  return `${t.sizeBytes}:${t.durationMs}:${t.peaks.length}:${sum}`;
}

/**
 * Loads the project's tracks into the audio engine and keeps them in step with edits; cleans up on
 * leave. Returns a function that retries one track whose download failed.
 */
export function useProjectAudio(tracks: TrackDto[]): (trackId: number) => void {
  const sync = useRef<AudioSync | null>(null);

  useEffect(() => {
    const controller = getAudioController();
    sync.current = new AudioSync(controller, (t) => loadTrackBuffer(t.id, t.version));
    return () => {
      controller.pause();
      sync.current?.dispose();
      sync.current = null;
      controller.seek(0);
    };
  }, []);

  useEffect(() => {
    sync.current?.sync(
      tracks.map((t) => ({
        id: t.id,
        startOffsetMs: t.startOffsetMs,
        latencyOffsetMs: t.latencyOffsetMs,
        version: trackVersion(t),
      })),
    );
  }, [tracks]);

  return useCallback((trackId: number) => sync.current?.retry(trackId), []);
}
