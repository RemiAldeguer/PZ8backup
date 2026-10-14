# Backend Java de Planzone 8

Ce dossier implémente le socle de la [direction technique Java](../docs/superpowers/specs/2026-10-13-planzone8-design.md) : applications API/jobs séparées, modules métier, PostgreSQL et frontière transactionnelle par Planzone.

La référence fonctionnelle est PZ7. Le module people réunit les ressources humaines, virtuelles et matérielles, les profils locaux et les invitations. La tranche d’accès ajoute connexion OIDC, sessions partagées, API de ressources/invitations, rôles PZ7 et restrictions de champs, worker SMTP et écrans React. Les [règles et la configuration](../docs/refoundation/2026-10-14-access-contract.md) et les [preuves de validation](../docs/refoundation/2026-10-14-access-validation.md) décrivent son périmètre ; la parité globale reste suivie dans [functional-coverage.json](../docs/refoundation/functional-coverage.json).

Les écrans `/access` et d’acceptation d’invitation utilisent l’API Java sous `/api/v1`. Les autres fonctions de l’interface poursuivent la transition décrite dans le [plan](../docs/superpowers/plans/2026-10-13-planzone8-implementation.md). Par défaut, `PZ8_ACCESS_ENABLED=false` ferme les routes métier ; leur activation nécessite les connexions PostgreSQL/OIDC et la clé d’invitation. Aucun compte ou accès de démonstration n’est intégré au produit.

Les points d’entrée sont ResourceService, InvitationService et AccessService. Le contexte HTTP provient exclusivement de la session vérifiée ; chaque commande recontrôle adhésion, version de sécurité et capacités courantes dans sa transaction. Le domaine ne dépend pas de HTTP/JDBC. L’identité de connexion globale ne remplace jamais les profils people locaux de chaque Planzone.

ScopedAccessService et la migration 006 ajoutent les droits des zones/projets, leurs rôles et la gestion des équipes. La [qualification PZ7](../docs/refoundation/2026-10-14-scope-pz7-evidence.md) et le [contrat de scope](../docs/refoundation/2026-10-14-scope-access-contract.md) précisent visibilité, restrictions, rôles autorisés et retraits. Le panneau « Zones et projets » utilise ces endpoints ; il ne remplace pas encore les parcours complets de création/édition de projet.

## Prérequis et commandes

JDK 21 et Docker avec moteur Linux disponible sont nécessaires à la vérification complète. Gradle est fourni par son wrapper ; les versions et sommes de contrôle sont enregistrées dans gradle/.

Depuis backend, sous PowerShell :

```powershell
.\gradlew.bat check :core:integrationTest :api:integrationTest :api:bootJar :jobs:bootJar
```

Sous Linux ou macOS :

```sh
bash ./gradlew check :core:integrationTest :api:integrationTest :api:bootJar :jobs:bootJar
```

check inclut le format, les frontières d’architecture et les tests ordinaires, dont le dialogue SMTP. Les integrationTest démarrent un PostgreSQL 18 éphémère avec Testcontainers ; l’absence de Docker fait échouer cette vérification. Le schéma est installé avec Liquibase, puis les scénarios s’exécutent avec de vrais logins non privilégiés. Les tests API utilisent un fournisseur de test HTTP signant ses jetons OIDC, deux instances Java et les véritables cookies/CSRF.

Les rapports sont écrits sous core/build/reports/tests et api/build/reports/tests. Les exécutables se trouvent sous api/build/libs et jobs/build/libs. Les caches et sorties de build ne sont pas versionnés.

Pour appliquer le format Java :

```powershell
.\gradlew.bat spotlessApply
```

Pour une mise à jour volontaire des dépendances, modifier les versions fixes, résoudre et régénérer verrous et sommes de contrôle, puis relire les différences et exécuter les tests pertinents. Les options de mise à jour ne font pas partie du contrôle habituel : une dépendance inattendue doit être signalée.

## Frontières du code

core contient les types et cas d’usage dans identity, planzones, people et access. Les ports métier ne dépendent pas de Spring ou de JDBC. platform.jdbc implémente transactions, requêtes et mapping. API et jobs utilisent ces contrats ; le navigateur ne fournit pas son propre contexte d’identité.

Une PlanzoneUnitOfWork possède toute sa transaction. Elle vérifie l’identité et l’adhésion, coordonne les droits, installe un contexte PostgreSQL local et ferme sa session à la sortie. Les références entre clients et Planzones sont contrôlées par la base ; les politiques RLS complètent les permissions métier.

Les identités données au noyau doivent provenir d’une authentification vérifiée. La recherche issuer/subject ne valide pas un token OIDC et ne constitue pas une connexion autonome.

## Migrations et rôles

migrations/src/main/resources/db/changelog contient les migrations Liquibase 001 à 006. L’installation crée les rôles sans connexion pz8_owner, pz8_migrator, pz8_runtime et pz8_mailer. Le provisionnement initial nécessite la création de rôles ; il est séparé de l’exécution de l’application.

Une connexion d’application doit hériter uniquement de pz8_runtime, sans superuser, BYPASSRLS ou appartenance au propriétaire. Les mots de passe sont provisionnés hors dépôt. Les tables du catalogue d’autorité ne sont pas directement accessibles au runtime ; les fonctions autorisées ont une interface limitée et un search_path fixe.

Le worker dispose d’un login distinct héritant de pz8_mailer et ne possède pas les accès métier de l’API. La première organisation et son administrateur restent à provisionner par un futur parcours métier ; les migrations ne créent pas d’identité ou d’organisation de démonstration.

## PostgreSQL de développement

Le [compose local](../deploy/local/compose.yaml) démarre une base persistante sur 127.0.0.1:55432 avec mot de passe obligatoire. Son administrateur de développement sert au provisionnement ; il ne doit pas devenir le compte d’exécution de l’application. Les [instructions locales](../docs/refoundation/multi-agent-workflow.md#environnement-local) décrivent démarrage et arrêt sans effacement des données.

Les tests utilisent par défaut leurs propres conteneurs isolés. Le mode PZ8_TEST_JDBC_URL est réservé à une base et un cluster de test dédiés et jetables, avec PZ8_TEST_JDBC_USER et PZ8_TEST_JDBC_PASSWORD. Les noms des rôles initiaux sont globaux au cluster : ne pas utiliser une base métier existante. Aucun test ne doit effacer ou recréer un rôle préexistant pour contourner un conflit.

## Coordination

Les règles de contribution figurent dans [AGENTS.md](../AGENTS.md). Les agents travaillent sur des fichiers attribués ; le coordinateur intègre et vérifie. La preuve d’un lot est enregistrée dans le plan et un compte rendu de validation, avec les limites des contrôles.
