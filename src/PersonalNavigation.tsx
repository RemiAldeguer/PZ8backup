import { Clock3, LayoutDashboard, MessageSquare } from 'lucide-react';
import './personal-navigation.css';
import type { AppData } from '../shared/types';
import { canSeeView } from '../shared/permissions';

export function PersonalNavigation({ active, data }: { active: 'summary' | 'time' | 'discussions'; data: AppData }) {
  return <nav className="pd-personal-nav personal-navigation" aria-label="Vues de mon espace">
    {canSeeView(data, 'personal-summary') && <a href="#personal" aria-current={active === 'summary' ? 'page' : undefined}><LayoutDashboard size={20} />Ma synthèse</a>}
    {canSeeView(data, 'personal-time') && <a href="#time" aria-current={active === 'time' ? 'page' : undefined}><Clock3 size={20} />Suivi temporel</a>}
    {canSeeView(data, 'personal-discussions') && <a href="#discussions" aria-current={active === 'discussions' ? 'page' : undefined}><MessageSquare size={20} />Mes discussions</a>}
  </nav>;
}
