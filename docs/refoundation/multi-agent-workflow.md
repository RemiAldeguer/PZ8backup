# Workflow multi-agent de refondation

Ce workflow organise le travail sur le nouveau socle décrit dans [la spécification PZ8](../superpowers/specs/2026-10-13-planzone8-design.md). L’agent racine reste responsable de la coordination, des décisions d’intégration et de la cohérence du résultat livré. La délégation accélère des tâches séparables ; elle ne transfère pas cette responsabilité.

## Répartition des rôles

- **Agent racine — coordination et intégration :** découpe le travail, fixe les contrats entre composants, attribue les fichiers, arbitre les décisions qui dépassent une tâche et intègre les changements. Il relit le diff final et rapporte les preuves ainsi que les limites connues.
- **Sol 6.1, effort moyen — implémentation courante :** code métier et interface dans le périmètre attribué, documentation ordinaire et compilation locale utile à la tâche.
- **Sol, effort élevé — travaux de transaction et d’isolation :** opérations concurrentes, frontières transactionnelles, RLS, contexte de Planzone, révocation, reprise et scénarios qui prouvent leurs garanties sur PostgreSQL.
- **Luna, effort moyen — tâches bornées par fichiers :** documentation, configuration, petites adaptations isolées et inventaires dont les entrées et sorties sont explicites.
- **Astra — revue ciblée de risque :** à solliciter si un changement sensible mérite une lecture indépendante, par exemple une frontière d’autorisation, une transaction ou une récupération. La revue porte sur un diff précis et des questions définies.

> Les noms désignent des profils disponibles, pas une obligation d’utiliser chaque profil. Les capacités et le choix d’un modèle sont décrits dans le [guide officiel de sélection des modèles](https://developers.openai.com/api/docs/guides/model-selection). Aucun tarif ou avantage de coût n’est supposé ici.

## Préparer une délégation

Avant de paralléliser, l’agent racine écrit le contrat : résultat attendu, invariants à respecter, fichiers exclusifs, dépendances, vérifications utiles et format de compte rendu. Il attribue des ensembles de fichiers disjoints. Si deux tâches ont besoin du même fichier, il les séquence ou désigne un propriétaire qui réalise l’intégration.

Les contrats API, données, transactions et dépendances entre modules sont décidés avant les tâches qui s’y appuient. Chaque tâche métier inclut une référence PZ7 qualifiée, les identifiants de scénarios de parité et les droits associés ; les simplifications du prototype PZ8 ne sont pas des exigences. Une hypothèse non prouvée est remontée, pas implémentée silencieusement. Les tâches parallèles doivent pouvoir avancer sans modifier le travail d’une autre. Une tâche bornée reçoit le contexte et les références nécessaires, sans recopier tout l’historique de conversation.

La délégation ne devient pas récursive : un agent délégué ne délègue pas à son tour. L’agent racine collecte les résultats, résout les écarts de contrat et garde la vue d’ensemble.

## Instructions de tâche

Une demande de délégation utile tient en quelques points :

1. **Objectif observable :** ce qui doit exister ou se comporter différemment.
2. **Périmètre :** chemins modifiables et chemins à laisser intacts.
3. **Contrat :** comportements et invariants attendus, avec les choix déjà tranchés.
4. **Vérification :** commandes ou scénarios proportionnés au changement ; ne pas lancer de build lourd sans nécessité.
5. **Compte rendu :** fichiers modifiés, preuves obtenues, limites ou questions ouvertes.

Les fichiers synchronisés sous `sources/` sont des références en lecture seule. Les instructions `AGENTS.md` du dépôt et les décisions utilisateur priment sur les habitudes implicites d’un agent.

## Intégration et preuves

L’agent racine vérifie que le travail respecte le périmètre attribué et les contrats partagés, examine les changements ensemble, puis exécute les contrôles pertinents à l’intégration. Les tests protègent un comportement métier ou une régression réelle ; ils ne reproduisent pas la logique de production et ne se limitent pas à vérifier des appels de mocks structurels. La couverture et le nombre de tests ne sont pas des objectifs.

Le compte rendu final reste compact : changements livrés, vérifications effectivement exécutées et leurs résultats, puis limites restant à lever. Distinguer une preuve locale d’une propriété encore non démontrée en base ou en exploitation. Ne pas présenter une commande non exécutée comme validée.

## Pilotage entre les chats

Le nouveau socle reçu est transmis sur la branche refactor/java-pz7-foundation, distincte des évolutions du prototype. Un chat qui poursuit le chantier Java part de ce socle et du commit annoncé par le coordinateur, dans un checkout séparé s’il possède déjà des changements. Il ne remplace pas les travaux de son utilisateur et ne reconstitue pas un second backend faute d’avoir récupéré la base.

La prochaine tranche est la création, l’édition, le déplacement et la suppression complète des projets. Commencer par un contrat PZ7 court : champs et valeurs par défaut, statuts, dates/fuseaux, droits et restrictions, effets d’appartenance, variantes et inconnues restantes. Relier chaque règle à une source qualifiée et à un scénario observable. Les décisions sensibles non établies bloquent uniquement les travaux qui en dépendent.

Le développement progresse par trois points de contrôle : contrat qualifié, comportement backend reçu, puis parcours d’interface reçu. Avant chaque passage, le coordinateur examine le changement réel et les preuves ciblées. Les fichiers restent attribués ; une modification transverse ou un changement d’architecture passe par le coordinateur. Un résultat reçu sur une branche de travail ne déclenche ni fusion sur main ni déploiement.

Toute nouvelle demande qui change le périmètre ou contredit une décision validée doit être rendue explicite : demande concernée, décision affectée et impact sur la tranche. Les nouvelles instructions humaines explicites restent prioritaires ; le plan est alors corrigé avant l’implémentation. Un chat ne doit ni les ignorer systématiquement ni mélanger silencieusement le prototype et le nouveau backend.

## Environnement local

Le fichier [`deploy/local/compose.yaml`](../../deploy/local/compose.yaml) fournit PostgreSQL 18 uniquement. Docker Compose doit être installé. Dans PowerShell, depuis la racine du dépôt, définir un mot de passe de développement local puis démarrer le service :

```powershell
$env:PZ8_POSTGRES_PASSWORD = Read-Host 'Mot de passe PostgreSQL local'
docker compose -f deploy/local/compose.yaml up -d
docker compose -f deploy/local/compose.yaml ps
docker compose -f deploy/local/compose.yaml logs --follow postgres
```

Le port hôte par défaut est `55432`; le remplacer au besoin avec `$env:PZ8_POSTGRES_PORT`. L’hôte est limité à `127.0.0.1`. La base s’appelle `planzone8` et son utilisateur initial `pz8_dev_admin` est un administrateur de développement local. Il ne doit pas être configuré comme rôle d’exécution de l’application ; celle-ci devra recevoir un rôle dédié aux privilèges limités lorsqu’elle sera ajoutée.

Pour arrêter le conteneur tout en conservant les données :

```powershell
docker compose -f deploy/local/compose.yaml down
```

Le volume nommé reste présent et sera réutilisé au prochain démarrage. Le fichier ne contient aucun mot de passe de secours ni service d’application fictif. La configuration a été validée avec Docker Compose ; le démarrage de ce service persistant n’a pas été exécuté pendant cette vérification. Les intégrations du backend utilisent leurs propres conteneurs PostgreSQL éphémères.
