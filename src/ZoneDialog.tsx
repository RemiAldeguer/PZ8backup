import { useRef, useState, type FormEvent } from 'react';
import type { Mutation, Project, Zone } from '../shared/types';
import { Modal } from './Dialogs';

export function ZoneDialog({ zone, mutate, onClose, notify }: { zone?: Zone | null; mutate: Mutation; onClose: () => void; notify: (message: string) => void }) {
  const [name, setName] = useState(zone?.name ?? '');
  const [color, setColor] = useState(zone?.color ?? '#0f766e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!name.trim()) { setError('Indiquez le nom de la zone.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    try { await mutate('zones', zone ? 'PATCH' : 'POST', { name: name.trim(), color }, zone?.id); notify(zone ? 'La zone a été modifiée.' : 'La zone a été créée.'); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'La zone n’a pas pu être enregistrée.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title={zone ? 'Modifier la zone' : 'Nouvelle zone'} onClose={() => { if (!inFlight.current) onClose(); }}>
    <form onSubmit={submit}>
      <div className="modal-body">
        <label className="form-field">Nom de la zone<input className="form-input" autoComplete="off" required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Ex. : Pôle France" /></label>
        <label className="form-field">Couleur<input className="form-input" type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button button-primary" disabled={busy}>{busy ? 'Enregistrement…' : zone ? 'Enregistrer' : 'Créer la zone'}</button></div>
    </form>
  </Modal>;
}

export function ZoneDeleteDialog({ zone, projects, mutate, onClose, onDeleted, notify }: { zone: Zone; projects: Project[]; mutate: Mutation; onClose: () => void; onDeleted: () => void; notify: (message: string) => void }) {
  // Freeze the projects the user is confirming; later arrivals must be reviewed separately.
  const [reviewedProjects] = useState(() => projects.map(project => ({ id: project.id, name: project.name })));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function remove() {
    if (inFlight.current || !confirmed) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await mutate('zones', 'DELETE', { deleteProjects: true, expectedProjectIds: reviewedProjects.map(project => project.id) }, zone.id); notify(reviewedProjects.length ? 'La zone et ses projets ont été supprimés.' : 'La zone a été supprimée.'); onDeleted(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'La zone n’a pas pu être supprimée.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title="Supprimer la zone" onClose={() => { if (!inFlight.current) onClose(); }}>
    <div className="modal-body">
      <p>Supprimer la zone <strong>{zone.name}</strong> ?</p>
      <p className="form-error" role="alert"><strong>Attention : cette action est définitive.</strong> {reviewedProjects.length > 0 ? <>Les {reviewedProjects.length} projet{reviewedProjects.length > 1 ? 's' : ''} ci-dessous seront supprimés avec leurs listes, tâches, jalons, temps saisis (y compris validés), documents, discussions, dépenses, recettes, rapports et données de capacité associées.</> : 'La zone sera supprimée.'}</p>
      {reviewedProjects.length > 0 && <ul className="zone-delete-projects" aria-label="Projets qui seront supprimés">{reviewedProjects.map(project => <li key={project.id}>{project.name}</li>)}</ul>}
      <p>Les ressources et leurs comptes de connexion seront conservés. Leurs appartenances à cette zone et à ses projets seront retirées.</p>
      <label className="zone-delete-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Je confirme la suppression définitive de cette zone{reviewedProjects.length > 0 ? ' et de ses projets' : ''}.</label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Annuler</button><button type="button" className="button button-danger" disabled={busy || !confirmed} onClick={remove}>{busy ? 'Suppression…' : reviewedProjects.length > 0 ? 'Supprimer la zone et ses projets' : 'Supprimer la zone'}</button></div>
  </Modal>;
}
