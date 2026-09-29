import { createBrowserRouter, createMemoryRouter, Link, Outlet } from 'react-router';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { ProjectPage } from './pages/ProjectPage';

function Layout() {
  return (
    <>
      <header className="app-header">
        <Link to="/">Sing-along</Link>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/project/:id', element: <ProjectPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

/** Memory router for tests (pass entries); browser router in the app. */
export function createAppRouter(entries?: string[]) {
  return entries
    ? createMemoryRouter(routes, { initialEntries: entries })
    : createBrowserRouter(routes);
}
