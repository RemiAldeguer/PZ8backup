import { actualCost, plannedCost } from './domain';
import { projectBudgetMetrics, type ProjectBudgetMetrics } from './project-budget';
import type { AppData, Expense, Resource } from './types';

export const EXPENSE_TYPE_STYLES = {
  software: { label: 'Achat logiciel', color: '#a855f7' },
  training: { label: 'Formation', color: '#73c63f' },
  equipment: { label: 'Matériels', color: '#e9a72e' },
  supplies: { label: 'Fournitures', color: '#2d64d8' },
  legal: { label: 'Frais juridiques', color: '#25c98b' },
  other: { label: 'Autres', color: '#89929c' },
} as const satisfies Record<Expense['category'], { label: string; color: string }>;

export const RESOURCE_TYPE_STYLES = {
  external: { label: 'Externes', color: '#ffa32c' },
  internal: { label: 'Internes', color: '#c7daf8' },
  material: { label: 'Matérielles', color: '#ff742a' },
  virtual: { label: 'Virtuelles', color: '#8b5cf6' },
  unclassified: { label: 'Non classées', color: '#89929c' },
} as const;

export interface ResourceCostTotals {
  planned: number;
  actual: number;
  earned: number;
  plannedMissing: number;
  actualMissing: number;
  earnedMissing: number;
}
export interface ResourceTypeCost extends ResourceCostTotals {
  key: keyof typeof RESOURCE_TYPE_STYLES;
  label: string;
  color: string;
}
export interface ExpenseTypeCost {
  key: Expense['category'];
  label: string;
  color: string;
  planned: number;
  actual: number;
}
export interface ProjectBudgetOverview {
  metrics: ProjectBudgetMetrics;
  resourceCosts: ResourceCostTotals;
  expenseCosts: { planned: number; actual: number };
  expenseTypes: ExpenseTypeCost[];
  resourceTypes: ResourceTypeCost[];
  revenues: {
    planned: number;
    received: number;
    pending: number;
    plannedResult: number;
    actualResult: number;
  };
}

function precise(amount: number): number {
  const rounded = Number(amount.toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

function resourceType(resource: Resource | undefined): ResourceTypeCost['key'] {
  if (!resource) return 'unclassified';
  if (resource.type === 'material') return 'material';
  if (resource.type === 'virtual') return 'virtual';
  if (resource.type === 'human') {
    if (resource.classification === 'internal') return 'internal';
    if (resource.classification === 'external') return 'external';
  }
  return 'unclassified';
}

/** Keep twelve-decimal precision while retaining the aggregate after grouping. */
function reconcile<T extends { planned: number; actual: number; earned?: number }>(
  groups: T[], key: 'planned' | 'actual' | 'earned', target: number,
): void {
  let largest: T | undefined;
  for (const group of groups) {
    const value = group[key] ?? 0;
    if (!largest || Math.abs(value) > Math.abs(largest[key] ?? 0)) largest = group;
    group[key] = precise(value);
  }
  if (!largest) return;
  const total = groups.reduce((sum, group) => sum + (group[key] ?? 0), 0);
  largest[key] = precise((largest[key] ?? 0) + precise(target - total));
}

/**
 * Groups the existing budget valuation without changing its cost contracts.
 * Classification uses current resource metadata; actual costs retain each time
 * entry's historical tariff and its recorded resource, even after reassignment.
 * Receipts describe income separately from the project's allocated envelope.
 */
export function projectBudgetOverview(data: AppData, projectId: string): ProjectBudgetOverview {
  const project = data.projects.find(item => item.id === projectId);
  const metrics = projectBudgetMetrics(data, project ? [project] : []);
  const tasks = project ? data.tasks.filter(task => task.projectId === projectId) : [];
  const taskIds = new Set(tasks.map(task => task.id));
  const entries = data.timeEntries.filter(entry => taskIds.has(entry.taskId));
  const expenses = project ? data.expenses.filter(expense => expense.projectId === projectId) : [];
  const resources = new Map(data.resources.map(resource => [resource.id, resource]));

  const expenseCosts = {
    planned: precise(expenses.reduce((sum, expense) => sum + expense.amount, 0)),
    actual: precise(expenses.filter(expense => expense.paidDate).reduce((sum, expense) => sum + expense.amount, 0)),
  };
  const resourceCosts: ResourceCostTotals = {
    planned: precise(metrics.planned - expenseCosts.planned),
    actual: precise(metrics.actual - expenseCosts.actual),
    earned: metrics.earned,
    plannedMissing: metrics.plannedMissing,
    actualMissing: metrics.actualMissing,
    earnedMissing: metrics.earnedMissing,
  };
  const expenseTypes: ExpenseTypeCost[] = (Object.keys(EXPENSE_TYPE_STYLES) as Expense['category'][]).map(key => ({
    key, ...EXPENSE_TYPE_STYLES[key], planned: 0, actual: 0,
  }));
  const expenseGroups = new Map(expenseTypes.map(group => [group.key, group]));
  for (const expense of expenses) {
    const group = expenseGroups.get(expense.category) ?? expenseGroups.get('other')!;
    group.planned += expense.amount;
    if (expense.paidDate) group.actual += expense.amount;
  }
  reconcile(expenseTypes, 'planned', expenseCosts.planned);
  reconcile(expenseTypes, 'actual', expenseCosts.actual);

  const resourceTypes: ResourceTypeCost[] = (Object.keys(RESOURCE_TYPE_STYLES) as ResourceTypeCost['key'][]).map(key => {
    const groupTasks = tasks.filter(task => resourceType(resources.get(task.assigneeId ?? '')) === key);
    const groupEntries = entries.filter(entry => resourceType(resources.get(entry.resourceId)) === key);
    const planned = plannedCost(groupTasks, data.resources, data.profiles);
    const actual = actualCost(groupEntries);
    const earned = plannedCost(groupTasks.map(task => ({
      ...task, allocatedHours: task.allocatedHours * task.progress / 100,
    })), data.resources, data.profiles);
    return {
      key, ...RESOURCE_TYPE_STYLES[key], planned: planned.amount, actual: actual.amount, earned: earned.amount,
      plannedMissing: planned.missing, actualMissing: actual.missing, earnedMissing: earned.missing,
    };
  });
  reconcile(resourceTypes, 'planned', resourceCosts.planned);
  reconcile(resourceTypes, 'actual', resourceCosts.actual);
  reconcile(resourceTypes, 'earned', resourceCosts.earned);

  // Legacy stored snapshots can omit this newly introduced collection.
  const revenues = project ? (data.revenues ?? []).filter(revenue => revenue.projectId === projectId) : [];
  const plannedRevenue = precise(revenues.reduce((sum, revenue) => sum + revenue.amount, 0));
  const receivedRevenue = precise(revenues.filter(revenue => revenue.receivedDate).reduce((sum, revenue) => sum + revenue.amount, 0));

  return {
    metrics, resourceCosts, expenseCosts, expenseTypes, resourceTypes,
    revenues: {
      planned: plannedRevenue,
      received: receivedRevenue,
      pending: precise(plannedRevenue - receivedRevenue),
      plannedResult: precise(plannedRevenue - metrics.planned),
      actualResult: precise(receivedRevenue - metrics.actual),
    },
  };
}
