import { describe, expect, it } from 'vitest';
import { createSelectionStore } from './selection';

describe('selection store', () => {
  it('toggles takes in and out, keeping the order they were picked', () => {
    const s = createSelectionStore();
    s.getState().toggle('a');
    s.getState().toggle('b');
    expect(s.getState().ids).toEqual(['a', 'b']);
    s.getState().toggle('a');
    expect(s.getState().ids).toEqual(['b']);
  });
  it('clears', () => {
    const s = createSelectionStore();
    s.getState().toggle('a');
    s.getState().clear();
    expect(s.getState().ids).toEqual([]);
  });
  it('drops takes that no longer exist and keeps the others', () => {
    const s = createSelectionStore();
    for (const id of ['a', 'b', 'c']) s.getState().toggle(id);
    s.getState().prune(['a', 'c', 'z']);
    expect(s.getState().ids).toEqual(['a', 'c']);
  });
  it('prune does not notify when nothing changed', () => {
    const s = createSelectionStore();
    s.getState().toggle('a');
    let n = 0;
    s.subscribe(() => n++);
    s.getState().prune(['a']);
    expect(n).toBe(0);
  });
});
