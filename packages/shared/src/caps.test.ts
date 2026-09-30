import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS, formatBytes } from './index';

describe('formatBytes', () => {
  it.each([
    [DEFAULT_CAPS.maxFileBytes, '60 MB'],
    [DEFAULT_CAPS.maxStorageBytes, '8 GB'],
    [5.2 * 1024 ** 3, '5.2 GB'],
    [1024 * 1024 * 1.5, '1.5 MB'],
    [0, '0 KB'],
    [500, '1 KB'],
    [200 * 1024, '200 KB'],
  ])('%s -> %s', (n, out) => expect(formatBytes(n)).toBe(out));
});
