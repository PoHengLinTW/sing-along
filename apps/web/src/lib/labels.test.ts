import type { LabelDto, TrackDto } from '@sing-along/shared';
import { describe, expect, it } from 'vitest';
import {
  canCreateLabel,
  filterByLabels,
  labelsInProject,
  matchLabels,
  tracksWithLabel,
  waveformColor,
} from './labels';

const label = (id: number, name: string, color = '#111111'): LabelDto => ({
  id,
  name,
  color,
  isPreset: false,
});
const alto = label(1, 'Alto', '#f97316');
const bass = label(2, 'Bass', '#22c55e');
const kazoo = label(3, 'Kazoo', '#0ea5e9');
const track = (id: number, labels: LabelDto[]) => ({ id, labels }) as unknown as TrackDto;

describe('matchLabels (type-ahead)', () => {
  const all = [alto, bass, kazoo];
  it('returns everything for an empty query', () => {
    expect(matchLabels(all, '')).toEqual(all);
    expect(matchLabels(all, '   ')).toEqual(all);
  });
  it('matches case-insensitively anywhere in the name', () => {
    expect(matchLabels(all, 'a').map((l) => l.name)).toEqual(['Alto', 'Bass', 'Kazoo']);
    expect(matchLabels(all, 'KAZ').map((l) => l.name)).toEqual(['Kazoo']);
    expect(matchLabels(all, 'zzz')).toEqual([]);
  });
  it('puts names that start with the query first', () => {
    expect(matchLabels([bass, alto], 'a').map((l) => l.name)).toEqual(['Alto', 'Bass']);
  });
});

describe('canCreateLabel', () => {
  it('offers Create for a new, non-empty name of at most 30 characters', () => {
    expect(canCreateLabel('Ukulele', [alto])).toBe(true);
  });
  it('does not offer it for an existing name (case-insensitive) or a blank one', () => {
    expect(canCreateLabel('alto', [alto])).toBe(false);
    expect(canCreateLabel('  ALTO ', [alto])).toBe(false);
    expect(canCreateLabel('   ', [alto])).toBe(false);
  });
  it('does not offer it over 30 characters', () => {
    expect(canCreateLabel('a'.repeat(31), [])).toBe(false);
    expect(canCreateLabel('a'.repeat(30), [])).toBe(true);
  });
});

describe('labelsInProject', () => {
  it('lists each label once, in order of first appearance', () => {
    expect(
      labelsInProject([track(1, [bass, alto]), track(2, [alto, kazoo])]).map((l) => l.name),
    ).toEqual(['Bass', 'Alto', 'Kazoo']);
  });
  it('is empty when no track has labels', () => {
    expect(labelsInProject([track(1, [])])).toEqual([]);
  });
});

describe('filterByLabels', () => {
  const tracks = [track(1, [alto]), track(2, [bass]), track(3, [alto, bass]), track(4, [])];
  it('shows everything without a filter', () => {
    expect(filterByLabels(tracks, []).map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });
  it('shows tracks that have at least one chosen label', () => {
    expect(filterByLabels(tracks, [1]).map((t) => t.id)).toEqual([1, 3]);
    expect(filterByLabels(tracks, [1, 2]).map((t) => t.id)).toEqual([1, 2, 3]);
  });
  it('hides unlabeled tracks while a filter is active', () => {
    expect(filterByLabels(tracks, [2]).map((t) => t.id)).not.toContain(4);
  });
});

describe('tracksWithLabel', () => {
  it('returns the ids of tracks that carry the label', () => {
    expect(tracksWithLabel([track(1, [alto]), track(2, [bass]), track(3, [alto])], 1)).toEqual([
      1, 3,
    ]);
  });
});

describe('waveformColor', () => {
  it('is the first label color, else neutral', () => {
    expect(waveformColor(track(1, [bass, alto]))).toBe('#22c55e');
    expect(waveformColor(track(1, []))).toBe('#94a3b8');
  });
});
