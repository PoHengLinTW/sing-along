import { Link } from 'react-router';

/** Route-level fallback: a crashed page never leaves a blank screen. Details go to the console only. */
export function RouteError() {
  return (
    <div className="state-box">
      <p>Something went wrong showing this page.</p>
      <div className="dialog-actions">
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link to="/">Back to projects</Link>
      </div>
    </div>
  );
}
