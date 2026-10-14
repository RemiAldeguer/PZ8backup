import { useEffect, useRef } from 'react';
import './table-columns.css';

export function ColumnResizeHandle({ label, width, defaultWidth, min = 60, max = 800, onChange, onCommit }: { label: string; width: number; defaultWidth: number; min?: number; max?: number; onChange: (width: number) => void; onCommit: (width: number) => void }) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));
  return <button type="button" className="table-column-resizer" role="separator" aria-orientation="vertical" aria-label={`Redimensionner ${label}`} aria-valuenow={width} aria-valuemin={min} aria-valuemax={max} title="Glisser pour redimensionner · Double-clic pour rétablir la largeur"
    onDoubleClick={() => onCommit(defaultWidth)} onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); onCommit(event.key === 'Home' ? min : event.key === 'End' ? max : clamp(width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10))); }
    }} onPointerDown={event => {
      if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); cleanup.current?.();
      const origin = event.clientX, initial = width, pointerId = event.pointerId; let current = width, frame = 0;
      const cursor = document.body.style.cursor, selection = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
      const move = (moveEvent: PointerEvent) => { if (moveEvent.pointerId !== pointerId) return; current = clamp(initial + moveEvent.clientX - origin); if (!frame) frame = requestAnimationFrame(() => { frame = 0; onChange(current); }); };
      const clean = () => { cancelAnimationFrame(frame); document.body.style.cursor = cursor; document.body.style.userSelect = selection; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); cleanup.current = null; };
      const finish = (upEvent: PointerEvent) => { if (upEvent.pointerId !== pointerId) return; clean(); onCommit(current); };
      const cancel = (cancelEvent?: PointerEvent) => { if (cancelEvent && cancelEvent.pointerId !== pointerId) return; clean(); onChange(initial); };
      const key = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); keyEvent.stopPropagation(); cancel(); } };
      cleanup.current = clean; window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    }} />;
}
