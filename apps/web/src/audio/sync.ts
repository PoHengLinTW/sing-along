import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AudioController } from './controller';

export interface SyncTrack {
  id: number;
  startOffsetMs: number;
  latencyOffsetMs: number;
  /**
   * Identifies the audio file. When it changes for a loaded track the new audio is fetched and
   * swapped in; offset edits alone never reload. Leave it out for audio that never changes.
   */
  version?: string;
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
  /** The version of the audio each engine track plays, and of a replacement being fetched. */
  private loadedVersion = new Map<number, string | undefined>();
  private reloading = new Map<number, string>();

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
        this.refresh(t);
      } else if (!this.loading.has(t.id)) {
        void this.start(t);
      }
    }
  }

  /** Different audio for a track already playing: fetch it (once) and swap it in. */
  private refresh(t: SyncTrack): void {
    if (t.version === undefined) return;
    if (t.version === this.loadedVersion.get(t.id)) return;
    if (t.version === this.reloading.get(t.id)) return;
    void this.reload(t, t.version);
  }

  /**
   * The old audio plays until the new one is ready, then the engine track is replaced (a track
   * added while playing joins at the current position). A failure keeps the old audio, and the
   * next sync tries again; a slower, older request never overwrites a newer one.
   */
  private async reload(t: SyncTrack, version: string): Promise<void> {
    this.reloading.set(t.id, version);
    try {
      const buffer = await this.load(t);
      const latest = this.known.get(t.id);
      if (this.reloading.get(t.id) !== version || !latest || !this.inEngine.has(t.id)) return;
      this.controller.removeTrack(t.id);
      this.controller.addTrack({
        id: latest.id,
        buffer,
        startOffsetMs: latest.startOffsetMs,
        latencyOffsetMs: latest.latencyOffsetMs,
      });
      this.loadedVersion.set(t.id, version);
      this.reloading.delete(t.id);
    } catch {
      if (this.reloading.get(t.id) === version) this.reloading.delete(t.id);
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
    this.loadedVersion.delete(id);
    this.reloading.delete(id);
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
      this.loadedVersion.set(track.id, track.version);
      this.loading.delete(track.id);
      this.setStatus(track.id, 'ready');
      this.refresh(latest); // the audio changed again while this one was downloading
    } catch {
      if (!this.loading.has(track.id)) return;
      this.loading.delete(track.id);
      this.setStatus(track.id, 'error'); // the next sync() retries
    }
  }
}
