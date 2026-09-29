import { DEFAULT_CAPS } from '@sing-along/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadDeps } from '../api/upload';
import { ToastProvider } from '../ui/toast';
import { UploadPanel } from './UploadPanel';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const labels = [
  { id: 1, name: 'Alto', color: '#f97316', isPreset: true },
  { id: 2, name: 'Bass', color: '#22c55e', isPreset: true },
];

let client: QueryClient;
let puts: {
  url: string;
  onProgress: (f: number) => void;
  resolve: () => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  name: string;
}[];
let apiCalls: string[];

function makeDeps(): UploadDeps {
  return {
    decode: async () => ({
      durationSec: 2,
      sampleRate: 100,
      channels: [new Float32Array(200).fill(0.5)],
    }),
    apiFetch: (async (path: string) => {
      apiCalls.push(path);
      if (path.endsWith('/upload-url'))
        return {
          trackId: apiCalls.length,
          uploadUrl: `https://s3/${apiCalls.length}`,
          headers: { 'Content-Type': 'audio/flac' },
          expiresAt: '',
        };
      return { id: 1 };
    }) as UploadDeps['apiFetch'],
    put: (url, file, _h, onProgress, signal) =>
      new Promise<void>((resolve, reject) => {
        puts.push({ url, onProgress, resolve, reject, signal, name: (file as File).name });
        signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
      }),
  };
}

function setup(props: { trackCount?: number; caps?: typeof DEFAULT_CAPS } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(200, labels)),
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UploadPanel projectId={5} deps={makeDeps()} {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { invalidate };
}
const flac = (name = 'take.flac') => new File([new Uint8Array(50)], name, { type: 'audio/flac' });
const chooser = () => screen.getByLabelText(/add audio files/i) as HTMLInputElement;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  puts = [];
  apiCalls = [];
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('UploadPanel', () => {
  it('rejects unsupported files before upload with "Unsupported format."', async () => {
    setup();
    await userEvent.upload(chooser(), new File(['x'], 'notes.txt', { type: 'text/plain' }), {
      applyAccept: false,
    });
    expect(await screen.findByText(/notes\.txt: Unsupported format\./)).toBeTruthy();
    expect(apiCalls).toEqual([]);
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('shows a form per file: name defaults to the file name, performer to the remembered one', async () => {
    localStorage.setItem('sing-along:performer', 'Sam');
    setup();
    await userEvent.upload(chooser(), flac('Lead vocal.flac'));
    expect((await screen.findByLabelText('Name')) as HTMLInputElement).toHaveProperty(
      'value',
      'Lead vocal',
    );
    expect((screen.getByLabelText('Performer') as HTMLInputElement).value).toBe('Sam');
  });

  it('uploads with the chosen name, performer and labels, shows a percentage, then refreshes the project', async () => {
    const { invalidate } = setup();
    await userEvent.upload(chooser(), flac());
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Alto line');
    await userEvent.clear(screen.getByLabelText('Performer'));
    await userEvent.type(screen.getByLabelText('Performer'), 'Robin');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    puts[0]?.onProgress(0.42);
    expect(await screen.findByText('42%')).toBeTruthy();
    puts[0]?.resolve();
    await waitFor(() => expect(apiCalls.at(-1)).toMatch(/\/confirm$/));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', '5'] }));
    expect(localStorage.getItem('sing-along:performer')).toBe('Robin');
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull()); // finished items leave the queue
  });

  it('cancelling aborts the PUT and does not confirm', async () => {
    setup();
    await userEvent.upload(chooser(), flac());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(puts[0]?.signal?.aborted).toBe(true);
    await tick();
    expect(apiCalls.some((c) => c.endsWith('/confirm'))).toBe(false);
    expect(await screen.findByText(/cancelled/i)).toBeTruthy();
  });

  it('several files upload one after another', async () => {
    setup();
    await userEvent.upload(chooser(), [flac('a.flac'), flac('b.flac')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload all' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.name).toBe('a.flac');
    await tick();
    expect(puts).toHaveLength(1); // b has not started while a is uploading
    puts[0]?.resolve();
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]?.name).toBe('b.flac');
  });

  it('accepts files dropped on the drop zone', async () => {
    setup();
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [flac('dropped.flac')] },
    });
    expect((await screen.findByLabelText('Name')) as HTMLInputElement).toHaveProperty(
      'value',
      'dropped',
    );
  });

  it('shows an upload error and keeps the item so it can be retried', async () => {
    setup();
    await userEvent.upload(chooser(), flac());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    puts[0]?.reject(new Error('Upload failed (403)'));
    const item = (await screen.findByText(/Upload failed \(403\)/)).closest('li') as HTMLElement;
    expect(within(item).getByRole('button', { name: 'Upload' })).toBeTruthy();
  });
});

describe('UploadPanel caps (M3-03)', () => {
  const sized = (name: string, size: number, type: string) => {
    const f = new File([new Uint8Array(1)], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('rejects a file over 60 MB on the client, naming the limit, without any API call', async () => {
    setup();
    await userEvent.upload(chooser(), sized('huge.flac', 61 * 1024 * 1024, 'audio/flac'));
    expect(await screen.findByText(/huge\.flac: Too large \(limit 60 MB\)\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(apiCalls).toEqual([]);
  });

  it('gives WAV files the convert hint', async () => {
    setup();
    await userEvent.upload(chooser(), sized('take.wav', 61 * 1024 * 1024, 'audio/wav'));
    expect(await screen.findByText(/Convert to FLAC or MP3/)).toBeTruthy();
  });

  it('shows the too-long message when the decoded audio exceeds 10 minutes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, labels)),
    );
    const deps = makeDeps();
    deps.decode = async () => ({
      durationSec: 601,
      sampleRate: 1,
      channels: [new Float32Array(1)],
    });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <UploadPanel projectId={5} deps={deps} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.upload(chooser(), flac());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Too long (limit 10 minutes).')).toBeTruthy();
    expect(apiCalls).toEqual([]);
  });

  it('disables choosing files at the track limit, with an explanation', async () => {
    setup({ trackCount: 10 });
    expect(chooser().disabled).toBe(true);
    expect(chooser().closest('label')?.getAttribute('title')).toBe('Track limit reached (10).');
    expect(screen.getByText('Track limit reached (10).')).toBeTruthy();
  });

  it('stays enabled at 9 tracks', () => {
    setup({ trackCount: 9 });
    expect(chooser().disabled).toBe(false);
    expect(screen.queryByText('Track limit reached (10).')).toBeNull();
  });

  it('ignores dropped files at the limit', () => {
    setup({ trackCount: 10 });
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [flac()] } });
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });

  it('uses the live limit from the server', () => {
    setup({ trackCount: 4, caps: { ...DEFAULT_CAPS, maxTracksPerProject: 4 } });
    expect(chooser().disabled).toBe(true);
    expect(screen.getByText('Track limit reached (4).')).toBeTruthy();
  });
});

describe('UploadPanel: labels fetch failure (M3-05)', () => {
  it('shows a Retry when the labels cannot be loaded, and loads them on retry', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (++n === 1 ? json(500, { message: 'x' }) : json(200, labels))),
    );
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <UploadPanel projectId={5} deps={makeDeps()} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.upload(chooser(), flac());
    expect(await screen.findByText(/couldn't load labels/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Alto')).toBeTruthy();
    expect(screen.queryByText(/couldn't load labels/i)).toBeNull();
  });
});
