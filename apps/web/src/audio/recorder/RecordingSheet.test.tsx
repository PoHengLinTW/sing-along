import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui/toast';
import { createTransportStore } from '../transportStore';
import { createLevelStore } from './levelStore';
import { LiveWave } from './liveWave';
import { RecordingSheet } from './RecordingSheet';
import { createRecordingStore } from './recordingStore';

let recording: ReturnType<typeof createRecordingStore>;
let levels: ReturnType<typeof createLevelStore>;
let transport: ReturnType<typeof createTransportStore>;
let live: LiveWave;
const session = {
  pause: vi.fn(() => recording.setState({ status: 'paused' })),
  resume: vi.fn(async () => recording.setState({ status: 'recording' })),
  stop: vi.fn(async () => {
    recording.setState({ status: 'idle' });
    return {} as never;
  }),
  setMuted: vi.fn((m: boolean) => recording.setState({ muted: m })),
};

beforeEach(() => {
  recording = createRecordingStore();
  levels = createLevelStore();
  transport = createTransportStore();
  live = new LiveWave();
  for (const fn of Object.values(session)) fn.mockClear();
  render(
    <ToastProvider>
      <RecordingSheet
        session={session as never}
        recording={recording}
        levels={levels}
        transport={transport}
        live={live}
      />
    </ToastProvider>,
  );
});

const sheet = () => screen.queryByRole('region', { name: 'Recording' });
const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('RecordingSheet visibility', () => {
  it('is absent while idle', () => {
    expect(sheet()).toBeNull();
  });

  it.each(['starting', 'recording', 'paused', 'stopping'] as const)(
    'is open while %s',
    (status) => {
      act(() => recording.setState({ status }));
      expect(sheet()).not.toBeNull();
    },
  );

  it('closes when the take is over', () => {
    act(() => recording.setState({ status: 'recording' }));
    act(() => recording.setState({ status: 'idle' }));
    expect(sheet()).toBeNull();
  });

  it('is not discarded by Escape', () => {
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(sheet()).not.toBeNull();
    expect(session.stop).not.toHaveBeenCalled();
  });
});

describe('RecordingSheet status and times', () => {
  it('says what is happening in words', () => {
    act(() => recording.setState({ status: 'starting' }));
    expect(screen.getByRole('status').textContent).toMatch(/starting/i);
    act(() => recording.setState({ status: 'recording' }));
    expect(screen.getByRole('status').textContent).toMatch(/recording/i);
    act(() => recording.setState({ muted: true }));
    expect(screen.getByRole('status').textContent).toMatch(/muted.*silence/i);
    act(() => recording.setState({ status: 'paused' }));
    expect(screen.getByRole('status').textContent).toMatch(/paused/i);
    act(() => recording.setState({ status: 'stopping', muted: false }));
    expect(screen.getByRole('status').textContent).toMatch(/finishing/i);
  });

  it('shows the song position and the recorded time as two labelled values', () => {
    act(() => recording.setState({ status: 'recording', startSec: 70 }));
    act(() => transport.setState({ position: 72.35 }));
    expect(screen.getByText('Song').parentElement?.textContent).toMatch(/01:12\.350/);
    expect(screen.getByText('Recorded').parentElement?.textContent).toMatch(/00:02\.350/);
  });

  it('recorded time holds still while paused (the playhead is frozen too)', () => {
    act(() => recording.setState({ status: 'paused', startSec: 10 }));
    act(() => transport.setState({ position: 14 }));
    expect(screen.getByText('Recorded').parentElement?.textContent).toMatch(/00:04\.000/);
  });

  it('shows the input level with a text clipping warning', () => {
    act(() => recording.setState({ status: 'recording' }));
    act(() => levels.setState({ level: 0.5 }));
    const meter = screen.getByLabelText('Input level') as HTMLMeterElement;
    expect(meter.value).toBeGreaterThan(0);
    expect(screen.queryByText(/clipping/i)).toBeNull();
    act(() => levels.setState({ level: 1, clipUntil: Date.now() + 5000 }));
    expect(screen.getByText(/clipping/i)).toBeTruthy();
  });
});

describe('RecordingSheet controls', () => {
  it('Pause pauses, then the same place offers Resume', async () => {
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.click(btn('Pause recording'));
    expect(session.pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Pause recording' })).toBeNull();
    fireEvent.click(btn('Resume recording'));
    await waitFor(() => expect(session.resume).toHaveBeenCalledTimes(1));
    expect(btn('Pause recording')).toBeTruthy();
  });

  it('Mute and Unmute the microphone, with the state shown on the button', () => {
    act(() => recording.setState({ status: 'recording' }));
    expect(btn('Mute microphone').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn('Mute microphone'));
    expect(session.setMuted).toHaveBeenLastCalledWith(true);
    expect(btn('Unmute microphone').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('Unmute microphone'));
    expect(session.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('can mute while paused, and says so before resuming', () => {
    act(() => recording.setState({ status: 'paused' }));
    fireEvent.click(btn('Mute microphone'));
    expect(session.setMuted).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('status').textContent).toMatch(/paused/i);
    expect(screen.getByRole('status').textContent).toMatch(/muted/i);
  });

  it('Finish recording ends the take, also while paused, and only once on a double tap', async () => {
    act(() => recording.setState({ status: 'paused' }));
    const finish = btn('Finish recording');
    fireEvent.click(finish);
    fireEvent.click(finish);
    await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1));
  });

  it('disables everything while starting and while finishing', () => {
    for (const status of ['starting', 'stopping'] as const) {
      act(() => recording.setState({ status }));
      for (const b of screen.getAllByRole('button'))
        expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('a failed Finish is explained and the buttons come back', async () => {
    session.stop.mockRejectedValueOnce(new Error('boom'));
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.click(btn('Finish recording'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/finish/i);
    await waitFor(() => expect(btn('Finish recording').disabled).toBe(false));
  });

  it('has a labelled live waveform', () => {
    act(() => recording.setState({ status: 'recording' }));
    expect(screen.getByRole('img', { name: 'Live microphone waveform' })).toBeTruthy();
  });
});
