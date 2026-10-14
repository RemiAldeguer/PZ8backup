import type { Project, Resource, Task } from '../shared/types.ts';
import type { StoreLike } from './contracts.ts';

export const CURRENT_USER = { id: 'resource-claire', name: 'Claire Martin', role: 'Administrateur' as const };

export function seed(store: StoreLike): void {
  if (store.all('zones').length) return;
  store.transaction(() => {
    const zones = [
      { id: 'zone-transformation', name: 'Transformation', color: '#6366F1' },
      { id: 'zone-produit', name: 'Produit & innovation', color: '#0EA5A4' },
      { id: 'zone-operations', name: 'Opérations', color: '#F59E0B' },
    ];
    zones.forEach(zone => store.put('zones', zone));
    const profiles = [
      { id: 'profile-pilot', name: 'Pilotage', dailyRate: 650, eqjtHours: 8, currency: 'EUR' as const },
      { id: 'profile-expertise', name: 'Expertise & développement', dailyRate: 580, eqjtHours: 8, currency: 'EUR' as const },
      { id: 'profile-design', name: 'Design & accompagnement', dailyRate: 480, eqjtHours: 8, currency: 'EUR' as const },
    ];
    profiles.forEach(profile => store.put('profiles', profile));
    const resources: Resource[] = [
      { id: 'resource-claire', name: 'Claire Martin', jobTitle: 'Cheffe de projet', type: 'human', classification: 'internal', initials: 'CM', color: '#6366F1', dailyHours: 8, mondayHours: 7, profileId: 'profile-pilot', active: true },
      { id: 'resource-thomas', name: 'Thomas Bernard', jobTitle: 'Développeur', type: 'human', classification: 'internal', initials: 'TB', color: '#0EA5A4', dailyHours: 8, mondayHours: 8, profileId: 'profile-expertise', active: true },
      { id: 'resource-ines', name: 'Inès Robert', jobTitle: 'Designer produit', type: 'human', classification: 'internal', initials: 'IR', color: '#EC4899', dailyHours: 7, mondayHours: 7, profileId: 'profile-design', active: true },
      { id: 'resource-lucas', name: 'Lucas Dubois', jobTitle: 'Architecte technique', type: 'human', classification: 'external', initials: 'LD', color: '#F59E0B', dailyHours: 8, mondayHours: 8, profileId: 'profile-expertise', active: true },
      { id: 'resource-sarah', name: 'Sarah Petit', jobTitle: 'Responsable formation', type: 'human', classification: 'internal', initials: 'SP', color: '#8B5CF6', dailyHours: 7, mondayHours: 7, profileId: 'profile-design', active: true },
      { id: 'resource-qa', name: 'Équipe qualité', jobTitle: 'Ressource virtuelle', type: 'virtual', classification: 'internal', initials: 'QA', color: '#3B82F6', dailyHours: 16, mondayHours: 16, profileId: 'profile-expertise', active: true },
      { id: 'resource-lab', name: 'Laboratoire de test', jobTitle: 'Ressource matérielle', type: 'material', classification: 'internal', initials: 'LT', color: '#64748B', dailyHours: 8, mondayHours: 8, profileId: null, active: true },
    ];
    resources.forEach(resource => store.put('resources', resource));
    const projects: Project[] = [
      { id: 'project-nova', name: 'Déploiement de Planzone · Groupe Nova', description: 'Remplacer les outils de pilotage dispersés du Groupe Nova par Planzone. Le projet associe cadrage métier, configuration de la plateforme, reprise des données et accompagnement des équipes.', zoneId: 'zone-transformation', startDate: '2026-10-05', endDate: '2027-01-29', status: 'open', weather: 4, budget: 95000, color: '#6366F1' },
      { id: 'project-mobile', name: 'Application mobile clients', description: 'Concevoir une expérience mobile claire, accessible et cohérente avec nos services.', zoneId: 'zone-produit', startDate: '2026-09-14', endDate: '2026-12-18', status: 'open', weather: 5, budget: 58000, color: '#0EA5A4' },
      { id: 'project-onboarding', name: 'Parcours nouveaux collaborateurs', description: 'Faciliter les premières semaines avec un parcours commun et des ressources adaptées.', zoneId: 'zone-operations', startDate: '2026-09-07', endDate: '2026-11-27', status: 'open', weather: 3, budget: 26000, color: '#F59E0B' },
      { id: 'project-data', name: 'Gouvernance des données', description: 'Définir les responsabilités et les standards de qualité pour les données partagées.', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2027-02-26', status: 'requested', weather: 4, budget: 42000, color: '#8B5CF6' },
    ];
    projects.forEach(project => store.put('projects', project));
    const base = { description: '', phase: 'Cadrage & stratégie', status: 'todo' as const, progress: 0, assigneeId: 'resource-claire', allocatedHours: 24, kind: 'task' as const, tags: [] as string[], dependsOnId: null };
    const tasks: Task[] = [
      { ...base, id: 'task-cadrage', projectId: 'project-nova', title: 'Définir les objectifs et le périmètre', description: 'Partager une vision commune et confirmer les indicateurs de réussite du projet.', status: 'done', progress: 100, startDate: '2026-10-05', endDate: '2026-10-05', allocatedHours: 8, tags: ['Stratégie'] },
      { ...base, id: 'task-ateliers', projectId: 'project-nova', title: 'Animer les ateliers métiers', description: 'Recueillir les besoins des équipes et identifier les parcours prioritaires.', status: 'in_progress', progress: 35, startDate: '2026-10-05', endDate: '2026-10-09', allocatedHours: 32, tags: ['Prioritaire'], dependsOnId: 'task-cadrage' },
      { ...base, id: 'task-audit', projectId: 'project-nova', title: 'Cartographier les outils existants', status: 'in_progress', progress: 20, assigneeId: 'resource-lucas', startDate: '2026-10-05', endDate: '2026-10-13', allocatedHours: 40, tags: ['Technique'] },
      { ...base, id: 'task-pilotage', projectId: 'project-nova', title: 'Préparer le comité de pilotage', status: 'validation', progress: 80, startDate: '2026-10-05', endDate: '2026-10-07', allocatedHours: 12 },
      { ...base, id: 'task-validation-cadrage', projectId: 'project-nova', title: 'Valider le cadrage', kind: 'milestone', startDate: null, endDate: '2026-10-14', allocatedHours: 0, dependsOnId: 'task-ateliers', tags: ['Jalon'] },
      { ...base, id: 'task-parcours', projectId: 'project-nova', title: 'Concevoir les parcours utilisateurs', phase: 'Conception & réalisation', status: 'ready', assigneeId: 'resource-ines', startDate: '2026-10-08', endDate: '2026-10-23', allocatedHours: 56, tags: ['Design'] },
      { ...base, id: 'task-maquettes', projectId: 'project-nova', title: 'Valider les maquettes de Planzone', phase: 'Conception & réalisation', assigneeId: 'resource-ines', startDate: '2026-10-19', endDate: '2026-11-06', allocatedHours: 64, dependsOnId: 'task-parcours', tags: ['Design'] },
      { ...base, id: 'task-portail', projectId: 'project-nova', title: 'Configurer le socle de Planzone', phase: 'Conception & réalisation', assigneeId: 'resource-thomas', startDate: '2026-10-26', endDate: '2026-11-27', allocatedHours: 120, dependsOnId: 'task-maquettes', tags: ['Technique'] },
      { ...base, id: 'task-integrations', projectId: 'project-nova', title: 'Connecter les services existants', phase: 'Conception & réalisation', assigneeId: 'resource-lucas', startDate: '2026-11-16', endDate: '2026-12-11', allocatedHours: 80, dependsOnId: 'task-portail' },
      { ...base, id: 'task-tests', projectId: 'project-nova', title: 'Mener la recette utilisateurs', phase: 'Tests & déploiement', assigneeId: 'resource-qa', startDate: '2026-12-07', endDate: '2026-12-18', allocatedHours: 64, dependsOnId: 'task-integrations', tags: ['Qualité'] },
      { ...base, id: 'task-formation', projectId: 'project-nova', title: 'Former les équipes pilotes', phase: 'Tests & déploiement', assigneeId: 'resource-sarah', startDate: '2027-01-04', endDate: '2027-01-15', allocatedHours: 40, dependsOnId: 'task-tests' },
      { ...base, id: 'task-launch', projectId: 'project-nova', title: 'Mise en service de Planzone', phase: 'Tests & déploiement', kind: 'milestone', startDate: null, endDate: '2027-01-29', allocatedHours: 0, dependsOnId: 'task-formation', tags: ['Jalon'] },
      { ...base, id: 'task-mobile-research', projectId: 'project-mobile', title: 'Interviewer les clients', status: 'done', progress: 100, assigneeId: 'resource-ines', startDate: '2026-09-14', endDate: '2026-09-25', allocatedHours: 32 },
      { ...base, id: 'task-mobile-design', projectId: 'project-mobile', title: 'Prototyper les écrans clés', status: 'in_progress', progress: 60, assigneeId: 'resource-ines', startDate: '2026-09-28', endDate: '2026-10-16', allocatedHours: 56, dependsOnId: 'task-mobile-research', tags: ['Design'] },
      { ...base, id: 'task-mobile-dev', projectId: 'project-mobile', title: 'Développer la première version', phase: 'Réalisation', assigneeId: 'resource-thomas', startDate: '2026-10-19', endDate: '2026-12-04', allocatedHours: 160, dependsOnId: 'task-mobile-design' },
      { ...base, id: 'task-mobile-release', projectId: 'project-mobile', title: 'Livrer la version pilote', phase: 'Réalisation', kind: 'milestone', startDate: null, endDate: '2026-12-18', allocatedHours: 0, dependsOnId: 'task-mobile-dev' },
      { ...base, id: 'task-onboarding-audit', projectId: 'project-onboarding', title: 'Analyser le parcours actuel', status: 'done', progress: 100, assigneeId: 'resource-sarah', startDate: '2026-09-07', endDate: '2026-09-18', allocatedHours: 24 },
      { ...base, id: 'task-onboarding-kit', projectId: 'project-onboarding', title: 'Créer le kit de bienvenue', status: 'validation', progress: 80, assigneeId: 'resource-sarah', startDate: '2026-09-21', endDate: '2026-10-02', allocatedHours: 40, dependsOnId: 'task-onboarding-audit' },
      { ...base, id: 'task-onboarding-pilot', projectId: 'project-onboarding', title: 'Tester le parcours avec les équipes', phase: 'Déploiement', status: 'ready', assigneeId: 'resource-claire', startDate: '2026-10-12', endDate: '2026-11-06', allocatedHours: 32, dependsOnId: 'task-onboarding-kit' },
      { ...base, id: 'task-data-inventory', projectId: 'project-data', title: 'Recenser les sources de données', assigneeId: 'resource-lucas', startDate: '2026-10-12', endDate: '2026-10-30', allocatedHours: 48 },
      { ...base, id: 'task-data-rules', projectId: 'project-data', title: 'Définir les règles de qualité', assigneeId: 'resource-qa', startDate: '2026-11-02', endDate: '2026-11-20', allocatedHours: 40, dependsOnId: 'task-data-inventory' },
    ];
    tasks.forEach(task => store.put('tasks', task));
    [
      { id: 'time-cadrage', taskId: 'task-cadrage', resourceId: 'resource-claire', date: '2026-10-05', hours: 7, note: 'Réunion de lancement et cadrage.', validated: true, rateSnapshot: 650, eqjtSnapshot: 8 },
      { id: 'time-ateliers', taskId: 'task-ateliers', resourceId: 'resource-claire', date: '2026-10-06', hours: 3, note: 'Atelier avec les responsables métiers.', validated: false, rateSnapshot: 650, eqjtSnapshot: 8 },
      { id: 'time-audit', taskId: 'task-audit', resourceId: 'resource-lucas', date: '2026-10-05', hours: 6, note: 'Inventaire des services et des accès.', validated: true, rateSnapshot: 580, eqjtSnapshot: 8 },
      { id: 'time-design', taskId: 'task-mobile-design', resourceId: 'resource-ines', date: '2026-10-06', hours: 4, note: 'Prototype de navigation.', validated: false, rateSnapshot: 480, eqjtSnapshot: 8 },
      { id: 'time-kit', taskId: 'task-onboarding-kit', resourceId: 'resource-sarah', date: '2026-10-02', hours: 5, note: 'Finalisation du kit de bienvenue.', validated: true, rateSnapshot: 480, eqjtSnapshot: 8 },
    ].forEach(entry => store.put('timeEntries', entry));
    [
      { id: 'comment-ateliers-1', taskId: 'task-ateliers', authorName: 'Claire Martin', body: 'Le premier atelier a confirmé la priorité : rendre les informations plus faciles à retrouver.', createdAt: '2026-10-05T14:30:00.000Z' },
      { id: 'comment-ateliers-2', taskId: 'task-ateliers', authorName: 'Inès Robert', body: 'Les retours vont nous aider à structurer les parcours. Je prépare une synthèse pour le prochain atelier.', createdAt: '2026-10-06T09:15:00.000Z' },
      { id: 'comment-audit-1', taskId: 'task-audit', authorName: 'Lucas Dubois', body: 'La cartographie initiale est prête. Nous complétons les dépendances avec les équipes techniques.', createdAt: '2026-10-06T08:00:00.000Z' },
    ].forEach(comment => store.put('comments', comment));
    [
      { id: 'expense-nova-license', projectId: 'project-nova', label: 'Licences de la plateforme Planzone', amount: 4800, plannedDate: '2026-10-05', paidDate: '2026-10-05', category: 'software' as const },
      { id: 'expense-nova-workshop', projectId: 'project-nova', label: 'Accompagnement des ateliers métiers', amount: 2200, plannedDate: '2026-10-09', paidDate: null, category: 'training' as const },
      { id: 'expense-nova-lab', projectId: 'project-nova', label: 'Équipement du laboratoire de recette', amount: 3500, plannedDate: '2026-11-30', paidDate: null, category: 'equipment' as const },
      { id: 'expense-mobile', projectId: 'project-mobile', label: 'Panel de recherche utilisateurs', amount: 1800, plannedDate: '2026-09-14', paidDate: '2026-09-18', category: 'other' as const },
    ].forEach(expense => store.put('expenses', expense));
  });
}
