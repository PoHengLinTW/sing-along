/** Input level maths (pure): min/max blocks from the worklet, a meter with peak hold, clip detection. */

/** ~21 ms at 48 kHz: 43+ updates a second, above the 30 fps the live waveform needs. */
export const LEVEL_BLOCK_FRAMES = 1024;
/** Samples at or above -0.1 dBFS count as clipping. */
export const CLIP_LEVEL = 10 ** (-0.1 / 20);
export const CLIP_HOLD_MS = 2000;
/** The meter's bottom: anything quieter reads as empty. */
const FLOOR_DB = -60;
/** Per update: the bar falls slowly after a loud peak so short peaks stay readable. */
const DECAY = 0.92;

export interface LevelBlock {
  min: number;
  max: number;
  frames: number;
}

/** Collapses the worklet's 128-frame quanta into min/max blocks. Shared by worklet and tests. */
export class LevelTracker {
  private min = 0;
  private max = 0;
  private frames = 0;

  constructor(private blockFrames = LEVEL_BLOCK_FRAMES) {}

  push(samples: Float32Array): LevelBlock[] {
    const out: LevelBlock[] = [];
    for (const s of samples) {
      if (this.frames === 0) {
        this.min = s;
        this.max = s;
      } else if (s < this.min) this.min = s;
      else if (s > this.max) this.max = s;
      this.frames++;
      if (this.frames === this.blockFrames) {
        out.push({ min: this.min, max: this.max, frames: this.frames });
        this.frames = 0;
      }
    }
    return out;
  }
}

export const blockPeak = (b: LevelBlock): number => Math.max(Math.abs(b.min), Math.abs(b.max));

export const toDb = (amplitude: number): number =>
  amplitude <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude);

/** 0..1 bar length: -60 dB is empty, 0 dB is full. */
export function levelFraction(amplitude: number): number {
  const db = toDb(amplitude);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

export interface LevelState {
  /** Peak-hold amplitude, 0..1. */
  level: number;
  /** Wall-clock ms until which the clip warning stays on. */
  clipUntil: number;
}

export function updateLevel(prev: LevelState, peak: number, nowMs: number): LevelState {
  return {
    level: Math.max(peak, prev.level * DECAY),
    clipUntil: peak >= CLIP_LEVEL ? nowMs + CLIP_HOLD_MS : prev.clipUntil,
  };
}

export const isClipping = (state: LevelState, nowMs: number): boolean => nowMs < state.clipUntil;
