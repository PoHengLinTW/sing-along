import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui/toast';
import { createTransportStore } from '../transportStore';
import { createLevelStore } from './levelStore';
import { saveMicDevice } from './mic';
import { RecordControls } from './RecordControls';
import { createRecordingStore } from './recordingStore';

let recording: ReturnType<typeof createRecordingStore>;
let levels: ReturnType<typeof createLevelStore>;
let transport: ReturnType<typeof createTransportStore>;
const session = {
  start: vi.fn(async () => {
    recording.setState({ status: 'recording', startSec: 10 });
  }),
  stop: vi.fn(async () => {
    recording.setState({ status: 'idle' });
    return {} as never;
  }),
  setMuted: vi.fn((m: boolean) => recording.setState({ muted: m })),
  pause: vi.fn(() => recording.setState({ status: 'paused' })),
  resume: vi.fn(async () => recording.setState({ status: 'recording' })),
};
const monitor = { setMuted: vi.fn((m: boolean) => levels.setState({ muted: m })) };

beforeEach(() => {
  recording = createRecordingStore();
  levels = createLevelStore();
  transport = createTransportStore();
  for (const fn of [...Object.values(session), ...Object.values(monitor)]) fn.mockClear();
  render(
    <ToastProvider>
      <RecordControls
        projectId={7}
        session={session as never}
        recording={recording}
        levels={levels}
        monitor={monitor as never}
        transport={transport}
      />
      <input aria-label="notes" />
    </ToastProvider>,
  );
});

const recordButton = () => screen.getByRole('button', { name: /^(record|stop recording)/i });
const muteButton = () => screen.getByRole('button', { name: /mic/i }) as HTMLButtonElement;

describe('record button', () => {
  it('starts a take for this project on the saved input device, with the remembered performer', async () => {
    saveMicDevice('usb-1');
    localStorage.setItem('sing-along:performer', 'Ann');
    await userEvent.click(recordButton());
    expect(session.start).toHaveBeenCalledWith({
      projectId: 7,
      deviceId: 'usb-1',
      performer: 'Ann',
    });
  });

  it('turns red and shows the elapsed time while recording, then stops the take', async () => {
    await userEvent.click(recordButton());
    const stop = await screen.findByRole('button', { name: /stop recording/i });
    expect(stop.className).toMatch(/recording/);
    act(() => transport.setState({ position: 72.4 })); // 62.4 s after the take began at 10 s
    expect(stop.textContent).toMatch(/1:02/);
    await userEvent.click(stop);
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /^record/i })).toBeTruthy();
  });

  it('elapsed time never goes negative (the playhead is a moment behind the first frame)', async () => {
    await userEvent.click(recordButton());
    act(() => transport.setState({ position: 9.9 }));
    expect((await screen.findByRole('button', { name: /stop recording/i })).textContent).toMatch(
      /0:00/,
    );
  });

  it('explains a mic failure and stays idle', async () => {
    session.start.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await userEvent.click(recordButton());
    expect((await screen.findByRole('alert')).textContent).toMatch(/allow.*settings/i);
    expect(recordButton().textContent).toMatch(/record/i);
  });

  it('is disabled while the take is starting or stopping', async () => {
    act(() => recording.setState({ status: 'starting' }));
    await waitFor(() => expect((recordButton() as HTMLButtonElement).disabled).toBe(true));
    act(() => recording.setState({ status: 'stopping' }));
    expect((recordButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('R shortcut', () => {
  it('starts and stops a take', async () => {
    fireEvent.keyDown(document.body, { key: 'r' });
    await waitFor(() => expect(session.start).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: /stop recording/i });
    fireEvent.keyDown(document.body, { key: 'R' });
    await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1));
  });

  it('is ignored while typing in a text field', () => {
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'r' });
    expect(session.start).not.toHaveBeenCalled();
  });

  it('does nothing while a take is starting', () => {
    act(() => recording.setState({ status: 'starting' }));
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(session.start).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
  });
});

describe('mic mute', () => {
  it('is unavailable when neither recording nor checking the input', () => {
    expect(muteButton().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(session.setMuted).not.toHaveBeenCalled();
    expect(monitor.setMuted).not.toHaveBeenCalled();
  });

  it('mutes the take with the button and with M, and the muted state is plain to see', () => {
    act(() => recording.setState({ status: 'recording' }));
    expect(muteButton().disabled).toBe(false);
    expect(muteButton().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(muteButton());
    expect(session.setMuted).toHaveBeenLastCalledWith(true);
    expect(muteButton().getAttribute('aria-pressed')).toBe('true');
    expect(muteButton().textContent).toMatch(/muted/i);
    expect(muteButton().className).toMatch(/muted/);
    fireEvent.keyDown(document.body, { key: 'M' });
    expect(session.setMuted).toHaveBeenLastCalledWith(false);
    expect(muteButton().textContent).not.toMatch(/muted/i);
  });

  it('works during an input check too', () => {
    act(() => levels.setState({ monitoring: true }));
    expect(muteButton().disabled).toBe(false);
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(monitor.setMuted).toHaveBeenCalledWith(true);
    expect(session.setMuted).not.toHaveBeenCalled();
    expect(muteButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('M is ignored while typing', () => {
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'm' });
    expect(session.setMuted).not.toHaveBeenCalled();
  });

  it('tooltips name the shortcuts', () => {
    expect(recordButton().title).toMatch(/\(R\)/);
    expect(muteButton().title).toMatch(/\(M\)/);
  });
});

describe('pause', () => {
  it('P pauses a running take and resumes a paused one', async () => {
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(session.pause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'P' });
    await waitFor(() => expect(session.resume).toHaveBeenCalledTimes(1));
  });

  it('P does nothing when no take is open or while typing', () => {
    fireEvent.keyDown(document.body, { key: 'p' });
    act(() => recording.setState({ status: 'recording' }));
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'p' });
    expect(session.pause).not.toHaveBeenCalled();
    expect(session.resume).not.toHaveBeenCalled();
  });

  it('while paused the take can still be finished and the mic muted', async () => {
    act(() => recording.setState({ status: 'paused', startSec: 10 }));
    const stop = await screen.findByRole('button', { name: /stop recording/i });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    expect(muteButton().disabled).toBe(false);
    await userEvent.click(stop);
    expect(session.stop).toHaveBeenCalledTimes(1);
  });
});
