# Validation du premier lot Java de Planzone 8

Date : 13 octobre 2026. Lot 1 du [plan d’implémentation](../superpowers/plans/2026-10-13-planzone8-implementation.md) terminé localement.

Portée après clarification utilisateur : ces preuves techniques restent valables, mais ne démontrent pas la parité fonctionnelle PZ7. Les rôles et le modèle métier doivent être qualifiés au lot 0 ; la gestion unifiée utilisateurs/ressources n’est pas encore implémentée.

## Résultat livré

Le backend se construit en trois projets Gradle : core, api et jobs. Les cas d’usage internes permettent de créer et parcourir des zones dans une Planzone autorisée et de révoquer une adhésion. Le domaine ne dépend pas de Spring ou du SQL ; les adaptateurs JDBC gèrent transaction, contexte, mapping et autorité. L’API refuse les routes non autorisées et ne publie qu’une sonde minimale.

Le schéma Liquibase impose un client pour une Planzone et protège les données par RLS. Le runtime utilise un vrai login PostgreSQL non privilégié ; il n’hérite pas des droits du propriétaire. Le catalogue d’autorité est accessible seulement par des fonctions limitées.

## Vérifications exécutées

| Vérification | Résultat |
|---|---|
| Compilation Java 21 et production des exécutables API/jobs | Réussie |
| Contrôle de format avec Spotless et google-java-format verrouillés | Réussi |
| Frontières sans Spring/SQL dans le domaine et absence de cycles | Deux contrôles réussis |
| Frontière HTTP anonyme et absence de connexion de démonstration | Deux tests réussis |
| PostgreSQL 18 réel via Testcontainers | Huit scénarios réussis, sans test ignoré |
| Configuration Docker Compose locale | Validation réussie ; service persistant non démarré |
| Liens locaux de la documentation et différences Git | Aucun lien cassé ni erreur d’espacement détecté |

Commande principale exécutée depuis backend : gradlew check :core:integrationTest :api:bootJar :jobs:bootJar. Après l’ajout du contrôle de déplacement d’une zone vers une Planzone étrangère, :core:spotlessCheck et :core:integrationTest ont été réexécutés avec succès. Les sources finales sont antérieures aux classes utilisées par cette dernière exécution.

Les intégrations couvrent lecture/écriture entre clients, insertion et déplacement étrangers, contexte absent, catalogue d’autorité privé, rôles insuffisants, rollback métier et SQL, réutilisation de la même connexion, pagination stable avec noms identiques et jokers littéraux, révocation concurrente et référence client/Planzone invalide. L’attente de révocation est constatée par PostgreSQL via pg_blocking_pids, pas déduite d’une simple temporisation.

L’environnement local utilise Microsoft OpenJDK 21.0.10 et Docker Desktop avec PostgreSQL 18 éphémère. La CI prévue utilise Temurin 21. Le workflow GitHub Actions est ajouté au dépôt ; son exécution distante n’a pas eu lieu pendant ce lot.

## Revue et corrections

Une revue indépendante Astra ciblée a examiné les fonctions SQL privilégiées, RLS, droits, contexte et tests ; elle n’a établi aucun défaut bloquant supplémentaire. La revue d’intégration a séparé le SQL des cas d’usage et renforcé la preuve de révocation et la durée de vie des sessions transactionnelles.

Les versions fixes de Gradle, Spring, Modulith et du formateur sont accompagnées de verrous et de sommes de contrôle. Une incompatibilité du formateur a été corrigée avant la validation finale, sans supprimer son contrôle.

## Périmètre restant

Le frontend existant n’utilise pas encore le backend Java. La connexion OIDC, les endpoints métier, reçus/idempotence, audit/outbox et consommateurs de jobs restent à réaliser selon les lots suivants. Le lot courant ne prétend pas démontrer ces propriétés, la capacité de charge ou la restauration sélective.

Les contrôles du frontend historique n’ont pas été relancés pour ce lot qui ne le modifie pas. Sa baseline antérieure demeure compilation, types et 355 tests réussis.

## Travail conservé dans l’autre session

L’autre session a confirmé son arrêt. Les références distantes ont été récupérées sans fusion : origin/main d17227f et origin/work 95f57c7 au moment de la vérification. Les changements de logo et d’interface non commités qu’elle a déclarés restent dans cette session. Leur réconciliation précède la refonte des mêmes fichiers.
