import { useRef, useState, type FormEvent } from 'react';
import { Folder, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { AppData, Mutation, ProjectStatus } from '../shared/types';
import { PROJECT_STATUS_LABELS } from '../shared/types';
import type { ProjectStatusDefinition, StrategicAxis } from '../shared/customization';
import { Modal } from './Dialogs';
import './customization-governance.css';

interface GovernanceProps { data: AppData; mutate: Mutation; notify: (message: string) => void; }

const nativeStatuses: { status: ProjectStatus; description: string; color: string }[] = [
  { status: 'requested', description: 'Le projet nécessite une validation avant de pouvoir passer à l’état ouvert.', color: '#c8b717' },
  { status: 'open', description: 'Le projet est en cours de réalisation. Celui-ci est éditable.', color: '#309c53' },
  { status: 'paused', description: 'Le projet est interrompu. Ses tâches, temps, dépenses et recettes sont verrouillés.', color: '#ed724e' },
  { status: 'closed', description: 'Le projet clôturé est conservé pour archive. Ses tâches, temps, dépenses et recettes sont verrouillés.', color: '#889398' },
];
const defaultScale: StrategicAxis['scale'] = ['Fortement incohérent', 'Peu cohérent', 'Neutre', 'Cohérent', 'Renforce la mission'];
const scaleValues = [-2, -1, 0, 1, 2] as const;

function failure(error: unknown) { return error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.'; }
function textColor(color: string) {
  const components = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = components.map(component => component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2] > .179 ? '#17292f' : '#ffffff';
}

function NativeStatusRow({ status, description, color }: typeof nativeStatuses[number]) {
  return <div className="pg-status-row pg-native-status"><Folder size={18} color={color} aria-hidden="true" /><strong>{PROJECT_STATUS_LABELS[status]}</strong><p>{description}</p><span className="pg-native-label">Statut natif</span></div>;
}

export function ProjectStatusesView({ data, mutate, notify }: GovernanceProps) {
  const definitions = data.projectStatusDefinitions ?? [];
  const [editor, setEditor] = useState<ProjectStatusDefinition | null | undefined>();
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleting = useRef(false);
  const remove = async (definition: ProjectStatusDefinition) => {
    if (deleting.current || !window.confirm(`Supprimer le statut « ${definition.name} » ? Un statut utilisé par un projet doit d’abord être remplacé dans ce projet.`)) return;
    deleting.current = true; setDeletingId(definition.id); setError('');
    try { await mutate('project-status-definitions', 'DELETE', undefined, definition.id); notify('Le statut a été supprimé.'); }
    catch (err) { setError(failure(err)); }
    finally { deleting.current = false; setDeletingId(null); }
  };
  return <section className="pg-view" aria-labelledby="pg-title">
    <div className="pg-intro"><h2 id="pg-title">Gestion des statuts du projet</h2><p>Ajoutez des statuts de projet et choisissez le comportement associé.</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pg-status-list">
      {nativeStatuses.slice(0, 3).map(status => <NativeStatusRow key={status.status} {...status} />)}
      {definitions.map(definition => <div className="pg-status-row pg-custom-status" key={definition.id}>
        <Folder size={18} color={definition.color} aria-hidden="true" />
        <strong>{definition.name}</strong><p>{definition.description}</p>
        <span className="pg-behavior">{PROJECT_STATUS_LABELS[definition.baseStatus]}</span>
        <div className="pg-row-actions"><button type="button" className="pg-action" disabled={deletingId !== null} onClick={() => { setError(''); setEditor(definition); }} aria-label={`Modifier le statut ${definition.name}`}><Pencil size={16} /></button>
          <button type="button" className="pg-action pg-delete" disabled={deletingId !== null} onClick={() => void remove(definition)} aria-label={`Supprimer le statut ${definition.name}`}><Trash2 size={16} /></button></div>
      </div>)}
      {!definitions.length && <p className="pg-empty-note">Aucun statut personnalisé. Les statuts natifs sont disponibles dans tous vos projets.</p>}
      <button className="pg-new-status" type="button" disabled={deletingId !== null} onClick={() => { setError(''); setEditor(null); }}><Plus size={18} />Nouveau statut</button>
      <div className="pg-closed-status"><NativeStatusRow {...nativeStatuses[3]} /></div>
    </div>
    {editor !== undefined && <StatusDialog key={editor?.id ?? 'new'} definition={editor} mutate={mutate} notify={notify} onClose={() => setEditor(undefined)} />}
  </section>;
}

function StatusDialog({ definition, mutate, notify, onClose }: { definition: ProjectStatusDefinition | null; mutate: Mutation; notify: GovernanceProps['notify']; onClose: () => void }) {
  const [draft, setDraft] = useState({ name: definition?.name ?? '', description: definition?.description ?? '', color: definition?.color ?? '#58c9e9', baseStatus: definition?.baseStatus ?? 'requested' as ProjectStatus });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const inFlight = useRef(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await mutate('project-status-definitions', definition ? 'PATCH' : 'POST', { ...draft, name: draft.name.trim(), description: draft.description.trim() }, definition?.id);
      notify(definition ? 'Le statut a été enregistré.' : 'Le statut a été créé.'); onClose();
    } catch (err) { setError(failure(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="pg-dialog"><Modal title={definition ? 'Modifier le statut' : 'Nouveau statut'} onClose={() => { if (!inFlight.current) onClose(); }}>
    <form onSubmit={save}><div className="modal-body"><fieldset disabled={busy}>
      <label className="form-field">Nom du statut<input className="form-input" required maxLength={200} value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} placeholder="Ex. : À qualifier" /></label>
      <label className="form-field">Description<textarea className="form-input" rows={3} maxLength={10000} value={draft.description} onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))} /></label>
      <div className="form-grid"><label className="form-field">Couleur<input className="form-input pg-color-input" type="color" value={draft.color} onChange={event => setDraft(previous => ({ ...previous, color: event.target.value }))} /></label>
        <label className="form-field">Comportement du projet<select className="form-input" value={draft.baseStatus} onChange={event => setDraft(previous => ({ ...previous, baseStatus: event.target.value as ProjectStatus }))}>{Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <p className="pg-form-note">{nativeStatuses.find(status => status.status === draft.baseStatus)?.description}</p>
      {definition && <p className="pg-form-note">Le comportement d’un statut déjà utilisé ne peut pas être modifié. Changez d’abord le statut des projets concernés.</p>}
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}</div>
    <div className="modal-footer"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Annuler</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : definition ? 'Enregistrer le statut' : 'Créer le statut'}</button></div></form>
  </Modal></div>;
}

export function StrategicAxesView({ data, mutate, notify }: GovernanceProps) {
  const axes = data.strategicAxes ?? [];
  const [editor, setEditor] = useState<StrategicAxis | null | undefined>();
  const [error, setError] = useState(''); const [deletingId, setDeletingId] = useState<string | null>(null); const deleting = useRef(false);
  const remove = async (axis: StrategicAxis) => {
    if (deleting.current || !window.confirm(`Supprimer l’axe stratégique « ${axis.code} » ? Un axe évalué dans un projet doit d’abord être retiré de ce projet.`)) return;
    deleting.current = true; setDeletingId(axis.id); setError('');
    try { await mutate('strategic-axes', 'DELETE', undefined, axis.id); notify('L’axe stratégique a été supprimé.'); }
    catch (err) { setError(failure(err)); }
    finally { deleting.current = false; setDeletingId(null); }
  };
  return <section className="sa-view" aria-label="Axes stratégiques">
    <div className="sa-toolbar"><button type="button" className="button button-primary" disabled={deletingId !== null} onClick={() => { setError(''); setEditor(null); }}><Plus size={16} />Axe stratégique</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {axes.length ? <div className="sa-table-scroll" role="region" aria-label="Liste des axes stratégiques" tabIndex={0}><table className="sa-table">
      <colgroup><col className="sa-code-column" /><col className="sa-name-column" />{scaleValues.map(value => <col key={value} />)}<col className="sa-weight-column" /><col className="sa-actions-column" /></colgroup>
      <thead><tr className="sa-scale-title"><th colSpan={2} /><th colSpan={5} scope="colgroup">Possibilités de cohérence du projet avec la stratégie</th><th colSpan={2} /></tr>
        <tr><th scope="col">Code</th><th scope="col">Axe stratégique</th>{scaleValues.map(value => <th key={value} scope="col">{value}</th>)}<th scope="col">Poids</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{axes.map(axis => <tr key={axis.id}><td><span className="sa-code-badge" style={{ backgroundColor: axis.color, color: textColor(axis.color) }}>{axis.code}</span></td><td>{axis.name}</td>{axis.scale.map((label, index) => <td key={index}>{label}</td>)}<td className="sa-weight">{axis.weight}</td>
        <td><div className="sa-row-actions"><button type="button" className="pg-action" disabled={deletingId !== null} onClick={() => { setError(''); setEditor(axis); }} aria-label={`Modifier l’axe ${axis.code}`}><Pencil size={16} /></button><button type="button" className="pg-action pg-delete" disabled={deletingId !== null} onClick={() => void remove(axis)} aria-label={`Supprimer l’axe ${axis.code}`}><Trash2 size={16} /></button></div></td></tr>)}</tbody>
    </table></div> : <div className="sa-empty"><Target size={36} /><h2>Aucun axe stratégique</h2><p>Ajoutez vos axes et leur poids, puis évaluez leur cohérence dans les paramètres de chaque projet.</p><button className="button button-secondary" type="button" onClick={() => setEditor(null)}><Plus size={16} />Créer un axe stratégique</button></div>}
    {editor !== undefined && <AxisDialog key={editor?.id ?? 'new'} axis={editor} mutate={mutate} notify={notify} onClose={() => setEditor(undefined)} />}
  </section>;
}

function AxisDialog({ axis, mutate, notify, onClose }: { axis: StrategicAxis | null; mutate: Mutation; notify: GovernanceProps['notify']; onClose: () => void }) {
  const [draft, setDraft] = useState({ code: axis?.code ?? '', name: axis?.name ?? '', color: axis?.color ?? '#48228c', weight: axis?.weight ?? 1, scale: [...(axis?.scale ?? defaultScale)] as StrategicAxis['scale'] });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const inFlight = useRef(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await mutate('strategic-axes', axis ? 'PATCH' : 'POST', { ...draft, code: draft.code.trim(), name: draft.name.trim(), scale: draft.scale.map(label => label.trim()) }, axis?.id);
      notify(axis ? 'L’axe stratégique a été enregistré.' : 'L’axe stratégique a été créé.'); onClose();
    } catch (err) { setError(failure(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const setScale = (index: number, label: string) => setDraft(previous => { const scale = [...previous.scale] as StrategicAxis['scale']; scale[index] = label; return { ...previous, scale }; });
  return <div className="sa-dialog"><Modal title={axis ? 'Modifier l’axe stratégique' : 'Nouvel axe stratégique'} onClose={() => { if (!inFlight.current) onClose(); }}>
    <form onSubmit={save}><div className="modal-body"><fieldset disabled={busy}>
      <label className="form-field">Code<input className="form-input" required maxLength={100} value={draft.code} onChange={event => setDraft(previous => ({ ...previous, code: event.target.value }))} placeholder="Ex. : INNOVATION" /></label>
      <label className="form-field">Nom de l’axe stratégique<input className="form-input" required maxLength={200} value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} placeholder="Ex. : Innovation et développement de produits" /></label>
      <div className="form-grid"><label className="form-field">Couleur<input className="form-input pg-color-input" type="color" value={draft.color} onChange={event => setDraft(previous => ({ ...previous, color: event.target.value }))} /></label><label className="form-field">Poids<input className="form-input" required type="number" min={0} max={1000} step={1} value={draft.weight} onChange={event => setDraft(previous => ({ ...previous, weight: Number(event.target.value) }))} /></label></div>
      <h3 className="sa-form-scale-title">Échelle de cohérence</h3><p className="pg-form-note">Le score stratégique du projet additionne chaque évaluation (de −2 à 2) multipliée par son poids.</p>
      <div className="sa-scale-fields">{scaleValues.map((value, index) => <label className="form-field" key={value}>Libellé pour {value}<input className="form-input" required maxLength={200} value={draft.scale[index]} onChange={event => setScale(index, event.target.value)} /></label>)}</div>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}</div>
    <div className="modal-footer"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Annuler</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : axis ? 'Enregistrer l’axe' : 'Créer l’axe stratégique'}</button></div></form>
  </Modal></div>;
}
