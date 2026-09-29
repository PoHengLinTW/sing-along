import { DraftStore } from './draftStore';

let storePromise: Promise<DraftStore> | null = null;

/** The one IndexedDB draft store for the page, opened on first use. */
export function getDraftStore(): Promise<DraftStore> {
  storePromise ??= DraftStore.open();
  return storePromise;
}
