import type { Task, TaskConstraint } from './types';

export const DEFAULT_TASK_CONSTRAINT: TaskConstraint = { mode: 'exact', offset: 0, unit: 'days', direction: 'after', automatic: true };
const DAY = 86_400_000;
export class TaskConstraintError extends Error {}
function stamp(date: string): number { return Date.parse(`${date}T00:00:00Z`); }
export function constraintDate(date: string, days: number): string {
  const next = stamp(date) + days * DAY;
  if (!Number.isFinite(next) || next < stamp('0001-01-01') || next > stamp('9999-12-31')) throw new TaskConstraintError('La contrainte dépasse les dates prises en charge.');
  return new Date(next).toISOString().slice(0, 10);
}
/** Dates are inclusive: zero days after the finish means the following calendar day. */
export function constraintDistance(constraint: TaskConstraint): number {
  return 1 + constraint.offset * (constraint.unit === 'weeks' ? 7 : 1) * (constraint.direction === 'before' ? -1 : 1);
}
function start(task: Task): string | null { return task.kind === 'milestone' ? task.endDate ?? task.startDate : task.startDate; }
function end(task: Task): string | null { return task.endDate ?? (task.kind === 'milestone' ? task.startDate : null); }
function satisfied(actual: string, target: string, mode: TaskConstraint['mode']): boolean {
  return mode === 'exact' ? actual === target : mode === 'not_before' ? actual >= target : actual <= target;
}
export type ConstraintShift = (task: Task, edge: 'start' | 'end', target: string) => Task;
export const calendarConstraintShift: ConstraintShift = (task, edge, target) => {
  const date = edge === 'start' ? start(task) : end(task);
  if (!date || (task.kind === 'task' && (!task.startDate || !task.endDate))) return task;
  const delta = (stamp(target) - stamp(date)) / DAY;
  return { ...task, startDate: task.startDate ? constraintDate(task.startDate, delta) : null, endDate: task.endDate ? constraintDate(task.endDate, delta) : null };
};

/** One predecessor per task. Build a plan without writes; the caller authorizes and commits it atomically. */
export function planTaskConstraints(tasks: Task[], updated: Task, previous?: Task, shift: ConstraintShift = calendarConstraintShift): Task[] {
  const nodes = new Map(tasks.filter(task => task.projectId === updated.projectId).map(task => [task.id, { ...task }]));
  nodes.set(updated.id, { ...updated });
  const children = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const task of nodes.values()) {
    if (task.dependencyConstraint && !task.dependsOnId) throw new TaskConstraintError('Choisissez un prédécesseur pour cette contrainte.');
    degree.set(task.id, task.dependsOnId ? 1 : 0);
    if (!task.dependsOnId) continue;
    if (!nodes.has(task.dependsOnId)) throw new TaskConstraintError('La dépendance doit appartenir au même projet.');
    const siblings = children.get(task.dependsOnId) ?? [];
    siblings.push(task.id); children.set(task.dependsOnId, siblings);
  }
  const queue = [...degree].filter(([, value]) => value === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) for (const id of children.get(queue[i]) ?? []) { degree.set(id, 0); queue.push(id); }
  if (queue.length !== nodes.size) throw new TaskConstraintError('Cette dépendance crée un cycle.');
  const changed = new Set([updated.id]);
  const move = (task: Task, edge: 'start' | 'end', target: string) => {
    const next = shift(task, edge, target);
    if (next.startDate !== task.startDate || next.endDate !== task.endDate) { nodes.set(task.id, next); changed.add(task.id); }
    return next;
  };
  let root = nodes.get(updated.id)!;
  const datesChanged = !!previous && (previous.startDate !== updated.startDate || previous.endDate !== updated.endDate);
  const linkChanged = !previous || previous.dependsOnId !== updated.dependsOnId || JSON.stringify(previous.dependencyConstraint ?? null) !== JSON.stringify(updated.dependencyConstraint ?? null);
  if (!datesChanged && !linkChanged) return [updated];
  // A direct date edit anchors the edited task; exact links and violated bounds also reconcile its ancestors.
  if (datesChanged && !linkChanged) {
    while (root.dependsOnId && root.dependencyConstraint?.automatic) {
      const predecessor = nodes.get(root.dependsOnId)!;
      const beginning = start(root), finish = end(predecessor), constraint = root.dependencyConstraint;
      if (!beginning || !finish) break;
      if (!satisfied(beginning, constraintDate(finish, constraintDistance(constraint)), constraint.mode)) {
        const moved = move(predecessor, 'end', constraintDate(beginning, -constraintDistance(constraint)));
        if (moved === predecessor) break;
        root = moved;
      } else break;
    }
  } else if (root.dependsOnId && root.dependencyConstraint?.automatic) {
    const predecessor = nodes.get(root.dependsOnId)!, finish = end(predecessor), beginning = start(root);
    if (finish && beginning) {
      const target = constraintDate(finish, constraintDistance(root.dependencyConstraint));
      if (!satisfied(beginning, target, root.dependencyConstraint.mode)) root = move(root, 'start', target);
    }
  }
  const propagation = [root.id];
  for (let i = 0; i < propagation.length; i++) {
    const predecessor = nodes.get(propagation[i])!;
    for (const id of children.get(predecessor.id) ?? []) {
      let task = nodes.get(id)!;
      if (!task.dependencyConstraint?.automatic) continue;
      const finish = end(predecessor), beginning = start(task);
      if (!finish || !beginning) continue;
      const target = constraintDate(finish, constraintDistance(task.dependencyConstraint));
      if (!satisfied(beginning, target, task.dependencyConstraint.mode)) task = move(task, 'start', target);
      propagation.push(task.id);
    }
  }
  return [...changed].map(id => nodes.get(id)!);
}
