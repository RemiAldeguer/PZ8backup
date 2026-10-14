import { projectTimeEntries } from './planzone-preferences';
import { actualCost, plannedCost } from './domain';
import type { AppData, Project } from './types';

export interface ProjectBudgetMetrics {
  allocated: number;
  planned: number;
  actual: number;
  plannedMargin: number;
  actualMargin: number;
  earned: number;
  plannedMissing: number;
  actualMissing: number;
  earnedMissing: number;
}

function precise(amount: number): number {
  const rounded = Number(amount.toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

/**
 * Monetary totals for a project or zone, scoped once before valuation.
 * Missing tariffs leave known subtotals: costs are lower bounds and margins
 * are upper bounds. The earned value uses task progress, not recorded time;
 * expenses have no execution progress and do not contribute to earned value.
 */
export function projectBudgetMetrics(data: AppData, projects: Project[]): ProjectBudgetMetrics {
  const scopedProjects = new Map(projects.map(project => [project.id, project]));
  const tasks = data.tasks.filter(task => scopedProjects.has(task.projectId));
  const taskIds = new Set(tasks.map(task => task.id));
  const entries = projectTimeEntries(data).filter(entry => taskIds.has(entry.taskId));
  const expenses = data.expenses.filter(expense => scopedProjects.has(expense.projectId));

  const allocated = [...scopedProjects.values()].reduce((sum, project) => sum + project.budget, 0);
  const plannedWork = plannedCost(tasks, data.resources, data.profiles);
  const actualWork = actualCost(entries);
  const earnedWork = plannedCost(tasks.map(task => ({
    ...task, allocatedHours: task.allocatedHours * task.progress / 100,
  })), data.resources, data.profiles);
  const planned = plannedWork.amount + expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const actual = actualWork.amount + expenses.filter(expense => expense.paidDate)
    .reduce((sum, expense) => sum + expense.amount, 0);

  return {
    allocated: precise(allocated),
    planned: precise(planned),
    actual: precise(actual),
    plannedMargin: precise(allocated - planned),
    actualMargin: precise(allocated - actual),
    earned: precise(earnedWork.amount),
    plannedMissing: plannedWork.missing,
    actualMissing: actualWork.missing,
    earnedMissing: earnedWork.missing,
  };
}
