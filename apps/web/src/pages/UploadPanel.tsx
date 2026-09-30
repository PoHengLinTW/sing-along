import { type Caps, DEFAULT_CAPS } from '@sing-along/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { putWithProgress } from '../api/put';
import { type UploadDeps, uploadTrack } from '../api/upload';
import { getAudioController } from '../audio/controller';
import { defaultTrackName, resolveAudioMime } from '../lib/audioFile';
import { fileCapMessage } from '../lib/caps';
import { LabelsLoadError } from '../lib/LabelsLoadError';
import { useLabels } from '../lib/useLabels';
import { LabelPicker } from '../ui/LabelPicker';

const PERFORMER_KEY = 'sing-along:performer';
const ACCEPT = '.mp3,.m4a,.aac,.wav,.ogg,.opus,.webm,.flac,audio/*';

export const browserUploadDeps: UploadDeps = {
  decode: async (data) => {
    const buffer = await getAudioController().engine.decode(data);
    return {
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
    };
  },
  apiFetch,
  put: putWithProgress,
};

type Status = 'ready' | 'queued' | 'uploading' | 'error';
interface Item {
  key: number;
  file: File;
  name: string;
  performer: string;
  labelIds: number[];
  status: Status;
  progress: number;
  error?: string;
}

function readPerformer(): string {
  try {
    return localStorage.getItem(PERFORMER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function UploadPanel({
  projectId,
  deps = browserUploadDeps,
  trackCount = 0,
  caps = DEFAULT_CAPS,
}: {
  projectId: number;
  deps?: UploadDeps;
  /** Tracks already in the project; drafts don't count. */
  trackCount?: number;
  caps?: Caps;
}) {
  const atLimit = trackCount >= caps.maxTracksPerProject;
  const limitMessage = `Track limit reached (${caps.maxTracksPerProject}).`;
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const aborts = useRef(new Map<number, AbortController>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const nextKey = useRef(1);

  const { labels, create: createLabel, isError: labelsFailed, retry: retryLabels } = useLabels();

  const update = (key: number, patch: Partial<Item>) => {
    itemsRef.current = itemsRef.current.map((i) => (i.key === key ? { ...i, ...patch } : i));
    setItems(itemsRef.current);
  };
  const remove = (key: number) => {
    itemsRef.current = itemsRef.current.filter((i) => i.key !== key);
    setItems(itemsRef.current);
  };

  const addFiles = (files: File[]) => {
    if (atLimit) return;
    const bad: string[] = [];
    const added: Item[] = [];
    for (const file of files) {
      if (!resolveAudioMime(file)) {
        bad.push(`${file.name}: Unsupported format.`);
        continue;
      }
      const tooBig = fileCapMessage(file, caps);
      if (tooBig) {
        bad.push(`${file.name}: ${tooBig}`);
        continue;
      }
      added.push({
        key: nextKey.current++,
        file,
        name: defaultTrackName(file.name),
        performer: readPerformer(),
        labelIds: [],
        status: 'ready',
        progress: 0,
      });
    }
    setRejected(bad);
    itemsRef.current = [...itemsRef.current, ...added];
    setItems(itemsRef.current);
  };

  const run = async (key: number) => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (item?.status !== 'queued') return; // removed or cancelled while waiting
    const ctl = new AbortController();
    aborts.current.set(key, ctl);
    update(key, { status: 'uploading', progress: 0, error: undefined });
    try {
      localStorage.setItem(PERFORMER_KEY, item.performer);
    } catch {
      /* storage unavailable */
    }
    try {
      await uploadTrack(deps, {
        projectId,
        file: item.file,
        form: { name: item.name, performer: item.performer, labelIds: item.labelIds },
        onProgress: (f) => update(key, { progress: f }),
        signal: ctl.signal,
        caps,
      });
      remove(key);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['project', String(projectId)] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    } catch (err) {
      const cancelled = (err as Error).name === 'AbortError';
      update(key, {
        status: 'error',
        error: cancelled ? 'Upload cancelled.' : (err as Error).message,
      });
    } finally {
      aborts.current.delete(key);
    }
  };

  /** One upload at a time: each starts when the previous one settles. */
  const enqueue = (keys: number[]) => {
    for (const key of keys) {
      update(key, { status: 'queued', error: undefined });
      chain.current = chain.current.then(() => run(key));
    }
  };

  const ready = items.filter((i) => i.status === 'ready');

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target; the file input is the accessible path
    <section
      id="upload-tracks"
      className="upload-panel"
      data-testid="drop-zone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <label title={atLimit ? limitMessage : undefined}>
        Add audio files
        <input
          type="file"
          accept={ACCEPT}
          multiple
          disabled={atLimit}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = ''; // allow choosing the same file again
          }}
        />
      </label>
      {atLimit && <p className="hint">{limitMessage}</p>}
      <p className="hint">…or drop files here (mp3, m4a/aac, wav, ogg, webm/opus, flac)</p>

      {rejected.length > 0 && (
        <ul className="field-error">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {ready.length > 1 && (
        <button type="button" onClick={() => enqueue(ready.map((i) => i.key))}>
          Upload all
        </button>
      )}

      <ul className="upload-items">
        {items.map((item) => {
          const idle = item.status === 'ready' || item.status === 'error';
          return (
            <li key={item.key}>
              <strong>{item.file.name}</strong>
              <label>
                Name
                <input
                  value={item.name}
                  disabled={!idle}
                  onChange={(e) => update(item.key, { name: e.target.value })}
                />
              </label>
              <label>
                Performer
                <input
                  value={item.performer}
                  disabled={!idle}
                  onChange={(e) => update(item.key, { performer: e.target.value })}
                />
              </label>
              <fieldset disabled={!idle}>
                <legend>Labels</legend>
                {labelsFailed && <LabelsLoadError onRetry={retryLabels} />}
                <LabelPicker
                  labels={labels}
                  selectedIds={item.labelIds}
                  onChange={(ids) => update(item.key, { labelIds: ids })}
                  onCreate={createLabel}
                />
              </fieldset>
              {item.status === 'uploading' && (
                <p>
                  <progress value={item.progress} max={1} />{' '}
                  <span>{Math.round(item.progress * 100)}%</span>{' '}
                  <button type="button" onClick={() => aborts.current.get(item.key)?.abort()}>
                    Cancel upload
                  </button>
                </p>
              )}
              {item.status === 'queued' && <p>Waiting…</p>}
              {item.error && <p className="field-error">{item.error}</p>}
              {idle && (
                <div className="dialog-actions">
                  <button type="button" onClick={() => remove(item.key)}>
                    Remove
                  </button>
                  <button
                    type="button"
                    disabled={item.name.trim() === '' || atLimit}
                    title={atLimit ? limitMessage : undefined}
                    onClick={() => enqueue([item.key])}
                  >
                    Upload
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
