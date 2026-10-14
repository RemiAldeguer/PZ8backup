import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Zone } from '../shared/types';
import './zone-actions.css';

export function ZoneActions({ zone, onEdit, onDelete, sidebar = false }: { zone: Zone; onEdit: (zone: Zone) => void; onDelete: (zone: Zone) => void; sidebar?: boolean }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const items = [...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
  function choose(action: (zone: Zone) => void) { setOpen(false); trigger.current?.focus(); action(zone); }
  return <div ref={container} className={`zone-actions${sidebar ? ' zone-actions-sidebar' : ''}`} onKeyDown={keydown}>
    <button ref={trigger} type="button" className="zone-actions-trigger" aria-label={`Actions de la zone ${zone.name}`} title={`Actions de la zone ${zone.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={18} /></button>
    {open && <div className="zone-actions-popup" role="menu" aria-label={`Actions de la zone ${zone.name}`}>
      <button type="button" role="menuitem" onClick={() => choose(onEdit)}><Pencil size={15} />Modifier la zone</button>
      <button type="button" role="menuitem" className="zone-actions-delete" onClick={() => choose(onDelete)}><Trash2 size={15} />Supprimer la zone</button>
    </div>}
  </div>;
}
