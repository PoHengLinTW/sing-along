import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StorageMeter, storageLevel } from './StorageMeter';

const GB = 1024 ** 3;
const usage = (usedBytes: number) => ({
  usedBytes,
  limitBytes: 8 * GB,
  projectCount: 1,
  projectLimit: 100,
  maxFileBytes: 60 * 1024 * 1024,
  maxTrackMs: 600_000,
  maxTracksPerProject: 10,
});

describe('storageLevel', () => {
  it.each([
    [0, 'ok'],
    [0.79, 'ok'],
    [0.8, 'warn'],
    [0.94, 'warn'],
    [0.95, 'full'],
    [1, 'full'],
  ])('%s of the budget is %s', (fraction, level) => {
    expect(storageLevel(fraction * 8 * GB, 8 * GB)).toBe(level);
  });
});

describe('StorageMeter', () => {
  it('shows used and limit', () => {
    render(<StorageMeter usage={usage(5.2 * GB)} />);
    expect(screen.getByText('5.2 / 8 GB used')).toBeTruthy();
  });
  it('marks the bar amber at 80% and red at 95%', () => {
    const { rerender } = render(<StorageMeter usage={usage(1 * GB)} />);
    expect(screen.getByRole('progressbar').getAttribute('data-level')).toBe('ok');
    rerender(<StorageMeter usage={usage(6.4 * GB)} />);
    expect(screen.getByRole('progressbar').getAttribute('data-level')).toBe('warn');
    rerender(<StorageMeter usage={usage(7.7 * GB)} />);
    expect(screen.getByRole('progressbar').getAttribute('data-level')).toBe('full');
  });
  it('shows 0 as "0 / 8 GB used"', () => {
    render(<StorageMeter usage={usage(0)} />);
    expect(screen.getByText('0 / 8 GB used')).toBeTruthy();
  });
});
