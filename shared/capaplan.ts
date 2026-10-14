import type { AppData, Project, Resource } from './types';
import { resourceCapacity, resourceLoad } from './domain';
import { normalizeResource } from './resources';
import { canProject, canReadProject, globalRole, isAdmin } from './permissions';

export interface CapacityDomain { id: string; name: string; teamIds: string[]; resourceIds: string[]; managerIds: string[]; }
export interface CapacitySkill { id: string; domainId: string; name: string; status: 'requested' | 'approved' | 'created' | 'rejected'; reason: string; }
export interface CapacityMembership { id: string; resourceId: string; skillId: string; share: number | null; }
export interface CapacityContract { id: string; resourceId: string; monthlyDays: number; startMonth: string; endMonth: string; }
export interface CapacityOverhead { id: string; resourceId: string; month: string; runDays: number; otherDays: number; source: 'manual' | 'carried' | 'suggested'; }
export interface CapacityDemand { id: string; projectId: string; skillId: string; month: string; days: number; status: 'proposed' | 'go'; createdAt: string; updatedAt: string; }
export interface CapacityAllocation { id: string; demandId: string; resourceId: string; days: number; }
export interface CapacityBaseline { id: string; projectId: string; at: string; demands: CapacityDemand[]; }
export interface CapacityAudit { id: string; at: string; actorId: string; actorName: string; action: string; targetId: string; before: string; after: string; reason: string; }
export interface CapacitySettings { warningThreshold: number; underloadThreshold: number; allowOverload: boolean; includeProposed: boolean; suggestionMonths: number; carryDay: number; pmoIds: string[]; }
export interface CapacityPlan {
  id: 'capacity-plan'; domains: CapacityDomain[]; skills: CapacitySkill[]; memberships: CapacityMembership[];
  contracts: CapacityContract[]; overheads: CapacityOverhead[]; demands: CapacityDemand[]; allocations: CapacityAllocation[];
  baselines: CapacityBaseline[]; audit: CapacityAudit[]; settings: CapacitySettings;
}
export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = { warningThreshold: 80, underloadThreshold: 50, allowOverload: true, includeProposed: false, suggestionMonths: 3, carryDay: 1, pmoIds: [] };
export function capacityPlan(data: Pick<AppData, 'capacityPlans'>): CapacityPlan {
  return data.capacityPlans?.[0] ?? { id: 'capacity-plan', domains: [], skills: [], memberships: [], contracts: [], overheads: [], demands: [], allocations: [], baselines: [], audit: [], settings: { ...DEFAULT_CAPACITY_SETTINGS } };
}
export function capacityPmo(data: AppData, plan = capacityPlan(data)): boolean { return isAdmin(data) || plan.settings.pmoIds.includes(data.currentUser.id); }
export function capacityManager(data: AppData, domainId: string, plan = capacityPlan(data)): boolean { return capacityPmo(data, plan) || !!plan.domains.find(domain => domain.id === domainId)?.managerIds.includes(data.currentUser.id); }
export function canReadCapacityPlan(data: AppData, plan = capacityPlan(data)): boolean {
  return capacityPmo(data, plan) || globalRole(data) === 'project_creator' || plan.domains.some(domain => domain.managerIds.includes(data.currentUser.id)) || data.projects.some(project => canProject(data, project.id, 'details'));
}
export function domainResourceIds(data: AppData, domain: CapacityDomain): Set<string> {
  const units = data.organizationUnits ?? []; const selected = new Set(domain.teamIds);
  for (let pass = 0; pass < units.length; pass++) for (const unit of units) if (unit.parentId && selected.has(unit.parentId)) selected.add(unit.id);
  return new Set([...domain.resourceIds, ...units.filter(unit => selected.has(unit.id)).flatMap(unit => unit.resourceIds)]);
}
export function capacityMonthRange(month: string): { startDate: string; endDate: string } {
  const [year, number] = month.split('-').map(Number);
  return { startDate: `${month}-01`, endDate: new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10) };
}
export function shiftCapacityMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number - 1 + offset, 1, 12)).toISOString().slice(0, 7);
}
export function monthlyOverhead(plan: CapacityPlan, resourceId: string, month: string): { runDays: number; otherDays: number; source: string; fromMonth?: string } {
  const explicit = plan.overheads.find(item => item.resourceId === resourceId && item.month === month); if (explicit) return explicit;
  const prior = plan.overheads.filter(item => item.resourceId === resourceId && item.month < month).sort((a, b) => b.month.localeCompare(a.month))[0];
  return prior ? { runDays: prior.runDays, otherDays: prior.otherDays, source: 'carried', fromMonth: prior.month } : { runDays: 0, otherDays: 0, source: 'empty' };
}
export interface CapacityMonthMetrics { capacity: number; absences: number; run: number; other: number; allocated: number; real: number; occupancy: number | null; spent: number; incomplete: boolean; source: string; }
export function capacityMonthMetrics(data: AppData, resource: Resource, month: string, plan = capacityPlan(data)): CapacityMonthMetrics {
  const dates = capacityMonthRange(month), hoursPerDay = normalizeResource(resource).hoursPerDay || 8;
  const calendarCapacity = resourceCapacity(resource, dates.startDate, dates.endDate, []);
  const netCalendarCapacity = resourceCapacity(resource, dates.startDate, dates.endDate, data.unavailabilities);
  const contract = plan.contracts.find(item => item.resourceId === resource.id && item.startMonth <= month && item.endMonth >= month);
  const absenceDays = Math.max(0, (calendarCapacity - netCalendarCapacity) / hoursPerDay);
  const capacity = (resource.classification === 'external') ? Math.max(0, (contract?.monthlyDays ?? 0) - absenceDays) : netCalendarCapacity / hoursPerDay;
  const overhead = monthlyOverhead(plan, resource.id, month);
  const monthDemands = plan.demands.filter(demand => demand.month === month && (plan.settings.includeProposed || demand.status === 'go'));
  const managed = new Set(monthDemands.map(demand => demand.projectId));
  const legacy = resourceLoad(resource, data.tasks.filter(task => task.assigneeId === resource.id && task.kind === 'task' && !managed.has(task.projectId)), dates.startDate, dates.endDate) / hoursPerDay;
  const demands = new Set(monthDemands.map(demand => demand.id));
  const allocated = legacy + plan.allocations.filter(item => item.resourceId === resource.id && demands.has(item.demandId)).reduce((sum, item) => sum + item.days, 0);
  const spent = data.timeEntries.filter(entry => entry.resourceId === resource.id && entry.date.startsWith(month)).reduce((sum, entry) => sum + entry.hours, 0) / hoursPerDay;
  const total = overhead.runDays + overhead.otherDays + allocated;
  return { capacity, absences: absenceDays, run: overhead.runDays, other: overhead.otherDays, allocated, real: capacity - total, occupancy: capacity > 0 ? total / capacity * 100 : total > 0 ? Infinity : null, spent, incomplete: (resource.classification === 'external') && !contract, source: overhead.source };
}
export function capacityBand(rate: number | null, settings: CapacitySettings): 'unavailable' | 'underload' | 'normal' | 'tension' | 'overload' {
  return rate === null ? 'unavailable' : rate > 100 ? 'overload' : rate >= settings.warningThreshold ? 'tension' : rate < settings.underloadThreshold ? 'underload' : 'normal';
}
export function demandAllocated(plan: CapacityPlan, id: string): number { return plan.allocations.filter(item => item.demandId === id).reduce((sum, item) => sum + item.days, 0); }
export function demandRemaining(plan: CapacityPlan, demand: CapacityDemand): number { return Math.max(0, demand.days - demandAllocated(plan, demand.id)); }
export function capacityDomainMetrics(data: AppData, domain: CapacityDomain, month: string, plan = capacityPlan(data)) {
  const ids = domainResourceIds(data, domain), resources = data.resources.filter(resource => resource.active && resource.type !== 'material' && ids.has(resource.id));
  const metrics = resources.map(resource => ({ resource, ...capacityMonthMetrics(data, resource, month, plan) }));
  const skills = new Set(plan.skills.filter(skill => skill.domainId === domain.id).map(skill => skill.id));
  const remaining = plan.demands.filter(demand => demand.month === month && skills.has(demand.skillId) && (plan.settings.includeProposed || demand.status === 'go')).reduce((sum, demand) => sum + demandRemaining(plan, demand), 0);
  const sum = (key: 'capacity' | 'run' | 'other' | 'allocated' | 'real') => metrics.reduce((total, metric) => total + metric[key], 0);
  const capacity = sum('capacity'), total = sum('run') + sum('other') + sum('allocated');
  return { resources: metrics, capacity, allocated: sum('allocated'), run: sum('run'), other: sum('other'), real: sum('real'), remaining, projected: sum('real') - remaining, occupancy: capacity > 0 ? total / capacity * 100 : total > 0 ? Infinity : null };
}
export function overheadSuggestion(data: AppData, resource: Resource, month: string, months = capacityPlan(data).settings.suggestionMonths) {
  const hoursPerDay = normalizeResource(resource).hoursPerDay || 8; const taskMap = new Map(data.tasks.map(task => [task.id, task])); const projectMap = new Map(data.projects.map(project => [project.id, project]));
  let run = 0, other = 0, count = 0;
  for (let offset = 1; offset <= months; offset++) {
    const previous = shiftCapacityMonth(month, -offset), entries = data.timeEntries.filter(entry => entry.resourceId === resource.id && entry.date.startsWith(previous));
    if (!entries.length) continue; count++;
    for (const entry of entries) { const task = taskMap.get(entry.taskId), project = task && projectMap.get(task.projectId); const text = `${project?.name ?? ''} ${(project?.tags ?? []).join(' ')} ${task?.title ?? ''} ${task?.phase ?? ''} ${(task?.tags ?? []).join(' ')}`.toLocaleLowerCase('fr');
      if (/\brun\b/.test(text)) run += entry.hours / hoursPerDay; else if (/hors[- ]projet|autres activités/.test(text)) other += entry.hours / hoursPerDay;
    }
  }
  return count ? { runDays: run / count, otherDays: other / count, months: count } : null;
}
export function capacityConsumed(data: AppData, project: Project, resourceId: string, month: string): number | null {
  const resource = data.resources.find(resource => resource.id === resourceId);
  if (!resource) return null;
  const hoursPerDay = normalizeResource(resource).hoursPerDay || 8;
  const tasks = new Set(data.tasks.filter(task => task.projectId === project.id).map(task => task.id));
  return data.timeEntries.filter(entry => entry.resourceId === resourceId && entry.date.startsWith(month) && tasks.has(entry.taskId)).reduce((sum, entry) => sum + entry.hours, 0) / hoursPerDay;
}
export function commonCapacityWindow(data: AppData, needs: { resourceId: string; days: number }[], months: string[]) {
  const grouped = new Map<string, number>();
  for (const need of needs) grouped.set(need.resourceId, (grouped.get(need.resourceId) ?? 0) + (Number.isFinite(need.days) && need.days >= 0 ? need.days : Infinity));
  return months.map(month => ({ month, blockers: [...grouped].flatMap(([resourceId, days]) => {
    const need = { resourceId, days };
    const resource = data.resources.find(item => item.id === need.resourceId); if (!resource) return [{ resourceId: need.resourceId, available: 0, required: need.days }];
    const metric = capacityMonthMetrics(data, resource, month); return metric.real + 1e-9 < need.days ? [{ resourceId: resource.id, available: metric.real, required: need.days }] : [];
  }) }));
}

/** PMO can inspect the complete plan. Other users receive only their managed
 * domains, readable projects and own capacity; audit payloads stay private.
 */
export function permittedCapacityPlans(data: AppData): CapacityPlan[] {
  const plan = data.capacityPlans?.[0]; if (!plan) return [];
  if (capacityPmo(data, plan)) return [plan];
  const projectIds = new Set(data.projects.filter(project => canReadProject(data, project.id)).map(project=>project.id));
  const managedDomains = new Set(plan.domains.filter(domain => domain.managerIds.includes(data.currentUser.id)).map(domain => domain.id));
  const managedSkills = new Set(plan.skills.filter(skill => managedDomains.has(skill.domainId)).map(skill => skill.id));
  const managedResources = new Set(plan.domains.filter(domain => managedDomains.has(domain.id)).flatMap(domain => [...domainResourceIds(data, domain)]));
  managedResources.add(data.currentUser.id);
  const allocations=plan.allocations.filter(item=>managedResources.has(item.resourceId)||plan.demands.some(demand=>demand.id===item.demandId&&projectIds.has(demand.projectId)));
  const demandIds=new Set(allocations.map(item=>item.demandId)); const demands=plan.demands.filter(item=>projectIds.has(item.projectId)||demandIds.has(item.id));
  const memberships=plan.memberships.filter(item=>managedResources.has(item.resourceId)); const skillIds=new Set([...demands.map(item=>item.skillId),...memberships.map(item=>item.skillId),...managedSkills]);
  const skills=plan.skills.filter(item=>skillIds.has(item.id)); const domainIds=new Set(skills.map(item=>item.domainId));
  return [{...plan, domains:plan.domains.filter(item=>domainIds.has(item.id)||domainResourceIds(data,item).has(data.currentUser.id)).map(item=>({...item,resourceIds:item.resourceIds.filter(id=>managedResources.has(id)),teamIds:managedDomains.has(item.id)?item.teamIds:[],managerIds:managedDomains.has(item.id)?item.managerIds:[]})), skills,memberships,
    contracts:plan.contracts.filter(item=>managedResources.has(item.resourceId)),overheads:plan.overheads.filter(item=>managedResources.has(item.resourceId)),demands,allocations,
    baselines:plan.baselines.filter(item=>projectIds.has(item.projectId)),audit:[],settings:{...plan.settings,pmoIds:[]}}];
}
