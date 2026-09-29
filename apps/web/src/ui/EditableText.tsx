import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  multiline?: boolean;
  validate?: (value: string) => string | null;
  placeholder?: string;
  /** Keep the label for screen readers but hide it visually (dense layouts). */
  labelHidden?: boolean;
}

const SAVED_VISIBLE_MS = 2000;

/** Text that saves itself: on blur, or on Enter for single-line fields. Esc undoes the edit. */
export function EditableText({
  label,
  value,
  onSave,
  multiline,
  validate,
  placeholder,
  labelHidden,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const focused = useRef(false);
  // The last value we committed: stops Enter-then-blur from saving the same text twice
  // while the parent has not yet handed the saved value back through `value`.
  const committed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    committed.current = value;
    if (!focused.current) setDraft(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = async () => {
    if (draft === committed.current) return;
    const problem = validate?.(draft) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const previous = committed.current;
    committed.current = draft;
    try {
      await onSave(draft);
      setSaved(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS);
    } catch (err) {
      committed.current = previous; // let the user retry the same text
      setSaved(false);
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const shared = {
    id,
    value: draft,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      setSaved(false);
    },
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      void commit();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(committed.current);
        setError(null);
      } else if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        void commit();
      }
    },
  };

  return (
    <div className="editable">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : undefined}>
        {label}
      </label>
      {multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />}
      {saved && <span className="saved">Saved</span>}
      {error && (
        <p id={`${id}-error`} className="field-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
