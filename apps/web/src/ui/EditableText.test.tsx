import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditableText } from './EditableText';

const setup = (props: Partial<Parameters<typeof EditableText>[0]> = {}) => {
  const onSave = vi.fn(async (_v: string) => {});
  render(<EditableText label="Title" value="Old" onSave={onSave} {...props} />);
  return { onSave, input: screen.getByLabelText('Title') as HTMLInputElement };
};

describe('EditableText', () => {
  it('saves on blur when the value changed', async () => {
    const { onSave, input } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, 'New');
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledWith('New');
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('does not save an unchanged value', async () => {
    const { onSave, input } = setup();
    await userEvent.click(input);
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('saves on Enter in a single-line field', async () => {
    const { onSave, input } = setup();
    await userEvent.type(input, 'X{Enter}');
    expect(onSave).toHaveBeenCalledWith('OldX');
  });

  it('does NOT save on Enter in a multiline field (Enter inserts a newline)', async () => {
    const onSave = vi.fn(async () => {});
    render(<EditableText label="Notes" value="" multiline onSave={onSave} />);
    const area = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    await userEvent.type(area, 'a{Enter}b');
    expect(onSave).not.toHaveBeenCalled();
    expect(area.value).toBe('a\nb');
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledWith('a\nb');
  });

  it('Esc undoes the edit without saving', async () => {
    const { onSave, input } = setup();
    await userEvent.type(input, 'zzz{Escape}');
    expect(input.value).toBe('Old');
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a validation error and does not save when invalid', async () => {
    const { onSave, input } = setup({
      validate: (v) => (v.trim() === '' ? 'Title is required' : null),
    });
    await userEvent.clear(input);
    await userEvent.tab();
    expect(await screen.findByText('Title is required')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the draft and shows the error when saving fails', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('nope');
    });
    render(<EditableText label="Title" value="Old" onSave={onSave} />);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    await userEvent.type(input, 'X');
    await userEvent.tab();
    expect(await screen.findByText('nope')).toBeTruthy();
    expect(input.value).toBe('OldX');
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('follows the value prop when it changes from outside and the field is not being edited', async () => {
    const { rerender } = render(<EditableText label="Title" value="A" onSave={async () => {}} />);
    rerender(<EditableText label="Title" value="B" onSave={async () => {}} />);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('B');
  });
});
