import type { Draft } from '../draftStore';

/** Undo steps kept; older edits fall off. */
export const MAX_HISTORY = 30;

/** One edit as the drafts before and after it. Blobs are immutable, so holding them is cheap. */
export interface EditEntry {
  label: string;
  before: Draft[];
  after: Draft[];
}

/**
 * Undo and redo for edits to local drafts, for this page visit only: it is not saved, so a reload
 * keeps the edited takes but forgets how to step back.
 */
export class EditHistory {
  private done: EditEntry[] = [];
  private undone: EditEntry[] = [];
  private listeners = new Set<() => void>();

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  push(entry: EditEntry): void {
    this.done.push(entry);
    if (this.done.length > MAX_HISTORY) this.done.shift();
    this.undone = [];
    this.notify();
  }

  /** The edit to reverse, or null. The caller restores `before`. */
  undo(): EditEntry | null {
    const entry = this.done.pop();
    if (!entry) return null;
    this.undone.push(entry);
    this.notify();
    return entry;
  }

  /** The edit to apply again, or null. The caller restores `after`. */
  redo(): EditEntry | null {
    const entry = this.undone.pop();
    if (!entry) return null;
    this.done.push(entry);
    this.notify();
    return entry;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.notify();
  }

  /** A draft was discarded for good: edits that involve it can no longer be stepped through. */
  forget(draftId: string): void {
    const keep = (e: EditEntry) => ![...e.before, ...e.after].some((d) => d.id === draftId);
    this.done = this.done.filter(keep);
    this.undone = this.undone.filter(keep);
    this.notify();
  }
}

/** The page's one history: the edit bar, the editor and discarding a take share it. */
export const editHistory = new EditHistory();
