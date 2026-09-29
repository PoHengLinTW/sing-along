import { type ProjectDetail, projectCreateSchema } from '@sing-along/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../api/client';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EditableText } from '../ui/EditableText';

const validateTitle = (v: string) => {
  const r = projectCreateSchema.shape.title.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid title');
};

export function ProjectHeader({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const save = async (patch: Record<string, string>) => {
    const updated = await apiFetch<ProjectDetail>(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: patch,
    });
    qc.setQueryData(['project', String(project.id)], updated);
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const del = useMutation({
    mutationFn: () => apiFetch(`/api/projects/${project.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['project', String(project.id)] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      navigate('/');
    },
  });

  const n = project.tracks.length;
  return (
    <header className="project-header">
      <EditableText
        label="Title"
        value={project.title}
        validate={validateTitle}
        onSave={(v) => save({ title: v })}
      />
      <EditableText
        label="Artist"
        value={project.artist ?? ''}
        onSave={(v) => save({ artist: v })}
      />
      <EditableText
        label="Notes"
        value={project.notes ?? ''}
        multiline
        onSave={(v) => save({ notes: v })}
      />
      <button type="button" className="danger" onClick={() => setConfirming(true)}>
        Delete project
      </button>
      <ConfirmDialog
        open={confirming}
        title="Delete project?"
        message={`Delete '${project.title}' and its ${n} ${n === 1 ? 'track' : 'tracks'}? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        requireText={project.title}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          del.mutate();
        }}
      />
    </header>
  );
}
