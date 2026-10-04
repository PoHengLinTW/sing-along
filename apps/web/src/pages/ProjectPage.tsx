import type { ProjectDetail } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, apiFetch } from '../api/client';
import { mixerStore } from '../audio/mixerStore';
import { draftEngineId } from '../audio/recorder/draftView';
import { EncodeStatus } from '../audio/recorder/EncodeStatus';
import { getDraftEditor } from '../audio/recorder/edit/editor';
import { LevelMeter } from '../audio/recorder/LevelMeter';
import { MicSetup } from '../audio/recorder/MicSetup';
import { RecordingSheet } from '../audio/recorder/RecordingSheet';
import { isTakeOpen, recordingStore } from '../audio/recorder/recordingStore';
import { getRecordingSession, setAutoStopHandler } from '../audio/recorder/session';
import { useDrafts } from '../audio/recorder/useDrafts';
import { useLeaveGuard } from '../audio/recorder/useLeaveGuard';
import { TransportBar } from '../audio/TransportBar';
import { useDraftAudio } from '../audio/useDraftAudio';
import { useMixPersistence } from '../audio/useMixPersistence';
import { useProjectAudio } from '../audio/useProjectAudio';
import { filterByLabels } from '../lib/labels';
import { latencyForStart } from '../lib/startTime';
import { useCaps } from '../lib/useStorageUsage';
import { Timeline, TimelineZoomControls } from '../timeline/Timeline';
import { useToast } from '../ui/toast';
import { EditBar, REFUSALS } from './EditBar';
import { EmptyProject } from './EmptyProject';
import { LabelFilterBar } from './LabelFilterBar';
import { NotFound } from './NotFound';
import { ProjectHeader } from './ProjectHeader';
import { TrackPanels } from './TrackPanels';
import { UploadPanel } from './UploadPanel';
import { useDraftUploader } from './useDraftUploader';
import { useLatencyEditing } from './useLatencyEditing';

const EMPTY: never[] = [];

export function ProjectPage() {
  const { id } = useParams();
  const [filter, setFilter] = useState<number[]>([]);
  const caps = useCaps();
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => apiFetch<ProjectDetail>(`/api/projects/${id}`),
    meta: { handles404: true },
  });

  useLeaveGuard(); // "Leave site?" while a take is running
  const toast = useToast();
  useEffect(() => {
    setAutoStopHandler(() =>
      toast.error('Recording stopped: a take can be at most 10 minutes. It was kept as a draft.'),
    );
    return () => setAutoStopHandler(null);
  }, [toast]);
  // Declared before useProjectAudio so a running take ends (and unlocks the transport) before
  // that hook's cleanup pauses and rewinds.
  useEffect(
    () => () => {
      if (isTakeOpen(recordingStore.getState().status)) getRecordingSession().stopIfRecording();
    },
    [],
  );

  const { drafts: savedDrafts, loaded: draftsLoaded } = useDrafts(Number(id));
  // Offsets being edited apply at once (lane, engine, panel); saving follows after a pause.
  const latency = useLatencyEditing(Number(id), query.data?.tracks ?? EMPTY, savedDrafts);
  const drafts = latency.drafts;
  const uploadDraftTake = useDraftUploader(Number(id));
  const project = useMemo(
    () => (query.data ? { ...query.data, tracks: latency.tracks } : undefined),
    [query.data, latency.tracks],
  );
  // The engine always gets every track: the label filter only hides rows, it never stops audio.
  const retryAudio = useProjectAudio(project?.tracks ?? EMPTY);
  useDraftAudio(drafts);
  // Drafts count as "known" ids for mix persistence, but only once they have loaded: pruning
  // against an empty list would forget their remembered mix.
  const trackIds = useMemo(
    () =>
      project && draftsLoaded
        ? [...project.tracks.map((t) => t.id), ...drafts.map((d) => draftEngineId(d.id))]
        : undefined,
    [project, drafts, draftsLoaded],
  );
  useMixPersistence(id === undefined ? undefined : Number(id), trackIds);
  const visible = useMemo(
    () => filterByLabels(project?.tracks ?? EMPTY, filter),
    [project?.tracks, filter],
  );

  if (query.error instanceof ApiRequestError && query.error.status === 404) {
    return <NotFound title="Project not found" />;
  }
  if (query.isError && !query.data) {
    // Only when there is nothing to show: a failed background refresh keeps the page (and playback).
    return (
      <div className="state-box">
        <p>Couldn't load this project.</p>
        <button type="button" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  }
  if (!query.data || !project) return <p>Loading…</p>;
  return (
    <section className="studio-page">
      <ProjectHeader project={query.data} />
      <TransportBar projectId={query.data.id} />
      <div className="input-strip">
        <div className="input-strip-title">
          <span className="input-icon" aria-hidden="true">
            ♩
          </span>
          <strong>Microphone</strong>
        </div>
        <MicSetup />
        <LevelMeter />
      </div>
      <EncodeStatus />
      <RecordingSheet />
      <div className="workspace-heading">
        <div>
          <h2>Tracks &amp; timeline</h2>
          <p>
            Click a waveform to seek. Drag a track's top bar to move it in time. Shape your mix with
            each track's controls.
          </p>
        </div>
        <LabelFilterBar tracks={query.data.tracks} filter={filter} onFilterChange={setFilter} />
        <TimelineZoomControls />
      </div>
      <EditBar draftIds={drafts.map((d) => d.id)} />
      {project.tracks.length === 0 && drafts.length === 0 && <EmptyProject />}
      <div className="workspace">
        <TrackPanels
          project={project}
          visible={visible}
          drafts={drafts}
          reorderDisabled={filter.length > 0}
          onTrackLatency={latency.setTrackLatency}
          onDraftLatency={latency.setDraftLatency}
          onDraftUpload={uploadDraftTake}
        />
        <Timeline
          tracks={visible}
          drafts={drafts}
          onRetryAudio={retryAudio}
          showZoomControls={false}
          onTrackStart={(t, ms) => latency.setTrackLatency(t, latencyForStart(t, ms))}
          onDraftStart={(d, ms) => latency.setDraftLatency(d, latencyForStart(d, ms))}
          onDraftTrim={async (d, edge, ms) => {
            const editor = getDraftEditor();
            const result =
              edge === 'start'
                ? await editor.trimBefore(d.id, ms)
                : await editor.trimAfter(d.id, ms);
            if (!result.ok) toast.error(REFUSALS[result.reason]?.(result) ?? '');
          }}
        />
      </div>
      <div className="workspace-footer">
        <span>Hidden tracks keep playing unless muted.</span>
        <button
          type="button"
          title="Volume, mute and solo of every track back to 100% / off (this browser only)"
          onClick={() => mixerStore.getState().reset()}
        >
          Reset mix
        </button>
      </div>
      <UploadPanel projectId={query.data.id} trackCount={query.data.tracks.length} caps={caps} />
    </section>
  );
}
