import type { Pz7AccessClient } from './pz7-access/client';
import type { ScopeApi } from './pz7-scope/client';

const part = (id: string) => encodeURIComponent(id);
type Query = { namePrefix?: string; after?: { name: string; id: string } | null; limit?: number };

function params(query?: Query, zoneId?: string | null) {
  const search = new URLSearchParams();
  if (query?.namePrefix) search.set('namePrefix', query.namePrefix);
  if (query?.limit !== undefined) search.set('limit', String(query.limit));
  if (query?.after) {
    search.set('afterName', query.after.name);
    search.set('afterId', query.after.id);
  }
  if (zoneId) search.set('zoneId', zoneId);
  const encoded = search.toString();
  return encoded ? '?' + encoded : '';
}

export function createScopeApi(client: Pz7AccessClient): ScopeApi {
  const base = (planzoneId: string) => '/planzones/' + part(planzoneId);
  const zone = (planzoneId: string, zoneId: string) => base(planzoneId) + '/zones/' + part(zoneId);
  const project = (planzoneId: string, projectId: string) => base(planzoneId) + '/projects/' + part(projectId);
  return {
    listZones: (planzoneId, signal, query) => client.request(base(planzoneId) + '/zones' + params(query), 'GET', undefined, signal),
    listProjects: (planzoneId, zoneId, signal, query) => client.request(base(planzoneId) + '/projects' + params(query, zoneId), 'GET', undefined, signal),
    projectRoles: (planzoneId, signal) => client.request(base(planzoneId) + '/project-roles', 'GET', undefined, signal),
    zoneMembers: (planzoneId, zoneId, signal, query) => client.request(zone(planzoneId, zoneId) + '/members' + params(query), 'GET', undefined, signal),
    projectMembers: (planzoneId, projectId, signal, query) => client.request(project(planzoneId, projectId) + '/members' + params(query), 'GET', undefined, signal),
    zoneCandidates: (planzoneId, zoneId, signal, query) => client.request(zone(planzoneId, zoneId) + '/member-candidates' + params(query), 'GET', undefined, signal),
    projectCandidates: (planzoneId, projectId, signal, query) => client.request(project(planzoneId, projectId) + '/member-candidates' + params(query), 'GET', undefined, signal),
    addZoneMember: (planzoneId, zoneId, resourceId, signal) => client.request(zone(planzoneId, zoneId) + '/members', 'POST', { resourceId }, signal),
    removeZoneMember: (planzoneId, zoneId, resourceId, signal) => client.request(zone(planzoneId, zoneId) + '/members/' + part(resourceId), 'DELETE', undefined, signal),
    addProjectMember: (planzoneId, projectId, body, signal) => client.request(project(planzoneId, projectId) + '/members', 'POST', body, signal),
    updateProjectMember: (planzoneId, projectId, resourceId, body, signal) => client.request(project(planzoneId, projectId) + '/members/' + part(resourceId), 'PUT', body, signal),
    removeProjectMember: (planzoneId, projectId, resourceId, signal) => client.request(project(planzoneId, projectId) + '/members/' + part(resourceId), 'DELETE', undefined, signal),
  };
}
