import { type ProjectDetail, projectCreateSchema } from '@sing-along/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiRequestError, apiFetch } from '../api/client';
import { Modal } from '../ui/Modal';

export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={open}
      labelledBy={titleId}
      onCancel={onClose}
      initialFocus={() => titleInput.current}
    >
      <CreateForm titleId={titleId} titleInput={titleInput} onClose={onClose} />
    </Modal>
  );
}

function CreateForm({
  titleId,
  titleInput,
  onClose,
}: {
  titleId: string;
  titleInput: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (body: { title: string; artist?: string }) =>
      apiFetch<ProjectDetail>('/api/projects', { method: 'POST', body }),
    onSuccess: async (project) => {
      await qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      navigate(`/project/${project.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.fields) setErrors(err.fields);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Same rules as the server, from the shared schema, so the user gets instant feedback.
    const parsed = projectCreateSchema.safeParse({ title, artist });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate({
      title: parsed.data.title,
      ...(parsed.data.artist ? { artist: parsed.data.artist } : {}),
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 id={titleId}>Create project</h2>
      <label>
        Title
        <input
          ref={titleInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? 'create-title-error' : undefined}
        />
      </label>
      {errors.title && (
        <p id="create-title-error" className="field-error">
          {errors.title}
        </p>
      )}
      <label>
        Artist
        <input value={artist} onChange={(e) => setArtist(e.target.value)} />
      </label>
      {errors.artist && <p className="field-error">{errors.artist}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={create.isPending}>
          Create
        </button>
      </div>
    </form>
  );
}
