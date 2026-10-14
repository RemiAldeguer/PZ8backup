import { AlertTriangle } from 'lucide-react';
import type { AppData } from '../shared/types';
import { planningWarnings } from '../shared/planning-warnings';
import { formatDate } from '../shared/domain';
import './planzone-settings.css';

export function PlanningWarnings({ data, resourceId, startDate, endDate }: { data: AppData; resourceId: string; startDate: string; endDate: string }) {
  const warnings = planningWarnings(data, resourceId, startDate, endDate);
  if (!warnings.length) return null;
  return <details className="pz-planning-warnings" open><summary><AlertTriangle size={17} aria-hidden="true" />{warnings.length} avertissement{warnings.length > 1 ? 's' : ''} de planification</summary><ul>{warnings.slice(0, 8).map(warning => <li key={warning.id}><time dateTime={warning.date}>{formatDate(warning.date)}</time><span>{warning.message}</span></li>)}</ul>{warnings.length > 8 && <p>{warnings.length - 8} autre{warnings.length - 8 > 1 ? 's' : ''} avertissement{warnings.length - 8 > 1 ? 's' : ''} sur cette période.</p>}<small>Calcul sur les données accessibles, pour les 31 premiers jours de la période. Les avertissements ne bloquent pas l’enregistrement.</small></details>;
}
