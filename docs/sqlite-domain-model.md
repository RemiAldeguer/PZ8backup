# Modèle métier SQLite et rapprochement PZ7

Le schéma officiel de PZ7 (DDL ou export anonymisé) n'est pas présent dans ce dépôt. Il n'existe donc **pas** de garantie de compatibilité d'import avec PZ7, ni d'équivalence de ses noms de tables. Cette évolution rapproche **la structure consultable de SQLite** des notions métier connues dans PZ8 : zones, projets, tâches, ressources, allocations, temps, membres et discussions.

## Stockage et migration

Les 22 collections existantes conservent leur contrat `(id, data JSON)` et leurs références déjà déclarées. Des colonnes générées virtuelles rendent consultables et indexables les champs usuels (projet, statut, dates, responsable, affectation, charge, validation, montants, etc.) sans recopier ni réencoder les JSON. Les nouvelles projections et leurs index sont ajoutés à l'ouverture dans une transaction ; `user_version` vaut 2. L'ouverture répétée est idempotente. Les bases anciennes sont mises à niveau sans vider les collections, et les données de l'API demeurent les mêmes. L'authentification reste dans ses tables distinctes. Le Worker D1 conserve son stockage snapshot indépendant.

Vues SQL en lecture seule (colonnes `snake_case`) :

- `domain_task_allocations` : une ligne par tâche ordinaire affectée, avec ressource, heures allouées et avancement ; les jalons et les tâches sans affectation sont exclus ; les anciennes tâches sans `kind` explicite restent des tâches ordinaires.
- `domain_time_records` : heures déclarées, ressource, tâche, date, validation individuelle et tarif historique.
- `domain_project_memberships` : rôles projet (`source = 'role'`) et adhésions explicitement enregistrées sur les ressources (`source = 'explicit'`) ; les deux sources peuvent produire deux lignes pour un même couple. Les affectations de tâches ne sont **pas** des adhésions explicites.
- `domain_organization_memberships`, `domain_event_participants`, `domain_comment_mentions` : associations issues des tableaux JSON respectifs.

Ces vues se recalculent sur les données actuelles, y compris après une modification SQL directe ; elles ne sont pas des tables métier indépendantes. Les index accélèrent les requêtes SQL ciblées sur les colonnes projetées, **pas** les lectures `Store.all()` de l'API qui parcourent toujours les collections.

## Limites à lever pour une véritable interopérabilité PZ7

La tâche PZ8 n'a qu'un responsable et un prédécesseur, contrairement à des allocations/dépendances multiples possibles dans PZ7 ; une saisie de temps exige une tâche. Les validations de projet commun, arborescence, permissions et références JSON multivaluées restent garanties par le service métier, pas intégralement par des clés étrangères SQLite. Les vues n'ajoutent ni fonctionnalité ni format d'import PZ7. Pour migrer de vraies données PZ7, il faut d'abord obtenir son schéma/export anonymisé et établir les correspondances d'identifiants, cardinalités, statuts, auteurs, tarifs historiques et politiques d'accès, puis réaliser un import testable avec sauvegarde et rapport d'anomalies. Ne pas écraser `data/planzone.sqlite` pour cette exploration.
