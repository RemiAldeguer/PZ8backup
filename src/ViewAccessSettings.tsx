import { useEffect, useRef, useState } from 'react';
import { ChevronDown, PanelsTopLeft } from 'lucide-react';
import type { AppData, ResourceRole } from '../shared/types';
import { WORKSPACE_VIEWS, type ViewRoleAssignments, type WorkspaceView } from '../shared/view-access';

function RolePicker({ view, roles, catalog, onChange }: {
  view: typeof WORKSPACE_VIEWS[number]; roles: ResourceRole[];
  catalog: NonNullable<AppData['viewRoleCatalog']>; onChange: (roles: ResourceRole[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const labels = catalog.filter(role => roles.includes(role.id)).map(role => role.label).join(', ') || 'Aucun rôle';
  return <div className="pz-view-picker" ref={root} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" aria-label={view.label} aria-expanded={open} aria-controls={'pz-view-roles-' + view.id} onClick={() => setOpen(previous => !previous)} title={labels}><span>{labels}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open && <fieldset id={'pz-view-roles-' + view.id} className="pz-view-options"><legend className="sr-only">Rôles autorisés : {view.label}</legend>{catalog.map(role => <label key={role.id}><input type="checkbox" checked={roles.includes(role.id)} onChange={event => onChange(event.target.checked ? [...roles, role.id] : roles.filter(id => id !== role.id))} />{role.label}</label>)}</fieldset>}
  </div>;
}

export function ViewAccessSettings({ data, values, onChange, disabled }: {
  data: AppData; values: Record<WorkspaceView, ResourceRole[]>;
  onChange: (value: ViewRoleAssignments) => void; disabled: boolean;
}) {
  const catalog = data.viewRoleCatalog ?? [];
  return <fieldset className="pz-view-settings" disabled={disabled || !catalog.length}><legend><PanelsTopLeft size={18} aria-hidden="true" />Vues</legend>
    <p className="pz-settings-note">Sélectionnez les rôles globaux autorisés pour chaque vue. Les droits de lecture et de modification des projets continuent de s’appliquer. Les paramètres restent accessibles aux administrateurs.</p>
    {!catalog.length && <p role="alert">Le catalogue des rôles est indisponible. Rechargez les paramètres.</p>}
    {WORKSPACE_VIEWS.map(view => <div className="pz-view-row" key={view.id}><span>{view.label}</span><RolePicker view={view} roles={values[view.id]} catalog={catalog} onChange={roles => onChange({ ...values, [view.id]: roles })} /></div>)}
  </fieldset>;
}
