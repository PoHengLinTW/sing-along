import type { ProjectDetail } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, apiFetch } from '../api/client';
import { TransportBar } from '../audio/TransportBar';
import { useProjectAudio } from '../audio/useProjectAudio';
import { filterByLabels } from '../lib/labels';
import { Timeline } from '../timeline/Timeline';
import { LabelFilterBar } from './LabelFilterBar';
import { NotFound } from './NotFound';
import { ProjectHeader } from './ProjectHeader';
import { TrackPanels } from './TrackPanels';
import { UploadPanel } from './UploadPanel';

const EMPTY: never[] = [];

export function ProjectPage() {
  const { id } = useParams();
  const [filter, setFilter] = useState<number[]>([]);
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => apiFetch<ProjectDetail>(`/api/projects/${id}`),
    meta: { handles404: true },
  });

  // The engine always gets every track: the label filter only hides rows, it never stops audio.
  useProjectAudio(query.data?.tracks ?? EMPTY);
  const visible = useMemo(
    () => filterByLabels(query.data?.tracks ?? EMPTY, filter),
    [query.data?.tracks, filter],
  );

  if (query.error instanceof ApiRequestError && query.error.status === 404) {
    return <NotFound title="Project not found" />;
  }
  if (!query.data) return <p>Loading…</p>;
  return (
    <section>
      <ProjectHeader project={query.data} />
      <TransportBar />
      <LabelFilterBar tracks={query.data.tracks} filter={filter} onFilterChange={setFilter} />
      <div className="workspace">
        <TrackPanels project={query.data} visible={visible} reorderDisabled={filter.length > 0} />
        <Timeline tracks={visible} />
      </div>
      <UploadPanel projectId={query.data.id} />
    </section>
  );
}
