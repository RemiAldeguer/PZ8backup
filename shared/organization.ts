import type { OrganizationUnit, Resource } from './types';

export const MAX_ORGANIZATION_DEPTH = 20;
/** Validate the entire tree so moving a parent cannot make a descendant invalid. */
export function validateOrganizationTree(units: OrganizationUnit[], resources: Resource[]): void {
  const byId = new Map(units.map(unit => [unit.id, unit])); const resourceIds = new Set(resources.map(resource => resource.id));
  if (byId.size !== units.length) throw new Error('Chaque unité doit avoir un identifiant unique.');
  for (const unit of units) {
    if (new Set(unit.resourceIds).size !== unit.resourceIds.length) throw new Error('Chaque ressource doit être sélectionnée une seule fois par unité.');
    if (unit.resourceIds.some(id => !resourceIds.has(id))) throw new Error('Une ressource de l’unité est introuvable.');
    const visited = new Set([unit.id]); let parentId = unit.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error('Une unité ne peut pas être placée dans elle-même ou dans une de ses sous-unités.');
      visited.add(parentId);
      if (visited.size > MAX_ORGANIZATION_DEPTH) throw new Error(`L’organigramme est limité à ${MAX_ORGANIZATION_DEPTH} niveaux.`);
      const parent = byId.get(parentId); if (!parent) throw new Error('L’unité parente est introuvable.'); parentId = parent.parentId;
    }
  }
}
export function validateResourceManagers(resources: Resource[]): void {
  const byId = new Map(resources.map(resource => [resource.id, resource]));
  for (const resource of resources) {
    if (resource.managerId !== undefined && resource.managerId !== null && (typeof resource.managerId !== 'string' || !resource.managerId || resource.managerId.length > 100)) throw new Error('Le responsable de la ressource est invalide.');
    const visited = new Set([resource.id]); let managerId = resource.managerId;
    while (managerId) {
      if (visited.has(managerId)) throw new Error('La responsabilité des ressources ne peut pas former un cycle.');
      visited.add(managerId);
      const manager = byId.get(managerId);
      if (!manager) throw new Error('Le responsable de la ressource est introuvable.');
      if (manager.type === 'material') throw new Error('Une ressource matérielle ne peut pas être responsable.');
      managerId = manager.managerId;
    }
  }
}
export interface OrganizationNode { unit: OrganizationUnit; children: OrganizationNode[]; resources: Resource[]; depth: number; path: string; }
export function organizationTree(units: OrganizationUnit[], resources: Resource[]): OrganizationNode[] {
  const byId = new Map(resources.map(resource => [resource.id, resource]));
  const children = new Map<string | null, OrganizationUnit[]>(); const ids = new Set(units.map(unit => unit.id));
  for (const unit of units) { const key = unit.parentId && ids.has(unit.parentId) ? unit.parentId : null; children.set(key, [...children.get(key) ?? [], unit]); }
  function nodes(parentId: string | null, path = '', depth = 0, seen = new Set<string>()): OrganizationNode[] {
    if (depth >= MAX_ORGANIZATION_DEPTH) return [];
    return (children.get(parentId) ?? []).filter(unit => !seen.has(unit.id)).map(unit => {
      const label = path ? `${path} / ${unit.name}` : unit.name;
      return { unit, path: label, depth, resources: unit.resourceIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []).sort((a,b) => a.name.localeCompare(b.name, 'fr')),
        children: nodes(unit.id, label, depth + 1, new Set([...seen, unit.id])) };
    });
  }
  return nodes(null);
}
export function flattenOrganization(nodes: OrganizationNode[]): OrganizationNode[] { return nodes.flatMap(node => [node, ...flattenOrganization(node.children)]); }
export function organizationDescendantIds(units: OrganizationUnit[], id: string): Set<string> {
  const result = new Set([id]); let count = 0;
  while (count !== result.size) { count = result.size; for (const unit of units) if (unit.parentId && result.has(unit.parentId)) result.add(unit.id); }
  return result;
}
export function resourceManagementDescendantIds(resources: Resource[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const resource of resources) if (resource.managerId) children.set(resource.managerId, [...children.get(resource.managerId) ?? [], resource.id]);
  const result = new Set([id]); const queue = [id];
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) if (!result.has(child)) { result.add(child); queue.push(child); }
  return result;
}
