import { formatBytes, type StorageUsage } from '@sing-along/shared';

export type StorageLevel = 'ok' | 'warn' | 'full';

/** Amber from 80% of the budget, red from 95% (M3-02). */
export function storageLevel(usedBytes: number, limitBytes: number): StorageLevel {
  const fraction = usedBytes / limitBytes;
  if (fraction >= 0.95) return 'full';
  if (fraction >= 0.8) return 'warn';
  return 'ok';
}

/** "5.2 / 8 GB used": the used figure borrows the limit's unit so the two read as one fraction. */
function usedLabel(used: number, limit: number): string {
  const limitText = formatBytes(limit);
  const unit = limitText.split(' ')[1] ?? 'GB';
  const divisor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
  const usedNumber = +(used / divisor).toFixed(1);
  return `${usedNumber} / ${limitText} used`;
}

export function StorageMeter({ usage }: { usage: StorageUsage }) {
  const level = storageLevel(usage.usedBytes, usage.limitBytes);
  return (
    <div className="storage-meter">
      <progress
        aria-label="Storage used"
        data-level={level}
        max={usage.limitBytes}
        value={Math.min(usage.usedBytes, usage.limitBytes)}
      />
      <span>{usedLabel(usage.usedBytes, usage.limitBytes)}</span>
    </div>
  );
}
