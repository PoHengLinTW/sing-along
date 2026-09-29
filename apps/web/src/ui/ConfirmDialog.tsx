import { useId, useRef, useState } from 'react';
import { Modal } from './Modal';

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

export function ConfirmDialog(p: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  return (
    <Modal
      open={p.open}
      labelledBy={titleId}
      onCancel={p.onCancel}
      // Destructive actions start on the safe choice; a required-text dialog starts on the field.
      initialFocus={() => inputRef.current ?? cancelRef.current}
    >
      <ConfirmBody {...p} titleId={titleId} cancelRef={cancelRef} inputRef={inputRef} />
    </Modal>
  );
}

function ConfirmBody(
  p: Props & {
    titleId: string;
    cancelRef: React.RefObject<HTMLButtonElement | null>;
    inputRef: React.RefObject<HTMLInputElement | null>;
  },
) {
  const [typed, setTyped] = useState('');
  const armed = p.requireText === undefined || typed === p.requireText;
  return (
    <form
      method="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        if (armed) p.onConfirm();
      }}
    >
      <h2 id={p.titleId}>{p.title}</h2>
      <p>{p.message}</p>
      {p.requireText !== undefined && (
        <label>
          Type <strong>{p.requireText}</strong> to confirm
          <input
            ref={p.inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      <div className="dialog-actions">
        <button type="button" ref={p.cancelRef} onClick={p.onCancel}>
          {p.cancelLabel ?? 'Cancel'}
        </button>
        <button type="submit" disabled={!armed} data-destructive={p.destructive ? 'true' : 'false'}>
          {p.confirmLabel}
        </button>
      </div>
    </form>
  );
}
