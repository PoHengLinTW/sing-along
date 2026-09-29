import type { ProjectListItem } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../api/client';
import { formatRelativeTime } from '../lib/time';
import { useStorageUsage } from '../lib/useStorageUsage';
import { CreateProjectDialog } from './CreateProjectDialog';
import { StorageMeter } from './StorageMeter';

export function Home() {
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ProjectListItem[]>('/api/projects'),
  });

  const storage = useStorageUsage();

  return (
    <section>
      <div className="page-head">
        <h1>Projects</h1>
        <button type="button" onClick={() => setCreating(true)}>
          Create project
        </button>
      </div>

      {storage.data && <StorageMeter usage={storage.data} />}

      {query.isPending && (
        <ul className="project-list" aria-label="Projects" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton-row" />
          ))}
        </ul>
      )}

      {query.isError && (
        <div className="state-box">
          <p>Couldn't load projects.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      )}

      {query.data && query.data.length === 0 && (
        <div className="state-box">
          <p>No projects yet.</p>
          <button type="button" onClick={() => setCreating(true)}>
            Create your first project
          </button>
        </div>
      )}

      {query.data && query.data.length > 0 && (
        <ul className="project-list" aria-label="Projects" aria-busy="false">
          {query.data.map((p) => (
            <li key={p.id}>
              <Link to={`/project/${p.id}`}>
                <strong>{p.title}</strong>
                {p.artist && <span>{p.artist}</span>}
                <span>{p.trackCount === 1 ? '1 track' : `${p.trackCount} tracks`}</span>
                <span>{formatRelativeTime(p.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
