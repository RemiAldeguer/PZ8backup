import type { AppData, Comment, Project, Task } from './types';

export interface DiscussionThread {
  id: string;
  project: Project;
  task: Task | null;
  comments: Comment[];
  mentioned: boolean;
  participated: boolean;
  latestAt: string;
}

type DiscussionData = Pick<AppData, 'projects' | 'tasks' | 'comments' | 'currentUser'> & Partial<Pick<AppData, 'resources'>>;
export type PersonalDiscussionFilter = 'all' | 'mentioned' | 'participated';

export function commentIsOwn(comment: Comment, user: AppData['currentUser'], legacyResourceName?: string): boolean {
  return comment.authorId ? comment.authorId === user.id
    : comment.authorName === user.name || (legacyResourceName !== undefined && comment.authorName === legacyResourceName);
}

export function commentMentionsUser(comment: Comment, userId: string): boolean {
  return (comment.mentionResourceIds ?? []).includes(userId);
}

/** Legacy task comments derive their project from the task; conflicting or orphan contexts stay excluded. */
export function discussionThreads(data: DiscussionData, projectId?: string, includeEmptyProject = false): DiscussionThread[] {
  const projects = new Map(data.projects.map(project => [project.id, project]));
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  const resource = data.resources?.find(item => item.id === data.currentUser.id);
  const legacyResourceName = resource && data.resources?.filter(item => item.name === resource.name).length === 1 ? resource.name : undefined;
  const threads = new Map<string, DiscussionThread>();
  const make = (project: Project, task: Task | null): DiscussionThread => ({
    id: task ? `task:${task.id}` : `project:${project.id}`, project, task,
    comments: [], mentioned: false, participated: false, latestAt: '',
  });
  if (includeEmptyProject && projectId) {
    const project = projects.get(projectId);
    if (project) threads.set(`project:${project.id}`, make(project, null));
  }
  for (const comment of data.comments) {
    const task = comment.taskId ? tasks.get(comment.taskId) : null;
    if (comment.taskId && !task) continue;
    if (task && comment.projectId && task.projectId !== comment.projectId) continue;
    const scopeId = task?.projectId ?? comment.projectId;
    const project = scopeId ? projects.get(scopeId) : undefined;
    if (!project || (projectId && project.id !== projectId)) continue;
    const id = task ? `task:${task.id}` : `project:${project.id}`;
    const thread = threads.get(id) ?? make(project, task ?? null);
    thread.comments.push(comment);
    thread.mentioned ||= commentMentionsUser(comment, data.currentUser.id);
    thread.participated ||= commentIsOwn(comment, data.currentUser, legacyResourceName);
    if (comment.createdAt > thread.latestAt) thread.latestAt = comment.createdAt;
    threads.set(id, thread);
  }
  for (const thread of threads.values()) {
    thread.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  return [...threads.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt) || a.id.localeCompare(b.id));
}

export function personalDiscussionThreads(data: DiscussionData, filter: PersonalDiscussionFilter = 'all'): DiscussionThread[] {
  return discussionThreads(data).filter(thread => filter === 'mentioned' ? thread.mentioned
    : filter === 'participated' ? thread.participated : thread.mentioned || thread.participated);
}
