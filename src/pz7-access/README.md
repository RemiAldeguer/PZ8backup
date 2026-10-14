# Interface d’accès PZ7

Composant React/TypeScript intégré depuis `src/main.tsx` sur `/access`, `/invitations/accept` et `/account/validation`. `VITE_PZ8_BACKEND=java` active aussi cette entrée à la racine. Aucun jeu de démonstration, compte synthétique ou mot de passe n’est présent dans le chemin produit.

```tsx
import { Pz7AccessApp } from "./pz7-access";

<Pz7AccessApp
  apiBaseUrl=""
  onPlanzoneChange={(planzone) => {
    // Brancher le contexte et la navigation de l’application hôte.
    // null indique qu’aucun contexte client n’est actuellement disponible.
  }}
/>;
```

`apiBaseUrl` est une racine de chemin sur la même origine, par exemple `""` ou `"/gateway"`. Le client ajoute `/api/v1`. Il refuse les origines différentes et les racines comportant une query, un fragment ou des identifiants. `onPlanzoneChange` est facultatif et ne transporte que les métadonnées de sélection, sans token CSRF.

## Parcours couverts

- Session OIDC : lecture de session, redirection vers `/api/v1/auth/login`, déconnexion et sélection parmi les Planzones renvoyées par le serveur.
- Ressources humaines, virtuelles et matérielles : filtre par préfixe de nom, type et activation ; pages de 25 avec curseur `(name, id)` ; création VIRTUAL/MATERIAL sans compte ; renommage avec version attendue.
- Invitations : création et envoi par le backend, liste des statuts, révocation confirmée, prévisualisation publique et acceptation authentifiée. Le composant prend en charge `/invitations/accept?token=…` et `/account/validation?token=…`.
- Permissions de ressource : rôle provenant du catalogue backend et champs non modifiables. Les valeurs existantes, y compris les restrictions de champs encore inconnus de cette UI, sont conservées. Sans `canManageRoles`, les restrictions peuvent être modifiées si `resource:manage-access` est accordée, mais le rôle existant est conservé.

Les objets de rôle et leurs labels viennent exclusivement de `/planzones/:id/access`. Les noms PZ7 `pz_admin`, `pz_under_admin`, `pz_user` et `pz_visitor` ne sont pas remplacés par un catalogue côté React.

## Garanties de l’interface

Les requêtes utilisent `credentials: "include"`, `cache: "no-store"` et le header CSRF reçu de `/session` pour chaque mutation. Le token CSRF et les données client restent en mémoire, sans persistance dans le navigateur. Les invitations ne sont jamais exposées sous forme d’un token de création renvoyé à l’écran ; leur envoi appartient au backend.

Le changement de Planzone remonte un contexte neuf, masque immédiatement les données précédentes, annule les requêtes HTTP en cours et ignore leur résolution tardive. Cela ne révoque pas une commande déjà reçue par le serveur. Une réponse ressource dont le `planzoneId` ne correspond pas à la requête est refusée. Les permissions de lecture, de création, d’édition, de gestion d’invitations et de gestion d’accès sont évaluées séparément. Ces contrôles UI ne remplacent pas ceux du serveur.

Une mutation n’est jamais rejouée automatiquement. Une reprise explicite du même formulaire conserve l’`operationId` ; tout changement du corps en produit un nouveau. Un conflit de version exige un rechargement explicite du profil, puis une nouvelle sauvegarde. Le profil rechargé est de nouveau vérifié avant d’autoriser l’édition de son nom.

## Contrat complété par le coordinateur

Chaque item ressource et le profil renvoyé par `GET /planzones/:id/resources/:resourceId` doivent inclure `nonEditableFields: string[]`. Le profil contient les mêmes champs et la même version que les items de la liste. Ces restrictions sont modifiées uniquement par `PUT .../access`, jamais par PATCH du nom. Si le backend omet cet état, l’interface bloque son édition pour éviter d’effacer implicitement une restriction.

La connexion navigue vers `/auth/login?returnTo=` avec le chemin et la query actuels encodés, conformément au contrat d’intégration. Le backend valide ce chemin relatif et le restitue après l’aller-retour fournisseur. Une réponse `SESSION_EXPIRED` invite à se reconnecter, sans boucle automatique. L’URL d’acceptation est débarrassée du token une fois l’acceptation confirmée. Le composant rafraîchit alors la session et sélectionne la Planzone renvoyée, même absente de la session initiale.

## Validation reproductible

Depuis le dépôt, avec les dépendances du lockfile et Chromium installés :

```sh
node_modules/.bin/tsc --noEmit
npm run test:e2e:access
```

Le test monte exclusivement l’export `Pz7AccessApp` via un bundle esbuild en mémoire. Les fixtures HTTP et le fournisseur de redirection de test sont contenus dans le seul fichier de test ; ils ne font pas partie du produit. Les comportements couverts comprennent les refus, les conflits, les réponses tardives, les curseurs, les restrictions, le CSRF et l’arrivée dans une nouvelle Planzone.

La recette `npm run test:e2e:access:java` utilise l’entrée réelle, Vite et un backend Java/PostgreSQL avec fournisseur de test OIDC signé. Elle nécessite d’abord la tâche `:api:browserAcceptanceFixture` et son manifeste `PZ8_BROWSER_FIXTURE_FILE`. Les [instructions et résultats](../../docs/refoundation/2026-10-14-access-validation.md) distinguent cette recette des 25 scénarios avec fixtures HTTP et de l’exploitation avec le futur fournisseur. Aucun déploiement n’a été réalisé.
