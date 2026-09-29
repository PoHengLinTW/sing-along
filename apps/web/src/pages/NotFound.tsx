import { Link } from 'react-router';

export function NotFound({ title = 'Page not found' }: { title?: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>
        <Link to="/">Back to Home</Link>
      </p>
    </section>
  );
}
