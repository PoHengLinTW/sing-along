import type { TrackDto } from '@sing-along/shared';
import { describe, expect, it } from 'vitest';
import { hiddenTrackIds, withoutCheckedOut } from './checkedOut';

describe('hiddenTrackIds', () => {
  it('is empty without takes, or for takes that are not tied to a saved track', () => {
    expect(hiddenTrackIds([])).toEqual(new Set());
    expect(hiddenTrackIds([{}, { deletesTrackIds: [] }])).toEqual(new Set());
  });
  it('holds the track a take overwrites and the tracks combined into it', () => {
    expect(
      hiddenTrackIds([{ replacesTrackId: 1 }, { deletesTrackIds: [4, 5] }, { replacesTrackId: 1 }]),
    ).toEqual(new Set([1, 4, 5]));
  });
});

describe('withoutCheckedOut', () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }] as TrackDto[];
  it('keeps the very same list when nothing is checked out (no needless re-render)', () => {
    expect(withoutCheckedOut(tracks, new Set())).toBe(tracks);
    expect(withoutCheckedOut(tracks, new Set([99]))).toBe(tracks);
  });
  it('drops the hidden tracks and keeps the order of the rest', () => {
    expect(withoutCheckedOut(tracks, new Set([2])).map((t) => t.id)).toEqual([1, 3]);
  });
});
