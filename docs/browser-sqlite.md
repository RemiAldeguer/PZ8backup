# Migration vers Planzone 8 entièrement dans le navigateur (SQLite/OPFS)

## Périmètre et prérequis

Cette variante exécute l'interface et le service métier localement : `src/browser-api.ts` communique avec `src/browser-db.worker.ts`, qui utilise SQLite WASM dans un Web Worker et persiste la base dans **OPFS** (Origin Private File System). Le nom du fichier actif est mémorisé dans IndexedDB. Il n'y a ni API de données distante, ni comptes, ni mot de passe, ni connexion, ni synchronisation multi-utilisateur. La ressource « utilisateur courant » de la base préparée sert uniquement de référence locale, **pas** d'authentification. La création d'un espace vierge n'est pas proposée : il faut importer un fichier PZ7 préparé.

Servir l'application en **HTTPS**, avec `Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: require-corp` sur les réponses applicatives, y compris après navigation/rechargement ; les ressources chargées doivent être compatibles avec l'isolation d'origine. Sur `localhost`/`127.0.0.1`, le navigateur peut considérer le contexte comme sécurisé pour le développement, sans que cela remplace HTTPS en production. Vérifier dans le navigateur `isSecureContext === true`, `crossOriginIsolated === true` et la disponibilité d'OPFS (`navigator.storage.getDirectory`) : sinon le worker refuse de démarrer. `vite.config.ts` ajoute COOP/COEP pour le serveur de développement et l'aperçu ; `public/_headers` les prévoit pour les hébergeurs qui interprètent ce fichier. **Ne pas supposer** que n'importe quel hébergement statique, proxy ou navigateur les applique : vérifier les en-têtes effectivement reçus et l'import sur l'URL finale.

Utiliser une version récente et à jour d'un navigateur compatible avec OPFS, les Web Workers, WebAssembly et l'isolation croisée (notamment Chromium/Firefox récents ; vérifier Safari/WebKit sur les versions visées). Tester le navigateur et le mode de navigation réellement utilisés : navigation privée, politiques d'entreprise, restrictions de stockage ou blocage d'OPFS peuvent empêcher l'ouverture ou la persistance. L'application n'est pas garantie utilisable hors connexion après un simple chargement : les fichiers statiques doivent encore pouvoir être servis ou être disponibles en cache ; seule la **base serveur** est rendue inutile au fonctionnement local une fois l'application et le fichier importé accessibles.

## Préparer puis importer une copie privée

Partir d'une base **runtime PZ7 préparée**, non d'un dump de schéma vide, d'une ancienne base PZ8 brute ou d'un fichier publié sur le Web. Voir [la procédure PZ7](pz7-migration.md) pour la migration et la préparation préalable. Après avoir gelé les écritures du service d'origine et conservé ses sauvegardes, créer une copie autonome dans un **répertoire privé jamais servi par le Web** (de préférence hors du checkout, impérativement hors de `public/` et de `dist/`) :

```sh
python3 scripts/export-pz7-browser.py \
  --source data/pz7-runtime-active.sqlite \
  --output /chemin/prive/pz7-browser.sqlite
```

Le script lit la source sans la modifier, produit un snapshot cohérent incluant les transactions WAL validées, refuse une destination existante ou située sous `public/`/`dist/`, enlève les tables et objets `auth_*`, exécute `VACUUM` pour purger les pages libérées et vérifie l'intégrité et les clés étrangères. Le fichier de sortie (droits `0600`) **contient encore les données métier** : ne jamais le committer, le publier, le copier dans les assets, ni l'envoyer à un service non approuvé. Conserver la base serveur source et ses sauvegardes privées, hors ligne pour cette variante ; ne pas la supprimer après l'export.

Ouvrir l'URL HTTPS dans le navigateur cible, choisir **Importer une base .sqlite**, puis sélectionner manuellement ce fichier privé. Le navigateur lit le fichier choisi ; aucun chemin de base locale ou URL d'import public n'est configuré. Le worker refuse les fichiers invalides ou supérieurs à 250 Mio, effectue `integrity_check` et `foreign_key_check`, vérifie la ressource de référence, supprime aussi les tables d'authentification connues si elles existent et sélectionne la nouvelle copie seulement après validation. Si une base locale existe déjà, **exporter d'abord une sauvegarde** : confirmer l'import remplace la base *active* (l'ancienne copie physique peut subsister dans OPFS, sans interface de restauration automatique). Un import rejeté laisse la base précédemment sélectionnée active. Après un remplacement réussi, l’ancienne copie OPFS est supprimée si le navigateur le permet ; une panne pendant l’opération ou un échec de nettoyage peut laisser un fichier orphelin. Si le fichier actif est perdu ou illisible, l’écran d’import reste disponible pour restaurer une sauvegarde manuelle.

Dans l'interface, utiliser **Exporter une sauvegarde .sqlite** pour télécharger un instantané de la base locale ; conserver régulièrement plusieurs exports sur un support privé et en vérifier la réimportation dans un environnement de test. L'export n'est ni automatique ni synchronisé avec la base serveur ; il contient les données métier et doit être protégé. L'export privé et l'import dans le Worker retirent `auth_*` : les comptes, sessions et secrets serveur ne sont pas conservés dans la base du navigateur, et les utilisateurs du navigateur ne disposent pas d'identités distinctes protégées par mot de passe.

## Données, quotas et retour arrière

OPFS et IndexedDB sont liés à **l'origine exacte** (schéma, hôte, port) **et au profil du navigateur**. Changer de domaine, de port, de navigateur, de profil ou d'appareil ne retrouve pas automatiquement la base : exporter puis réimporter explicitement. Tout utilisateur ayant accès au même profil et à cette origine peut accéder aux données locales ; ce n'est pas une solution de partage d'équipe. Les réglages du navigateur, l'effacement des données du site, le mode privé, une réinstallation, l'éviction du stockage ou une panne de l'appareil peuvent effacer la copie. Le quota disponible dépend du navigateur et de l'espace disque ; un import ou des écritures peuvent échouer lorsque l'espace manque. Prévoir une marge pour les copies temporaires et sauvegarder avant toute opération risquée. Ne jamais traiter OPFS comme l'unique sauvegarde.

Pour revenir au service historique, garder sa base serveur et ses sauvegardes **hors ligne et inchangées** pendant l'essai navigateur ; arrêter les écritures côté navigateur, exporter chaque base locale à conserver, puis redémarrer l'ancien service selon sa procédure de retour arrière (voir [migration PZ7](pz7-migration.md)). **Aucune réconciliation automatique** : les modifications faites dans le navigateur après l'export initial ne sont pas réinjectées dans la base serveur, pas plus que d'éventuelles modifications serveur ne fusionnent avec OPFS. Le retour direct à la base serveur les perd côté serveur ; toute reprise de ces éditions exigerait une migration manuelle distincte, vérifiée, ou leur ressaisie. Ne pas laisser croire qu'un export `.sqlite` de navigateur peut remplacer directement la base du service avec ses comptes et sessions.

## Bascule locale vérifiée le 14 octobre 2026

L'unité `planzone8-codex.service` a été arrêtée et désactivée après un export cohérent. La base avec comptes est conservée dans `data/pz7-runtime-before-browser-20261014T133829Z.sqlite` ; la copie **sans comptes** à sélectionner manuellement dans chaque navigateur est `data/pz7-browser-import-20261014T133829Z.sqlite` (50 identités, intégrité et clés étrangères validées, droits 0600). Le site `https://planzone8.codex.f10web.com/` sert seulement `/var/www/planzone8-static` ; `/api` répond 410, les chemins SQLite 404, le WASM est servi avec `application/wasm` et COOP/COEP. Un import, une mutation et un rechargement ont été vérifiés sur l'URL HTTPS en Chromium sans requête API. La configuration Nginx antérieure est sauvegardée dans `/etc/nginx/sites-available/planzone8.codex.f10web.com.before-browser-20261014T133829Z` pour un retour arrière contrôlé. Chromium et Firefox ont aussi passé les essais locaux d'import, d'écriture et de rechargement ; WebKit/Safari reste **non vérifié** sur cet hôte (bibliothèques système manquantes).

La publication Cloudflare distante `workers.dev` **n'a pas été modifiée** : Wrangler n'est pas authentifié sur cet hôte. Le dry-run statique n'a aucun binding D1, mais l'ancienne publication distante peut encore avoir son Worker/API jusqu'à ce que son administrateur exécute `npm run deploy:cloudflare` avec les autorisations appropriées. La base D1 historique n'est pas supprimée par cette commande.

## Développement, validation et publication statique

Depuis la racine du projet, avec Node.js ≥ 24, Python 3 pour l'export et les dépendances npm installées :

```sh
npm ci
npm run dev                  # Vite sur 127.0.0.1:5173, en-têtes d'isolation
npm test                     # tests unitaires, dont l'export PZ7 navigateur
npm run build                # contrôle TypeScript puis génération de dist/
npm run start                # aperçu Vite sur 127.0.0.1:3001
npm run check:cloudflare     # contrôle Wrangler --dry-run, sans déploiement
```

Vérifier après build que `dist/` contient uniquement les assets statiques voulus et les en-têtes adaptés à l'hébergement choisi ; valider sur l'origine HTTPS finale l'isolation, l'import, les modifications, l'export et la réouverture après rechargement. La **racine statique doit être `dist/` uniquement** : jamais `public/`, `data/` ni la racine du checkout. `wrangler.jsonc` publie `./dist` sans binding D1 ni script Worker applicatif ; `public/_headers` est appliqué par les assets Workers. Vérifier les réponses réelles avant toute publication. `npm run dev:cloudflare` donne une prévisualisation locale ; `npm run deploy:cloudflare` publie les seuls assets statiques et ne doit être lancé que lorsque le parcours navigateur est validé.

`npm run test:e2e` utilise `playwright.local.config.ts` pour tester Chromium : démarrage isolé, import, modification persistante, export/réimport, récupération après perte OPFS, suppression d'une ancienne copie et refus d'un mauvais fichier. Lancer `npx playwright install chromium --only-shell` si ce navigateur de test manque. `npm run check:cloudflare` n'est qu'un dry-run ; il ne prouve pas à lui seul les en-têtes de l'URL finale ni l'absence de données privées publiées.
