import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportBar } from './TransportBar';
import { createTransportStore } from './transportStore';

let transport: ReturnType<typeof createTransportStore>;
let view: ReturnType<typeof render>;
const controller = {
  toggle: vi.fn(async () => {}),
  restart: vi.fn(),
  skip: vi.fn(),
  setLoopPoint: vi.fn(() => true),
  toggleLoop: vi.fn(),
  clearLoop: vi.fn(),
};

beforeEach(() => {
  transport = createTransportStore();
  for (const fn of Object.values(controller)) fn.mockClear();
  view = render(
    <>
      <TransportBar controller={controller as never} transport={transport} />
      <input aria-label="text field" />
    </>,
  );
});

describe('buttons', () => {
  it('have aria-labels and tooltips that show the shortcut', () => {
    expect(screen.getByRole('button', { name: 'Restart' }).getAttribute('title')).toBe(
      'Restart (Home)',
    );
    expect(screen.getByRole('button', { name: 'Back 10 seconds' }).getAttribute('title')).toBe(
      'Back 10 s (←)',
    );
    expect(screen.getByRole('button', { name: 'Play' }).getAttribute('title')).toBe(
      'Play / Pause (Space)',
    );
    expect(screen.getByRole('button', { name: 'Forward 10 seconds' }).getAttribute('title')).toBe(
      'Forward 10 s (→)',
    );
  });

  it('call the controller', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    await userEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(controller.restart).toHaveBeenCalledTimes(1);
    expect(controller.skip).toHaveBeenNthCalledWith(1, -10);
    expect(controller.skip).toHaveBeenNthCalledWith(2, 10);
    expect(controller.toggle).toHaveBeenCalledTimes(1);
  });

  it('the play button turns into pause while playing', () => {
    act(() => transport.setState({ playing: true }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });
});

describe('time display', () => {
  it('shows mm:ss.s / mm:ss and updates with the position', () => {
    act(() => transport.setState({ position: 65.34, duration: 200 }));
    expect(screen.getByTestId('time').textContent).toBe('01:05.3 / 03:20');
    act(() => transport.setState({ position: 70 }));
    expect(screen.getByTestId('time').textContent).toBe('01:10.0 / 03:20');
  });
});

describe('keyboard shortcuts', () => {
  const press = (key: string, target: Element | Document = document) =>
    fireEvent.keyDown(target, { key });

  it('Space, Home, Left and Right drive the transport', () => {
    press(' ');
    press('Home');
    press('ArrowLeft');
    press('ArrowRight');
    expect(controller.toggle).toHaveBeenCalledTimes(1);
    expect(controller.restart).toHaveBeenCalledTimes(1);
    expect(controller.skip).toHaveBeenCalledWith(-10);
    expect(controller.skip).toHaveBeenCalledWith(10);
  });

  it('are ignored while focus is in a text input', () => {
    const input = screen.getByLabelText('text field');
    input.focus();
    press(' ', input);
    press('ArrowLeft', input);
    press('Home', input);
    expect(controller.toggle).not.toHaveBeenCalled();
    expect(controller.skip).not.toHaveBeenCalled();
    expect(controller.restart).not.toHaveBeenCalled();
  });

  it('prevent the page from scrolling on Space', () => {
    const evt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('stop listening when the bar unmounts', () => {
    view.unmount();
    press(' ');
    expect(controller.toggle).not.toHaveBeenCalled();
  });
});

describe('loop controls', () => {
  it('Set A and Set B mark the loop points at the playhead', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Set loop start (A)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set loop end (B)' }));
    expect(controller.setLoopPoint).toHaveBeenNthCalledWith(1, 'a');
    expect(controller.setLoopPoint).toHaveBeenNthCalledWith(2, 'b');
  });

  it('the loop toggle and Clear are disabled until there is a loop', () => {
    expect((screen.getByRole('button', { name: 'Loop' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Clear loop' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the region, toggles looping and clears it', async () => {
    act(() => transport.setState({ loop: { a: 10, b: 75.5 }, loopEnabled: true }));
    expect(screen.getByTestId('loop-range').textContent).toBe('A 0:10 – B 1:15');
    const toggle = screen.getByRole('button', { name: 'Loop' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(toggle);
    expect(controller.toggleLoop).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(controller.clearLoop).toHaveBeenCalledTimes(1);
    act(() => transport.setState({ loopEnabled: false }));
    expect(screen.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a pending A while waiting for B, and can clear it', async () => {
    act(() => transport.setState({ loopA: 12 }));
    expect(screen.getByTestId('loop-range').textContent).toBe('A 0:12 – B ?');
    expect((screen.getByRole('button', { name: 'Clear loop' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
