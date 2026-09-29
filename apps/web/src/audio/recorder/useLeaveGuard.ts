import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { type RecordingState, recordingStore } from './recordingStore';

/**
 * While a take is starting, running or being saved, closing or reloading the tab shows the
 * browser's "Leave site?" prompt. Nothing is shown when not recording. (The audio already captured
 * is kept as a draft either way; the prompt is there because the take would end early.)
 */
export function useLeaveGuard(recording: StoreApi<RecordingState> = recordingStore): void {
  const busy = useStore(recording, (s) => s.status !== 'idle');

  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // some browsers need this to show the prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);
}
