import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, Box, Check, ChevronDown, Folder, Plus, Settings2, Trash2, UserRound, Users, X } from 'lucide-react';
import type { AppData, Mutation, Project, Resource, ResourceCustomField, ResourceRole, WeeklyCapacity } from '../shared/types';
import { RESOURCE_ROLE_LABELS } from '../shared/types';
import { associatedResourceProjectIds, normalizeResource } from '../shared/resources';
import { CustomFieldInputs } from './CustomFieldInputs';
import './ResourceDialog.css';
import { resourceManagementDescendantIds } from '../shared/organization';
import { isAdmin } from '../shared/permissions';
import { ResourceProfileDialog } from './ResourceProfileDialog';
import { MemberAccess } from './MemberAccess';
import { GLOBAL_ROLE_DESCRIPTIONS } from './RoleSelect';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const initialsFor = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? '').join('').toUpperCase() || 'R';
const resourceDefaults: Resource = { id: '', name: '', jobTitle: '', type: 'human', classification: 'internal', initials: 'R', color: '#0EA5A8', dailyHours: 8, mondayHours: 8, profileId: null, active: true };
const fieldTypes = { text: 'Texte', number: 'Nombre', date: 'Date', url: 'Lien' };

function ResourceAvatar({ resource, small = false }: { resource: Pick<Resource, 'name' | 'initials' | 'color'>; small?: boolean }) {
  const rgb = resource.color.match(/[a-f0-9]{2}/gi)?.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }) ?? [0, 0, 0];
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  return <span className={`rd-avatar ${small ? 'rd-avatar-small' : ''}`} style={{ backgroundColor: resource.color, color: luminance > .179 ? '#000' : '#fff' }} aria-hidden="true">{resource.initials || initialsFor(resource.name)}</span>;
}

export function ResourceDialog(props: Parameters<typeof AdminResourceDialog>[0]) { return isAdmin(props.data) ? <AdminResourceDialog {...props} /> : <ResourceProfileDialog {...props} />; }

function AdminResourceDialog({ resource, data, initialProjectId, mutate, onClose, notify, openProject, onAccountCreated }: {
  resource: Resource | null; data: AppData; mutate: Mutation;
  initialProjectId?: string; onAccountCreated?: () => Promise<void>;
  onClose: () => void; notify: (message: string) => void; openProject?: (project: Project) => void;
}) {
  const [draft, setDraft] = useState(() => normalizeResource(resource ?? { ...resourceDefaults, projectIds: data.projects.some(project => project.id === initialProjectId) ? [initialProjectId!] : [] }));
  const [choosingType, setChoosingType] = useState(!resource);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => ({ ...resource?.customValues }));
  const [busy, setBusy] = useState(false);
  const [imageReading, setImageReading] = useState(false);
  const saveInFlight = useRef(false);
  const [error, setError] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [tagColor, setTagColor] = useState('#6366F1');
  const [editingTags, setEditingTags] = useState(false);
  const [editingCustomFields, setEditingCustomFields] = useState(false);
  const [editingProjects, setEditingProjects] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!choosingType) nameInput.current?.focus(); }, [choosingType]);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    nameInput.current?.focus();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const profile = data.profiles.find(item => item.id === draft.profileId);
  const derivedProjectIds = new Set(resource ? data.tasks.filter(task => task.assigneeId === resource.id).map(task => task.projectId) : []);
  const associatedProjectIds = new Set(associatedResourceProjectIds(draft, data.tasks, data.projects));
  const associatedProjects = data.projects.filter(project => associatedProjectIds.has(project.id));
  const excludedManagers = resourceManagementDescendantIds(data.resources, resource?.id ?? '');
  const eligibleValidators = [...data.resources].sort((a, b) => Number(b.type === 'human') - Number(a.type === 'human') || a.name.localeCompare(b.name, 'fr'));

  function toggleValidation(id: string) {
    field('validatesTimeForIds', draft.validatesTimeForIds.includes(id) ? draft.validatesTimeForIds.filter(item => item !== id) : [...draft.validatesTimeForIds, id]);
  }
  function toggleProject(id: string) {
    field('projectIds', draft.projectIds.includes(id) ? draft.projectIds.filter(item => item !== id) : [...draft.projectIds, id]);
  }
  function capacity(index: number, value: number) {
    const hours = [...draft.weeklyCapacityHours] as WeeklyCapacity;
    hours[index] = Math.round(value * (draft.capacityUnit === 'days' ? draft.hoursPerDay : 1) * 10000) / 10000;
    field('weeklyCapacityHours', hours);
  }
  function addTag() {
    const label = tagLabel.trim();
    if (!label) return;
    if (draft.tags.some(tag => tag.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr'))) { setError('Ce tag existe déjà pour cette ressource.'); return; }
    field('tags', [...draft.tags, { label, color: tagColor }]); setTagLabel(''); setError('');
  }
  function addCustomField() {
    field('customFields', [...draft.customFields, { id: crypto.randomUUID(), label: '', type: 'text', value: '' }]);
    setEditingCustomFields(true);
  }
  function updateCustomField(id: string, patch: Partial<ResourceCustomField>) {
    field('customFields', draft.customFields.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saveInFlight.current || imageReading) return;
    saveInFlight.current = true; setBusy(true); setError('');
    try {
      const { id: _id, timeIntegrationDate: _timeIntegrationDate, ...payload } = draft;
      await mutate('resources', resource ? 'PATCH' : 'POST', {
        ...payload, name: draft.name.trim(), email: draft.email.trim(), initials: initialsFor(draft.name),
        mondayHours: draft.weeklyCapacityHours[0], dailyHours: draft.weeklyCapacityHours[1],
        ...(Object.keys(customValues).length || resource?.customValues ? { customValues } : {}),
      }, resource?.id);
      notify(resource ? 'La fiche ressource a été enregistrée.' : draft.type === 'human' ? 'Le membre a été ajouté à la Planzone.' : draft.type === 'virtual' ? 'La ressource virtuelle a été créée.' : 'La ressource matérielle a été créée.'); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'La fiche n’a pas pu être enregistrée. Réessayez.'); }
    finally { saveInFlight.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className={`resource-dialog${choosingType ? ' rd-choosing-type' : ''}`} aria-labelledby="resource-dialog-title" onCancel={event => { event.preventDefault(); if (!busy && !imageReading) onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget || busy || imageReading) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    {choosingType ? <div className="rd-creation-choice"><header className="rd-header"><h2 id="resource-dialog-title">Nouvelle ressource</h2><button type="button" className="rd-close" aria-label="Fermer la fiche ressource" onClick={onClose}><X size={23} /></button></header><div className="rd-choice-body"><h3>Quelle ressource voulez-vous ajouter à la Planzone ?</h3><div className="rd-choice-grid">{([
      { type: 'human', label: 'Ajouter un membre', detail: 'Une personne avec sa fonction, son rôle et sa capacité hebdomadaire.', icon: UserRound },
      { type: 'virtual', label: 'Ressource virtuelle', detail: 'Une équipe, un rôle ou une compétence pour planifier vos besoins.', icon: Bot },
      { type: 'material', label: 'Ressource matérielle', detail: 'Un équipement, une machine ou un autre moyen matériel.', icon: Box },
    ] as const).map(option => <button type="button" key={option.type} aria-label={option.label} onClick={() => { setDraft(previous => ({ ...previous, type: option.type, ...(option.type !== 'human' ? { email: '', role: 'user' as ResourceRole } : {}) })); setChoosingType(false); }}><option.icon size={37} /><strong>{option.label}</strong><span>{option.detail}</span></button>)}</div></div></div> : <form onSubmit={save} className="rd-form">
      <header className="rd-header"><h2 id="resource-dialog-title">{resource ? 'Fiche ressource' : draft.type === 'human' ? 'Ajouter un membre' : draft.type === 'virtual' ? 'Créer une ressource virtuelle' : 'Créer une ressource matérielle'}</h2><button type="button" className="rd-close" aria-label="Fermer la fiche ressource" disabled={busy || imageReading} onClick={onClose}><X size={23} /></button></header>
      <div className="rd-scroll"><fieldset className="rd-content" disabled={busy || imageReading}>
        <section className="rd-column rd-identity-column" aria-label="Identité et informations">
          {!resource && <div className="rd-new-context"><button type="button" onClick={() => setChoosingType(true)}><ArrowLeft size={15} />Changer de type</button><span>{draft.type === 'human' ? 'Membre de la Planzone' : draft.type === 'virtual' ? 'Ressource virtuelle' : 'Ressource matérielle'}</span></div>}
          <div className="rd-identity"><ResourceAvatar resource={{ ...draft, initials: initialsFor(draft.name) }} /><div><strong>{draft.name.trim() || 'Nouvelle ressource'}</strong><span>{draft.email || (draft.type === 'human' ? 'Adresse e-mail non renseignée' : draft.type === 'virtual' ? 'Ressource virtuelle' : 'Ressource matérielle')}</span></div></div>
          <label className="rd-field">Nom de la ressource<input ref={nameInput} required maxLength={200} value={draft.name} placeholder="Prénom et nom, équipe ou matériel" onChange={event => field('name', event.target.value)} /></label>
          <label className="rd-field">Fonction dans l’organisation<input aria-label="Fonction dans l’organisation" maxLength={200} value={draft.jobTitle} placeholder="Ex. : Chef de projet" onChange={event => field('jobTitle', event.target.value)} /></label>
          {draft.type === 'human' && <div className="rd-field-pair"><label className="rd-field">Rôle<select disabled={resource?.id === 'resource-claire'} value={draft.role} onChange={event => field('role', event.target.value as ResourceRole)}>{Object.entries(RESOURCE_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="rd-field">Adresse e-mail<input type="email" maxLength={254} value={draft.email} placeholder="nom@exemple.fr" onChange={event => field('email', event.target.value)} /></label></div>}
          {draft.type === 'human' && <p className="rd-hint">{GLOBAL_ROLE_DESCRIPTIONS[draft.role]}</p>}
          {resource && <MemberAccess data={data} resource={resource} onCreated={onAccountCreated} />}
          {!resource && draft.type === 'human' && <p className="rd-hint">Le membre pourra être affecté aux tâches et associé aux projets de cette Planzone.</p>}
          <label className="rd-field">Responsable<select aria-label="Responsable de la ressource" value={draft.managerId ?? ''} onChange={event => field('managerId', event.target.value || null)}><option value="">Aucun responsable</option>{data.resources.filter(item => !excludedManagers.has(item.id) && item.type !== 'material').map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}</select></label>
          <label className="rd-field">Description <span className="rd-optional">(optionnelle)</span><textarea rows={4} maxLength={10000} value={draft.description} placeholder="Responsabilités, compétences et informations utiles…" onChange={event => field('description', event.target.value)} /></label>

          <CustomFieldInputs definitions={data.customFieldDefinitions ?? []} scope="resource" values={customValues} onChange={setCustomValues} heading="Champs de l’organisation" onPendingChange={setImageReading} />

          <section className="rd-section rd-custom-fields"><div className="rd-section-heading"><h3>Champs personnalisés</h3><button type="button" className="rd-icon-button" aria-label="Configurer les champs personnalisés" aria-pressed={editingCustomFields} onClick={() => setEditingCustomFields(!editingCustomFields)}><Settings2 size={18} /></button></div>
            {draft.customFields.length ? <div className="rd-custom-list">{draft.customFields.map((item, index) => <div className={`rd-custom-item ${editingCustomFields ? 'editing' : ''}`} key={item.id}>
              {editingCustomFields ? <div className="rd-custom-definition"><input required aria-label={`Nom du champ personnalisé ${index + 1}`} maxLength={100} placeholder="Nom du champ" value={item.label} onChange={event => updateCustomField(item.id, { label: event.target.value })} /><select aria-label={`Type du champ personnalisé ${index + 1}`} value={item.type} onChange={event => updateCustomField(item.id, { type: event.target.value as ResourceCustomField['type'], value: '' })}>{Object.entries(fieldTypes).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select><button type="button" className="rd-icon-button rd-delete" aria-label={`Supprimer le champ ${item.label || index + 1}`} onClick={() => field('customFields', draft.customFields.filter(other => other.id !== item.id))}><Trash2 size={16} /></button></div> : <label htmlFor={`rd-custom-${item.id}`}>{item.label}</label>}
              <input id={`rd-custom-${item.id}`} aria-label={editingCustomFields ? `Valeur du champ personnalisé ${index + 1}` : item.label} type={item.type === 'text' ? 'text' : item.type} step={item.type === 'number' ? 'any' : undefined} maxLength={10000} value={item.value} placeholder={item.type === 'url' ? 'https://…' : 'Valeur'} onChange={event => updateCustomField(item.id, { value: event.target.value })} />
            </div>)}</div> : <p className="rd-empty">Ajoutez les informations propres à votre organisation.</p>}
            <button type="button" className="rd-text-button" onClick={addCustomField} disabled={draft.customFields.length >= 25}><Plus size={15} />Ajouter un champ</button>
          </section>

          <fieldset className="rd-zone-access"><legend>Zones accessibles</legend>{data.zones.map(zone => <label className="rd-checkbox" key={zone.id}><input type="checkbox" checked={draft.zoneIds?.includes(zone.id) ?? false} onChange={event => field('zoneIds', event.target.checked ? [...draft.zoneIds ?? [], zone.id] : (draft.zoneIds ?? []).filter(id => id !== zone.id))} />{zone.name}</label>)}</fieldset>
          <details className="rd-settings"><summary><Settings2 size={16} />Paramètres de la ressource<ChevronDown size={16} /></summary><div className="rd-settings-fields"><label className="rd-field">Nature de ressource<select disabled={resource?.id === 'resource-claire'} value={draft.type} onChange={event => field('type', event.target.value as Resource['type'])}><option value="human">Humaine</option><option value="virtual">Virtuelle</option><option value="material">Matérielle</option></select></label><label className="rd-field rd-color-field">Couleur<input type="color" value={draft.color} onChange={event => field('color', event.target.value)} /></label><label className="rd-checkbox"><input type="checkbox" disabled={resource?.id === 'resource-claire'} checked={draft.active} onChange={event => field('active', event.target.checked)} />Ressource active</label></div></details>
        </section>

        <section className="rd-column" aria-label="Organisation, capacité et projets">
          <div className="rd-profile-tags"><div className="rd-profile"><span className={`rd-profile-pill ${profile ? '' : 'unassigned'}`}><UserRound size={15} />{profile ? <>{profile.name}<strong>{new Intl.NumberFormat('fr-FR').format(profile.dailyRate)} € / Eqjt</strong></> : 'Sans profil tarifaire'}</span><label className="rd-field"><span className="rd-sr-only">Profil tarifaire</span><select aria-label="Profil tarifaire" value={draft.profileId ?? ''} onChange={event => field('profileId', event.target.value || null)}><option value="">Aucun profil tarifaire</option>{data.profiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.dailyRate} € / Eqjt</option>)}</select></label></div>
            <div className="rd-tags"><div className="rd-section-heading"><h3>Tags ressource</h3><button type="button" className="rd-icon-button" aria-label="Modifier les tags ressource" aria-expanded={editingTags} onClick={() => setEditingTags(!editingTags)}><Plus size={18} /></button></div><div className="rd-tag-list">{draft.tags.length ? draft.tags.map((tag, index) => <span className="rd-tag" key={tag.label} style={{ '--rd-tag-color': tag.color } as React.CSSProperties}>{tag.label}<button type="button" aria-label={`Retirer le tag ${tag.label}`} onClick={() => field('tags', draft.tags.filter((_item, itemIndex) => itemIndex !== index))}><X size={12} /></button></span>) : <span className="rd-muted">Aucun tag</span>}</div>{editingTags && <div className="rd-tag-composer"><input aria-label="Nom du tag ressource" maxLength={50} value={tagLabel} placeholder="Nom du tag" onChange={event => setTagLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} /><input type="color" aria-label="Couleur du tag ressource" value={tagColor} onChange={event => setTagColor(event.target.value)} /><button type="button" className="rd-icon-button" aria-label="Ajouter le tag ressource" disabled={!tagLabel.trim() || draft.tags.length >= 20} onClick={addTag}><Check size={18} /></button></div>}</div>
          </div>

          <section className="rd-section rd-validation"><div className="rd-section-heading"><h3>Gère la validation des temps de</h3><Users size={17} /></div><div className="rd-validation-grid">{eligibleValidators.map(item => <label className={`rd-validation-person ${draft.validatesTimeForIds.includes(item.id) ? 'selected' : ''}`} key={item.id} title={item.name}><input type="checkbox" checked={draft.validatesTimeForIds.includes(item.id)} aria-label={`Valide les temps de ${item.name}`} onChange={() => toggleValidation(item.id)} /><ResourceAvatar resource={item} small /><span>{item.name}{!item.active ? ' (inactive)' : ''}</span></label>)}</div><p className="rd-hint">{draft.role === 'administrator' ? 'Dans cette démonstration, un administrateur peut valider les temps de toutes les ressources.' : draft.role === 'visitor' ? 'Un visiteur ne peut pas valider de temps. Les délégations sont conservées.' : 'Ces délégations autorisent la validation et le retrait de validation des temps.'}</p></section>

          <label className="rd-checkbox rd-external"><input type="checkbox" checked={draft.classification === 'external'} onChange={event => field('classification', event.target.checked ? 'external' : 'internal')} />Cette ressource est externe</label>

          <section className="rd-section rd-capacity"><div className="rd-section-heading"><h3>Capacité hebdomadaire</h3><label className="rd-unit-label">Unité<select aria-label="Unité de capacité" value={draft.capacityUnit} onChange={event => field('capacityUnit', event.target.value as 'hours' | 'days')}><option value="hours">Heures</option><option value="days">Jours</option></select></label></div><div className="rd-capacity-table"><div className="rd-capacity-unit" aria-hidden="true">{draft.capacityUnit === 'days' ? 'jours' : 'heures'}</div>{DAYS.map((day, index) => <label className="rd-capacity-day" key={day}><span>{day}</span><input aria-label={`Capacité du ${day.toLocaleLowerCase('fr')} (${draft.capacityUnit === 'days' ? 'jours/jour' : 'h/jour'})`} type="number" min="0" max={draft.capacityUnit === 'days' ? 168 / draft.hoursPerDay : 168} step="any" value={Number((draft.weeklyCapacityHours[index] / (draft.capacityUnit === 'days' ? draft.hoursPerDay : 1)).toFixed(4))} onChange={event => capacity(index, Number(event.target.value))} /></label>)}</div>{draft.capacityUnit === 'days' && <label className="rd-day-conversion">Heures par jour<input type="number" aria-label="Heures par jour de capacité" min="0.25" max="24" step="0.25" value={draft.hoursPerDay} onChange={event => { const next = Number(event.target.value); if (next > 0) field('hoursPerDay', next); }} /><span>La capacité enregistrée reste la même lors d’un changement d’unité.</span></label>}</section>

          <label className="rd-field">Calendrier de jours fériés<select value={draft.holidayCalendarId} onChange={event => field('holidayCalendarId', event.target.value as 'none' | 'fr')}><option value="none">Aucun calendrier de jours fériés</option><option value="fr">Férié FR · France métropolitaine</option></select><span className="rd-hint">Les jours fériés du calendrier choisi sont exclus de la capacité.</span></label>

          <section className="rd-section rd-projects"><div className="rd-section-heading"><h3>Projets</h3><button type="button" className="rd-text-button" aria-expanded={editingProjects} onClick={() => setEditingProjects(!editingProjects)}><Plus size={15} />Associer un projet</button></div><div className="rd-project-list">{associatedProjects.length ? associatedProjects.map(project => <div className="rd-project-row" key={project.id}><Folder size={18} /><strong>{project.name}</strong>{derivedProjectIds.has(project.id) ? <span className="rd-project-source">Affectation à une tâche</span> : <button type="button" className="rd-icon-button" aria-label={`Retirer le projet ${project.name}`} onClick={() => toggleProject(project.id)}><X size={15} /></button>}{openProject && <button type="button" className="rd-icon-button" aria-label={`Ouvrir le projet ${project.name}`} onClick={() => { onClose(); openProject(project); }}><ArrowUpRight size={16} /></button>}</div>) : <p className="rd-empty">Aucun projet associé.</p>}</div>{editingProjects && <div className="rd-project-picker"><input type="search" aria-label="Rechercher un projet à associer" placeholder="Rechercher un projet…" value={projectQuery} onChange={event => setProjectQuery(event.target.value)} /><div>{data.projects.filter(project => project.name.toLocaleLowerCase('fr').includes(projectQuery.toLocaleLowerCase('fr'))).map(project => <label className="rd-checkbox" key={project.id}><input type="checkbox" aria-label={`Associer au projet ${project.name}`} disabled={derivedProjectIds.has(project.id)} checked={associatedProjectIds.has(project.id)} onChange={() => toggleProject(project.id)} /><span>{project.name}</span>{derivedProjectIds.has(project.id) && <span className="rd-muted">Via une tâche</span>}</label>)}</div></div>}<p className="rd-hint">Les projets liés à une tâche restent associés tant que la ressource y est affectée.</p></section>
        </section>
      </fieldset></div>
      <footer className="rd-footer">{error && <p className="rd-error" role="alert">{error}</p>}<div className="rd-actions"><button type="button" className="button button-secondary" disabled={busy || imageReading} onClick={onClose}>Annuler</button><button type="submit" className="button button-primary" disabled={busy || imageReading}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div></footer>
    </form>}
  </dialog>;
}
