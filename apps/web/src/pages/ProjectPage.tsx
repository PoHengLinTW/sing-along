import type { ProjectDetail } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, apiFetch } from '../api/client';
import { mixerStore } from '../audio/mixerStore';
import { draftEngineId } from '../audio/recorder/draftView';
import { EncodeStatus } from '../audio/recorder/EncodeStatus';
import { LevelMeter } from '../audio/recorder/LevelMeter';
import { MicSetup } from '../audio/recorder/MicSetup';
import { recordingStore } from '../audio/recorder/recordingStore';
import { getRecordingSession, setAutoStopHandler } from '../audio/recorder/session';
import { useDrafts } from '../audio/recorder/useDrafts';
import { useLeaveGuard } from '../audio/recorder/useLeaveGuard';
import { TransportBar } from '../audio/TransportBar';
import { useDraftAudio } from '../audio/useDraftAudio';
import { useMixPersistence } from '../audio/useMixPersistence';
import { useProjectAudio } from '../audio/useProjectAudio';
import { filterByLabels } from '../lib/labels';
import { Timeline } from '../timeline/Timeline';
import { useToast } from '../ui/toast';
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
      if (recordingStore.getState().status === 'recording') getRecordingSession().stopIfRecording();
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
  useProjectAudio(project?.tracks ?? EMPTY);
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
  if (!query.data || !project) return <p>Loading…</p>;
  return (
    <section>
      <ProjectHeader project={query.data} />
      <TransportBar projectId={query.data.id} />
      <MicSetup />
      <LevelMeter />
      <EncodeStatus />
      <LabelFilterBar tracks={query.data.tracks} filter={filter} onFilterChange={setFilter} />
      <p className="mix-actions">
        <button
          type="button"
          title="Volume, mute and solo of every track back to 100% / off (this browser only)"
          onClick={() => mixerStore.getState().reset()}
        >
          Reset mix
        </button>
      </p>
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
        <Timeline tracks={visible} drafts={drafts} />
      </div>
      <UploadPanel projectId={query.data.id} />
    </section>
  );
}
