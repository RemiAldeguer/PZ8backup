import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import type { Mutation, Zone } from '../shared/types';
import { Modal } from './Dialogs';
import './zone-order.css';

export function ZoneOrderDialog({ zones, mutate, onClose, notify }: { zones: Zone[]; mutate: Mutation; onClose: () => void; notify: (message: string) => void }) {
  const [ordered, setOrdered] = useState(() => [...zones]);
  const [original] = useState(() => zones.map(zone => zone.id));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const dragged = useRef<string | null>(null); const inFlight = useRef(false);
  const changed = ordered.some((zone, index) => zone.id !== original[index]);
  function move(id: string, targetId: string, after = false) {
    if (id === targetId) return;
    setOrdered(previous => {
      const zone = previous.find(item => item.id === id); if (!zone) return previous;
      const remaining = previous.filter(item => item.id !== id); const index = remaining.findIndex(item => item.id === targetId);
      if (index < 0) return previous;
      return [...remaining.slice(0, index + Number(after)), zone, ...remaining.slice(index + Number(after))];
    });
  }
  async function save() {
    if (!changed || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await mutate('zone-order', 'POST', { zoneIds: ordered.map(zone => zone.id) }); notify('L’ordre des zones a été enregistré.'); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'L’ordre n’a pas pu être enregistré.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title="Organiser les zones" onClose={() => { if (!inFlight.current) onClose(); }}>
    <div className="modal-body"><p>Glissez les zones dans l’ordre souhaité, ou utilisez les flèches. Cet ordre s’applique à toute la Planzone.</p>
      <ol className="zone-order-list" aria-label="Ordre des zones">{ordered.map((zone, index) => <li key={zone.id} data-zone-id={zone.id} draggable={!busy} className={dropTarget?.id === zone.id ? `zone-order-drop-${dropTarget.after ? 'after' : 'before'}` : ''}
        onDragStart={event => { dragged.current = zone.id; event.dataTransfer.setData('text/plain', zone.id); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={event => { if (!dragged.current || busy) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: zone.id, after: event.clientY > rect.top + rect.height / 2 }); }}
        onDrop={event => { if (!dragged.current || busy) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); move(dragged.current, zone.id, event.clientY > rect.top + rect.height / 2); dragged.current = null; setDropTarget(null); }}
        onDragEnd={() => { dragged.current = null; setDropTarget(null); }}>
        <GripVertical size={16} className="zone-order-grip" aria-hidden="true" /><span className="zone-order-color" style={{ backgroundColor: zone.color }} /><span className="zone-order-name">{zone.name}</span>
        <button type="button" className="icon-button" disabled={busy || index === 0} aria-label={`Monter ${zone.name}`} onClick={() => move(zone.id, ordered[index - 1].id)}><ArrowUp size={16} /></button>
        <button type="button" className="icon-button" disabled={busy || index === ordered.length - 1} aria-label={`Descendre ${zone.name}`} onClick={() => move(zone.id, ordered[index + 1].id, true)}><ArrowDown size={16} /></button>
      </li>)}</ol>{error && <p className="form-error" role="alert">{error}</p>}
    </div><div className="modal-footer"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Annuler</button><button type="button" className="button button-primary" disabled={busy || !changed} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer l’ordre'}</button></div>
  </Modal>;
}
