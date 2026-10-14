import { useRef, useState, type FormEvent } from 'react';
import type { Mutation } from '../shared/types';
import { Modal } from './Dialogs';

export function ZoneDialog({ mutate, onClose, notify }: { mutate: Mutation; onClose: () => void; notify: (message: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!name.trim()) { setError('Indiquez le nom de la zone.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    try { await mutate('zones', 'POST', { name: name.trim(), color }); notify('La zone a été créée.'); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'La zone n’a pas pu être créée.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title="Nouvelle zone" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="modal-body">
        <label className="form-field">Nom de la zone<input className="form-input" autoComplete="off" required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Ex. : Pôle France" /></label>
        <label className="form-field">Couleur<input className="form-input" type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button button-primary" disabled={busy}>{busy ? 'Création…' : 'Créer la zone'}</button></div>
    </form>
  </Modal>;
}
