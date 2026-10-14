import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, children, onClose, large = false, className = '', label = title, header }: { title: string; children: ReactNode; onClose: () => void; large?: boolean; className?: string; label?: string; header?: ReactNode }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const controls = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"],[contenteditable="true"]') ?? [])]
        .filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden');
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${large ? 'modal-large' : ''} ${className}`} ref={modalRef} role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal-header">{header ?? <div><span className="eyebrow">PLANZONE 8</span><h2>{title}</h2></div>}<button className="icon-button" onClick={onClose} aria-label="Fermer la fenêtre"><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

export { TaskDialog } from './tasks/TaskDetailDialog';

export { ProjectCreationDialog as ProjectDialog } from './ProjectCreationDialog';
