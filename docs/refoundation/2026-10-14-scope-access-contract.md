# Permissions des zones et projets PZ7

Cette tranche porte les permissions et appartenances P02/P03 dans le socle Java, puis les relie aux panneaux d’accès. La [qualification PZ7](2026-10-14-scope-pz7-evidence.md) fournit les commits, chemins, lignes et catalogue final des privilèges. Le [suivi fonctionnel](functional-coverage.json) reste partiel : moteur de droits, API d’équipes et parcours de création/édition d’un projet sont des livraisons distinctes.

## Règles conservées

| Contexte | Règle |
|---|---|
| Visibilité zones | pz_admin et pz_under_admin voient toutes les zones du client ; autres rôles par ZoneMember ; zone de modèles visible |
| Visibilité projets | pz_admin voit tous les projets ; autres rôles par ProjectMember actif et ressource active ; modèles visibles |
| Zone et projet | Une zone visible ne donne pas lecture de tous ses projets |
| Privilèges projet | Union du rôle Planzone et du rôle projet ; trois rôles projet persistants, sans catalogue inventé côté interface |
| Membres de zone | Ajout selon zonemember:create, retrait selon zonemember:delete ; aucune nouvelle hiérarchie de rôles de zone |
| Équipe projet | Ajout, modification et retrait contrôlés séparément par projectmember:create/update/delete |
| Ressources candidates | Catalogue technique du client autorisé pour l’action d’équipe, indépendamment du droit de lecture du catalogue global de ressources |
| Ressource sans compte | VIRTUAL/MATERIAL associable avec rôle projet facultatif ; aucune création d’identité ou d’adhésion implicite |
| Projet et zone | Ajouter un membre projet crée son appartenance à la zone si nécessaire ; le retirer du projet conserve celle de la zone |
| Retrait de zone | Retire réellement les appartenances projet de cette zone dans la même transaction, en conservant celles des autres zones |
| Statuts | Aucun verrou général d’édition d’équipe n’est ajouté pour pz_closed/pz_waiting ; les règles des tâches et du temps restent propres à leurs commandes |

Les privilèges du visiteur projet comprennent notamment certaines actions de discussion et de document. Le catalogue conserve ces droits ; leur présence ne prouve pas le portage de ces parcours métier futurs.

Les listes zones, projets, membres et candidats utilisent une pagination par nom/UUID, préfixe littéral et limite de 1 à 100, 25 par défaut. Les frontières client sont imposées en PostgreSQL et dans chaque contexte API. Une page peut changer après un renommage concurrent ; ce n’est pas un snapshot immuable.

## Choix de sécurité explicites

Le code PZ7 inspecté contient des écarts entre restrictions déclarées et résolution effective du contexte d’entité, des lectures qui ignorent la désactivation et une référence Role non bornée au catalogue projet. La cible normalise le contexte projet, exclut les droits locaux des membres/ressources inactifs et refuse les rôles globaux ou étrangers dans une affectation projet. Ce sont des corrections documentées, pas une comparaison exécutée avec PZ7 déployé.

Le rôle projet détermine ses restrictions de champs : pr_worker ne permet pas de renommer/déplacer un projet, même si un sous-administrateur possède project:update globalement. Les restrictions ne sont pas fusionnées arbitrairement avec celles des ressources. L’administrateur Planzone conserve l’autorité sur tous les projets et leurs champs, même sans appartenance ou avec un rôle projet restreint ; ce choix évite la fragilité du résolveur historique sans membre et préserve l’autorité administrative observée.

Les restrictions Zone sont stockées séparément de celles des ressources. Un privilège zone:update n’accorde pas à lui seul l’édition de son nom aux utilisateurs et sous-administrateurs. La création interne de zone vérifie le privilège réel du catalogue, puis associe le profil humain du créateur s’il existe, sans en fabriquer un.

Une ressource au rôle global pz_visitor ne peut recevoir un rôle projet incompatible. Une rétrogradation globale adapte aussi ses rôles projet existants en pr_visitor, augmente leurs versions et conserve leur activation et les appartenances zone. Une promotion ultérieure ne restaure aucun ancien rôle. Cette adaptation et son audit appartiennent à la transaction d’affectation globale.

Les modifications d’équipe acquièrent le verrou d’autorité de la Planzone dès l’entrée, puis vérifient les droits propres à la zone ou au projet. Elles ne supposent pas un rôle administrateur global pour un manager projet. Les anciennes entrées réservées aux administrateurs gardent leur contrôle. La version globale de session reste vérifiée sous verrou, et aucune autorité envoyée par le navigateur n’est acceptée.

Ajout/retrait dans le même état sont idempotents par clé d’appartenance. Ajouter un membre déjà présent avec un autre rôle ou état donne un conflit ; l’API ne transforme pas un droit de création en droit de modification. Modifier rôle/activation exige la version attendue. Une erreur d’audit annule aussi l’appartenance et l’association de zone induite.

## API et interface

Toutes les routes ci-dessous sont sous `/api/v1/planzones/{planzoneId}` et proviennent de la session OIDC vérifiée. Les rôles et les permissions courantes sont renvoyés par le serveur.

| Route | Résultat |
|---|---|
| GET `/zones`, `/projects?zoneId=…` | Pages autorisées, permissions par objet et champs éditables |
| GET `/project-roles` | Catalogue du client : UUID, nom et libellé |
| GET `/zones/{zoneId}/members`, `/member-candidates` | Pages de membres et candidats de zone |
| POST `/zones/{zoneId}/members` | Ajout avec resourceId |
| DELETE `/zones/{zoneId}/members/{resourceId}` | Retrait de zone et de ses équipes projet |
| GET `/projects/{projectId}/members`, `/member-candidates` | Pages de membres et candidats, allowedRoleIds propres à chaque ressource |
| POST `/projects/{projectId}/members` | Ajout avec resourceId et roleId facultatif pour V/M |
| PUT `/projects/{projectId}/members/{resourceId}` | roleId explicitement présent, éventuellement null pour V/M ; deactivated et expectedVersion obligatoires |
| DELETE `/projects/{projectId}/members/{resourceId}` | Retrait du projet, appartenance zone conservée |

Chaque GET paginé accepte namePrefix, limit et la paire afterName/afterId. Les UUID sont scalaires. Les refus d’action donnent 403, un scope/rôle indisponible 404, un conflit d’appartenance/version 409, un corps incomplet 400. Une requête vers une autre Planzone ne peut utiliser les droits de la Planzone courante.

L’onglet « Zones et projets » est intégré au workspace d’accès. Le transport conserve le cookie et le CSRF en mémoire selon le contrat précédent. Les panneaux annulent les lectures et retirent les données au changement de client. Ils ne supposent pas que la visibilité de la zone accorde celle du projet. Un retrait de zone affiche ses effets avant confirmation ; les conflits exigent un rechargement explicite, sans renvoi automatique de mutation.

Les fonctions de lecture/modification d’appartenance sont bornées et vérifiées, avec search_path fixe et exécution publique révoquée. Les catalogues de rôles, membres et audits restent privés pour le login API. Les projets ont RLS forcée ; les références de zone, ressource et rôle utilisent des clés composées du même client. Le worker mail ne reçoit aucun nouvel accès métier.

## Limites de réception

La migration 006 ajoute le schéma d’autorité et les projections minimales de projets. Elle ne crée pas de projets ou comptes de démonstration dans le produit et ne migre pas les données du backend historique. Les créations paramétrées, édition/déplacement/suppression de projets, groupes et autres commandes métier seront portées avec leurs règles PZ7 complètes ; aucun formulaire réduit n’est présenté comme leur équivalent.

SSO/UAA, parcours d’organisation initiaux, workflows de statuts, temps, documents et discussions restent suivis par leurs familles. Les garanties de ce lot n’impliquent pas leur couverture. Aucun test de charge ni différentiel contre PZ7 déployé n’est déclaré réalisé. Les contrôles strictement nécessaires et leurs résultats figurent dans la [validation](2026-10-14-scope-access-validation.md).
