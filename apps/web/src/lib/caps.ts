import { type Caps, formatBytes } from '@sing-along/shared';

const minutes = (ms: number) => `${+(ms / 60000).toFixed(1)} minutes`;

/** Messages omit the file name: callers show them next to it ("take.wav: Too large ..."). */
export function fileCapMessage(file: { name: string; size: number }, caps: Caps): string | null {
  if (file.size <= caps.maxFileBytes) return null;
  const wav = file.name.toLowerCase().endsWith('.wav');
  return `Too large (limit ${formatBytes(caps.maxFileBytes)}).${wav ? ' Convert to FLAC or MP3.' : ''}`;
}

export function durationCapMessage(durationMs: number, caps: Caps): string | null {
  return durationMs > caps.maxTrackMs ? `Too long (limit ${minutes(caps.maxTrackMs)}).` : null;
}
