import type { ProjectDetail, TrackDto } from '@sing-along/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { mixerStore, useMix } from '../audio/mixerStore';
import { moveBefore, moveByOffset } from '../lib/reorder';
import { LANE_HEIGHT, LANE_MARGIN, RULER_HEIGHT } from '../timeline/Timeline';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EditableText } from '../ui/EditableText';

export function TrackPanels({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const key = ['project', String(project.id)];
  const dragId = useRef<number | null>(null);

  const patchTrack = (id: number, updated: TrackDto) =>
    qc.setQueryData<ProjectDetail>(key, (old) =>
      old ? { ...old, tracks: old.tracks.map((t) => (t.id === id ? updated : t)) } : old,
    );

  const reorder = useMutation({
    mutationFn: (ids: number[]) =>
      apiFetch<ProjectDetail>(`/api/projects/${project.id}/track-order`, {
        method: 'PUT',
        body: { trackIds: ids },
      }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ProjectDetail>(key);
      // Optimistic: show the new order at once; roll back if the save fails.
      qc.setQueryData<ProjectDetail>(key, (old) =>
        old
          ? {
              ...old,
              tracks: ids
                .map((id, i) => {
                  const t = old.tracks.find((x) => x.id === id);
                  return t ? { ...t, sortOrder: i } : undefined;
                })
                .filter((t): t is TrackDto => !!t),
            }
          : old,
      );
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (saved) => qc.setQueryData(key, saved),
  });

  const ids = project.tracks.map((t) => t.id);
  const applyOrder = (next: number[]) => {
    if (next !== ids) reorder.mutate(next);
  };

  return (
    <div className="panels">
      <div style={{ height: RULER_HEIGHT }} />
      {project.tracks.map((track) => (
        <TrackPanel
          key={track.id}
          track={track}
          projectKey={key}
          onSaved={(updated) => patchTrack(track.id, updated)}
          onDragStart={() => {
            dragId.current = track.id;
          }}
          onDrop={() => {
            if (dragId.current !== null) applyOrder(moveBefore(ids, dragId.current, track.id));
            dragId.current = null;
          }}
          onMove={(offset) => applyOrder(moveByOffset(ids, track.id, offset))}
        />
      ))}
    </div>
  );
}

interface PanelProps {
  track: TrackDto;
  projectKey: (string | number)[];
  onSaved: (updated: TrackDto) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onMove: (offset: -1 | 1) => void;
}

function TrackPanel({ track, projectKey, onSaved, onDragStart, onDrop, onMove }: PanelProps) {
  const qc = useQueryClient();
  const mix = useMix(track.id);
  const [confirming, setConfirming] = useState(false);

  const save = async (patch: { name?: string; performer?: string }) => {
    onSaved(await apiFetch<TrackDto>(`/api/tracks/${track.id}`, { method: 'PATCH', body: patch }));
  };

  const del = useMutation({
    mutationFn: () => apiFetch(`/api/tracks/${track.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      // gone from the view immediately; AudioSync then drops it from the engine
      qc.setQueryData<ProjectDetail>(projectKey, (old) =>
        old ? { ...old, tracks: old.tracks.filter((t) => t.id !== track.id) } : old,
      );
      mixerStore.getState().forget(track.id);
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target; keyboard users use the move buttons
    <div
      className="track-panel"
      data-testid={`panel-${track.name}`}
      style={{ height: LANE_HEIGHT, margin: `${LANE_MARGIN}px 0` }}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="panel-top">
        <span
          className="drag-handle"
          draggable
          role="img"
          aria-label={`Drag to reorder ${track.name}`}
          title="Drag to reorder"
        >
          ⠿
        </span>
        <EditableText
          label="Track name"
          labelHidden
          value={track.name}
          onSave={(v) => save({ name: v })}
          validate={(v) => (v.trim() ? null : 'Name is required')}
        />
        <button type="button" aria-label={`Move ${track.name} up`} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" aria-label={`Move ${track.name} down`} onClick={() => onMove(1)}>
          ↓
        </button>
      </div>
      <EditableText
        label="Performer"
        labelHidden
        value={track.performer ?? ''}
        onSave={(v) => save({ performer: v })}
        placeholder="Performer"
      />
      <div className="panel-mix">
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={150}
          step={1}
          value={Math.round(mix.volume * 100)}
          onChange={(e) => mixerStore.getState().setVolume(track.id, Number(e.target.value) / 100)}
        />
        <span className="vol-readout">{Math.round(mix.volume * 100)}%</span>
        <button
          type="button"
          aria-pressed={mix.muted}
          onClick={() => mixerStore.getState().toggleMute(track.id)}
        >
          Mute
        </button>
        <button
          type="button"
          aria-pressed={mix.solo}
          onClick={() => mixerStore.getState().toggleSolo(track.id)}
        >
          Solo
        </button>
        <button
          type="button"
          className="danger"
          aria-label={`Delete ${track.name}`}
          onClick={() => setConfirming(true)}
        >
          🗑
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete track?"
        message={`Delete '${track.name}'? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          del.mutate();
        }}
      />
    </div>
  );
}
