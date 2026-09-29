/** Move `id` to where `targetId` currently is (drag and drop). Unknown ids leave the order unchanged. */
export function moveBefore(ids: number[], id: number, targetId: number): number[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/** Move one step up (-1) or down (+1): the keyboard alternative to dragging. */
export function moveByOffset(ids: number[], id: number, offset: -1 | 1): number[] {
  const from = ids.indexOf(id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
