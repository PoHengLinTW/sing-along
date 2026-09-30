/**
 * Shown when a project has no tracks and no drafts. Both actions reuse the controls that are
 * already on the page (the file chooser and the transport bar's Record button), so permission
 * prompts, errors and the R shortcut behave exactly the same.
 */
export function EmptyProject() {
  return (
    <div className="state-box empty-project">
      <p>No tracks yet. Add a recording of one part, or record your own.</p>
      <div className="dialog-actions">
        <button
          type="button"
          onClick={() =>
            document.querySelector<HTMLInputElement>('.upload-panel input[type="file"]')?.click()
          }
        >
          Upload a track
        </button>
        <button
          type="button"
          onClick={() => document.querySelector<HTMLButtonElement>('button.record')?.click()}
        >
          Record a take
        </button>
      </div>
    </div>
  );
}
