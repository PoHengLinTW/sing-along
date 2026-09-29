import { describe, expect, it } from 'vitest';
import { moveBefore, moveByOffset } from './reorder';

describe('moveBefore', () => {
  it('moves an item to the position of the target (dragging down)', () => {
    expect(moveBefore([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
  });
  it('moves an item to the position of the target (dragging up)', () => {
    expect(moveBefore([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
  });
  it('returns the same order when dropped on itself or on unknown ids', () => {
    expect(moveBefore([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
    expect(moveBefore([1, 2, 3], 9, 2)).toEqual([1, 2, 3]);
  });
});

describe('moveByOffset', () => {
  it('moves one step and stops at the ends', () => {
    expect(moveByOffset([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveByOffset([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveByOffset([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveByOffset([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
  });
});
