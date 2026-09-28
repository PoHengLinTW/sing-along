export type MicSupport = { ok: true } | { ok: false; reason: 'insecure-context' | 'no-getusermedia' };

export function checkMicSupport(env: { isSecureContext: boolean; hasGetUserMedia: boolean }): MicSupport {
  if (!env.isSecureContext) return { ok: false, reason: 'insecure-context' };
  if (!env.hasGetUserMedia) return { ok: false, reason: 'no-getusermedia' };
  return { ok: true };
}

export function describeMicError(err: { name: string }): string {
  switch (err.name) {
    case 'NotAllowedError':
      return 'Microphone permission denied.';
    case 'NotFoundError':
      return 'No microphone found.';
    default:
      return `Microphone error: ${err.name}`;
  }
}

/** Raw constraints per PRD: processing off, mono. Used from M0-03 on. */
export const RAW_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};
