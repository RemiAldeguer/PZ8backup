# Déployer la démonstration Planzone 8 sur Cloudflare

Le dépôt fournit un Worker Cloudflare, les fichiers React compilés et une base D1. Une publication réussie crée une adresse HTTPS `https://<worker>.<sous-domaine-du-compte>.workers.dev`. Cette adresse n’est confirmée qu’après les vérifications du script ; lancer l’application dans l’environnement cloud ne crée pas à lui seul une adresse publique.

La cible par défaut est le Worker `planzone8-demo` et une base D1 du même nom. L’interface de connexion est publique ; les données et leurs mutations exigent une session du compte administrateur. La session est transmise par un cookie opaque `HttpOnly`, `Secure`, `SameSite=Lax`, expire après sept jours et est révoquée côté serveur à la déconnexion. Les sessions du même compte retrouvent le même workspace D1. La création de comptes supplémentaires, le SSO et les droits par zone/projet restent à développer.

Le premier déploiement crée `admin` avec un mot de passe aléatoire. Seul son hash salé est envoyé à D1 ; les identifiants initiaux sont conservés dans `.cloudflare/admin-credentials.json`, ignoré par Git et créé avec des permissions `0600`. Ne pas inclure ce fichier dans une archive de code ou un journal. Les déploiements suivants conservent le compte et son mot de passe. Le menu du compte permet de le changer ; toutes les autres sessions sont alors invalidées. Le fichier initial devient obsolète après ce changement.

## Accès requis

Dans le compte Cloudflare choisi :

L’ID de compte est visible dans **Workers & Pages**, dans les informations du compte, ou dans l’adresse du tableau de bord : `dash.cloudflare.com/<ACCOUNT_ID>/…`. Il comporte 32 caractères hexadécimaux ; il est distinct de l’identifiant d’une zone DNS.

- Activer Workers et configurer son sous-domaine `workers.dev` dans **Workers & Pages**. Le script réutilise ce sous-domaine et ne crée pas de compte temporaire, ne change pas le sous-domaine du compte et n’accepte pas de conditions de service automatiquement.
- Créer un jeton API limité à ce compte avec **Account Settings Read**, **Workers Scripts Edit** et **D1 Edit**. Aucun accès DNS ni domaine personnalisé n’est nécessaire.
- Configurer `CLOUDFLARE_ACCOUNT_ID` comme variable et `CLOUDFLARE_API_TOKEN` comme secret dans l’environnement d’exécution. Ne pas coller le jeton dans le chat, le code, `wrangler.jsonc` ou une commande enregistrée.

Utiliser une version récente de Node 24 ; Node **24.19.0** a été utilisé pour la vérification. Le script de publication utilise `node --use-env-proxy --import tsx` afin que ses requêtes REST respectent le proxy de l’environnement. Wrangler respecte également `HTTPS_PROXY` / `HTTP_PROXY`. Conserver les variables proxy et les certificats CA déjà configurés ; ne pas désactiver la validation TLS pour contourner un refus réseau. `api.cloudflare.com` et l’adresse `workers.dev` publiée doivent être autorisés par la politique réseau.

Dans l’environnement cloud, ces répertoires évitent des écritures dans un dossier personnel inaccessible, sans modifier `HOME` :

```sh
export XDG_CONFIG_HOME=/tmp/planzone8-wrangler-config
export WRANGLER_LOG_PATH=/tmp/planzone8-wrangler-logs
export WRANGLER_SEND_METRICS=false
```

Le script de publication fournit lui-même ces valeurs par défaut à Wrangler et désactive ses journaux sur disque. Le jeton reste transmis par l’environnement.

## Vérifier avant de publier

```sh
npm ci
npm run build
npm run check:cloudflare
npm run dev:cloudflare
```

`check:cloudflare` compile le Worker avec `wrangler deploy --dry-run`, sans publication. `dev:cloudflare` sert les fichiers compilés et une base D1 locale sur le port **8787**. Une base locale ne devient pas la base distante lors de la publication. Le fichier `wrangler.jsonc` contient un identifiant D1 nul destiné au développement ; le script résout le véritable identifiant pour la publication.

`npm run test:e2e:cloudflare` prépare un compte de test dans une base D1 temporaire indépendante et vérifie les formulaires de connexion, le changement de mot de passe et les parcours métier. `npm run dev:cloudflare` seul ne crée pas de compte ; provisionner un compte local avant de l’utiliser, par exemple avec le même adaptateur `AuthManager`/`D1AuthDatabase` utilisé par les tests. Un compte de test local ne devient pas un compte distant lors de la publication. Les vérifications effectuées figurent dans `docs/verification.md`.

## Publier et conserver les données

Après configuration des deux variables Cloudflare :

```sh
npm run deploy:cloudflare
```

`scripts/deploy-cloudflare.ts` effectue ces opérations dans cet ordre :

1. Vérifie le compte, son sous-domaine, les Workers existants et toutes les pages de bases D1.
2. Refuse un Worker ou une base homonyme sans reçu local de cette démonstration. Pour un premier déploiement, choisir des noms disponibles dans `wrangler.jsonc` si les noms par défaut sont déjà utilisés.
3. Crée D1 pour une nouvelle cible ou réutilise l’identifiant du reçu. Applique les migrations SQL dans leur ordre, avec des créations idempotentes qui conservent les espaces existants ; vérifie chaque résultat SQL et provisionne `admin` seulement si ce compte n’existe pas.
4. Écrit `.cloudflare/wrangler.deploy.json` avec les chemins absolus et le véritable binding D1. Ce fichier contient des identifiants et un marqueur de déploiement, aucun jeton API.
5. Lance Wrangler pour compiler et publier le Worker et les fichiers `dist/`, puis active `workers.dev` avec les URL de prévisualisation désactivées.
6. Vérifie la page HTML, ses fichiers JavaScript/CSS, `/api/health`, le refus HTTP401 de `/api/state` sans session et la session anonyme `{authenticated:false}`. Affiche ensuite l’adresse publique confirmée.

Les reçus `.cloudflare/deployment.json` et `.cloudflare/deployment.pending.json` sont ignorés par Git. **Conserver ces fichiers** pour les redéploiements : ils évitent de remplacer un projet inconnu et de changer de base par erreur. Le marqueur non secret permet de reconnaître un Worker publié partiellement si Wrangler échoue après son téléversement. Un reçu avec `verified: false` signifie que la cible a été publiée mais que sa disponibilité publique n’est pas encore confirmée.

Si l’API renvoie un refus de permissions ou si la politique réseau bloque l’hôte, corriger l’accès configuré puis relancer. Le script ne supprime ni Worker ni base en cas d’échec. Si les reçus ont été perdus, examiner les ressources existantes dans Cloudflare avant toute reprise : créer un faux reçu ou supprimer la base ne constitue pas une procédure de récupération.

Après publication, ouvrir l’adresse affichée et se connecter avec les identifiants du compte. Vérifier qu’une session anonyme ne peut pas lire les données, qu’un rechargement conserve la connexion et que la déconnexion empêche le rejeu du cookie. Une autre session authentifiée avec ce compte partage ses données.

Pour reprendre les données de l’ancienne démonstration, se connecter depuis le navigateur qui possède encore son cookie `__Host-planzone8-demo`. Après vérification du mot de passe, le serveur peut associer cet espace existant au compte, une seule fois et seulement si le workspace courant du compte n’a jamais été modifié. Toutes les anciennes lignes sont conservées ; l’ancien cookie seul n’autorise plus aucun accès. Une mutation concurrente ne peut pas enregistrer silencieusement des modifications dans un workspace abandonné pendant cette reprise.

## Limites de cette architecture

Chaque espace est un snapshot JSON D1 avec révision. Une mutation enregistre les données uniquement si la révision lue est toujours courante ; après cinq conflits, l’API retourne une erreur 409 invitant à réessayer. Cela évite qu’une modification concurrente écrase silencieusement la précédente.

L’application limite chaque snapshot à **1 000 000 octets** et chaque corps de mutation à **100 KiB**. La limite D1 d’une chaîne/BLOB ou ligne est **2 000 000 octets** : stocker tout un espace dans une ligne limite donc son volume bien avant la capacité totale de la base. La lecture, le clonage et la sérialisation JSON consomment du CPU Worker ; cette approche convient à la démonstration, pas à une grande instance de production avec de nombreux utilisateurs et projets.

Limites du plan gratuit consultées le 6 octobre 2026 :

| Service | Limite gratuite pertinente |
| --- | --- |
| Workers | 100 000 requêtes dynamiques par jour ; 10 ms de CPU par requête ; 128 MB de mémoire |
| Fichiers statiques | 20 000 fichiers par version ; 25 MiB par fichier |
| D1 | 10 bases par compte ; 500 MB par base ; 5 GB cumulés |
| D1 lectures/écritures | 5 millions de lignes lues et 100 000 lignes écrites par jour, remise à zéro à 00:00 UTC |
| D1 récupération Time Travel | 7 jours sur le plan gratuit |

Le plan actif du compte et les tarifs Cloudflare s’appliquent ; cette procédure ne garantit pas l’absence de facturation. La vérification anonyme de `/api/state` ne crée aucun workspace. Pour une grande instance, prévoir une gestion des comptes et permissions, une politique de conservation, un modèle de stockage par entité, des sauvegardes et une capacité adaptée avant d’y importer des données métier.

## Contrats REST utilisés

Toutes les routes suivantes sont relatives à `https://api.cloudflare.com/client/v4` et utilisent le jeton API du compte, sauf le téléversement des fichiers qui utilise un JWT temporaire d’assets :

| Action | Route et corps |
| --- | --- |
| Lire le compte | `GET /accounts/{accountId}` |
| Lire le sous-domaine | `GET /accounts/{accountId}/workers/subdomain` |
| Lister les Workers | `GET /accounts/{accountId}/workers/scripts` |
| Lister D1 | `GET /accounts/{accountId}/d1/database?page=…&per_page=100` |
| Créer D1 | `POST /accounts/{accountId}/d1/database`, `{ "name": "planzone8-demo" }` |
| Initialiser le schéma | `POST /accounts/{accountId}/d1/database/{uuid}/query`, `{ "sql": "…", "params": [] }` |
| Activer workers.dev | `POST /accounts/{accountId}/workers/scripts/{name}/subdomain`, `{ "enabled": true, "previews_enabled": false }`, puis `GET` de la même route |

Wrangler **4.147.0** prend en charge le protocole d’assets et l’envoi multipart du Worker. Pour une intégration REST ultérieure, ses contrats vérifiés sont :

1. Construire le manifeste `"/chemin": { "hash": "…", "size": octets }`. Le hash est les 32 premiers caractères hexadécimaux de **BLAKE3(contenu en base64 + extension sans point)** ; `size` compte les octets du fichier original.
2. `POST /accounts/{accountId}/workers/scripts/{name}/assets-upload-session` avec `{ "manifest": … }` retourne un JWT temporaire et des buckets de hashes restant à téléverser.
3. Pour chaque bucket, `POST /accounts/{accountId}/workers/assets/upload?base64=true` en multipart avec **le JWT de session comme Bearer**. Chaque champ et nom de fichier est son hash et son contenu est le fichier encodé en base64. Conserver le JWT de finalisation retourné ; si aucun bucket n’est nécessaire, le JWT initial convient déjà. Ne pas journaliser ces JWT.
4. `PUT /accounts/{accountId}/workers/scripts/{name}` en multipart contient le module JavaScript et une partie JSON `metadata`. Celle-ci inclut `main_module`, `compatibility_date`, `assets.jwt`, la configuration SPA et les bindings `{ "name": "ASSETS", "type": "assets" }` et `{ "name": "DB", "type": "d1", "id": "UUID" }`. `database_id` appartient à la configuration Wrangler ; le binding REST utilise **id**.

Le dépôt passe par Wrangler pour cette étape, ce qui évite de maintenir les détails du hash, des JWT et du multipart dans le script de publication.

Sources : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [tarifs D1](https://developers.cloudflare.com/d1/platform/pricing/), [API Cloudflare](https://developers.cloudflare.com/api/), [source Wrangler](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler). Le code distribué de Wrangler 4.147.0 et du SDK Cloudflare 5.2.0 a servi à vérifier les contrats REST.
