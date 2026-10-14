# Validation des permissions de zones et de projets

Réception locale terminée le 14 octobre 2026. Le [contrat](2026-10-14-scope-access-contract.md) et la [qualification PZ7](2026-10-14-scope-pz7-evidence.md) précisent les règles et les corrections de sécurité. Le [suivi fonctionnel](functional-coverage.json) conserve les familles P02/P03 partielles : la gestion des équipes ne livre pas les autres commandes de projet.

## Contrôles effectivement exécutés

| Contrôle ciblé | Résultat | Comportement protégé |
|---|---|---|
| ScopeAccessIntegrationTest, PostgreSQL 18 et login restreint | 4 scénarios réussis, aucun ignoré | Visibilité, privilèges et restrictions, rôles autorisés, ressources sans compte, versions, rétrogradation globale, retraits zone/projet, rollback et révocation concurrente |
| PlanzoneIsolationTest, affecté par la nouvelle visibilité des zones | 9 scénarios réussis, aucun ignoré | Frontières client, contexte, pagination, rollback et course de révocation |
| ScopeHttpIntegrationTest, HTTP/OIDC signé/PostgreSQL | 1 scénario réussi | Manager sans lecture du catalogue global, candidats locaux, rôles globaux/étrangers refusés, corps incomplet, conflit et refus après désactivation |
| Architecture et style Java, JAR API | 2 contrôles d’architecture réussis ; format et compilation réussis | Frontières des modules et exécutable construit après les dernières modifications |
| UI des panneaux avec réponses HTTP contrôlées | 1 scénario réussi en 1,4 seconde | Droits propres à chaque objet, pagination/recherche, choix de rôle, refus, conflit sans rejeu, confirmation de retrait et réponse tardive après changement de client |
| Entrée réelle Vite → Java → PostgreSQL/OIDC | 1 scénario réussi en 15,7 secondes | Connexion, ajout sans compte depuis l’interface, persistance, appartenance de zone induite, révocation par l’administrateur et retrait de zone supprimant l’appartenance projet |
| TypeScript et bundle de production | Réussite | Port paginé, adaptateur utilisant session/CSRF et onglet Zones et projets compilés |

Ces contrôles ont été choisis pour les comportements modifiés. Les suites ressources/invitations/SMTP déjà reçues n’ont pas été relancées. Les durées des deux scénarios navigateur excluent compilation et démarrage de la fixture ; la commande de recette réelle prend 17,3 secondes, fixture déjà démarrée. La dernière commande PostgreSQL ciblée prend 21 secondes, préparation comprise.

Le contrôle de visibilité a révélé que INSERT RETURNING d’une zone vérifiait sa politique de lecture avant que l’association du créateur soit visible. La création effectue désormais l’insertion et la lecture dans deux instructions de la même transaction, en conservant la politique restrictive. Aucun test utile n’a été désactivé.

La première attente de la recette navigateur supposait à tort que le rôle pz_user devait perdre tout accès à l’onglet Ressources. Le catalogue PZ7 lui accorde resource:create, sans resource:read. Le scénario conserve cette distinction : l’écran refuse la lecture du catalogue, et le responsable peut néanmoins composer son équipe depuis le projet. Les données de recette et les droits du produit n’ont pas été modifiés pour satisfaire cette attente.

## Parcours réel reçu

Deux contextes de navigateur utilisent le fournisseur OIDC de test signé et l’API Java réelle, avec cookies et CSRF. Aucun endpoint métier n’est intercepté. Les comptes, zones et projets de recette sont préparés exclusivement dans les sources de test ; aucun provisionnement de démonstration n’est ajouté au produit.

Le responsable voit sa zone et le projet auquel il appartient, sans voir un autre projet de cette même zone. Il ajoute une ressource virtuelle sans compte et sans rôle projet ; après rechargement, son appartenance à la zone est également présente. L’administrateur voit les deux projets et désactive le responsable depuis l’équipe. Celui-ci conserve sa zone mais ne voit plus aucun projet. L’administrateur confirme ensuite le retrait de la ressource de la zone ; elle disparaît aussi de l’équipe projet.

Les scénarios PostgreSQL restent la preuve du rollback et de la concurrence ; le navigateur ne duplique pas artificiellement ces courses. Les droits document/discussion du visiteur sont qualifiés et présents dans le moteur, sans prétendre livrer ces futurs écrans.

## Reproduction ciblée

Dans backend, avec JDK 21 et Docker disponible :

```powershell
.\gradlew.bat :core:integrationTest --tests '*ScopeAccessIntegrationTest' --tests '*PlanzoneIsolationTest'
.\gradlew.bat :api:integrationTest --tests '*ScopeHttpIntegrationTest'
```

Depuis la racine pour les types et le panneau isolé :

```powershell
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run build
npm run test:e2e:scope
```

Pour le seul parcours réel, démarrer une fixture neuve dans un premier terminal situé dans backend :

```powershell
$env:PZ8_BROWSER_FIXTURE_FILE = Join-Path (Split-Path -Parent (Get-Location)) '.access-acceptance.json'
.\gradlew.bat :api:browserAcceptanceFixture
```

Attendre le message de disponibilité. Dans un second terminal à la racine :

```powershell
$env:PZ8_BROWSER_FIXTURE_FILE = Join-Path (Get-Location) '.access-acceptance.json'
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e:scope:java
$scopeFixtureState = Get-Content -Raw .access-acceptance.json | ConvertFrom-Json
Invoke-WebRequest -Uri ($scopeFixtureState.controlUrl + '/shutdown') -Method Post
```

La fermeture de la recette exécutée a répondu 204 et a libéré API, fournisseur, pools, rôles temporaires et conteneur ; le manifeste est supprimé. Cette commande de contrôle loopback n’existe pas dans le produit. Une recette réussie modifie les données de test ; utiliser une nouvelle fixture avant de la rejouer.

## Intégration et reprise du chantier

Le lot de l’autre chat Planzone 8 provient de parallel/pz7-scope-ui au commit 638b0ef1425eb608dc6ce63bfc623e0e5440cf0f. Seuls src/pz7-scope/** et tests/browser/pz7-scope.spec.ts ont été récupérés. L’intégrateur a raccordé l’onglet, le transport existant et la recette Java. Les autres refontes d’interface et déploiements de ce chat restent distincts.

À la demande explicite de l’utilisateur, le plan, les décisions validées et la méthode ont aussi été transmis à ce chat : Java/PostgreSQL, people unifié, hiérarchie Planzone/zones/projets, qualification PZ7 avant chaque tranche, fichiers exclusifs, contrats avant parallélisation et vérification proportionnée. Les documents de reprise sont le [plan actif](../superpowers/plans/2026-10-13-planzone8-implementation.md), les [instructions du dépôt](../../AGENTS.md) et le [workflow multi-agent](multi-agent-workflow.md).

Le code reçu et ces documents sont transmis ensemble sur la branche refactor/java-pz7-foundation. La reprise utilise le commit annoncé par le coordinateur ; elle n’exige pas de fusionner les changements du prototype et ne publie pas le nouveau backend en production.

La prochaine tranche est la création/édition/déplacement/suppression paramétrée des projets avec leurs règles PZ7, puis les commandes métier de projet. Groupes, cycle de compte/UAA, autres domaines, exploitation et migration ultérieure restent ouverts. Aucun déploiement de ce backend, test de charge ou différentiel contre PZ7 déployé n’a été réalisé. Le gros bundle des anciens écrans demeure séparé de l’entrée Java ; la compilation ne démontre pas un gain de performance en production.
