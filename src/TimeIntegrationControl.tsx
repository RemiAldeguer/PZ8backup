import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarCheck, Check } from 'lucide-react';
import type { Mutation } from '../shared/types';
import { isCivilDate } from '../shared/time-integration';

export interface TimeIntegrationTarget { scope: 'project' | 'resource'; id: string; name: string; date?: string | null; }
export function TimeIntegrationControl({ target, canManage, mutate, notify, onSaved, onPendingChange, initialDate }: {
  target: TimeIntegrationTarget; canManage: boolean; mutate: Mutation; notify: (message: string) => void; onSaved?: () => void; onPendingChange?: (pending: boolean) => void; initialDate?: string;
}) {
  const [draft, setDraft] = useState(initialDate ?? target.date ?? '');
  const [busy, setBusy] = useState(false); const pending = useRef(false); const [error, setError] = useState('');
  useEffect(() => { setDraft(initialDate ?? target.date ?? ''); setError(''); }, [target.scope, target.id, target.date, initialDate]);
  const label = target.scope === 'project' ? 'Date d’intégration projet' : 'Date d’intégration ressource';
  const formatted = target.date ? target.date.split('-').reverse().join('/') : '';
  async function save(date: string | null) {
    if (pending.current || !canManage) return;
    pending.current = true; setBusy(true); setError(''); onPendingChange?.(true);
    try {
      await mutate('time-integrations', 'POST', target.scope === 'project' ? { scope: 'project', projectId: target.id, date } : { scope: 'resource', resourceId: target.id, date });
      notify(date ? `${label} enregistrée.` : `${label} retirée.`); onSaved?.();
    } catch (error) { setError(error instanceof Error ? error.message : 'La date n’a pas pu être enregistrée.'); }
    finally { pending.current = false; setBusy(false); onPendingChange?.(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); if (isCivilDate(draft)) void save(draft); }
  return <form className="time-integration-control" aria-label={label} onSubmit={submit}>
    <fieldset disabled={busy || !canManage}><div className="time-integration-fields"><CalendarCheck size={19} aria-hidden="true" /><label><span>{label}</span><input type="date" aria-label={label} required value={draft} onChange={event => setDraft(event.target.value)} /></label><button type="submit" className="button button-secondary" disabled={!isCivilDate(draft) || draft === (target.date ?? '')}>{busy ? 'Enregistrement…' : 'Valider jusqu’à cette date'}</button>{target.date && <button type="button" className="time-text-action" onClick={() => void save(null)}>Retirer la date</button>}</div></fieldset>
    <p className="time-integration-status">{target.date ? <><Check size={14} aria-hidden="true" />Journées validées jusqu’au {formatted} inclus.</> : 'Aucune date d’intégration définie.'}</p>
    <p className="time-integration-scope">{target.scope === 'project' ? `Toutes les ressources du projet ${target.name}.` : `Uniquement ${target.name}, sur tous ses projets.`} La date s’applique aussi aux journées antérieures, hors de la semaine et des filtres affichés.</p>
    <p className="time-integration-scope">Les temps de cette période sont verrouillés. Ajustez ou retirez la date pour rouvrir la période ; les autres validations restent applicables.</p>
    {!canManage && <p className="time-integration-scope">Ce périmètre est disponible en consultation.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
