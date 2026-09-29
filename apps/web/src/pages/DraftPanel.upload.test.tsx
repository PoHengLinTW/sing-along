import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftView } from '../audio/recorder/draftView';
import { DraftPanel } from './DraftPanel';

const draft: DraftView = {
  id: 'd1',
  projectId: 1,
  mimeType: 'audio/flac',
  engineId: -3,
  name: 'Take 1',
  performer: 'Ann',
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 2000,
  peaks: [0.5],
  labelIds: [],
  blob: new Blob([new Uint8Array(1)]),
};

let finish: () => void;
let fail: (e: Error) => void;
let onUpload: ReturnType<typeof vi.fn<(d: DraftView, p: (f: number) => void) => Promise<void>>>;
let report: (f: number) => void;

beforeEach(() => {
  onUpload = vi.fn((_d, onProgress) => {
    report = onProgress;
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  render(<DraftPanel draft={draft} onUpload={onUpload} />);
});

const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('DraftPanel upload', () => {
  it('offers an Upload button that starts the upload of this take', () => {
    fireEvent.click(button(/upload take 1/i));
    expect(onUpload).toHaveBeenCalledWith(draft, expect.any(Function));
  });

  it('shows progress and blocks a second click while uploading', async () => {
    fireEvent.click(button(/upload take 1/i));
    act(() => report(0.4));
    const bar = (await screen.findByRole('progressbar', {
      name: /uploading take 1/i,
    })) as HTMLProgressElement;
    expect(bar.value).toBeCloseTo(0.4);
    expect(button(/upload take 1/i).disabled).toBe(true);
    fireEvent.click(button(/upload take 1/i));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('on failure keeps the take, says why, and offers Retry which uploads again', async () => {
    fireEvent.click(button(/upload take 1/i));
    await act(async () => fail(new Error("Can't reach storage.")));
    expect((await screen.findByRole('alert')).textContent).toMatch(/can't reach storage/i);
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(button(/retry/i));
    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is idle again after success (the parent removes the draft)', async () => {
    fireEvent.click(button(/upload take 1/i));
    await act(async () => finish());
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cannot be discarded while it uploads', () => {
    fireEvent.click(button(/upload take 1/i));
    expect(button(/discard take 1/i).disabled).toBe(true);
  });
});
