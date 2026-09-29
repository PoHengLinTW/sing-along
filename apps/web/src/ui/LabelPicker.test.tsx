import type { LabelDto } from '@sing-along/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LabelPicker } from './LabelPicker';

const label = (id: number, name: string, isPreset = true): LabelDto => ({
  id,
  name,
  color: '#123456',
  isPreset,
});
const ALL = [label(1, 'Alto'), label(2, 'Bass'), label(3, 'Kazoo', false)];

function Harness({
  initial = [] as number[],
  onCreate = async (name: string) => label(99, name, false),
  onChange = vi.fn(),
}) {
  const [ids, setIds] = useState(initial);
  return (
    <LabelPicker
      labels={ALL}
      selectedIds={ids}
      onChange={(next) => {
        onChange(next);
        setIds(next);
      }}
      onCreate={onCreate}
    />
  );
}

describe('LabelPicker', () => {
  it('lists presets and custom labels as checkboxes', () => {
    render(<Harness />);
    expect(
      screen
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-label') ?? c.parentElement?.textContent),
    ).toEqual(['Alto', 'Bass', 'Kazoo']);
  });

  it('reflects the selection and toggles labels, keeping selection order', async () => {
    const onChange = vi.fn();
    render(<Harness initial={[2]} onChange={onChange} />);
    expect((screen.getByRole('checkbox', { name: 'Bass' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alto' }));
    expect(onChange).toHaveBeenLastCalledWith([2, 1]); // appended: order decides the first label / color
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bass' }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  it('filters as you type', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Find or create a label'), 'kaz');
    expect(
      screen
        .getAllByRole('checkbox')
        .map((c) => (c as HTMLInputElement).parentElement?.textContent),
    ).toEqual(['Kazoo']);
  });

  it("offers Create '<name>' for a new name, creates it and selects it", async () => {
    const onCreate = vi.fn(async (name: string) => label(99, name, false));
    const onChange = vi.fn();
    render(<Harness onCreate={onCreate} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Find or create a label'), 'Ukulele');
    await userEvent.click(screen.getByRole('button', { name: "Create 'Ukulele'" }));
    expect(onCreate).toHaveBeenCalledWith('Ukulele');
    expect(onChange).toHaveBeenLastCalledWith([99]);
    expect((screen.getByLabelText('Find or create a label') as HTMLInputElement).value).toBe('');
  });

  it('does not offer Create for a name that already exists', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Find or create a label'), 'alto');
    expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull();
  });

  it('Enter in the field creates the new label', async () => {
    const onCreate = vi.fn(async (name: string) => label(99, name, false));
    render(<Harness onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText('Find or create a label'), 'Cello{Enter}');
    expect(onCreate).toHaveBeenCalledWith('Cello');
  });

  it('shows the failure and keeps the text when creating fails', async () => {
    const onCreate = vi.fn(async () => {
      throw new Error('Label name must be at most 30 characters');
    });
    render(<Harness onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText('Find or create a label'), 'Cello');
    await userEvent.click(screen.getByRole('button', { name: "Create 'Cello'" }));
    expect(await screen.findByText(/at most 30/)).toBeTruthy();
    expect((screen.getByLabelText('Find or create a label') as HTMLInputElement).value).toBe(
      'Cello',
    );
  });
});
