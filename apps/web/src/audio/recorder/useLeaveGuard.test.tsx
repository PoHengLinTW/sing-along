import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createRecordingStore } from './recordingStore';
import { useLeaveGuard } from './useLeaveGuard';

const fire = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe('useLeaveGuard', () => {
  it('asks "Leave site?" while a take is being recorded', () => {
    const recording = createRecordingStore();
    renderHook(() => useLeaveGuard(recording));
    act(() => recording.setState({ status: 'recording' }));
    expect(fire().defaultPrevented).toBe(true);
  });

  it('also guards while the take starts or is being saved', () => {
    const recording = createRecordingStore();
    renderHook(() => useLeaveGuard(recording));
    for (const status of ['starting', 'stopping'] as const) {
      act(() => recording.setState({ status }));
      expect(fire().defaultPrevented).toBe(true);
    }
  });

  it('does not interrupt anyone when nothing is recording', () => {
    const recording = createRecordingStore();
    renderHook(() => useLeaveGuard(recording));
    expect(fire().defaultPrevented).toBe(false);
    act(() => recording.setState({ status: 'recording' }));
    act(() => recording.setState({ status: 'idle' }));
    expect(fire().defaultPrevented).toBe(false);
  });

  it('removes its listener when the page is left', () => {
    const recording = createRecordingStore();
    const { unmount } = renderHook(() => useLeaveGuard(recording));
    act(() => recording.setState({ status: 'recording' }));
    unmount();
    expect(fire().defaultPrevented).toBe(false);
  });
});
