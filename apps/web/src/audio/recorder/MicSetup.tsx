import { useCallback, useEffect, useState } from 'react';
import {
  audioInputs,
  classifyMicError,
  dismissHeadphoneHint,
  type InputDevice,
  loadMicDevice,
  type MicErrorKind,
  type MicSource,
  micErrorMessage,
  openMic,
  resolveDeviceId,
  saveMicDevice,
  shouldShowHeadphoneHint,
} from './mic';

type Media = MicSource & Pick<MediaDevices, 'enumerateDevices'>;

interface Props {
  /** Injected in tests; defaults to `navigator.mediaDevices` (undefined on insecure pages). */
  mediaDevices?: Media;
}

export function MicSetup({ mediaDevices }: Props) {
  const media: Media | undefined =
    mediaDevices ?? (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices);
  const [inputs, setInputs] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<MicErrorKind | null>(media ? null : 'unsupported');
  const [granted, setGranted] = useState(false);
  const [hint, setHint] = useState(shouldShowHeadphoneHint);

  const refresh = useCallback(async () => {
    if (!media) return;
    const list = audioInputs(await media.enumerateDevices());
    setInputs(list);
    setDeviceId(resolveDeviceId(loadMicDevice(), list));
  }, [media]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const enable = async () => {
    if (!media) return;
    try {
      // Permission probe: the real capture stream is opened when recording starts.
      const { stream } = await openMic(media, loadMicDevice());
      for (const t of stream.getTracks()) t.stop();
      setError(null);
      setGranted(true);
      await refresh();
    } catch (err) {
      setError(classifyMicError(err as { name?: string }));
    }
  };

  const choose = (value: string) => {
    const next = value === '' ? null : value;
    setDeviceId(next);
    saveMicDevice(next);
  };

  return (
    <div className="mic-setup">
      {hint && (
        <p className="headphone-hint">
          <strong>Use headphones</strong> while recording so the other tracks don't leak into your
          microphone.{' '}
          <button
            type="button"
            onClick={() => {
              dismissHeadphoneHint();
              setHint(false);
            }}
          >
            Don't show again
          </button>
        </p>
      )}
      {media && !granted && (
        <button type="button" onClick={() => void enable()}>
          Enable microphone
        </button>
      )}
      {inputs.length > 0 && (
        <label>
          Input{' '}
          <select value={deviceId ?? ''} onChange={(e) => choose(e.target.value)}>
            <option value="">Default</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert">{micErrorMessage(error)}</p>}
    </div>
  );
}
