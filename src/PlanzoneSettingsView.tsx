import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Clock3, Save, Settings2 } from 'lucide-react';
import type { AppData, Mutation } from '../shared/types';
import { isAdmin } from '../shared/permissions';
import { planzonePreferences, type PlanzonePreferences } from '../shared/planzone-preferences';
import './planzone-settings.css';
import { ViewAccessSettings } from './ViewAccessSettings';
import { viewRoleAssignments, type ViewRoleAssignments } from '../shared/view-access';

type Option = { key: Exclude<keyof PlanzonePreferences, 'id' | 'version' | 'viewRoles'>; label: string; hint?: string; numeric?: boolean };
const timeOptions: Option[] = [
  { key: 'automaticTimeIntegration', label: 'Activer l’intégration automatique des feuilles de temps', hint: 'Les temps sont pris en compte dans le suivi projet dès leur saisie. Sinon, seuls les temps validés sont comptabilisés.' },
  { key: 'allocationInDays', label: 'Saisir l’allocation de temps en jours', hint: 'La conversion utilise le nombre d’heures par jour de la ressource ; 8 h en l’absence de ressource.' },
  { key: 'blockIntegratedDates', label: 'Bloquer la saisie du temps aux dates intégrées', hint: 'Les validations individuelles restent protégées même lorsque cette option est désactivée.' },
  { key: 'showTimeSheetProgress', label: 'Afficher le pourcentage d’avancement des tâches dans les feuilles de temps' },
];
const planningOptions: Option[] = [
  { key: 'extendAcrossNonWorkingDays', label: 'Déplacer un élément de projet sur une période non ouvrée prolongera sa durée du nombre de jours non ouvrés inclus dans cette période', hint: 'Appliqué aux déplacements de tâches, selon le calendrier hebdomadaire et les jours fériés de leur ressource.' },
  { key: 'allowSelfAssignment', label: 'Activer le bouton d’auto-affectation sur une tâche dans le suivi temporel personnel', hint: 'Pour les tâches ouvertes non affectées d’un projet accessible, avec vos droits de travail habituels. Les accès en lecture seule sont conservés.' },
  { key: 'linkAllocationToDuration', label: 'Lier les heures allouées à la durée de la tâche', hint: 'Lors d’une création ou modification des dates, l’allocation suit la capacité ouvrée de la ressource.' },
  { key: 'criticalDailySpanHours', label: 'Avertir lorsque les ressources dépassent une amplitude journalière de travail critique', numeric: true, hint: 'Amplitude des événements avec horaires, entre le premier début et la dernière fin de la journée.' },
  { key: 'criticalDailyWorkHours', label: 'Avertir lorsque les ressources dépassent un volume de travail journalier critique', numeric: true, hint: 'Charge planifiée des tâches et événements horaires de la ressource.' },
  { key: 'minimumRestHours', label: 'Alerter si le repos entre la dernière activité et la première du lendemain est inférieur au seuil configuré', numeric: true, hint: 'Calculé sur les événements qui possèdent des horaires explicites.' },
  { key: 'warnDuringUnavailability', label: 'Afficher un avertissement lorsqu’une ressource affectée est indisponible pendant la période de la tâche' },
];

export function PlanzoneSettingsView({ data, mutate, notify, reload }: { data: AppData; mutate: Mutation; notify: (text: string) => void; reload: () => Promise<void> }) {
  const saved = planzonePreferences(data);
  const [draft, setDraft] = useState(saved), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) setDraft(saved); }, [saved.version, dirty]);
  if (!isAdmin(data)) return <section className="card empty-state"><h1>Paramètres de la Planzone</h1><p>Seul un administrateur peut modifier ces préférences.</p></section>;
  function change(key: Option['key'] | 'viewRoles', value: boolean | number | ViewRoleAssignments) { setDraft(previous => ({ ...previous, [key]: value })); setDirty(true); setError(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !dirty) return;
    setBusy(true); setError('');
    try {
      const { id, version, ...options } = draft;
      await mutate('planzone-preferences', 'POST', { ...options, expectedVersion: version });
      setDirty(false); notify('Préférences de la Planzone enregistrées.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  }
  function group(title: string, options: Option[], Icon: typeof Clock3) {
    return <fieldset className="pz-settings-group" disabled={busy}><legend><Icon size={18} aria-hidden="true" />{title}</legend>{options.map(option => <div className="pz-settings-row" key={option.key}>
      <label htmlFor={'pz-setting-' + option.key}><span id={'pz-label-' + option.key}>{option.label}</span>{option.hint && <small id={'pz-hint-' + option.key}>{option.hint}</small>}</label>
      <div className="pz-settings-value">{option.numeric ? <><input id={'pz-setting-' + option.key} aria-labelledby={'pz-label-' + option.key} aria-describedby={'pz-hint-' + option.key} type="number" min="0" max="24" step="0.01" required value={Number.isNaN(draft[option.key]) ? '' : String(draft[option.key])} onChange={event => change(option.key, event.target.value === '' ? Number.NaN : Number(event.target.value))} /><span>h</span></> : <input id={'pz-setting-' + option.key} aria-labelledby={'pz-label-' + option.key} aria-describedby={option.hint ? 'pz-hint-' + option.key : undefined} type="checkbox" checked={Boolean(draft[option.key])} onChange={event => change(option.key, event.target.checked)} />}</div>
    </div>)}</fieldset>;
  }
  return <section className="pz-settings-view"><header className="pz-settings-intro"><Settings2 size={25} aria-hidden="true" /><div><h1>Paramètres de la Planzone</h1><p>Personnalisez le suivi du temps et les règles de planification de votre espace.</p></div></header>
    <form className="pz-settings-form" onSubmit={save}><h2>Préférences</h2>{group('Suivi du temps', timeOptions, Clock3)}{group('Planification', planningOptions, CalendarDays)}
      <p className="pz-settings-note">Les seuils sont exprimés en heures. Une valeur de 0 désactive l’avertissement correspondant.</p>
      <ViewAccessSettings data={data} values={viewRoleAssignments({ ...data, planzonePreferences: [draft] })} disabled={busy} onChange={value => change('viewRoles', value)} />
      {saved.version !== draft.version && dirty && <p role="alert">Les préférences ont changé depuis l’ouverture de votre formulaire. Rechargez les réglages avant d’enregistrer.</p>}
      {error && <div className="form-error" role="alert"><p>{error}</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => { setDirty(false); setError(''); void reload().catch(failure => setError(failure instanceof Error ? failure.message : 'Chargement impossible.')); }}>Recharger les réglages</button></div>}
      <footer><span role="status">{busy ? 'Enregistrement…' : dirty ? 'Modifications non enregistrées' : 'Préférences à jour'}</span><button type="button" className="button button-secondary" disabled={busy || !dirty} onClick={() => { setDraft(saved); setDirty(false); setError(''); }}>Annuler les modifications</button><button type="submit" className="button button-primary" disabled={busy || !dirty || saved.version !== draft.version}><Save size={16} />Enregistrer les préférences</button></footer>
    </form>
  </section>;
}
