/** Shown by anything that needs the label list when it could not be loaded. */
export function LabelsLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="field-error" role="alert">
      Couldn't load labels.{' '}
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}
