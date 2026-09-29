import { type StorageUsage, storageUsageSchema } from '@sing-along/shared';
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
  });
}
