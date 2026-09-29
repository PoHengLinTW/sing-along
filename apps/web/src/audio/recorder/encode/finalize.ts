import type { Draft, DraftStore } from '../draftStore';
import type { EncodedTake, EncodeInput } from './encode';

export type EncodeFn = (
  input: EncodeInput,
  onProgress?: (fraction: number) => void,
) => Promise<EncodedTake>;

/**
 * Turns a draft's raw chunks into one encoded file saved on the draft. The file is saved first and
 * the chunks are deleted only afterwards, so a failure at any point leaves the take recoverable.
 */
export async function finalizeDraft(
  store: DraftStore,
  draftId: string,
  encode: EncodeFn,
  onProgress?: (fraction: number) => void,
): Promise<{ draft: Draft; fellBack: boolean }> {
  const draft = await store.getDraft(draftId);
  if (!draft) throw new Error(`draft ${draftId} not found`);
  if (draft.status === 'ready') return { draft, fellBack: false };

  const { samples } = await store.loadSamples(draftId);
  const encoded = await encode(
    { samples, sampleRate: draft.sampleRate, trimSamples: draft.trimSamples ?? 0 },
    onProgress,
  );
  const ready = await store.updateDraft(draftId, {
    status: 'ready',
    blob: new Blob([encoded.bytes as BlobPart], { type: encoded.mimeType }),
    mimeType: encoded.mimeType,
    peaks: encoded.peaks,
    durationMs: encoded.durationMs,
  });
  await store.deleteChunks(draftId);
  return { draft: ready, fellBack: encoded.fellBack };
}
