import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

interface Toast {
  id: number;
  kind: 'error' | 'success';
  text: string;
}
interface ToastApi {
  error(text: string): void;
  success(text: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast['kind'], text: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, kind, text }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ error: (t) => push('error', t), success: (t) => push('success', t) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`toast toast-${t.kind}`}
          >
            <span>{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
