import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Modal } from '../Dialogs';
import { normalizeTableColumns, type TableColumn, type TableColumnPreferences } from './column-preferences';
import '../list-columns.css';

export function TableColumnsDialog({ title, columns, preferences, onApply, onClose }: { title: string; columns: TableColumn[]; preferences: TableColumnPreferences; onApply: (value: TableColumnPreferences) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => normalizeTableColumns(preferences, columns));
  function move(id: string, delta: number) {
    setDraft(previous => { const order = [...previous.order]; const index = order.indexOf(id), target = index + delta; if (target < 0 || target >= order.length || columns.find(column => column.id === order[target])?.pinned) return previous; [order[index], order[target]] = [order[target], order[index]]; return { ...previous, order }; });
  }
  return <Modal title={title} onClose={onClose}><div className="modal-body lc-config-body"><p>Choisissez les colonnes et leur ordre. Faites glisser le bord d’un en-tête pour ajuster sa largeur.</p><ol className="lc-config-list" aria-label="Ordre des colonnes">{draft.order.map((id, index) => {
    const column = columns.find(column => column.id === id)!;
    return <li key={id}><span className="lc-column-position">{index + 1}</span><label><input type="checkbox" checked={!draft.hidden.includes(id)} disabled={column.pinned} onChange={event => setDraft(previous => ({ ...previous, hidden: event.target.checked ? previous.hidden.filter(value => value !== id) : [...previous.hidden, id] }))} />{column.label}{column.pinned && <small>Obligatoire</small>}</label><div className="lc-order-controls"><button type="button" className="icon-button" aria-label={`Monter ${column.label}`} disabled={column.pinned || index === 0 || columns.find(item => item.id === draft.order[index - 1])?.pinned} onClick={() => move(id, -1)}><ArrowUp size={16} /></button><button type="button" className="icon-button" aria-label={`Descendre ${column.label}`} disabled={column.pinned || index === draft.order.length - 1} onClick={() => move(id, 1)}><ArrowDown size={16} /></button></div></li>;
  })}</ol><p className="lc-settings-note">Affichage personnel conservé dans ce navigateur.</p></div><div className="modal-footer lc-config-footer"><button type="button" className="text-button" onClick={() => setDraft(normalizeTableColumns(null, columns))}>Rétablir les colonnes et les largeurs</button><div className="modal-footer-actions"><button type="button" className="button button-secondary" onClick={onClose}>Annuler</button><button type="button" className="button button-primary" onClick={() => onApply(draft)}>Appliquer</button></div></div></Modal>;
}
