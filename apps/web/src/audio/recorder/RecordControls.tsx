import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { formatClock } from '../../timeline/math';
import { useToast } from '../../ui/toast';
import { recordShortcut } from '../shortcuts';
import { type TransportState, transportStore } from '../transportStore';
import { type LevelStoreState, levelStore } from './levelStore';
import { classifyMicError, loadMicDevice, micErrorMessage } from './mic';
import { getInputMonitor, type InputMonitor } from './monitor';
import { loadPerformer } from './performer';
import { isTakeOpen, type RecordingState, recordingStore } from './recordingStore';
import { getRecordingSession, type RecordingSession } from './session';

interface Props {
  projectId: number;
  session?: Pick<RecordingSession, 'start' | 'stop' | 'setMuted' | 'pause' | 'resume'>;
  recording?: StoreApi<RecordingState>;
  levels?: StoreApi<LevelStoreState>;
  monitor?: Pick<InputMonitor, 'setMuted'>;
  transport?: StoreApi<TransportState>;
}

/** Record/Stop and mic mute, with their R and M shortcuts. */
export function RecordControls({
  projectId,
  session,
  recording = recordingStore,
  levels = levelStore,
  monitor,
  transport = transportStore,
}: Props) {
  const status = useStore(recording, (s) => s.status);
  const takeMuted = useStore(recording, (s) => s.muted);
  const monitoring = useStore(levels, (s) => s.monitoring);
  const checkMuted = useStore(levels, (s) => s.muted);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isRecording = isTakeOpen(status);
  const muted = isRecording ? takeMuted : monitoring && checkMuted;
  const canMute = isRecording || monitoring;

  const toggleRecording = async () => {
    const s = session ?? getRecordingSession();
    const current = recording.getState().status;
    if (busy || (current !== 'idle' && !isTakeOpen(current))) return;
    setBusy(true);
    try {
      if (isTakeOpen(current)) await s.stop();
      else await s.start({ projectId, deviceId: loadMicDevice(), performer: loadPerformer() });
    } catch (err) {
      toast.error(micErrorMessage(classifyMicError(err as { name?: string })));
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = () => {
    if (isTakeOpen(recording.getState().status)) {
      (session ?? getRecordingSession()).setMuted(!recording.getState().muted);
    } else if (levels.getState().monitoring) {
      (monitor ?? getInputMonitor()).setMuted(!levels.getState().muted);
    }
  };

  const togglePause = async () => {
    const s = session ?? getRecordingSession();
    const current = recording.getState().status;
    if (current === 'recording') s.pause();
    else if (current === 'paused') await s.resume();
  };

  // The listener always calls the latest handlers, so it is attached once.
  const latest = useRef({ toggleRecording, toggleMute, togglePause });
  latest.current = { toggleRecording, toggleMute, togglePause };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = recordShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'record') void latest.current.toggleRecording();
      else if (action === 'pause') void latest.current.togglePause();
      else latest.current.toggleMute();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className={isRecording ? 'record recording' : 'record'}
        aria-label={isRecording ? 'Stop recording' : 'Record'}
        title={isRecording ? 'Stop recording (R)' : 'Record a take at the playhead (R)'}
        disabled={busy || status === 'starting' || status === 'stopping'}
        onClick={() => void toggleRecording()}
      >
        {isRecording ? (
          <>
            ■ Stop <Elapsed transport={transport} recording={recording} />
          </>
        ) : (
          '● Record take'
        )}
      </button>
      <button
        type="button"
        className={muted ? 'mic-mute muted' : 'mic-mute'}
        aria-label={muted ? 'Mic muted' : 'Mute mic'}
        aria-pressed={muted}
        title={
          canMute
            ? 'Mute the microphone (M): the take keeps its length, the muted part is silent'
            : 'Mute the microphone (M): available while recording or checking the input'
        }
        disabled={!canMute}
        onClick={toggleMute}
      >
        {muted ? 'Mic muted' : 'Mute mic'}
      </button>
    </>
  );
}

/** The only per-frame reader here: the take's elapsed time from the shared playhead. */
function Elapsed({
  transport,
  recording,
}: {
  transport: StoreApi<TransportState>;
  recording: StoreApi<RecordingState>;
}) {
  const position = useStore(transport, (s) => s.position);
  const startSec = useStore(recording, (s) => s.startSec);
  return <span className="elapsed">{formatClock(Math.max(0, position - startSec))}</span>;
}
