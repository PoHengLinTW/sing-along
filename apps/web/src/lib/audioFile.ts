import { isAllowedAudioType } from '@sing-along/shared';

const EXTENSION_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

/** Browsers often report an empty or generic type for audio files: fall back to the extension. */
export function resolveAudioMime(file: { name: string; type: string }): string | null {
  const base = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base && isAllowedAudioType(base)) return base;
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
  return (ext && EXTENSION_TO_MIME[ext]) || null;
}

export function defaultTrackName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
