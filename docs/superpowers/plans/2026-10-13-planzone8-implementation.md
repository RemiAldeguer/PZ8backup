# Plan d’implémentation de Planzone 8

Date initiale : 13 octobre 2026 ; suivi actualisé le 14 octobre. La direction Java est validée ; la cible est une reprise fonctionnelle PZ7 1 pour 1 et l’intégration du service utilisateur dans people. La [spécification](../specs/2026-10-13-planzone8-design.md) reflète cette direction. Le chantier est coordonné ici ; l’autre chat a été repris à la demande de l’utilisateur pour livrer l’interface d’accès sur un périmètre attribué, puis son travail a été intégré. Ce plan décrit les lots et critères de sortie, sans délai non mesuré.

## Règles d’exécution

Un lot livre un comportement vérifiable. Un agent possède un ensemble de fichiers annoncé ; le coordinateur possède contrats transversaux, intégration, migrations entre lots et vérification finale. Les agents ne lancent pas de délégation récursive, ne changent pas les choix de la spécification et ne poussent pas de code. Les tâches dépendantes attendent le contrat ou la preuve dont elles ont besoin.

Le modèle est choisi selon le risque : GPT-6.1 Sol en effort moyen pour build et développement courant, Sol en effort élevé pour transactions et autorisations, Luna en effort moyen pour modifications bornées. Une revue Astra est réservée à un doute substantiel ou un changement de sécurité complexe. La réussite est jugée par le résultat et les contrôles, jamais par le nom du modèle. Voir le [workflow multi-agent](../../refoundation/multi-agent-workflow.md).

Chaque délégation reçoit un paquet court : objectif, fichiers autorisés, contrat, critères de réception et limites. L’historique complet n’est pas recopié. Le compte rendu contient fichiers touchés, résultats vérifiés et problèmes restants. Le coordinateur évite de relire tout le dépôt et de relancer une suite inchangée. Une escalade de modèle intervient après diagnostic d’un blocage précis.

## État de départ

- Branche locale refactor/foundation, référence PZ8 570673d.
- Baseline antérieure : compilation, types et 355 tests réussis.
- Correction locale conservée : le test des listes vérifie la liste créée, sans imposer un nombre arbitraire de collections.
- Session cloud arrêtée : dernier commit publié déclaré 95f57c7 ; changements non commités de logo et interface conservés dans cette session. Aucun de ces changements n’est automatiquement intégré au clone local.
- Sources synchronisées du projet en lecture seule.
- JDK 21 disponible localement ; la disponibilité de PostgreSQL réel sera vérifiée avant de déclarer l’isolation acquise.
- Le skill superpowers:writing-plans est absent de cette installation ; ce plan est rédigé directement selon la spécification validée.

## Lot 0 Référence PZ7 et contrats de parité

Statut : en cours. La [première passe étendue](../../refoundation/2026-10-13-pz7-parity-baseline.md) corrige des hypothèses du prototype ; elle ne constitue pas une revue exhaustive. Ce lot est ajouté avant tout nouveau développement métier. Le lot 1 technique déjà livré reste conservé et ses rôles minimaux seront réévalués.

Avancement au 14 octobre : le [contrat de la première tranche people](../../refoundation/2026-10-14-people-contract.md) est qualifié à partir de PZ7 et implémenté. Le [suivi de couverture](../../refoundation/functional-coverage.json) maintient les autres capacités ouvertes, sans assimiler une suite de tests réussie à une parité globale.

1. Compléter la carte des dépôts, modules, parcours, hooks d’écriture, configurations client et intégrations. Garder commit, chemin et statut de preuve. Traiter explicitement UAA inaccessible et dépendances privées non inspectées.
2. Recenser chaque capacité PZ7, y compris ses déclinaisons client, puis ses entrées, sorties, droits, erreurs, historiques et effets. Définir les jeux synthétiques et résultats attendus sans recopier les algorithmes.
3. Qualifier people : profil ressource local stable, liaison de connexion facultative, invitations, quatre états d’activité distincts, rattachements Planzone/zone/projet, responsabilités et restrictions de champs. Distinguer suppression et désactivation.
4. Qualifier les cardinalités et calculs : allocations multiples, contraintes de planning typées multiples, unités organisationnelles, copie/modèles, upsert du temps, intégration et historique de coût. Retirer toute limitation tirée seulement du prototype.
5. Définir le propriétaire et la transaction des copies, transferts et déplacements transversaux. Regrouper initialement projets/planning si une frontière séparée crée des cycles ; extraire uniquement après preuve utile.
6. Préparer les scénarios de comparaison PZ7/PZ8, les tests de sécurité et les mesures de charge sur les mêmes jeux et conditions. Une lecture statique ne vaut ni exécution ni gain de performance mesuré.

Sortie par tranche : fonctions recensées, règles et droits qualifiés, inconnues décisives levées pour cette tranche, contrats revus, preuves de réception définies. La livraison globale exige la couverture de tout le catalogue PZ7 ; un domaine non encore lu n’est pas automatiquement reporté hors version. Les choix modifiant un résultat métier sont soumis à décision explicite.

## Lot 1 Construction et isolation minimale

Statut : terminé localement. Voir les [preuves de validation](../../refoundation/2026-10-13-foundation-validation.md). L’intégration OIDC/HTTP métier et les commandes durables relèvent des lots suivants.

### 1A Construction Java

Créer backend avec trois sous-projets Gradle core, api et jobs ; wrapper et sommes de contrôle vérifiés ; Java 21 ; Boot et Modulith compatibles, versions exactes publiées vérifiées. Produire deux exécutables sans démarrer de jobs dans l’API.

L’API refuse par défaut les accès non authentifiés ; seule la sonde minimale nécessaire est publique. Aucun utilisateur fictif ou en-tête permettant de choisir librement une identité n’est exposé. Les sondes ne publient pas de secrets ou configuration.

Sortie : compilation, contrôles de format/frontières pertinents, tests unitaires utiles et production des deux exécutables. L’application existante reste exécutable pendant la construction du nouveau socle.

### 1B Isolation cliente réelle

Créer le schéma initial de client, Planzone, adhésion et zone avec Liquibase. Définir rôles de migration et d’application, RLS de lecture/écriture et références dans le bon périmètre.

Implémenter une frontière transactionnelle Spring JDBC explicite ; le contexte de Planzone est installé localement sur la connexion de la transaction. Ajouter création et lecture paginée de zones derrière des cas d’usage internes autorisés. Préparer les verrous d’autorité nécessaires à la révocation concurrente.

Sortie : tests contre PostgreSQL réel avec rôle applicatif non privilégié. Vérifier deux Planzones, contexte absent, écriture étrangère, rollback, pool réutilisé, appartenance invalide et course de révocation lorsque le protocole est livré. Ne pas substituer H2 ou des mocks à ces preuves.

### 1C Développement et intégration

Fournir PostgreSQL local reproductible, lié à l’interface locale, sans mot de passe réel dans le dépôt. Documenter démarrage, contrôles et arrêt non destructif. Exécuter les contrôles essentiels, examiner les différences et enregistrer les limites restantes.

Les tests d’intégration ne sont pas silencieusement ignorés si PostgreSQL est indisponible. Le résultat est alors explicitement incomplet, et les autres contrôles indépendants continuent.

## Tranche P08 Ressources locales et utilisateurs

Statut au 14 octobre 2026 : terminée pour son contrat backend interne, [vérification réussie](../../refoundation/2026-10-14-people-validation.md). Création virtuelle/matérielle sans connexion, profil humain pour membre déjà actif, lecture/pagination et renommage versionné ; reçus et audit atomiques, RLS et unicité locale d’identité. Les noms identiques restent permis.

Cette tranche initiale a été prolongée par [connexion, invitations et accès](../../refoundation/2026-10-14-access-contract.md) : session OIDC, API HTTP et UI d’accès, catalogue de rôles PZ7, restrictions, outbox et worker SMTP. Les scénarios et niveaux de preuve figurent dans [functional-coverage.json](../../refoundation/functional-coverage.json). Privilèges zones/projets/groupes complets, désactivation avec effets projet, coûts et OBS restent ouverts.

## Lot 2 Commandes durables et concurrence

Statut : partiellement livré pour ressources et invitations. Reçus de création, versions, audit, outbox chiffrée et worker mail à baux sont implémentés ; la généralisation aux autres commandes et effets reste à faire.

Dépendance : lot 1B et contrat PZ7 qualifié du lot 0 pour la commande retenue.

Ajouter reçu d’opération, version attendue, historique et outbox dans la même transaction. Définir l’empreinte canonique et l’unicité de clé par acteur, Planzone et opération. Implémenter une commande représentative avec lecture du résultat et recontrôle des droits.

Preuves : réponse perdue après commit, double commande simultanée, même clé/autre corps, version périmée, erreur après la première écriture. Les droits et les données retournées restent ceux en vigueur lors de la remise.

Ajouter jobs à baux et génération de tentative, reprise bornée, état inconnu d’effet externe et réconciliation. Prouver interruption et exécution concurrente, sans promesse de livraison externe exactement une fois.

## Lot 3 Identité et première API cliente

Statut : connexion OIDC, sessions JDBC, invitations, API ressources et droits de cette tranche sont livrés et testés. Le moteur zones/projets et les équipes ont été prolongés par la tranche P02/P03 ci-dessous. Restent notamment provisionnement initial, parcours complets du compte/UAA, groupes et application des droits aux autres commandes, API métier suivantes et OpenAPI/client généré. Voir la [validation de la tranche](../../refoundation/2026-10-14-access-validation.md).

Dépendances : lots 1 et 2, contrat people et matrice de droits qualifiés au lot 0.

Brancher OIDC via Spring Security, sessions partagées, issuer/subject stable, CSRF, révocation et contexte d’autorité. Un fournisseur OIDC de développement peut être utilisé localement ; le choix d’un fournisseur commercial reste distinct.

Intégrer comptes, profils, invitations et ressources dans people, sans microservice utilisateur métier. Conserver les ressources sans connexion, les profils locaux d’un compte multi-clients et les états distincts. Relier l’adaptateur OIDC aux parcours de compte existants, y compris récupération et SSO/MFA une fois leurs contrats établis. Une action distante de provisionnement a un résultat récupérable ; elle ne participe pas artificiellement à la transaction SQL locale.

Publier le contrat OpenAPI des premiers parcours ; générer le client TypeScript. Tester via HTTP les DTO, null/omission, champs inconnus, codes d’erreur et absence de divulgation. Mapper privilèges, restrictions de champs, groupes et appartenances PZ7 ; ne pas assimiler les seuls noms de rôles à une preuve de compatibilité.

Sortie : connexion réelle, session révoquée, API autorisée de zones/projets et tests d’accès entre deux clients. Aucun mode de démonstration contournant l’authentification dans un build déployable.

## Lot 4 Tranche métier complète

Tranche permissions P02/P03 au 14 octobre : [catalogue et règles PZ7 qualifiés](../../refoundation/2026-10-14-scope-pz7-evidence.md), moteur zones/projets, rôles persistants, appartenances et API d’équipes implémentés. L’interface paginée livrée par l’autre chat est intégrée sur l’entrée Java ; contrôles PostgreSQL/HTTP ciblés, scénario UI et parcours navigateur réel sont réussis. Les preuves et limites figurent dans la [validation de scope](../../refoundation/2026-10-14-scope-access-validation.md). La création/édition paramétrée complète des projets et leurs autres commandes restent dans ce lot, avec application des privilèges désormais qualifiés.

Dépendance : lot 3.

Relier membre, projet, tâche multi-ressources, temps, synthèse et export. Porter les règles PZ7 qualifiées d’affectation, appartenance, coût par date, validation et intégration, avec calculs décimaux adaptés. Ne pas présumer une intégration inclusive uniforme ni un snapshot de tarif par saisie.

Extraire du code, des tests et parcours PZ7 un catalogue de scénarios lisibles. Comparer résultats normalisés entre référence PZ7 et backend Java, sans recopier les algorithmes dans les tests. Les tests du prototype PZ8 sont des compléments, jamais l’oracle unique.

Sortie : deux clients, deux zones, projets, réaffectation, changement de tarif, temps puis correction et export. Même somme visible dans feuille de temps, synthèse et export ; aucun accès à l’autre Planzone.

## Lot 5 Interface et fonctions complémentaires

Dépendance : contrat du lot 3, puis lot 4.

Réconcilier les changements cloud conservés avant toute modification des mêmes fichiers. Organiser le frontend par fonctions et utiliser les contrats générés et TanStack Query. Séparer action refusée, écriture réussie/rafraîchissement indisponible et résultat inconnu.

Porter l’ensemble du catalogue PZ7 : Gantt/listes/Kanban et contraintes, ressources/capacité/charge/occupation, OBS, calendrier, budget, documents/discussions, rapports/personnalisation, variantes client et intégrations identifiées. Cette liste reste enrichie par l’inventaire ; elle ne réduit pas le 1 pour 1. Chaque domaine conserve ses scénarios métier et dispose d’un seul backend maître en écriture dans l’environnement concerné.

Sortie : parcours navigateur clavier et erreurs compréhensibles ; changement de contexte et onglets concurrents sans fuite ; fenêtres/pagination adaptées aux vues.

## Lot 6 Exploitation et réception

Dépendances : domaines effectivement livrés.

Construire les images API/jobs, migrations séparées, configuration contrôlée, arrêt gracieux, métriques/traces et limites de ressources. Vérifier compatibilité N/N−1 et retour applicatif.

Tester sauvegarde et restauration isolée d’une Planzone, cohérence des objets, maintien des révocations et réconciliation des effets. Mesurer charge multi-clients et saturation avant de choisir des engagements de service.

La mise en service exige les décisions d’hébergement/identité/niveau de service et les preuves de réception de la spécification. Chaque capacité PZ7 a une preuve d’équivalence ou une déviation explicitement acceptée ; aucune capacité manquante n’est masquée par un taux global de tests. Une migration de données PZ7 reste un chantier ultérieur distinct.

## Conditions de fin d’un lot

Le code compile, les contrats sont cohérents, les tests protègent des risques réels, la revue n’a plus de défaut bloquant et les limites sont écrites. Une vérification non exécutée n’est jamais déclarée réussie. Le compte rendu nomme le lot livré et le travail restant ; il ne présente pas toute la refonte comme terminée après le seul socle.
