import { Clock3, LayoutDashboard, MessageSquare } from 'lucide-react';
import './personal-navigation.css';

export function PersonalNavigation({ active }: { active: 'summary' | 'time' | 'discussions' }) {
  return <nav className="pd-personal-nav personal-navigation" aria-label="Vues de mon espace">
    <a href="#personal" aria-current={active === 'summary' ? 'page' : undefined}><LayoutDashboard size={20} />Ma synthèse</a>
    <a href="#time" aria-current={active === 'time' ? 'page' : undefined}><Clock3 size={20} />Suivi temporel</a>
    <a href="#discussions" aria-current={active === 'discussions' ? 'page' : undefined}><MessageSquare size={20} />Mes discussions</a>
  </nav>;
}
