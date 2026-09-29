import type { LabelDto } from '@sing-along/shared';

/** Black or white text, whichever reads better on the label color. */
function textOn(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}

export function LabelChip({ label }: { label: Pick<LabelDto, 'name' | 'color'> }) {
  return (
    <span
      className="label-chip"
      data-testid="label-chip"
      style={{ background: label.color, color: textOn(label.color) }}
    >
      {label.name}
    </span>
  );
}
