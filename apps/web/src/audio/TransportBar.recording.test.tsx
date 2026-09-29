import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingStore } from './recorder/recordingStore';
import { TransportBar } from './TransportBar';
import { createTransportStore } from './transportStore';

const controller = {
  toggle: vi.fn(async () => {}),
  restart: vi.fn(),
  skip: vi.fn(),
  setLoopPoint: vi.fn(() => true),
  toggleLoop: vi.fn(),
  clearLoop: vi.fn(),
};

let recording: ReturnType<typeof createRecordingStore>;
beforeEach(() => {
  recording = createRecordingStore();
  const transport = createTransportStore();
  transport.setState({ loop: { a: 1, b: 2 }, loopEnabled: true });
  render(
    <TransportBar controller={controller as never} transport={transport} recording={recording} />,
  );
});

const LOCKED = [
  'Restart',
  'Back 10 seconds',
  'Play',
  'Forward 10 seconds',
  'Set loop start (A)',
  'Set loop end (B)',
  'Loop',
  'Clear loop',
];
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('while recording', () => {
  it('is fully enabled when idle', () => {
    for (const name of LOCKED) expect(button(name).disabled).toBe(false);
  });

  it.each(['starting', 'recording', 'stopping'] as const)(
    'greys out seeking, looping and play while %s, with a tooltip saying why',
    (status) => {
      act(() => recording.setState({ status }));
      for (const name of LOCKED) {
        expect(button(name).disabled).toBe(true);
        expect(button(name).title).toMatch(/recording/i);
      }
    },
  );

  it('re-enables everything when the take ends', () => {
    act(() => recording.setState({ status: 'recording' }));
    act(() => recording.setState({ status: 'idle' }));
    for (const name of LOCKED) expect(button(name).disabled).toBe(false);
  });
});
