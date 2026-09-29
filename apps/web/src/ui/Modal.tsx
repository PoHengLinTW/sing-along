import { type ReactNode, useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  labelledBy: string;
  onCancel: () => void;
  /** Element to focus after opening; defaults to the browser's choice. */
  initialFocus?: () => HTMLElement | null;
  children: ReactNode;
}

/**
 * Modal on the native <dialog>: the browser traps focus and maps Esc to `cancel`.
 * We add: children mount only while open (so their state resets), a chosen initial focus,
 * and focus returning to whatever opened the dialog.
 */
export function Modal({ open, labelledBy, onCancel, initialFocus, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<Element | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only `open` transitions matter
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      trigger.current = document.activeElement;
      if (!dialog.open) dialog.showModal();
      initialFocus?.()?.focus();
    } else if (dialog.open) {
      dialog.close();
      (trigger.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault(); // close through state so React and the DOM never disagree
        onCancel();
      }}
    >
      {open && children}
    </dialog>
  );
}
