import { describe, expect, it, vi } from 'vitest';
import {
  audioInputs,
  classifyMicError,
  dismissHeadphoneHint,
  loadMicDevice,
  micConstraints,
  micErrorMessage,
  openMic,
  resolveDeviceId,
  saveMicDevice,
  shouldShowHeadphoneHint,
} from './mic';

const dev = (deviceId: string, label = '', kind: MediaDeviceKind = 'audioinput') =>
  ({ deviceId, label, kind, groupId: '' }) as MediaDeviceInfo;

const named = (name: string) => Object.assign(new Error(name), { name });

describe('micConstraints', () => {
  it('turns off all processing and asks for mono', () => {
    expect(micConstraints(null)).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  });

  it('pins a chosen device with exact', () => {
    const c = micConstraints('abc').audio as MediaTrackConstraints;
    expect(c.deviceId).toEqual({ exact: 'abc' });
    expect(c.echoCancellation).toBe(false);
  });
});

describe('audioInputs', () => {
  it('keeps only audio inputs', () => {
    const list = audioInputs([dev('a', 'Mic', 'audioinput'), dev('b', 'Spk', 'audiooutput')]);
    expect(list.map((d) => d.deviceId)).toEqual(['a']);
  });

  it('labels unnamed devices (before permission) with a numbered fallback', () => {
    const list = audioInputs([dev('a'), dev('b', 'USB Mic'), dev('c')]);
    expect(list.map((d) => d.label)).toEqual(['Microphone 1', 'USB Mic', 'Microphone 3']);
  });
});

describe('resolveDeviceId', () => {
  const inputs = audioInputs([dev('a', 'A'), dev('b', 'B')]);
  it('keeps a saved device that is still present', () => {
    expect(resolveDeviceId('b', inputs)).toBe('b');
  });
  it('falls back to the default (null) when the saved device is gone', () => {
    expect(resolveDeviceId('zzz', inputs)).toBeNull();
  });
  it('returns null when nothing was saved', () => {
    expect(resolveDeviceId(null, inputs)).toBeNull();
  });
});

describe('saved device and headphone hint', () => {
  it('round-trips the chosen device and clears it for the default', () => {
    saveMicDevice('abc');
    expect(loadMicDevice()).toBe('abc');
    saveMicDevice(null);
    expect(loadMicDevice()).toBeNull();
  });

  it('shows the headphone hint until dismissed for good', () => {
    expect(shouldShowHeadphoneHint()).toBe(true);
    dismissHeadphoneHint();
    expect(shouldShowHeadphoneHint()).toBe(false);
  });

  it('survives a storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadMicDevice()).toBeNull();
    expect(shouldShowHeadphoneHint()).toBe(true);
    spy.mockRestore();
  });
});

describe('classifyMicError / micErrorMessage', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['OverconstrainedError', 'not-found'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['WeirdError', 'other'],
  ] as const)('%s -> %s', (name, kind) => {
    expect(classifyMicError(named(name))).toBe(kind);
  });

  it('explains how to allow the mic when permission is denied', () => {
    expect(micErrorMessage('denied')).toMatch(/allow/i);
    expect(micErrorMessage('denied')).toMatch(/settings/i);
  });

  it('says clearly that no mic was found', () => {
    expect(micErrorMessage('not-found')).toMatch(/no microphone/i);
  });
});

describe('openMic', () => {
  const stream = { id: 's' } as unknown as MediaStream;

  it('requests the raw constraints and reports the device used', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const r = await openMic({ getUserMedia }, 'abc');
    expect(getUserMedia).toHaveBeenCalledWith(micConstraints('abc'));
    expect(r).toEqual({ stream, deviceId: 'abc' });
  });

  it('retries with the default device when the saved one is gone', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(named('OverconstrainedError'))
      .mockResolvedValueOnce(stream);
    const r = await openMic({ getUserMedia }, 'gone');
    expect(getUserMedia).toHaveBeenLastCalledWith(micConstraints(null));
    expect(r.deviceId).toBeNull();
  });

  it('does not retry on a permission error', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(named('NotAllowedError'));
    await expect(openMic({ getUserMedia }, 'abc')).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
