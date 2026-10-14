import { ThemeControl } from '../theme/ThemeControl';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Modal } from '../Dialogs';
import '../auth.css';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: import('../../shared/types').ResourceRole;
}

type AuthState = { authenticated: false } | { authenticated: true; user: AuthUser };
export interface AuthControls {
  user: AuthUser;
  onSessionExpired: () => void;
  signOut: () => Promise<void>;
  onPasswordChanged: (user: AuthUser) => void;
}

function authenticatedUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object' || !('authenticated' in value) || value.authenticated !== true || !('user' in value)) return null;
  const user = value.user;
  if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !('username' in user) || typeof user.username !== 'string' || !('name' in user) || typeof user.name !== 'string' || !('role' in user) || !['administrator', 'project_creator', 'user', 'visitor'].includes(String(user.role))) return null;
  return user as AuthUser;
}

async function postAuth(path: string, body: object): Promise<Response> {
  return fetch(`/api/auth/${path}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export function AuthBoundary({ children }: { children: (controls: AuthControls) => ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const onSessionExpired = useCallback(() => {
    generation.current += 1;
    setAuth({ authenticated: false });
    setLoadError(false);
    setNotice('Votre session a expiré. Connectez-vous pour retrouver votre espace.');
  }, []);
  const onAuthenticated = useCallback((user: AuthUser) => {
    generation.current += 1;
    setNotice('');
    setLoadError(false);
    setAuth({ authenticated: true, user });
  }, []);
  const activeGeneration = generation.current;
  const expireActiveSession = useCallback(() => {
    if (generation.current === activeGeneration) onSessionExpired();
  }, [activeGeneration, onSessionExpired]);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++generation.current;
    setLoadError(false);
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok && response.status !== 401) throw new Error('Session unavailable');
        const body: unknown = response.ok ? await response.json() : { authenticated: false };
        if (sequence !== generation.current) return;
        const user = authenticatedUser(body);
        setAuth(user ? { authenticated: true, user } : { authenticated: false });
      })
      .catch(() => { if (!controller.signal.aborted && sequence === generation.current) setLoadError(true); });
    return () => controller.abort();
  }, [retry]);

  const isAuthenticated = auth?.authenticated === true;
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    let pending = false;
    const checkSession = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      const sequence = generation.current;
      try {
        const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!active || sequence !== generation.current) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (active && sequence === generation.current && !authenticatedUser(body)) onSessionExpired();
      } catch { /* Keep the current view when connectivity is temporarily unavailable. */ }
      finally { pending = false; }
    };
    const focused = () => { void checkSession(); };
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    const timer = window.setInterval(focused, 60_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', focused); };
  }, [isAuthenticated, onSessionExpired]);

  const signOut = useCallback(async () => {
    const sequence = generation.current;
    const response = await postAuth('logout', {});
    if (!response.ok && response.status !== 401) throw new Error('La déconnexion n’a pas pu être terminée. Réessayez.');
    if (sequence !== generation.current) return;
    generation.current += 1;
    setAuth({ authenticated: false });
    setLoadError(false);
    setNotice('Vous avez été déconnecté.');
  }, []);

  if (!auth) return <main className="auth-loading" aria-busy={!loadError}>
    <AuthBrand />
    {loadError ? <><p role="alert">Impossible de vérifier votre connexion pour le moment.</p><button className="button button-primary" onClick={() => setRetry(value => value + 1)}>Réessayer</button></> : <><div className="loading-spinner" /><p>Ouverture de votre espace…</p></>}
  </main>;
  if (!auth.authenticated) return <LoginScreen notice={notice} onAuthenticated={onAuthenticated} />;
  return children({ user: auth.user, onSessionExpired: expireActiveSession, signOut, onPasswordChanged: onAuthenticated });
}

function AuthBrand() {
  return <div className="auth-brand"><img src="/planzone-logo.png" alt="" width={38} height={38} /><span>planzone<span className="auth-brand-version">8</span></span></div>;
}

function LoginScreen({ notice, onAuthenticated }: { notice: string; onAuthenticated: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await postAuth('login', { username: username.trim(), password });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status === 429) throw new Error('Trop de tentatives de connexion. Réessayez dans quelques minutes.');
        if (response.status === 401 || response.status === 400) throw new Error('Identifiant ou mot de passe incorrect.');
        throw new Error('La connexion est momentanément indisponible. Réessayez.');
      }
      const user = authenticatedUser(body);
      if (!user) throw new Error('La connexion n’a pas pu être confirmée. Réessayez.');
      setPassword('');
      onAuthenticated(user);
    } catch (err) {
      if (!mounted.current) return;
      setPassword('');
      setError(err instanceof Error && !(err instanceof TypeError) ? err.message : 'Impossible de se connecter. Vérifiez votre connexion et réessayez.');
      window.setTimeout(() => passwordRef.current?.focus(), 0);
    } finally { if (mounted.current) setBusy(false); }
  };
  return <main className="auth-page">
    <section className="auth-intro" aria-label="Planzone 8">
      <AuthBrand />
      <div className="auth-intro-copy"><span className="auth-eyebrow">VOTRE ESPACE DE PILOTAGE</span><h1>Gardez le cap.<br /><span>Ensemble.</span></h1><p>Vos projets, votre équipe et vos prochaines étapes réunis dans un même espace.</p><div className="auth-intro-line" /><span className="auth-intro-caption">PLANIFIER · COLLABORER · AVANCER</span></div>
      <p className="auth-intro-footer">Un espace commun pour faire avancer vos projets.</p>
    </section>
    <section className="auth-login-area">
      <ThemeControl className="theme-auth-control" />
      <div className="auth-mobile-brand"><AuthBrand /></div>
      <div className="auth-login-card">
        <span className="auth-lock"><LockKeyhole size={23} strokeWidth={1.7} /></span>
        <span className="auth-eyebrow">BIENVENUE DANS PLANZONE 8</span>
        <h2>Connectez-vous à votre espace</h2>
        <p className="auth-subtitle">Retrouvez vos projets et poursuivez là où vous en étiez.</p>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form className="auth-form" onSubmit={submit} aria-busy={busy}>
          <label className="auth-field" htmlFor="auth-username">Identifiant<input id="auth-username" className="form-input" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={80} value={username} onChange={event => setUsername(event.target.value)} disabled={busy} placeholder="Votre identifiant" /></label>
          <div className="auth-field"><label htmlFor="auth-password">Mot de passe</label><span className="auth-password-input"><input id="auth-password" ref={passwordRef} className="form-input" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder="Votre mot de passe" /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} disabled={busy}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? <><span className="auth-button-spinner" /> Connexion en cours…</> : <>Se connecter <ArrowRight size={18} /></>}</button>
        </form>
        <p className="auth-access-note"><ShieldCheck size={16} /><span>L’accès à votre espace nécessite une connexion.</span></p>
      </div>
      <p className="auth-page-footer">Planzone 8 · Votre espace de travail</p>
    </section>
  </main>;
}

export function PasswordDialog({ onClose, onSuccess, onSessionExpired }: {
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
  onSessionExpired: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clearPasswords = () => { setCurrentPassword(''); setNewPassword(''); setConfirmation(''); };
  const close = useCallback(() => {
    setCurrentPassword(''); setNewPassword(''); setConfirmation('');
    onClose();
  }, [onClose]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (newPassword.length < 12) { setError('Choisissez un mot de passe d’au moins 12 caractères.'); return; }
    if (newPassword !== confirmation) { setError('Les deux nouveaux mots de passe doivent être identiques.'); return; }
    setBusy(true);
    try {
      const response = await postAuth('password', { currentPassword, newPassword });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) { clearPasswords(); onSessionExpired(); return; }
      if (!response.ok) {
        if (response.status === 400 || response.status === 403) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Vérifiez votre mot de passe actuel et réessayez.');
        if (response.status === 429) throw new Error('Trop de tentatives. Réessayez dans quelques minutes.');
        throw new Error('Le mot de passe n’a pas pu être modifié. Réessayez.');
      }
      const user = authenticatedUser(body);
      if (!user) throw new Error('Le changement n’a pas pu être confirmé. Réessayez.');
      clearPasswords();
      onSuccess(user);
    } catch (err) {
      if (mounted.current) { setCurrentPassword(''); setError(err instanceof Error ? err.message : 'Vérifiez votre connexion et réessayez.'); }
    } finally { if (mounted.current) setBusy(false); }
  };
  return <Modal title="Changer le mot de passe" onClose={close}>
    <form onSubmit={submit} aria-busy={busy}>
      <div className="modal-body auth-password-dialog">
        <p><KeyRound size={19} /> Choisissez un mot de passe d’au moins 12 caractères.</p>
        <fieldset disabled={busy}>
          <label className="form-field" htmlFor="auth-current-password">Mot de passe actuel<input id="auth-current-password" className="form-input" type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
          <label className="form-field" htmlFor="auth-new-password">Nouveau mot de passe<input id="auth-new-password" className="form-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} aria-describedby="auth-password-help" /></label>
          <label className="form-field" htmlFor="auth-confirm-password">Confirmer le nouveau mot de passe<input id="auth-confirm-password" className="form-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        </fieldset>
        <p id="auth-password-help" className="muted">Vos autres sessions seront déconnectées après la modification.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button className="button button-secondary" type="button" onClick={close}>Annuler</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Modification…' : 'Modifier le mot de passe'}</button></div>
    </form>
  </Modal>;
}
