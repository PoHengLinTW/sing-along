import { createBrowserRouter, createMemoryRouter, Link, Outlet, useLocation } from 'react-router';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { ProjectPage } from './pages/ProjectPage';
import { RouteError } from './pages/RouteError';

function Layout() {
  const location = useLocation();
  const inProject = location.pathname.startsWith('/project/');
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" to="/" aria-label="Sing-along">
          <span className="brand-mark" aria-hidden="true">
            ♫
          </span>
          <span>
            singalong<span className="brand-dot">.</span>
          </span>
        </Link>
        <div>
          <p className="sidebar-caption">Workspace</p>
          <nav className="sidebar-nav" aria-label="Workspace">
            <Link
              to="/"
              className={!inProject ? 'active' : undefined}
              aria-current={!inProject ? 'page' : undefined}
            >
              <span aria-hidden="true">▦</span> Your projects
            </Link>
            {inProject && (
              <span className="active">
                <span aria-hidden="true">♫</span> Practice studio
              </span>
            )}
          </nav>
        </div>
        <p className="sidebar-footer">A space to hear every part and find your harmony.</p>
      </aside>
      <div className="app-content">
        <header className="app-header">
          <Link to="/" className="mobile-brand">
            ♫ singalong<span className="brand-dot">.</span>
          </Link>
          <div className="breadcrumb">
            Workspace <span aria-hidden="true">/</span>{' '}
            <strong>{inProject ? 'Practice studio' : 'Projects'}</strong>
          </div>
          <span className="header-badge">YOUR MUSIC SPACE</span>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const routes = [
  {
    element: <Layout />,
    errorElement: <RouteError />,
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
