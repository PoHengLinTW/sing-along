import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal built on the native <dialog>: the browser traps focus and maps Esc to `cancel`. */
export function ConfirmDialog(p: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trigger = useRef<Element | null>(null);
  const [typed, setTyped] = useState('');
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (p.open) {
      trigger.current = document.activeElement;
      setTyped('');
      if (!dialog.open) dialog.showModal();
      // Destructive actions start on the safe choice; a required-text dialog starts on the field.
      (inputRef.current ?? cancelRef.current)?.focus();
    } else if (dialog.open) {
      dialog.close();
      (trigger.current as HTMLElement | null)?.focus?.();
    }
  }, [p.open]);

  const armed = p.requireText === undefined || typed === p.requireText;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // we close through state, so React and the DOM never disagree
        p.onCancel();
      }}
    >
      {p.open && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (armed) p.onConfirm();
          }}
        >
          <h2 id={titleId}>{p.title}</h2>
          <p>{p.message}</p>
          {p.requireText !== undefined && (
            <label>
              Type <strong>{p.requireText}</strong> to confirm
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="dialog-actions">
            <button type="button" ref={cancelRef} onClick={p.onCancel}>
              {p.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={!armed}
              data-destructive={p.destructive ? 'true' : 'false'}
            >
              {p.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
