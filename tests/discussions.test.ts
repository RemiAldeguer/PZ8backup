import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentIsOwn, discussionThreads, personalDiscussionThreads } from '../shared/discussions.ts';
import type { AppData, Comment, Project, Resource, Task } from '../shared/types.ts';

const project: Project = { id: 'p1', name: 'Premier projet', description: '', zoneId: 'z', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', weather: 5, budget: 0, color: '#123456' };
const task: Task = { id: 't1', projectId: 'p1', title: 'Première tâche', description: '', phase: 'Phase', status: 'todo', progress: 0, assigneeId: null, startDate: null, endDate: null, allocatedHours: 0, kind: 'task', tags: [], dependsOnId: null };
const comment: Comment = { id: 'c1', taskId: 't1', authorName: 'Autre personne', body: 'Bonjour', createdAt: '2026-01-02T00:00:00Z' };
const data: Pick<AppData, 'projects' | 'tasks' | 'comments' | 'currentUser'> = {
  projects: [project, { ...project, id: 'p2', name: 'Second projet' }],
  tasks: [task, { ...task, id: 't2', projectId: 'p2' }],
  comments: [], currentUser: { id: 'r1', name: 'Moi', role: 'Administrateur' },
};

test('les fils utilisent le contexte exact et conservent tout le fil sélectionné par une mention', () => {
  const comments: Comment[] = [
    { ...comment, mentionResourceIds: ['r1'] },
    { ...comment, id: 'reply', createdAt: '2026-01-03T00:00:00Z', body: 'Réponse sans mention' },
    { ...comment, id: 'foreign', taskId: 't2', authorId: 'r1', authorName: 'Moi' },
    { ...comment, id: 'project', taskId: null, projectId: 'p1', authorId: 'r1', authorName: 'Moi' },
    { ...comment, id: 'conflict', projectId: 'p2' },
    { ...comment, id: 'orphan', taskId: 'missing', projectId: 'p1' },
  ];
  const threads = discussionThreads({ ...data, comments }, 'p1', true);
  assert.equal(threads.length, 2);
  assert.deepEqual(threads.find(thread => thread.task)?.comments.map(item => item.id), ['c1', 'reply']);
  const mentions = personalDiscussionThreads({ ...data, comments }, 'mentioned');
  assert.equal(mentions.length, 1);
  assert.deepEqual(mentions[0].comments.map(item => item.id), ['c1', 'reply']);
  assert.equal(personalDiscussionThreads({ ...data, comments }, 'participated').length, 2);
});

test('la participation utilise l’identifiant auteur et réserve le nom exact aux anciens commentaires', () => {
  assert.equal(commentIsOwn({ ...comment, authorName: 'Moi' }, data.currentUser), true);
  assert.equal(commentIsOwn({ ...comment, authorName: 'moi' }, data.currentUser), false);
  assert.equal(commentIsOwn({ ...comment, authorName: 'Moi', authorId: 'other' }, data.currentUser), false);
  assert.equal(commentIsOwn({ ...comment, authorName: 'Ancien nom', authorId: 'r1' }, data.currentUser), true);
  assert.equal(personalDiscussionThreads({ ...data, comments: [{ ...comment, body: '@Moi dans un texte sans mention sélectionnée' }] }).length, 0);
});

test('les commentaires historiques de la ressource courante restent visibles quand le compte porte un autre nom', () => {
  const resource: Resource = { id: 'r1', name: 'Claire Martin', initials: 'CM', jobTitle: '', type: 'human', classification: 'internal', color: '#123456', dailyHours: 8, mondayHours: 8, profileId: null, active: true };
  const history = { ...comment, authorName: resource.name };
  assert.equal(personalDiscussionThreads({ ...data, resources: [resource], comments: [history] }, 'participated').length, 1);
  assert.equal(personalDiscussionThreads({ ...data, resources: [resource], comments: [{ ...history, authorId: 'other' }] }, 'participated').length, 0);
  assert.equal(personalDiscussionThreads({ ...data, resources: [resource, { ...resource, id: 'other' }], comments: [history] }, 'participated').length, 0);
});

test('les listes restent stables, ordonnent les commentaires sans modifier les données et proposent un fil de projet vide', () => {
  const comments: Comment[] = [{ ...comment, id: 'late', createdAt: '2026-01-04T00:00:00Z' }, comment];
  const threads = discussionThreads({ ...data, comments }, 'p1', true);
  assert.deepEqual(threads[0].comments.map(item => item.id), ['c1', 'late']);
  assert.deepEqual(comments.map(item => item.id), ['late', 'c1']);
  assert.equal(threads[1].task, null);
  assert.equal(threads[1].comments.length, 0);
  assert.deepEqual(discussionThreads(data, 'missing', true), []);
});
