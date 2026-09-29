import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui/toast';
import { saveMicDevice } from './mic';
import { RecordButton } from './RecordButton';
import { createRecordingStore } from './recordingStore';

let recording: ReturnType<typeof createRecordingStore>;
const session = {
  start: vi.fn(async () => {
    recording.setState({ status: 'recording' });
  }),
  stop: vi.fn(async () => {
    recording.setState({ status: 'idle' });
    return {} as never;
  }),
};

const ui = () => (
  <ToastProvider>
    <RecordButton projectId={7} session={session as never} recording={recording} />
  </ToastProvider>
);

beforeEach(() => {
  recording = createRecordingStore();
  session.start.mockClear();
  session.stop.mockClear();
});

describe('RecordButton', () => {
  it('starts a take for this project on the saved input device', async () => {
    saveMicDevice('usb-1');
    localStorage.setItem('sing-along:performer', 'Ann');
    render(ui());
    await userEvent.click(screen.getByRole('button', { name: /record/i }));
    expect(session.start).toHaveBeenCalledWith({
      projectId: 7,
      deviceId: 'usb-1',
      performer: 'Ann',
    });
  });

  it('turns into Stop while recording, and stops the take', async () => {
    render(ui());
    await userEvent.click(screen.getByRole('button', { name: /record/i }));
    const stop = await screen.findByRole('button', { name: /stop/i });
    await userEvent.click(stop);
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /record/i })).toBeTruthy();
  });

  it('explains a mic failure with the shared message and stays idle', async () => {
    session.start.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    render(ui());
    await userEvent.click(screen.getByRole('button', { name: /record/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/allow.*settings/i);
    expect(screen.getByRole('button', { name: /record/i })).toBeTruthy();
  });

  it('is disabled while the take is starting or stopping', async () => {
    render(ui());
    act(() => recording.setState({ status: 'starting' }));
    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true),
    );
    act(() => recording.setState({ status: 'stopping' }));
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
