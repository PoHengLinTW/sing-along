import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface RecordingState {
  status: 'idle' | 'starting' | 'recording' | 'stopping';
  muted: boolean;
  draftId: string | null;
  /** Timeline position (sec) of the take's first frame: elapsed = position - startSec. */
  startSec: number;
}

const IDLE: RecordingState = { status: 'idle', muted: false, draftId: null, startSec: 0 };

export const createRecordingStore = () => createStore<RecordingState>(() => ({ ...IDLE }));
export const recordingStore = createRecordingStore();

export function useRecording<T>(selector: (s: RecordingState) => T): T {
  return useStore(recordingStore, selector);
}
export const resetRecording = (store = recordingStore) => store.setState({ ...IDLE });
