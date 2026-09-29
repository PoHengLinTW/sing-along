import type { TrackDto } from '@sing-along/shared';
import { useEffect, useRef } from 'react';
import { getAudioController } from './controller';
import { loadTrackBuffer } from './loadTrackBuffer';
import { AudioSync } from './sync';

/** Loads the project's tracks into the audio engine and keeps them in step with edits; cleans up on leave. */
export function useProjectAudio(tracks: TrackDto[]): void {
  const sync = useRef<AudioSync | null>(null);

  useEffect(() => {
    const controller = getAudioController();
    sync.current = new AudioSync(controller, (t) => loadTrackBuffer(t.id));
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
      })),
    );
  }, [tracks]);
}
