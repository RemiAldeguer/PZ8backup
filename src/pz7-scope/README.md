# Panneaux zones et projets PZ7

Port d’intégration : `ScopeApi` dans `client.ts`. Les six lectures paginées acceptent `query?: { namePrefix?, after?, limit? }` après le signal et renvoient `ScopePage<T>`. Les ajouts/modifications renvoient le DTO membre, les retraits `void`. Le client d’accès coordonné fournit transport, session et CSRF ; ce module n’implémente aucun endpoint ni catalogue de rôles.

Entrée exportée : `Pz7ScopePanels({ api, planzoneId, onUnauthorized })` depuis `index.ts`. Les erreurs du port portent `status` et/ou `code` (`SESSION_EXPIRED`, `ACCESS_DENIED`, `VERSION_CONFLICT`…). Le callback signale une session à renouveler ; il ne lance aucune redirection automatique.

Les permissions par objet et les `allowedRoleIds` renvoyés par Java font autorité. Une zone visible ne donne aucun accès implicite à ses projets. Aucun droit `resource:read` global n’est requis pour charger les candidats d’équipe.

Les données restent bornées à une page de 25 lignes. « Charger la suite » remplace la page courante ; « Page précédente » permet de retrouver les choix sans charger toute l’organisation. Le compteur indique les lignes réellement chargées sur cette page. Les six lectures transmettent le curseur reçu sans en inventer un. La recherche de candidats utilise `namePrefix` et remet le curseur à zéro.

La navigation par Planzone remonte tout le workspace avec une clé distincte, annule les requêtes et ignore les réponses tardives même si le port ne respecte pas l’annulation. Les listes zones/projets vérifient aussi le `planzoneId` des DTO. Le retrait de zone exige une confirmation de la cascade vers les équipes projet. Le retrait projet conserve l’accès zone. La modification de membre transmet la version attendue et impose un rechargement après un conflit ; aucune mutation n’est rejouée automatiquement.

Organisation : le domaine contient les règles pures de sélection de rôles et de portée ; la présentation possède les panneaux, formulaires, états asynchrones et styles `pz7-scope`. Le transport reste derrière le port typé. Aucun ancien écran, point d’entrée ni backend n’est modifié par ce lot.

Vérification ciblée : `tsc --noEmit` puis `playwright test tests/browser/pz7-scope.spec.ts`. Un scénario navigateur, avec port de test relié à une fixture HTTP, vérifie les droits par objet, la pagination, les candidats limités aux rôles autorisés, les refus 403/401, le conflit de version sans rejeu et une réponse tardive après changement de Planzone. Ce scénario ne qualifie pas le backend Java ; l’intégration réelle reste au coordinateur. Aucun déploiement de ce module n’est réalisé.
