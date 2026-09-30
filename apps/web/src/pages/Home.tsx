import type { ProjectListItem } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch } from '../api/client';
import { formatRelativeTime } from '../lib/time';
import { useStorageUsage } from '../lib/useStorageUsage';
import { CreateProjectDialog } from './CreateProjectDialog';
import { StorageMeter } from './StorageMeter';

export function Home() {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ProjectListItem[]>('/api/projects'),
  });

  const storage = useStorageUsage();
  const atProjectLimit = !!storage.data && storage.data.projectCount >= storage.data.projectLimit;
  const limitMessage = `Project limit reached (${storage.data?.projectLimit}). Delete a project to create another.`;
  const recent = query.data?.reduce(
    (latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest),
    undefined as ProjectListItem | undefined,
  );

  return (
    <section className="home-page">
      <div className="page-head home-intro">
        <div>
          <p className="eyebrow">Your music space</p>
          <h1>Make room for harmony.</h1>
          <p className="page-subtitle">
            Practice each part, blend your voices, and save the moments that click.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          aria-label="Create project"
          disabled={atProjectLimit}
          aria-describedby={atProjectLimit ? 'project-limit' : undefined}
          onClick={() => setCreating(true)}
        >
          ＋ Create project
        </button>
      </div>
      {atProjectLimit && (
        <p id="project-limit" className="hint">
          {limitMessage}
        </p>
      )}

      {storage.data && <StorageMeter usage={storage.data} />}

      {recent && (
        <section className="featured-project" aria-label="Pick up where you left off">
          <div className="featured-copy">
            <p className="eyebrow">Pick up where you left off</p>
            <h2>{recent.title}</h2>
            <p>
              {recent.artist || 'Your latest project'} ·{' '}
              {recent.trackCount === 1 ? '1 track' : `${recent.trackCount} tracks`}
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate(`/project/${recent.id}`)}
            >
              Open studio
            </button>
          </div>
          <div className="featured-art" aria-hidden="true">
            <span className="feature-wave" />
          </div>
        </section>
      )}

      {query.data && query.data.length > 0 && (
        <div className="section-heading">
          <h2>All projects</h2>
          <span>
            {query.data.length} {query.data.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
      )}

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
          <button type="button" disabled={atProjectLimit} onClick={() => setCreating(true)}>
            Create your first project
          </button>
        </div>
      )}

      {query.data && query.data.length > 0 && (
        <ul className="project-list" aria-label="Projects" aria-busy="false">
          {query.data.map((p) => (
            <li key={p.id}>
              <Link to={`/project/${p.id}`}>
                <span className="project-card-top">
                  <span className="project-card-icon" aria-hidden="true">
                    ♫
                  </span>
                  <span>{formatRelativeTime(p.updatedAt)}</span>
                </span>
                <strong>{p.title}</strong>
                {p.artist && <span className="project-artist">{p.artist}</span>}
                <span className="project-card-bottom">
                  <span>{p.trackCount === 1 ? '1 track' : `${p.trackCount} tracks`}</span>
                  <span>Open project ↗</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
