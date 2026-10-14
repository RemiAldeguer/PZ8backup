# Stockage et accès aux données

La version Cloudflare conserve les données métier dans D1 côté serveur. Le navigateur reçoit un état filtré selon le compte connecté et ses rôles ; il ne reçoit ni clé de stockage ni mot de passe. Les données qu’un utilisateur est autorisé à afficher restent lisibles dans son navigateur. HTTPS protège leur transport ; un chiffrement dont la clé serait livrée au navigateur ne remplacerait pas les autorisations serveur.

## Stockage D1

`server/workspace-crypto.ts` compresse puis chiffre chaque snapshot métier avec AES-256-GCM : clé de 256 bits, nonce aléatoire de 96 bits et authentification de 128 bits. Le contexte authentifié inclut l’identifiant de l’espace, le format, la version et l’identifiant de clé. Copier un ciphertext dans un autre espace, modifier son en-tête ou ses octets, ou utiliser une mauvaise clé entraîne un refus. La clé est un binding **secret** `PLANZONE_DATA_KEYS` du Worker et n’entre pas dans les assets Vite.

Le binding contient un JSON `{ "current": "identifiant", "keys": { "identifiant": "clé de 32 octets en base64" } }`. Un trousseau permet de conserver les anciennes clés lors d’une rotation explicite. Le script de déploiement conserve une copie privée ciblée par compte/base/Worker dans `.cloudflare/data-encryption-keys.json`, avec permissions 0600. **Conserver cette copie dans un gestionnaire de secrets ou une sauvegarde privée** : le script refuse de régénérer une clé si des espaces sont déjà chiffrés ou un binding existe. Les clés, identifiants administrateur et copies de récupération sont ignorés par Git et exclus de l’archive distribuée.

`npm run deploy:cloudflare` vérifie tous les espaces avant de publier et crée des copies de récupération chiffrées dans `.cloudflare/encrypted-backups/`. Il publie une version transitoire capable de chiffrer les anciens snapshots, installe des déclencheurs D1 qui refusent toute nouvelle écriture en clair (y compris venant d’une ancienne requête en cours), migre **tous** les espaces même si la vérification initiale n’en voyait aucun en clair, puis publie une version stricte avec `PLANZONE_MIGRATE_PLAINTEXT=false`. Les écritures utilisent toujours le chiffrement. Les mises à jour de migration comparent la révision, préservent `updated_at`, relisent après conflit et ne remplacent jamais une ligne par une ancienne sauvegarde. La migration conserve le JSON métier exact, y compris les collections anciennes absentes. Un déploiement interrompu se reprend avec les mêmes fichiers privés et la même clé.

L’absence de clé, un ciphertext invalide ou un snapshot en clair après la transition n’entraîne ni données de secours ni réinitialisation : l’API refuse l’opération. Les limites métier restent calculées sur le snapshot déchiffré ; une limite supplémentaire de 2 Mo protège les valeurs D1 chiffrées. La compression permet de conserver les pièces jointes proches du quota. D1 conserve ses propres sauvegardes historiques suivant la rétention Cloudflare ; cette migration ne réécrit pas rétroactivement ces sauvegardes privées.

Les tables d’identité/session restent distinctes : les mots de passe sont des empreintes PBKDF2 salées et les sessions des empreintes de jetons. Les identifiants nécessaires aux contrôles d’accès ne sont pas chiffrés par le codec des snapshots.

## Documents à la demande

`GET /api/state` et les réponses de création/modification renvoient les métadonnées des documents avec `contentBase64: null`. `GET /api/project-documents/:id/content` charge un document à son ouverture ou téléchargement. Il exige une session valide et la visibilité du projet dans l’espace du compte. Une ressource étrangère au projet reçoit 404 ; un visiteur non connecté reçoit 401. Les observateurs peuvent toujours lire les documents, y compris dans un projet clos. Les permissions d’écriture restent distinctes.

Ce contrat est commun à Express/SQLite et au Worker/D1. Les réponses API utilisent `Cache-Control: no-store`. Les previews chargent le document dans la mémoire du composant, annulent la requête à la fermeture et n’enregistrent pas les fichiers dans localStorage.

## Développement et récupération

SQLite reste une base de développement dans le dossier privé `data/`, ignoré par Git et jamais servi par Express. Le chiffrement applicatif décrit ici concerne le stockage Cloudflare publié.

Pour `wrangler dev`, définir un trousseau **local différent** dans `.dev.vars`, ignoré par Git. Générer une clé avec `crypto.getRandomValues` sur 32 octets et conserver ce fichier ; ne pas réutiliser la clé de production. Les tests navigateur D1 préparent automatiquement un trousseau synthétique dans un dossier temporaire, sans toucher aux secrets ou aux données publiées. Une ancienne base D1 locale doit être migrée explicitement avec `PLANZONE_MIGRATE_PLAINTEXT=true`, puis revenir à `false`.

Restaurer un espace exige sa clé d’origine et son identifiant d’origine. Vérifier la copie chiffrée, conserver une copie de l’état courant et effectuer une mise à jour avec comparaison de révision. Une restauration D1 de snapshots antérieurs au chiffrement nécessite de relancer la transition explicite ; la version stricte ne les accepte pas silencieusement.
