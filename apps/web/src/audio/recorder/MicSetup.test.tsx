import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MicSetup } from './MicSetup';
import { loadMicDevice, shouldShowHeadphoneHint } from './mic';

const dev = (deviceId: string, label: string) =>
  ({ deviceId, label, kind: 'audioinput', groupId: '' }) as MediaDeviceInfo;

const named = (name: string) => Object.assign(new Error(name), { name });

function fakeMedia(opts: { before?: MediaDeviceInfo[]; after?: MediaDeviceInfo[]; error?: Error }) {
  let granted = false;
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return {
    stop,
    md: {
      enumerateDevices: vi.fn(async () => (granted ? (opts.after ?? []) : (opts.before ?? []))),
      getUserMedia: vi.fn(async () => {
        if (opts.error) throw opts.error;
        granted = true;
        return stream;
      }),
    },
  };
}

describe('MicSetup', () => {
  it('asks for permission, then lists the inputs with their labels', async () => {
    const { md, stop } = fakeMedia({
      before: [dev('a', '')],
      after: [dev('a', 'Built-in'), dev('b', 'USB Mic')],
    });
    render(<MicSetup mediaDevices={md} />);
    await userEvent.click(await screen.findByRole('button', { name: /enable microphone/i }));

    await screen.findByRole('combobox', { name: /input/i });
    expect(await screen.findByRole('option', { name: 'USB Mic' })).toBeTruthy();
    expect(stop).toHaveBeenCalled(); // permission probe only: the stream is not kept open
  });

  it('remembers the chosen input', async () => {
    const { md } = fakeMedia({ after: [dev('a', 'Built-in'), dev('b', 'USB Mic')] });
    render(<MicSetup mediaDevices={md} />);
    await userEvent.click(await screen.findByRole('button', { name: /enable microphone/i }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /input/i }), 'b');
    expect(loadMicDevice()).toBe('b');
  });

  it('explains how to allow the mic when permission is denied', async () => {
    const { md } = fakeMedia({ error: named('NotAllowedError') });
    render(<MicSetup mediaDevices={md} />);
    await userEvent.click(await screen.findByRole('button', { name: /enable microphone/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/allow.*settings/i);
  });

  it('says so when there is no microphone', async () => {
    const { md } = fakeMedia({ error: named('NotFoundError') });
    render(<MicSetup mediaDevices={md} />);
    await userEvent.click(await screen.findByRole('button', { name: /enable microphone/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/no microphone/i);
  });

  it('reports a browser without getUserMedia', async () => {
    render(<MicSetup mediaDevices={undefined} />);
    // A note, not an alert: it is on the page for everyone, whether or not they mean to record.
    expect(screen.getByText(/not available/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the headphone hint until "Don\'t show again" is pressed', async () => {
    const { md } = fakeMedia({});
    const { unmount } = render(<MicSetup mediaDevices={md} />);
    expect(screen.getByText(/use headphones/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /don.t show again/i }));
    await waitFor(() => expect(screen.queryByText(/use headphones/i)).toBeNull());
    expect(shouldShowHeadphoneHint()).toBe(false);
    unmount();
    render(<MicSetup mediaDevices={md} />);
    expect(screen.queryByText(/use headphones/i)).toBeNull();
  });
});
