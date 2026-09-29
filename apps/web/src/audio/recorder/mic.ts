export const MIC_DEVICE_KEY = 'sing-along:mic-device';
export const HEADPHONE_HINT_KEY = 'sing-along:hide-headphone-hint';

/** Raw capture per PRD R2: no browser processing (it would colour the take and add latency), mono. */
const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export function micConstraints(deviceId: string | null): MediaStreamConstraints {
  return { audio: deviceId ? { ...RAW_AUDIO, deviceId: { exact: deviceId } } : { ...RAW_AUDIO } };
}

export interface InputDevice {
  deviceId: string;
  label: string;
}

/** Labels are empty until the user grants permission: number the unnamed ones so the list stays usable. */
export function audioInputs(devices: MediaDeviceInfo[]): InputDevice[] {
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** The saved device if it is still plugged in, otherwise null (= the browser's default input). */
export function resolveDeviceId(saved: string | null, inputs: InputDevice[]): string | null {
  return saved !== null && inputs.some((d) => d.deviceId === saved) ? saved : null;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window): the preference just isn't remembered.
  }
}

export const loadMicDevice = () => readStorage(MIC_DEVICE_KEY);
export const saveMicDevice = (deviceId: string | null) => writeStorage(MIC_DEVICE_KEY, deviceId);
export const shouldShowHeadphoneHint = () => readStorage(HEADPHONE_HINT_KEY) === null;
export const dismissHeadphoneHint = () => writeStorage(HEADPHONE_HINT_KEY, '1');

export type MicErrorKind = 'denied' | 'not-found' | 'busy' | 'unsupported' | 'other';

export function classifyMicError(err: { name?: string }): MicErrorKind {
  switch (err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not-found';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'other';
  }
}

export function micErrorMessage(kind: MicErrorKind): string {
  switch (kind) {
    case 'denied':
      return 'Microphone access is blocked. Allow the microphone for this site in your browser settings (the lock or site-settings icon by the address), then try again.';
    case 'not-found':
      return 'No microphone found. Plug one in or check that your device has one, then try again.';
    case 'busy':
      return 'The microphone is in use by another app or tab. Close it and try again.';
    case 'unsupported':
      return 'Recording is not available here: the browser needs a secure (https) page and microphone support.';
    default:
      return 'The microphone could not be started.';
  }
}

export interface MicSource {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/**
 * Opens the mic. A saved device that has been unplugged fails with OverconstrainedError:
 * retry once on the default input instead of leaving the user stuck.
 */
export async function openMic(
  media: MicSource,
  deviceId: string | null,
): Promise<{ stream: MediaStream; deviceId: string | null }> {
  try {
    return { stream: await media.getUserMedia(micConstraints(deviceId)), deviceId };
  } catch (err) {
    if (deviceId !== null && (err as { name?: string }).name === 'OverconstrainedError') {
      return { stream: await media.getUserMedia(micConstraints(null)), deviceId: null };
    }
    throw err;
  }
}
