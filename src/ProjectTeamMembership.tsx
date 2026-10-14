import { useRef, useState, type FormEvent } from 'react';
import { Plus, Users } from 'lucide-react';
import type { ViewProps } from '../shared/types';
import { canProject, isAdmin, projectMemberIds } from '../shared/permissions';
import { associatedResourceProjectIds } from '../shared/resources';
import { Modal } from './Dialogs';

export function ProjectTeamMembership({ props }: { props: ViewProps }) {
  const [open, setOpen] = useState(false); const [resourceId, setResourceId] = useState('');
  const [query, setQuery] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const saving = useRef(false);
  const locked = props.project.status === 'paused' || props.project.status === 'closed' || !canProject(props.data, props.project.id, 'team');
  const choices = props.data.resources.filter(resource => resource.active && !projectMemberIds(props.data, props.project).has(resource.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const filtered = choices.filter(resource => `${resource.name} ${resource.jobTitle}`.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  const add = async (event: FormEvent) => {
    event.preventDefault(); if (saving.current || locked) return;
    const resource = choices.find(item => item.id === resourceId); if (!resource) return;
    saving.current = true; setBusy(true); setError('');
    try { await props.mutate('resources', 'PATCH', { projectIds: [...new Set([...resource.projectIds ?? [], props.project.id])] }, resource.id); props.notify('La ressource a été ajoutée à l’équipe du projet.'); setOpen(false); setResourceId(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Ajout impossible.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <><div className="proj-toolbar"><button className="button button-primary" disabled={locked} onClick={() => setOpen(true)}><Plus size={17} />Ajouter une ressource</button></div>{open && <Modal title="Ajouter une ressource au projet" className="prc-dialog" onClose={() => { if (!busy) setOpen(false); }}><form onSubmit={add}><div className="modal-body"><p className="form-notice"><Users size={17} />Choisissez une ressource déjà présente dans la Planzone.</p><label className="form-field">Rechercher dans la Planzone<input className="form-input" value={query} onChange={event => { setQuery(event.target.value); setResourceId(''); }} placeholder="Nom ou fonction…" /></label><label className="form-field">Ressource de la Planzone<select className="form-input" value={resourceId} required disabled={busy} onChange={event => setResourceId(event.target.value)}><option value="">Sélectionner une ressource</option>{filtered.map(resource => <option key={resource.id} value={resource.id}>{resource.name} · {resource.type === 'human' ? 'Membre' : resource.type === 'virtual' ? 'Virtuelle' : 'Matérielle'}</option>)}</select></label>{!filtered.length && <p className="muted">Aucune autre ressource disponible dans ce périmètre.</p>}<button type="button" className="button button-secondary" disabled={busy || !props.openResource || !isAdmin(props.data)} onClick={() => { setOpen(false); props.openResource?.(null); }}><Plus size={16} />Créer une nouvelle ressource</button>{error && <p role="alert" className="form-error">{error}</p>}</div><footer className="modal-footer"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setOpen(false)}>Annuler</button><button className="button button-primary" disabled={busy || !resourceId}>{busy ? 'Ajout…' : 'Ajouter au projet'}</button></footer></form></Modal>}</>;
}
