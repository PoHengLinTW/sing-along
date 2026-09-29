import type { LabelDto } from '@sing-along/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

const NONE: LabelDto[] = [];

/** All labels (presets first, then custom) plus a create function shared by every picker. */
export function useLabels() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['labels'],
    queryFn: () => apiFetch<LabelDto[]>('/api/labels'),
  });

  const create = async (name: string): Promise<LabelDto> => {
    const label = await apiFetch<LabelDto>('/api/labels', { method: 'POST', body: { name } });
    await qc.invalidateQueries({ queryKey: ['labels'] });
    return label;
  };

  return { labels: query.data ?? NONE, create };
}
