import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './App';
import { installGestureUnlock } from './audio/controller';
import { AppProviders } from './providers';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

installGestureUnlock();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  </StrictMode>,
);
