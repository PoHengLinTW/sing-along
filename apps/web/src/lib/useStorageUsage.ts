import { type Caps, DEFAULT_CAPS, type StorageUsage, storageUsageSchema } from '@sing-along/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

/**
 * Keyed under 'projects' on purpose: every action that changes storage (create/delete a project,
 * upload or delete a track) already invalidates ['projects'], which refreshes this as well.
 */
export const STORAGE_KEY = ['projects', 'storage'] as const;

export function useStorageUsage() {
  return useQuery<StorageUsage>({
    queryKey: STORAGE_KEY,
    queryFn: async () => storageUsageSchema.parse(await apiFetch('/api/storage')),
    retry: false,
    meta: { silent: true },
  });
}

/** The server's live caps, or the PRD defaults until (or unless) they load. */
export function useCaps(): Caps {
  const { data } = useStorageUsage();
  if (!data) return DEFAULT_CAPS;
  return {
    maxFileBytes: data.maxFileBytes,
    maxTrackMs: data.maxTrackMs,
    maxTracksPerProject: data.maxTracksPerProject,
    maxProjects: data.projectLimit,
    maxStorageBytes: data.limitBytes,
  };
}
