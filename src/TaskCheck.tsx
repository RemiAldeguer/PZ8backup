import { useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { STATUS_LABELS, type AppData, type Mutation, type Task } from '../shared/types';
import './task-check.css';
import { canProject } from '../shared/permissions';

export function TaskCheck({ task, data, mutate, notify }: {
  task: Task; data: AppData; mutate: Mutation; notify: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const project = data.projects.find(item => item.id === task.projectId);
  const locked = !project || project.status === 'paused' || project.status === 'closed' || !canProject(data, task.projectId, 'taskComplete', task);
  const completed = task.status === 'done';
  const label = `${completed ? 'Rouvrir' : 'Terminer'} ${task.title}`;

  async function toggle() {
    if (locked || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      // Persist status and progress together; an unchecked task returns to À faire.
      await mutate('tasks', 'PATCH', { status: completed ? 'todo' : 'done', progress: completed ? 0 : 100 }, task.id);
      notify(completed ? 'Tâche remise à faire.' : 'Tâche terminée.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Le statut de la tâche n’a pas pu être enregistré.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <button type="button" className="task-completion" role="checkbox" aria-checked={completed}
    aria-label={label} aria-busy={pending} disabled={locked || pending}
    title={locked ? 'Le projet est interrompu ou clos.' : `${completed ? 'Remettre la tâche à faire' : 'Marquer la tâche comme terminée'} · ${STATUS_LABELS[task.status]}`}
    onClick={event => { event.stopPropagation(); void toggle(); }}>
    <span className={`task-completion-box task-completion-${task.status}`} aria-hidden="true">
      {pending ? <LoaderCircle className="task-completion-spinner" size={12} /> : completed ? <Check size={12} /> : null}
    </span>
  </button>;
}
