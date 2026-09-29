export const PERFORMER_KEY = 'sing-along:performer';

/** The performer name is remembered per browser so each new take is pre-filled. */
export function loadPerformer(): string {
  try {
    return localStorage.getItem(PERFORMER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePerformer(name: string): void {
  try {
    localStorage.setItem(PERFORMER_KEY, name);
  } catch {
    // Storage blocked: the name just isn't remembered.
  }
}
