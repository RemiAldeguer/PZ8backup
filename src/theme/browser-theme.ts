import { resolveTheme, themePreference, type ThemePreference, type ThemeState } from './theme';

export const THEME_STORAGE_KEY = 'planzone8-theme';
const listeners = new Set<() => void>();
const defaultState: ThemeState = { preference: 'system', resolved: 'light' };
let state = defaultState;
let system: MediaQueryList | undefined;
let started = false;

function storedPreference(): ThemePreference {
  try { return themePreference(localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return 'system'; }
}
function apply(preference: ThemePreference) {
  const resolved = resolveTheme(preference, system?.matches ?? false);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0f1724' : '#f4f6fa');
  if (state.preference === preference && state.resolved === resolved) return;
  state = { preference, resolved };
  listeners.forEach(listener => listener());
}
/** Called before React mounts, so the saved appearance applies to the first render. */
export function startThemeSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  system = window.matchMedia('(prefers-color-scheme: dark)');
  apply(storedPreference());
  system.addEventListener('change', () => {
    if (state.preference === 'system') apply('system');
  });
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === null)
      apply(storedPreference());
  });
}
export function setTheme(preference: ThemePreference) {
  startThemeSync();
  try { localStorage.setItem(THEME_STORAGE_KEY, preference); }
  catch { /* Appearance still works when browser storage is unavailable. */ }
  apply(preference);
}
export const getThemeState = () => state;
export const getServerThemeState = () => defaultState;
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
