import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { getServerThemeState, getThemeState, setTheme, subscribeTheme } from './browser-theme';
import { themePreference } from './theme';

export function ThemeControl({ className = '' }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeState, getServerThemeState);
  const Icon = theme.preference === 'system' ? Monitor : theme.resolved === 'dark' ? Moon : Sun;
  return <label className={`theme-control ${className}`}>
    <Icon size={17} aria-hidden="true" />
    <span className="theme-sr-only">Thème de l’application</span>
    <select value={theme.preference} onChange={event => setTheme(themePreference(event.target.value))}>
      <option value="system">Automatique</option>
      <option value="light">Clair</option>
      <option value="dark">Sombre</option>
    </select>
  </label>;
}
