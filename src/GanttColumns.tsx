import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { type AppData, STATUS_LABELS } from '../shared/types';
import { type GanttColumn, type GanttColumnPreferences, normalizeGanttColumns } from '../shared/gantt-columns';
import { type ProjectGanttRow } from '../shared/project-gantt';
import { ganttDurationDays } from '../shared/gantt-dates';
import { formatDate, formatHours } from '../shared/domain';
import { customFieldImageSource, evaluateCustomFormula, parseMultipleChoices, safeCustomFieldUrl } from '../shared/custom-field-values';
import { isCivilDate } from '../shared/time-integration';
import { canProject } from '../shared/permissions';
import { Modal } from './Dialogs';
import { CustomRichTextPreview } from './CustomFieldInputs';

export function GanttColumnsDialog({ columns, preferences, onApply, onClose }: { columns: GanttColumn[]; preferences: GanttColumnPreferences; onApply: (value: GanttColumnPreferences) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => normalizeGanttColumns(preferences, columns));
  function reorder(id: string, delta: number) { setDraft(previous => { const order = [...previous.order]; const index = order.indexOf(id); const target = index + delta; if (target < 0 || target >= order.length) return previous; [order[index], order[target]] = [order[target], order[index]]; return { ...previous, order }; }); }
  return <Modal title="Configurer les colonnes du Gantt" onClose={onClose}><div className="modal-body"><p>Choisissez les informations du panneau Détails et leur ordre. Le nom reste toujours visible.</p><ol className="lc-config-list pzg-column-options" aria-label="Ordre des colonnes du Gantt">{draft.order.map((id, index) => { const column = columns.find(column => column.id === id)!; return <li key={id}><span className="lc-column-position">{index + 1}</span><label><input type="checkbox" checked={!draft.hidden.includes(id)} onChange={event => setDraft(previous => ({ ...previous, hidden: event.target.checked ? previous.hidden.filter(item => item !== id) : [...previous.hidden, id] }))} />{column.label}{column.field && <small>Champ personnalisé</small>}</label><div className="lc-order-controls"><button type="button" className="icon-button" aria-label={`Monter ${column.label}`} disabled={index === 0} onClick={() => reorder(id, -1)}><ArrowUp size={17} /></button><button type="button" className="icon-button" aria-label={`Descendre ${column.label}`} disabled={index === draft.order.length - 1} onClick={() => reorder(id, 1)}><ArrowDown size={17} /></button></div></li>; })}</ol><p className="lc-settings-note">Configuration personnelle conservée pour ce projet dans ce navigateur.</p></div><div className="modal-footer lc-config-footer"><button type="button" className="text-button" onClick={() => setDraft(normalizeGanttColumns(null, columns))}>Rétablir les colonnes</button><div className="modal-footer-actions"><button type="button" className="button button-secondary" onClick={onClose}>Annuler</button><button type="button" className="button button-primary" onClick={() => onApply(normalizeGanttColumns(draft, columns))}>Appliquer</button></div></div></Modal>;
}

export function GanttDetailValue({ column, row, data }: { column: GanttColumn; row: ProjectGanttRow; data: AppData }) {
  const task = row.task; const project = data.projects.find(project => project.id === task?.projectId || row.kind === 'project' && `project:${project.id}` === row.id);
  const ids = row.task ? [row.task.id] : row.node?.aggregate.taskIds ?? data.tasks.filter(task => task.projectId === project?.id).map(task => task.id);
  const descendants = data.tasks.filter(task => ids.includes(task.id));
  const spent = data.timeEntries.filter(entry => ids.includes(entry.taskId)).reduce((sum, entry) => sum + entry.hours, 0);
  let content: ReactNode = '—'; let title = column.label;
  if (column.id === 'status') content = task ? STATUS_LABELS[task.status] : '—';
  if (column.id === 'start') content = row.startDate ? formatDate(row.startDate) : '—';
  if (column.id === 'end') content = row.endDate ? formatDate(row.endDate) : '—';
  if (column.id === 'duration') { const days = task?.kind === 'milestone' ? 0 : ganttDurationDays(row); content = days === null ? '—' : `${days} j`; }
  if (column.id === 'allocated') content = formatHours(row.allocatedHours);
  if (column.id === 'spent') content = formatHours(spent);
  if (column.id === 'remaining') content = formatHours(row.allocatedHours - spent);
  if (column.id === 'progress') content = task ? `${task.progress} %` : row.allocatedHours ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(descendants.reduce((sum, task) => sum + task.allocatedHours * task.progress, 0) / row.allocatedHours)} %` : '—';
  if (column.id === 'tags') { const tags = [...new Set(descendants.flatMap(task => task.tags))]; title = tags.join(', ') || 'Aucun tag'; content = tags.length ? <span className="tag-list">{tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}</span> : '—'; }
  if (column.id === 'assignee') { const names = data.resources.filter(resource => descendants.some(task => task.assigneeId === resource.id)).map(resource => resource.name); content = names.join(', ') || '—'; title = String(content); }
  if (column.field) {
    const field = column.field; const values = field.scope === 'task' ? task?.customValues : row.kind === 'project' ? project?.customValues : undefined; const value = values?.[field.id] ?? '';
    title = value || column.label;
    if (field.type === 'formula' && values) {
      const protectedBudget = field.scope === 'project' && /\{budget\}/.test(field.formula ?? '') && project && !canProject(data, project.id, 'budget');
      const formula = protectedBudget ? { value: null } : evaluateCustomFormula(field, data.customFieldDefinitions ?? [], values, field.scope === 'task' ? { allocatedHours: task?.allocatedHours ?? 0, progress: task?.progress ?? 0 } : { budget: project?.budget ?? 0 });
      content = formula.value === null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(formula.value); title = 'error' in formula && formula.error ? formula.error : column.label;
    } else if (field.type === 'multi_select') content = parseMultipleChoices(value)?.join(', ') || value || '—';
    else if (field.type === 'rich_text' && value) content = <CustomRichTextPreview value={value} />;
    else if (field.type === 'date' && isCivilDate(value)) content = formatDate(value);
    else if (field.type === 'url' && safeCustomFieldUrl(value)) content = <a href={safeCustomFieldUrl(value)!} target="_blank" rel="noopener noreferrer">{value}</a>;
    else if (field.type === 'image' && customFieldImageSource(value)) content = <img src={customFieldImageSource(value)!} alt={column.label} loading="lazy" referrerPolicy="no-referrer" />;
    else content = value || '—';
  }
  return <div className={`pzg-detail-value pzg-detail-${column.id}`} data-gantt-column={column.id} style={{ width: column.width }} title={title}>{content}</div>;
}
