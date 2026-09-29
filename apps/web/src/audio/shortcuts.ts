export type TransportShortcut = 'toggle' | 'restart' | 'back' | 'forward';

/**
 * True when keystrokes belong to the focused control, not to the transport: text entry
 * (inputs including range sliders, whose arrows must move the slider, textarea, select,
 * contenteditable).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const KEYS: Record<string, TransportShortcut> = {
  ' ': 'toggle',
  Home: 'restart',
  ArrowLeft: 'back',
  ArrowRight: 'forward',
};

export type RecordShortcut = 'record' | 'mic-mute';

const RECORD_KEYS: Record<string, RecordShortcut> = { r: 'record', m: 'mic-mute' };

/**
 * R starts/stops a take, M mutes the microphone. Ignored while typing and with Ctrl/Cmd/Alt
 * (Ctrl+R reloads the page, Cmd+M minimises the window).
 */
export function recordShortcut(e: KeyLike): RecordShortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  return RECORD_KEYS[e.key.toLowerCase()] ?? null;
}

/** Maps a keydown to a transport action, or null when it should be left alone. */
export function transportShortcut(e: KeyLike): TransportShortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null; // browser / OS shortcuts
  if (isTypingTarget(e.target)) return null;
  const action = KEYS[e.key];
  if (!action) return null;
  // Space on a focused button activates that button: don't also toggle playback.
  if (
    action === 'toggle' &&
    e.target instanceof HTMLElement &&
    e.target.closest('button, a, summary')
  )
    return null;
  return action;
}
