import { useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { useToast } from '../../ui/toast';
import { classifyMicError, loadMicDevice, micErrorMessage } from './mic';
import { loadPerformer } from './performer';
import { type RecordingState, recordingStore } from './recordingStore';
import { getRecordingSession, type RecordingSession } from './session';

interface Props {
  projectId: number;
  session?: Pick<RecordingSession, 'start' | 'stop'>;
  recording?: StoreApi<RecordingState>;
}

export function RecordButton({ projectId, session, recording = recordingStore }: Props) {
  const status = useStore(recording, (s) => s.status);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isRecording = status === 'recording';

  const toggle = async () => {
    const s = session ?? getRecordingSession();
    setBusy(true);
    try {
      if (isRecording) await s.stop();
      else await s.start({ projectId, deviceId: loadMicDevice(), performer: loadPerformer() });
    } catch (err) {
      toast.error(micErrorMessage(classifyMicError(err as { name?: string })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={isRecording ? 'record recording' : 'record'}
      aria-label={isRecording ? 'Stop recording' : 'Record'}
      title={isRecording ? 'Stop recording' : 'Record a take at the playhead'}
      disabled={busy || status === 'starting' || status === 'stopping'}
      onClick={() => void toggle()}
    >
      {isRecording ? '■ Stop' : '● Record'}
    </button>
  );
}
