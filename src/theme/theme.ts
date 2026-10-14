export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export interface ThemeState { preference: ThemePreference; resolved: Theme }

export function themePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
