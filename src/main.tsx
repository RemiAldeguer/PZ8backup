import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme/theme.css';
import { startThemeSync } from './theme/browser-theme';

startThemeSync();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
