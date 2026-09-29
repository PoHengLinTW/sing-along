import { DraftStore } from './draftStore';

let storePromise: Promise<DraftStore> | null = null;

/** The one IndexedDB draft store for the page, opened on first use. */
export function getDraftStore(): Promise<DraftStore> {
  storePromise ??= DraftStore.open();
  return storePromise;
}

/** Test hook: forget the opened store so the next call opens a fresh database. */
export function resetDraftStoreForTests(): void {
  storePromise = null;
}
