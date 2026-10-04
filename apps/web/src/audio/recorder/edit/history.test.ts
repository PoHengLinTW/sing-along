import { describe, expect, it } from 'vitest';
import type { Draft } from '../draftStore';
import { type EditEntry, EditHistory, MAX_HISTORY } from './history';

const d = (id: string): Draft => ({
  id,
  projectId: 1,
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  sampleRate: 48000,
  createdAt: 1,
  status: 'ready',
  name: id,
  performer: '',
});
const entry = (label: string, before: string[], after: string[]): EditEntry => ({
  label,
  before: before.map(d),
  after: after.map(d),
});

describe('EditHistory', () => {
  it('starts empty: nothing to undo or redo', () => {
    const h = new EditHistory();
    expect([h.canUndo, h.canRedo, h.undoLabel, h.redoLabel]).toEqual([false, false, null, null]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('undo returns the last edit, redo returns it again', () => {
    const h = new EditHistory();
    const split = entry('Split', ['a'], ['a1', 'a2']);
    h.push(split);
    expect(h.undoLabel).toBe('Split');
    expect(h.undo()).toBe(split);
    expect([h.canUndo, h.canRedo, h.redoLabel]).toEqual([false, true, 'Split']);
    expect(h.redo()).toBe(split);
    expect([h.canUndo, h.canRedo]).toEqual([true, false]);
  });

  it('undoes in reverse order', () => {
    const h = new EditHistory();
    const one = entry('One', ['a'], ['b']);
    const two = entry('Two', ['b'], ['c']);
    h.push(one);
    h.push(two);
    expect(h.undo()).toBe(two);
    expect(h.undo()).toBe(one);
    expect(h.undo()).toBeNull();
  });

  it('a new edit after an undo discards what could have been redone', () => {
    const h = new EditHistory();
    h.push(entry('One', ['a'], ['b']));
    h.undo();
    h.push(entry('Two', ['a'], ['c']));
    expect(h.canRedo).toBe(false);
  });

  it('keeps only the most recent edits', () => {
    const h = new EditHistory();
    for (let i = 0; i < MAX_HISTORY + 5; i++) h.push(entry(`E${i}`, ['a'], ['b']));
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(MAX_HISTORY);
  });

  it('tells subscribers about every change', () => {
    const h = new EditHistory();
    let calls = 0;
    const off = h.subscribe(() => calls++);
    h.push(entry('One', ['a'], ['b']));
    h.undo();
    h.redo();
    h.clear();
    expect(calls).toBe(4);
    off();
    h.push(entry('Two', ['a'], ['b']));
    expect(calls).toBe(4);
  });

  it('forgets edits that mention a draft that was discarded', () => {
    const h = new EditHistory();
    h.push(entry('One', ['a'], ['b']));
    h.push(entry('Two', ['x'], ['y']));
    h.forget('b');
    expect(h.undo()?.label).toBe('Two');
    expect(h.undo()).toBeNull();
  });
});
