import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './time';

const now = new Date('2026-06-15T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe('formatRelativeTime', () => {
  it('says "just now" under a minute', () => {
    expect(formatRelativeTime(ago(20 * S), now)).toBe('just now');
    expect(formatRelativeTime(new Date(now.getTime() + 5 * S).toISOString(), now)).toBe('just now'); // clock skew
  });
  it('uses minutes, hours and days', () => {
    expect(formatRelativeTime(ago(5 * M), now)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(1 * M), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(3 * H), now)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(2 * D), now)).toBe('2 days ago');
  });
  it('switches to a date after 30 days', () => {
    expect(formatRelativeTime(ago(45 * D), now)).toMatch(/May|Apr/);
  });
});
