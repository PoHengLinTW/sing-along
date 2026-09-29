import type { ProjectDetail } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ApiRequestError, apiFetch } from '../api/client';
import { useProjectAudio } from '../audio/useProjectAudio';
import { Timeline } from '../timeline/Timeline';
import { NotFound } from './NotFound';
import { ProjectHeader } from './ProjectHeader';
import { UploadPanel } from './UploadPanel';

const EMPTY: never[] = [];

export function ProjectPage() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => apiFetch<ProjectDetail>(`/api/projects/${id}`),
    meta: { handles404: true },
  });

  useProjectAudio(query.data?.tracks ?? EMPTY);

  if (query.error instanceof ApiRequestError && query.error.status === 404) {
    return <NotFound title="Project not found" />;
  }
  if (!query.data) return <p>Loading…</p>;
  return (
    <section>
      <ProjectHeader project={query.data} />
      <Timeline tracks={query.data.tracks} />
      <UploadPanel projectId={query.data.id} />
    </section>
  );
}
