import type { CustomFieldDefinition } from '../../shared/customization';
import type { TableColumn } from '../table/column-preferences';

export const BUDGET_COLUMNS = [
  { key: 'allocated', label: 'Alloué', metric: 'budget-allocated', explanation: 'Budget alloué au projet.' },
  { key: 'planned', label: 'Planifié', metric: 'budget-planned', explanation: 'Valorisation des heures allouées aux tâches au tarif actuel des profils, plus les dépenses prévues ou payées.' },
  { key: 'actual', label: 'Réel', metric: 'budget-actual', explanation: 'Valorisation des temps saisis avec leur tarif historique, plus les dépenses payées. Les temps non validés sont inclus.' },
  { key: 'plannedMargin', label: 'Marge planifiée', metric: 'budget-planned-margin', explanation: 'Budget alloué moins le budget planifié.' },
  { key: 'actualMargin', label: 'Marge réelle', metric: 'budget-actual-margin', explanation: 'Budget alloué moins le coût réel.' },
  { key: 'earned', label: 'Acquis', metric: 'budget-earned', explanation: 'Valorisation des allocations selon l’avancement des tâches, hors dépenses.' },
] as const;
export type ProjectMetricId = 'realized' | 'late' | 'open' | 'allocated' | 'spent' | 'remaining';
export interface ProjectTableColumn extends TableColumn { heading?: string; group?: 'activity' | 'work' | 'budget'; metric?: ProjectMetricId; budget?: typeof BUDGET_COLUMNS[number]; field?: CustomFieldDefinition; }
export const PROJECT_TABLE_COLUMNS: ProjectTableColumn[] = [
  { id: 'name', label: 'Nom du projet', width: 260, minWidth: 180, pinned: true },
  { id: 'zone', label: 'Zone', width: 70 },
  { id: 'start', label: 'Date de début', width: 110 },
  { id: 'end', label: 'Date de fin', width: 110 },
  { id: 'tags', label: 'Tags des tâches', width: 135 },
  { id: 'status', label: 'Statut', width: 130 },
  { id: 'weather', label: 'Météo', width: 80 },
  { id: 'team', label: 'Équipe', width: 155 },
  { id: 'realized', label: 'Activité · Réalisé', heading: 'Réalisé', width: 85, group: 'activity', metric: 'realized' },
  { id: 'late', label: 'Activité · Retard', heading: 'Retard', width: 85, group: 'activity', metric: 'late' },
  { id: 'open', label: 'Activité · Ouvert', heading: 'Ouvert', width: 85, group: 'activity', metric: 'open' },
  { id: 'allocated', label: 'Travail · Alloué', heading: 'Alloué', width: 105, group: 'work', metric: 'allocated' },
  { id: 'spent', label: 'Travail · Passé', heading: 'Passé', width: 105, group: 'work', metric: 'spent' },
  { id: 'remaining', label: 'Travail · Restant', heading: 'Restant', width: 105, group: 'work', metric: 'remaining' },
  ...BUDGET_COLUMNS.map(budget => ({ id: budget.metric, label: `Budget · ${budget.label}`, heading: budget.label, width: 145, group: 'budget' as const, budget })),
  { id: 'edit', label: 'Modifier', width: 60 },
];
export function projectTableColumns(fields: CustomFieldDefinition[]): ProjectTableColumn[] {
  return [...PROJECT_TABLE_COLUMNS, ...fields.filter(field => field.scope === 'project').map(field => ({ id: 'custom:' + field.id, label: field.translations.fr || field.name, width: 170, defaultHidden: true, field }))];
}
