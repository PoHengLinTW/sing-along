import type { ProjectDetail } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ApiRequestError, apiFetch } from '../api/client';
import { NotFound } from './NotFound';
import { ProjectHeader } from './ProjectHeader';
import { UploadPanel } from './UploadPanel';

export function ProjectPage() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => apiFetch<ProjectDetail>(`/api/projects/${id}`),
    meta: { handles404: true },
  });

  if (query.error instanceof ApiRequestError && query.error.status === 404) {
    return <NotFound title="Project not found" />;
  }
  if (!query.data) return <p>Loading…</p>;
  return (
    <section>
      <ProjectHeader project={query.data} />
      <UploadPanel projectId={query.data.id} />
    </section>
  );
}
