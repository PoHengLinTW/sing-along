import { describe, expect, it } from 'vitest';
import { defaultTrackName, resolveAudioMime } from './audioFile';

describe('resolveAudioMime', () => {
  it('accepts an allowed MIME type as reported by the browser', () => {
    expect(resolveAudioMime({ name: 'x', type: 'audio/flac' })).toBe('audio/flac');
    expect(resolveAudioMime({ name: 'x', type: 'audio/webm;codecs=opus' })).toBe('audio/webm');
  });
  it('falls back to the file extension when the browser reports no type', () => {
    expect(resolveAudioMime({ name: 'Take 1.MP3', type: '' })).toBe('audio/mpeg');
    expect(resolveAudioMime({ name: 'a.m4a', type: '' })).toBe('audio/mp4');
    expect(resolveAudioMime({ name: 'a.wav', type: '' })).toBe('audio/wav');
    expect(resolveAudioMime({ name: 'a.flac', type: 'application/octet-stream' })).toBe(
      'audio/flac',
    );
    expect(resolveAudioMime({ name: 'a.ogg', type: '' })).toBe('audio/ogg');
    expect(resolveAudioMime({ name: 'a.webm', type: '' })).toBe('audio/webm');
    expect(resolveAudioMime({ name: 'a.aac', type: '' })).toBe('audio/aac');
  });
  it('rejects everything else', () => {
    expect(resolveAudioMime({ name: 'movie.mp4', type: 'video/mp4' })).toBeNull();
    expect(resolveAudioMime({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
    expect(resolveAudioMime({ name: 'noext', type: '' })).toBeNull();
  });
});

describe('defaultTrackName', () => {
  it('is the file name without its extension', () => {
    expect(defaultTrackName('Lead vocal.take2.flac')).toBe('Lead vocal.take2');
    expect(defaultTrackName('noext')).toBe('noext');
  });
});
