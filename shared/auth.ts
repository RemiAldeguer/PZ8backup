export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: import('./types').ResourceRole;
}

export type AuthState =
  | { authenticated: false }
  | { authenticated: true; user: AuthUser };
