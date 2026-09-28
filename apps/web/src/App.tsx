import type { HealthResponse } from '@sing-along/shared';

const initial: HealthResponse = { status: 'ok' };

export function App() {
  return (
    <main>
      <h1>Sing-along</h1>
      <p>API status type: {initial.status}</p>
    </main>
  );
}
