import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './base.css';

const App = lazy(() => import('./legacy-entry'));
const Pz7AccessApp = lazy(() => import('./pz7-access').then(module => ({ default: module.Pz7AccessApp })));

const accessRoutes = new Set(['/access', '/invitations/accept', '/account/validation']);
const pathname = window.location.pathname.replace(/\/$/, '') || '/';
const useJavaAccess = accessRoutes.has(pathname) || import.meta.env.VITE_PZ8_BACKEND === 'java';
createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<p role="status">Chargement…</p>}>
    {useJavaAccess ? <Pz7AccessApp /> : <App />}
  </Suspense></StrictMode>,
);
