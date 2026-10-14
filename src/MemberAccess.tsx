import { useRef, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import type { AppData, Resource } from '../shared/types';
import { isAdmin } from '../shared/permissions';

export function MemberAccess({ data, resource, onCreated }: { data: AppData; resource: Resource; onCreated?: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [created, setCreated] = useState(''); const pending = useRef(false);
  const account = created || data.userAccounts?.find(account => account.resourceId === resource.id)?.username;
  if (!isAdmin(data) || resource.type !== 'human' || !resource.active) return null;
  async function create(event: FormEvent) {
    event.preventDefault(); event.stopPropagation(); if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { const response = await fetch('/api/auth/members', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceId: resource.id, username, password }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Création impossible.'); setCreated(result.username); setPassword(''); setOpen(false); await onCreated?.(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Création impossible.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="member-access"><h3><KeyRound size={16} />Accès de connexion</h3>{account ? <p>Identifiant : <strong>{account}</strong><small>Le rôle global de cette fiche et ses rôles projet s’appliquent à sa connexion.</small></p> : <><button type="button" className="button button-secondary" onClick={() => setOpen(!open)}>Créer l’accès de connexion</button>{open && <div className="member-access-fields"><label className="rd-field">Identifiant du membre<input value={username} autoComplete="off" minLength={3} maxLength={80} disabled={busy} onChange={event => setUsername(event.target.value)} /></label><label className="rd-field">Mot de passe initial<input type="password" value={password} autoComplete="new-password" minLength={12} maxLength={128} disabled={busy} onChange={event => setPassword(event.target.value)} /></label><p className="rd-hint">12 à 128 caractères. Le membre pourra changer son mot de passe après connexion.</p><button type="button" className="button button-primary" disabled={busy || username.trim().length < 3 || password.length < 12} onClick={event => { void create(event); }}>{busy ? 'Création…' : 'Créer le compte du membre'}</button></div>}</>}{error && <p className="form-error" role="alert">{error}</p>}</section>;
}
