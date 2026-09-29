import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AudioController } from './controller';

export interface SyncTrack {
  id: number;
  startOffsetMs: number;
  latencyOffsetMs: number;
}

export type TrackLoadStatus = 'loading' | 'ready' | 'error';
export interface StatusState {
  byId: Record<number, TrackLoadStatus>;
}

export const createStatusStore = () => createStore<StatusState>(() => ({ byId: {} }));
export const trackStatusStore = createStatusStore();
export const useTrackStatus = (id: number): TrackLoadStatus | undefined =>
  useStore(trackStatusStore, (s) => s.byId[id]);

type Controller = Pick<AudioController, 'addTrack' | 'removeTrack' | 'setOffsets'>;

/**
 * Keeps the engine in step with the project's track list: downloads and decodes new tracks
 * (once each), applies offset edits to loaded ones, and removes deleted ones.
 */
export class AudioSync {
  private known = new Map<number, SyncTrack>(); // latest desired state, loaded or not
  private inEngine = new Set<number>();
  private loading = new Set<number>();

  constructor(
    private controller: Controller,
    private load: (track: SyncTrack) => Promise<AudioBuffer>,
    private status: StoreApi<StatusState> = trackStatusStore,
  ) {}

  sync(tracks: SyncTrack[]): void {
    const wanted = new Set(tracks.map((t) => t.id));
    for (const id of [...this.known.keys()]) {
      if (!wanted.has(id)) this.drop(id);
    }
    for (const t of tracks) {
      const prev = this.known.get(t.id);
      this.known.set(t.id, t);
      if (this.inEngine.has(t.id)) {
        if (
          prev &&
          (prev.startOffsetMs !== t.startOffsetMs || prev.latencyOffsetMs !== t.latencyOffsetMs)
        ) {
          this.controller.setOffsets(t.id, {
            startOffsetMs: t.startOffsetMs,
            latencyOffsetMs: t.latencyOffsetMs,
          });
        }
      } else if (!this.loading.has(t.id)) {
        void this.start(t);
      }
    }
  }

  /** Reloads a track whose download failed; does nothing for one that is loading or ready. */
  retry(id: number): void {
    const track = this.known.get(id);
    if (track && !this.inEngine.has(id) && !this.loading.has(id)) void this.start(track);
  }

  dispose(): void {
    for (const id of [...this.known.keys()]) this.drop(id);
  }

  private setStatus(id: number, s: TrackLoadStatus | undefined): void {
    this.status.setState((st) => {
      const byId = { ...st.byId };
      if (s === undefined) delete byId[id];
      else byId[id] = s;
      return { byId };
    });
  }

  private drop(id: number): void {
    this.known.delete(id);
    this.loading.delete(id);
    if (this.inEngine.delete(id)) this.controller.removeTrack(id);
    this.setStatus(id, undefined);
  }

  private async start(track: SyncTrack): Promise<void> {
    this.loading.add(track.id);
    this.setStatus(track.id, 'loading');
    try {
      const buffer = await this.load(track);
      const latest = this.known.get(track.id);
      if (!latest || !this.loading.has(track.id)) return; // removed while downloading
      this.controller.addTrack({
        id: latest.id,
        buffer,
        startOffsetMs: latest.startOffsetMs,
        latencyOffsetMs: latest.latencyOffsetMs,
      });
      this.inEngine.add(track.id);
      this.loading.delete(track.id);
      this.setStatus(track.id, 'ready');
    } catch {
      if (!this.loading.has(track.id)) return;
      this.loading.delete(track.id);
      this.setStatus(track.id, 'error'); // the next sync() retries
    }
  }
}
