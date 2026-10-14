# Tranche projet PZ7 : préparation documentaire et dépendances

État au 14 octobre 2026. Fichier préparé dans ce chat pour réception par le coordinateur. Il inventorie les pièces disponibles ; il ne remplace ni la spécification validée, ni le contrat d’équipes déjà reçu, ni une qualification du code PZ7.

## État du checkout et dépendances

Le checkout cloud contient l’application React/TypeScript et son backend historique Express/D1. Aucun fichier Java, module Gradle, `AGENTS.md`, plan de refondation ou contrat de réception Java n’a été trouvé dans les deux checkouts sous `/workspace`. Les branches GitHub présentes sont celles du prototype et des lots d’interface d’accès/scope. Les changements du coordinateur restent sur son checkout local Windows ; ils ne sont pas synchronisés par une délégation textuelle.

Pour porter cette tranche, il faut recevoir :

- Le commit ou la branche du socle Java reçu : `backend/core`, `backend/api`, `backend/migrations`, `backend/jobs`, construction Gradle et contrôles d’isolation.
- `AGENTS.md`, la spécification et le plan `docs/superpowers/*/2026-10-13-planzone8-*`, `docs/refoundation/multi-agent-workflow.md`, les contrats et validations access/scope, et le suivi `functional-coverage.json`.
- Les sources backend GitLab projet `24472884` au commit `a8684583e9b47826bc3061d0e089a1eee706933e`, et le frontend core `34159200` à la révision exacte référencée par le web au commit `71d1c4153657f2e994191d390adb76a38a76a26c`. La révision core exacte reste à transmettre.
- Le contrat des commandes et catalogues projet, puis l’attribution des fichiers. Le contrat paginé `src/pz7-scope/client.ts` reçu porte sur les équipes et listes d’accès ; il ne définit pas la création, l’édition, le déplacement ou la suppression des projets.

L’accès anonyme essayé au commit backend par l’API GitLab a répondu **404**. Cela ne permet ni de conclure que ce commit n’existe pas, ni de qualifier ses règles. Aucun jeton n’a été demandé dans le chat. L’outil pour envoyer un message au chat coordinateur n’est pas exposé dans cet environnement ; une demande de synchronisation reste à lui transmettre.

## Sources documentaires réellement disponibles

| Pièce | Identification | Niveau de preuve |
| --- | --- | --- |
| Guide d’utilisation PZ7 (fr) (3).pdf | SHA-256 `3cc6a686bd67da8d08ae64977c3aa1b7b35755cdf10b5b97746b819289d3b617` | Lecture documentaire ; ne démontre pas un comportement du serveur actuel. |
| Extraction du guide | SHA-256 `9811bdc9a848d1d78f654e47dcc4c977b6a68f5ba0f9bfa5936682ae08463133` ; pages séparées par saut de page | Texte consulté pour les passages ci-dessous. Les pictogrammes de rôles et les images peuvent manquer de l’extraction. |
| Maquette Planzone du 1 mars 2023, fichier fourni daté du 10 juillet 2026 | SHA-256 `7a9c3d7517fc467fa44883ae35922fb7e8a3bf469db7f3a76f9ce19c3fea246a` | Intention d’interface, pas comportement livré PZ7. |
| Matrice rôles et permissions fournie | Extraction dans [role-permissions-matrix.json](../role-permissions-matrix.json) | Référence documentaire complémentaire ; les règles qualifiées dans les sources restent prioritaires. |

Les hashes des deux PDF et de l’extraction du guide ont été recalculés sur les fichiers disponibles. Les références de page ci-dessous désignent les pages PDF/extractions, pas des lignes de code PZ7.

## Parcours et paramètres à reprendre

| Parcours | Observation documentaire | Références | À qualifier dans le code avant portage |
| --- | --- | --- | --- |
| Entrée en création | Depuis la navigation ou une zone, choix entre zéro et modèle. | Guide p. 41 ; maquette p. 41. | Privilège effectif, accès aux zones/candidats, paramètres imposant un modèle, options disponibles selon la Planzone et la zone. |
| Création depuis modèle | Un modèle standardise détails, planification, statuts et vues ; la base peut être imposée ou non. La galerie permet de choisir un modèle. | Guide p. 17–18 ; maquette p. 45. | Catalogue autorisé, référence exacte du modèle, champs hérités/remplaçables, copie ou références, reconstruction des éléments/relations, membres/ressources et dates. Ne pas présumer que les temps, documents ou coûts historiques se copient. |
| Détails du projet | Nom, description, tags, portefeuilles, propriétaire, statut, vues actives, ressources, météo et dates de début/fin. | Guide p. 42. | DTO exact, champs obligatoires/facultatifs, formats, limites, verrous par contexte, droits de chaque commande et conservation des champs non éditables. |
| Formulaire de création dessiné | Responsable marqué obligatoire ; sponsor, devise, statuts de tâche avec pourcentages, objectifs, tags et dates apparaissent dans la maquette. Sa variante ajoute la sélection de zone. | Maquette p. 44 et 63. | Présence réelle de chaque champ dans la version PZ7 figée. Ne pas confondre propriétaire et responsable, ni présenter les objectifs dessinés comme une fonction reçue. |
| Édition | Les détails sont accessibles depuis le menu du projet. Le guide distingue rôles globaux et projet. | Guide p. 42–43 ; matrice `Roles_generaux` ligne 34 et `Roles_projet` ligne 4. | Privilèges issus des catalogues, union des rôles, restrictions de champs et effets des statuts. Les noms de rôles affichés ne constituent pas une autorisation. |
| Déplacement/transfert | Une modale demande la zone cible ; les détails proposent « Transférer ». La suppression d’une zone peut proposer le transfert de ses projets. | Maquette p. 43 et 46 ; guide p. 38. | Opération exacte, droits sur source et destination, appartenance de zone induite, équipes, modèles et portefeuilles, données conservées et effets externes. La suppression de zone avec transfert est un cas distinct du déplacement d’un projet. |
| Suppression | La maquette demande confirmation et annonce la suppression définitive du projet avec son nombre d’éléments. | Maquette p. 47. | Autorisation, suppression/archivage, dépendances bloquantes ou cascade réelle, définition du nombre d’éléments, documents externes, historiques, confirmations et atomicité. Le nombre « 76 » est un exemple, pas une règle. |

Le guide ne décrit pas suffisamment la suppression ou le déplacement indépendant d’un projet pour conclure leurs invariants. La maquette comporte des variantes ; elles ne prouvent pas plusieurs politiques métier. L’écran du prototype actuel ne constitue pas une référence de qualification PZ7.

## Règles reçues à conserver lors de l’intégration

Ces règles proviennent de la transmission du coordinateur ; leur réception dans ce chat ne remplace pas ses preuves locales :

- Un client possède une Planzone, contenant des zones puis projets. Les unités organisationnelles restent distinctes.
- Une zone visible ne donne pas automatiquement accès à ses projets. Les sous-administrateurs voient toutes les zones ; seuls les administrateurs voient automatiquement tous les projets.
- Les privilèges effectifs combinent les rôles globaux et projet ; les restrictions de champs sont propres au contexte. Le backend reste l’autorité.
- Un responsable peut sélectionner les candidats d’équipe autorisés sans lecture du catalogue global des ressources. `pz_user` peut disposer de `resource:create` sans `resource:read`.
- Ajouter un membre projet induit l’appartenance à sa zone ; retirer un membre projet la conserve ; retirer un membre de zone retire ses équipes projet dans cette zone.
- Une ressource ou appartenance désactivée ne confère pas ses droits locaux. Les rôles incompatibles avec visiteur sont refusés ou adaptés lors de la rétrogradation, sans restauration automatique ultérieure.
- Contexte d’autorité recontrôlé dans la transaction, isolation PostgreSQL/RLS et clés composées, versions, reçu/idempotence, audit et outbox atomiques ; aucune prétention d’effet externe exactement une fois.
- Tarifs historiques, temps intégrés/validés et structure de planning sont des invariants à préserver lorsqu’une commande les affecte.

### Différences documentaires déjà identifiées

La matrice fournie réserve la création de ressources aux administrateurs (`Roles_generaux`, lignes 19–21). Le coordinateur a qualifié dans PZ7 que `pz_user` possède `resource:create` sans `resource:read`. La matrice ne peut donc pas remplacer le catalogue effectif. De même, une mention de responsable obligatoire ou de suppression en cascade dans une maquette ne devient pas une règle serveur sans qualification de la révision figée.

## Ordre de reprise et vérifications utiles

1. Synchroniser le socle reçu et les sources PZ7 figées ; lire les instructions et contrats réellement présents.
2. Tracer chaque parcours frontend → commande backend → privilèges/restrictions → écritures/effets. Nommer les inconnues, divergences de sécurité et paramètres de configuration.
3. Fixer le contrat de catalogues/détail/commandes projet avec le coordinateur. Identifier le propriétaire de chaque fichier ; ne pas ajouter un autre backend Express/D1 pour cette tranche.
4. Porter une création paramétrée complète, puis édition, déplacement et suppression suivant les règles qualifiées. Reprendre les composants d’accès existants, sans faux compte ni simulation dans le produit.
5. Vérifier uniquement les garanties touchées : refus et absence d’écriture, accès client/source/destination, restrictions de champs, version périmée, annulation, rollback d’une commande partiellement écrite, rejeu et réponse incertaine, copie de modèle et invariants affectés. PostgreSQL réel lorsque la garantie dépend de SQL.
6. Raccorder un parcours navigateur réel au backend Java et actualiser le suivi du coordinateur avec les scénarios précisément exécutés. Ne pas remplacer cette réception par une série de mocks ou un pourcentage global.

## Bilan vérifiable

Lecture documentaire et inventaire des dépendances : effectués. Qualification statique des commandes projet PZ7 : **à faire, sources indisponibles ici**. Implémentation/HTTP/PostgreSQL/navigateur Java pour cette tranche : **non exécutés**. Comparaison runtime PZ7 et test de charge : **non exécutés**. Aucun nouveau backend Java ou déploiement Java n’a été réalisé dans ce chat.
