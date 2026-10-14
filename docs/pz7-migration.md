# Migration Planzone 8 → schéma SQLite PZ7

> Historique de la bascule du serveur SQLite. Pour la version navigateur sans backend, préparer ensuite un [export privé sans comptes et l’import manuel](browser-sqlite.md) ; ne jamais publier la base serveur brute.

Cet import est **hors application** : il ne remplace pas `data/planzone.sqlite`, ne modifie pas le schéma PZ7 fourni et ne crée pas de comptes PZ7 utilisables. La base SQLite PZ7 livrée en pièce jointe ne contient aucune donnée ; ses invariants applicatifs Java ne sont pas tous déductibles du DDL. Les codes de rôles/statuts/enums et `recording_date` ci-dessous viennent des précisions métier fournies pour ce travail.

```sh
python3 scripts/migrate-pz8-to-pz7.py \
  --source data/planzone.sqlite \
  --schema planzone_pz_sans_recording_day.sqlite \
  --output data/pz7-migrated
```

`--output` doit désigner un **répertoire inexistant** ; le programme refuse tout écrasement, y compris lors d'exécutions concurrentes. Les deux entrées sont ouvertes en lecture seule, la cible est clonée avant import, les insertions sont transactionnelles et les références sont vérifiées. Le répertoire privé est publié en une opération atomique après création des trois fichiers : `workspace.sqlite`, `report.json` (volumes, correspondances UUIDv5 et chevauchements de dates), et `source-json.json` (tous les JSON métier originaux, y compris les champs non importés ; **pas** les tables de mots de passe et sessions). Ne pas exposer publiquement ce fichier annexe. La publication atomique emploie `renameat2` de Linux.

## Correspondances implémentées

- Espace `pz_planzone` unique, zones, projets et racines `pz_activity`. Listes de tâches imbriquées et anciennes phases deviennent des activités ; projets, tâches et jalons conservent leurs dates. `weather` reste dans la sauvegarde JSON.
- Ressources et capacités hebdomadaires, profils de coûts et un historique par profil. Le taux journalier est copié dans `cost` **sans conversion d'unité validée** : ne pas utiliser les coûts importés pour la facturation avant vérification. `eqjtHours` reste dans la sauvegarde.
- Tâches → `pz_task`, jalons → `pz_milestone`, tags et affectations des tâches → `pz_allocation`. Le responsable d'un jalon n'a pas d'allocation native et n'est conservé que dans la sauvegarde.
- Heures → `pz_time_record.recording_date`. Le schéma choisi doit avoir **supprimé** `recording_day`. L'unicité `(resource_uuid, task_uuid, recording_date)` est appliquée par SQLite : une collision annule l'import ; aucune somme implicite. Notes, validation et tarifs historiques restent dans la sauvegarde.
- Statuts de tâches prédéfinis `pr_todo`, `pr_in_progress`, `pr_done` avec les UUID fournis ; `ready` et `validation` créés comme statuts propres à chaque projet. Projets `requested` → `pz_candidate`, `open` → `pz_open`, `closed` → `pz_closed`, `paused` → statut personnalisé `pz_paused`. Les rôles prédéfinis sont créés avec leurs UUID fournis ; `project_creator` → `pz_under_admin`. Les ressources historiques sans rôle explicite reprennent le rôle effectif de Planzone 8 : administrateur pour `resource-claire`, utilisateur pour les autres ; vérifier ces droits avant de relier des comptes PZ7.
- Membres projet explicites, créateurs de projets ou inférés des affectations/saisies → `pz_project_member` (rôle `pr_worker` par défaut pour les membres inférés), discussions et commentaires par tâche ou projet, types de dépenses et dépenses (`quantity = 1`, `unit_amount = amount`). Les auteurs anciens sans identifiant restent sans `author_uuid` ; leur nom d'origine subsiste dans la sauvegarde.
- Dépendance PZ8 `dependsOnId` → contrainte PZ7 `AT_LEAST (0)` entre la fin du prédécesseur (`END = 0`) et le début du successeur (`START = 1`), ou la date de fin d'un jalon successeur, `offset_days = 0`. Les types d'entité sont les ordinals fournis (`TASK = 1`, `MILESTONE = 2`). Les chevauchements sont signalés dans le rapport, **sans changer les dates ni supprimer les contraintes**. Vérifier l'effet du moteur de planification PZ7 avant de l'utiliser.

Les autres collections métier non vides sont listées sous `not_imported` ; toutes leurs données restent dans `source-json.json`. Cet export PZ7 **n'inclut pas** les comptes locaux et ne doit pas être utilisé seul comme base d'application. Il fournit une base de validation du mapping, pas une migration de production déclarée compatible avec l'application Java PZ7.

## Préparation séparée pour l'application Planzone 8

Pour construire une base de travail destinée à l'adaptateur PZ7 de Planzone 8, avec ses identifiants et sessions conservés :

```sh
python3 scripts/prepare-pz7-runtime.py \
  --source data/planzone.sqlite \
  --bundle data/pz7-migrated \
  --output data/pz7-runtime-active.sqlite
```

Cette opération refuse une base déjà créée et refuse si le contenu métier source diffère du snapshot utilisé pour produire le bundle. Elle copie les tables `auth_*` dans la **nouvelle** base et crée `pz8_identity` pour les identifiants PZ8 et les champs qu'aucune colonne PZ7 ne représente. Elle ne modifie ni la base active ni le bundle. Tant que l'import historique des six collections natives supplémentaires n'est pas implémenté, elle refuse explicitement une source contenant déjà des statuts personnalisés, axes, unités, rapports, événements ou absences : pas d'identités natives fantômes. La base de travail contient donc des données d'authentification sensibles : ne pas l'exposer ni la transférer sans précaution. **Avant une bascule réelle, arrêter l'ancien service pour geler aussi les écritures d'authentification** (changements de mot de passe, révocations et sessions) pendant l'export, la préparation et le changement de chemin. Une transaction de lecture ne protège pas contre les écritures survenues après son instantané. Refaire les deux programmes après cet arrêt, avec de nouveaux chemins de sortie, puis vérifier les comptes et le contenu avant de démarrer le nouveau service.

## Bascule locale vérifiée le 14 octobre 2026

L'ancien service `planzone8-codex.service` a été arrêté avant une sauvegarde SQLite cohérente dans `data/planzone-before-pz7-20261014T125419Z.sqlite`. Un nouveau bundle `data/pz7-cutover-20261014T125419Z/` a été importé à partir de cette sauvegarde puis préparé dans `data/pz7-runtime-active.sqlite`. La base `data/planzone.sqlite` d'origine n'a pas été remplacée. Les 50 identités (4 projets, 21 tâches dont 3 jalons, 7 ressources et 5 saisies d'heures), le compte et les 3 sessions préexistantes ont été conservés. L'état API avant/après est strictement identique ; `PRAGMA integrity_check` et `foreign_key_check` passent, sans anciennes tables métier JSON. La page et l'authentification sur l'URL HTTPS du service ont été vérifiées. Le rapport signale 4 chevauchements de dépendances, sans modification des dates.

Le démarrage normal utilise la base PZ7 préparée. En cas de retour arrière, **arrêter d'abord le service** et sauvegarder la base PZ7 active : toute écriture effectuée après la bascule y serait perdue en revenant directement à l'ancienne base. Configurer temporairement `STORAGE_BACKEND=legacy` et `DB_PATH` vers la sauvegarde PZ8 dans l'environnement de l'unité systemd, puis redémarrer et vérifier l'authentification ; retirer ces deux variables pour revenir à PZ7. Ne jamais utiliser l'ancienne base PZ8 avec `storage=pz7`.

## Limites explicites de l'adaptateur

Les champs sans correspondance PZ7, événements sans projet, libellés d'adéquation stratégique (ordinals inconnus), détails des rapports et appartenances simultanées à plusieurs unités restent dans les extensions `pz8_*` ; ils ne sont pas réinterprétés silencieusement. Les tables natives couvertes sont consultées lors des lectures et mises à jour lors des mutations. Les tâches PZ7 possédant plusieurs allocations et les profils possédant plusieurs historiques de coût sont **refusés à la modification** par Planzone 8, plutôt qu'écrasés. Une ligne PZ7 créée directement sans identité PZ8 peut rester invisible via l'API (sauf les membres projet mappés) ; ne pas utiliser ce runtime comme adaptateur général à toute l'application Java PZ7. Les notes/validations de temps et certains modèles personnalisés restent dans les extensions. Cloudflare/D1 conserve son stockage propre et n'est pas basculé par cette opération.
