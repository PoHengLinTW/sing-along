import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function Harness(props: { onConfirm?: () => void; confirmText?: string; destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <ConfirmDialog
        open={open}
        title="Delete thing?"
        message="This cannot be undone."
        confirmLabel="Delete"
        destructive={props.destructive}
        requireText={props.confirmText}
        onConfirm={() => {
          props.onConfirm?.();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('shows nothing until opened, then title and message', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByText('open'));
    expect(screen.getByRole('dialog', { name: 'Delete thing?' })).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('confirms and cancels', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('marks the confirm button as destructive', async () => {
    render(<Harness destructive />);
    await userEvent.click(screen.getByText('open'));
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('data-destructive')).toBe(
      'true',
    );
  });

  it('keeps confirm disabled until the exact text is typed', async () => {
    const onConfirm = vi.fn();
    render(<Harness confirmText="My Song" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText('open'));
    const confirm = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    const input = screen.getByRole('textbox');
    expect(confirm.disabled).toBe(true);
    await userEvent.type(input, 'my song');
    expect(confirm.disabled).toBe(true); // case matters
    await userEvent.clear(input);
    await userEvent.type(input, 'My Song');
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('focuses the first control on open (the text field when one is required)', async () => {
    render(<Harness confirmText="X" />);
    await userEvent.click(screen.getByText('open'));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('Esc cancels', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText('open'));
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })); // what the browser fires on Esc
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('returns focus to the trigger when it closes', async () => {
    render(<Harness />);
    const trigger = screen.getByText('open');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('clears the typed text when reopened', async () => {
    render(<Harness confirmText="Go" />);
    await userEvent.click(screen.getByText('open'));
    await userEvent.type(screen.getByRole('textbox'), 'Go');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByText('open'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
});
