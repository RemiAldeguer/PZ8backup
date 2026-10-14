# PZ7 — preuves des permissions zones et projets

Date : 14 octobre 2026. Qualification bornée de sources immuables, en lecture seule ; aucun appel à une API PZ7 déployée, aucun parcours navigateur PZ7 et aucun test PZ7 exécuté. Ce document ne prouve pas la parité de production. Le backend inspecté est GitLab **24472884**, commit **a8684583e9b47826bc3061d0e089a1eee706933e**. Le frontend core est GitLab **34159200**, commit **71d1c4153657f2e994191d390adb76a38a76a26c**. Les pages et gardes du dépôt web distinct ne sont pas qualifiées dans cette passe.

## Règles pivots et visibilité

Les rôles sont des entités persistantes, avec un nom, des privilèges et une carte de restrictions par entité. Ne pas transformer les rôles de zone en un nouvel enum. Pour les objets projet, les privilèges sont l’**union** du rôle Planzone de la ressource et du rôle ProjectMember ; sans ProjectMember, le moteur de privilèges utilise uniquement le rôle Planzone. Source : [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:152](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L152).

| Acteur | Zones ordinaires visibles | Projets ordinaires visibles | Création zone | Création projet |
|---|---|---|---|---|
| pz_admin | Toutes les zones du Planzone courant | Tous les projets du Planzone courant, même sans ProjectMember | Oui | Oui |
| pz_under_admin | Toutes les zones du Planzone courant | Projets auxquels il appartient | Non | Oui |
| pz_user | Zones où il est ZoneMember | Projets auxquels il appartient | Non | Non |
| pz_visitor | Zones où il est ZoneMember | Projets auxquels il appartient | Non | Non |

La zone de modèles et les projets template du Planzone courant sont également visibles dans les requêtes RLS. L’appartenance à une zone ne donne pas automatiquement lecture de tous ses projets. Aucun champ « confidentialité » n’a été trouvé dans Zone, son DTO ou les sources recherchées : la confidentialité observée repose sur les appartenances et les filtres, pas sur un booléen qualifié. Sources : [core/src/main/resources/application.yml:65](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/application.yml#L65), [core/src/main/resources/application.yml:75](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/application.yml#L75), [core/src/main/resources/application.yml:98](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/application.yml#L98), [core/src/main/java/com/planzone/common/domain/Zone.java:51](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/Zone.java#L51), [src/dto/zone.ts:1](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/dto/zone.ts#L1).

Les listes métier ont des différences avec le filtre Hibernate : [core/src/main/java/com/planzone/api/repository/ProjectRepository.java:308](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/repository/ProjectRepository.java#L308) exclut ProjectMember.deactivated, alors que application.yml:98-121 ne l’exclut pas. ZoneRepository.getVisibleZones ajoute les zones selon le rôle global ; sa branche admin n’a pas elle-même la borne Planzone, mais les méthodes appelantes de liste filtrent le Planzone courant : [core/src/main/java/com/planzone/api/repository/ZoneRepository.java:75](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/repository/ZoneRepository.java#L75), [core/src/main/java/com/planzone/api/service/ZoneService.java:146](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ZoneService.java#L146). Ne pas reproduire cette absence de borne sur une route PZ8.

## CRUD, équipe et ressources associables

Le tableau décrit les privilèges déclarés dans les seeds. Leur efficacité dépend aussi de la visibilité, des champs et des écarts d’implémentation détaillés plus bas.

| Rôle | zone:create/update/delete | zonemember:create/update/delete | project:create/update/delete | projectmember:create/update/delete |
|---|---|---|---|---|
| pz_admin | create, update, delete | create, update, delete | create, update, delete | create, update, delete |
| pz_under_admin | update avec champs restreints | create | create, update | create |
| pz_user | update avec champs restreints | create | Aucun | Aucun |
| pz_visitor | Aucun | Aucun | Aucun | Aucun |
| pr_manager, droits additionnels du projet | Aucun | create, incohérence de portée à corriger | update, delete | create, update, delete |
| pr_worker, droits additionnels du projet | Aucun | Aucun | update avec champs restreints | Aucun |
| pr_visitor, droits additionnels du projet | Aucun | Aucun | Aucun | Aucun |

Sources des noms et associations : changelogs 0009-sprint-91/0002, 0010-sprint-93/0005 et /0008, 0011-sprint-95/0001, 0013-sprint-97/0003, référencés intégralement en annexe. Le rôle global pz_under_admin possède bien project:update : réserver toute édition aux seuls managers/admins supprimerait un droit présent au catalogue.

La liste des membres utilise le projet visible. Le frontend lit /projects/{uuid}/resources?projection=details, expose deactivated, change le rôle par PATCH /projectMembers/{uuid}, désactive/réactive par PATCH du même objet. Sources : [src/services/core/getProjectResources.ts:18](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/getProjectResources.ts#L18), [src/services/core/editProjectResource.ts:17](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/editProjectResource.ts#L17), [src/services/core/disableProjectResource.ts:17](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/disableProjectResource.ts#L17), [src/services/core/activateProjectResource.ts:17](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/activateProjectResource.ts#L17). Aucune permission distincte « gérer équipe » n’est présente dans les seeds : la commande correspond à projectmember:create/update/delete selon l’action.

Un manager non-admin peut choisir des ressources existantes du Planzone pour les associer au projet, sans droit d’entrée dans l’écran global ressources. Le chargement backend de la batch utilise ResourceService.findAllResourcesByUuidIn et la lecture technique Resource est bornée au Planzone. Il ne faut donc pas exiger la capacité d’écran resource:read pour le sélecteur du projet. Sources : [core/src/main/java/com/planzone/api/service/ProjectMemberService.java:283](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectMemberService.java#L283), [core/src/main/java/com/planzone/api/service/ResourceService.java:366](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ResourceService.java#L366), [core/src/main/java/com/planzone/api/repository/ResourceRepository.java:169](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/repository/ResourceRepository.java#L169), [src/services/core/getPlanzoneResources.ts:16](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/getPlanzoneResources.ts#L16). Ces deux chargements n’excluent pas systématiquement les ressources cibles désactivées : un sélecteur exclusivement actif serait un durcissement à enregistrer.

Créer une nouvelle ressource virtuelle ou matérielle depuis un projet est explicitement autorisé à pr_manager ou pz_admin. La branche manager n’autorise pas de nouvelle ressource humaine. Elle utilise le Planzone courant, exige un nom de ressource unique et crée le profil puis son ProjectMember. Source : [core/src/main/java/com/planzone/api/service/ProjectService.java:935](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L935).

## Appartenances, création et déplacements

- Le créateur d’un projet devient ProjectMember au rôle pr_manager et ZoneMember si nécessaire, sauf super-admin UAA/CAS : [core/src/main/java/com/planzone/api/service/ProjectService.java:307](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L307), [core/src/main/java/com/planzone/api/service/ResourceService.java:135](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ResourceService.java#L135).
- Le créateur d’une zone devient ZoneMember, sans rôle zone renseigné, sauf super-admin : [core/src/main/java/com/planzone/api/handlers/ZoneEventHandler.java:53](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/handlers/ZoneEventHandler.java#L53).
- La création batch de ProjectMembers ajoute les ZoneMembers manquants dans la zone du projet : [core/src/main/java/com/planzone/api/service/ProjectMemberService.java:321](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectMemberService.java#L321). L’ajout de membre via lien de Project est également traité : [core/src/main/java/com/planzone/api/service/ProjectService.java:159](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L159).
- Le déplacement de projets charge la zone destination et les projets visibles, remplace Project.zone, ajoute les membres des projets à la zone destination si absents et conserve les appartenances à l’ancienne zone. Les projets non trouvés sont ignorés dans cette boucle ; aucune garantie atomique de batch n’est démontrée par cette méthode seule : [core/src/main/java/com/planzone/api/service/ProjectService.java:891](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L891), [core/src/main/java/com/planzone/api/controller/ProjectController.java:199](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/controller/ProjectController.java#L199), [src/services/core/moveProjects.ts:4](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/moveProjects.ts#L4). Le droit à vérifier est project:update et l’édition du champ zone ; la destination doit appartenir au même Planzone et être autorisée. Cette dernière règle doit être rendue explicite en PZ8 plutôt que dépendre de résolutions de liens.
- Retirer un ZoneMember appelle le retrait de la ressource des Project.resources de tous les projets de cette zone : [core/src/main/java/com/planzone/api/handlers/ZoneMemberEventHandler.java:18](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/handlers/ZoneMemberEventHandler.java#L18), [core/src/main/java/com/planzone/api/service/ZoneService.java:60](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ZoneService.java#L60). **Intention et effet SQL ne sont pas équivalents** : ce service modifie la collection inverse puis sauvegarde le projet, et Project.resources est mappedBy avec cascade ALL, sans orphanRemoval ; la suppression effective des lignes ProjectMember n’a pas été exécutée ni démontrée : [core/src/main/java/com/planzone/common/domain/Project.java:141](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/Project.java#L141).
- Retirer un ProjectMember ne retire pas son ZoneMember. Le handler retire la collection projet et la charge de travail pour ce membre/projet : [core/src/main/java/com/planzone/api/handlers/ProjectMemberEventHandler.java:106](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/handlers/ProjectMemberEventHandler.java#L106).

### Dernières précisions de modèle

ZoneMember possède member, role nullable et zone, **aucun champ deactivated**. Son supertype Instantiable possède deletedDate, pas deactivated. Les créations automatiques ne renseignent pas role ; le frontend getZoneRole retourne un DTO rôle vide. Il n’existe donc pas de rôle de zone opérationnel démontré à inventer. Sources : [core/src/main/java/com/planzone/common/domain/ZoneMember.java:42](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/ZoneMember.java#L42), [core/src/main/java/com/planzone/common/domain/structural/Instantiable.java:35](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/structural/Instantiable.java#L35), [src/services/core/getZoneRole.ts:4](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/getZoneRole.ts#L4).

ProjectMember.role est nullable dans le domaine. Pour une nouvelle ressource V/M, addNonExistentResourceAsProjectMember ne renseigne ce rôle que si le DTO fournit un rôle ; **aucun défaut pr_worker n’est qualifié**. Sources : [core/src/main/java/com/planzone/common/domain/ProjectMember.java:55](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/ProjectMember.java#L55), [core/src/main/java/com/planzone/api/service/ProjectService.java:959](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L959). Le DTO batch n’impose pas de @NotNull sur roleUuid, mais sa réponse toDto déréférence getRole().getUuid() : permettre un rôle absent sans traiter ces accès est une fragilité, pas une preuve de fonctionnement nominal de bout en bout. Source : [core/src/main/java/com/planzone/common/domain/dto/ProjectMemberCreateDto.java:20](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/dto/ProjectMemberCreateDto.java#L20), [core/src/main/java/com/planzone/common/domain/dto/ProjectMemberCreateDto.java:50](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/dto/ProjectMemberCreateDto.java#L50).

Une ressource au rôle global pz_visitor ne peut pas recevoir pr_manager/pr_worker : le validateur rejette la combinaison, tandis que le chemin batch remplace ce rôle demandé par pr_visitor. La divergence refus/normalisation doit être annoncée pour le contrat PZ8. Sources : [core/src/main/java/com/planzone/api/validation/impl/ProjectMemberValidator.java:33](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/validation/impl/ProjectMemberValidator.java#L33), [core/src/main/java/com/planzone/api/service/ProjectMemberService.java:478](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectMemberService.java#L478).

## Champs : combinaison exacte, intention et bugs

Les privilèges sont fusionnés ; les listes de champs **ne sont pas fusionnées**. getRoleOfResource choisit seulement le rôle ProjectMember si le niveau vaut PROJECT, sinon seulement le rôle Planzone. Il n’y a aucune intersection/union de field maps codée. Sources : [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:70](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L70), [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:140](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L140).

Cependant hasPermissionToUpdate appelle levelOfAccess(targetType) avec le nom CamelCase de la classe pour sélectionner les champs, et avec targetType.toUpperCase() pour sélectionner les privilèges. levelOfAccess compare des noms uppercase. Le chemin courant CustomHibernateInterceptor.onFlushDirty transmet Project : les privilèges sont donc l’union projet/global, mais la field map sélectionnée est celle du rôle **Planzone**. Sources : [core/src/main/java/com/planzone/api/config/CustomHibernateInterceptor.java:51](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/config/CustomHibernateInterceptor.java#L51), [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:72](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L72), [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:133](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L133).

Avec un contexte correctement normalisé, la branche conçue pour les champs projet choisirait seulement le rôle projet. Les seeds de pr_manager/pr_visitor n’ont pas de map project ; pr_worker contient les champs suivants :

`description, name, color, wiki, publishedAt, lockedAt, template, allocatedBudget, status, activityRoot, zone, data, tags, attributes`.

Le commentaire « seulement integratedAt » n’est pas une whitelist exhaustive : les champs ajoutés plus tard, par exemple allocatedResourcesBudget/allocatedExpensesBudget/timeZone, ne figurent pas dans cette liste. Source : [core/src/main/resources/db/changelog/0013-sprint-97/0003_add_update_timesheet_integration_privilege.yml:27](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0013-sprint-97/0003_add_update_timesheet_integration_privilege.yml#L27), [core/src/main/java/com/planzone/common/domain/Project.java:79](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/Project.java#L79).

pz_under_admin et pz_user ont la map zone :
`name, description, color, savingTemplates, planzone, projects, groups`.
Leurs seeds n’ont aucune map project. Il faut distinguer le privilège zone:update du droit de renommer une zone. Source : [core/src/main/resources/db/changelog/0011-sprint-95/0001_add_missing_privileges_to_project_manager.yml:81](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0011-sprint-95/0001_add_missing_privileges_to_project_manager.yml#L81).

Deux autres écarts empêchent d’affirmer l’effectivité PZ7 :
1. Les migrations insèrent les field maps comme blobs Java sérialisés, mais ResourceService les parse désormais comme JSON ; après erreur le parseur retourne une liste vide. Source : [core/src/main/java/com/planzone/api/service/ResourceService.java:345](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ResourceService.java#L345).
2. hasPermissionToUpdateCollection retourne true pour tous les types projectLevel avant la vérification finale. ZONEMEMBER figure dans projectLevel, mais getUuidOfSuperEntity(ZoneMember) retourne l’UUID Planzone, qui ne correspond pas à un UUID projet. Sources : [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:36](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L36), [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:108](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L108), [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:230](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L230). Aucun grant universel de gestion des zones ne doit être déduit du zonemember:create de pr_manager.

Le seul bypass explicitement inconditionnel du service est le super-admin UAA pzIsAdmin=true ou CAS ; il est distinct du rôle local pz_admin. Sources : [core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java:46](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L46), [core/src/main/java/com/planzone/api/service/UserApiService.java:83](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/UserApiService.java#L83). La sélection nominale de field map PROJECT sans membre utilise findFirst().get(), ce qui ne constitue pas un comportement valide pour un pz_admin non membre.

## Statuts, limites de champs et contexte

Le code exact d’Interrompu est **pz_waiting**, celui de Clos est **pz_closed** ; les autres statuts de base sont pz_open et pz_candidate. Les statuts sont eux aussi persistants, peuvent être locaux ou globaux (planzone nullable), et les quatre statuts de base ne peuvent pas être supprimés. Sources : [core/src/main/java/com/planzone/api/service/export/ProjectsExporter.java:90](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/export/ProjectsExporter.java#L90), [core/src/main/java/com/planzone/common/domain/ProjectStatus.java:42](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/ProjectStatus.java#L42), [core/src/main/java/com/planzone/api/handlers/ProjectStatusEventHandler.java:45](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/handlers/ProjectStatusEventHandler.java#L45).

Les recherches ciblées dans les deux commits ne démontrent **aucun blocage blanket de project:update, déplacement, renommage ou gestion d’équipe quand un projet est clos/interrompu**. ProjectService.handleProjectBeforeSave ne vérifie pas ces statuts. pz_closed/pz_waiting apparaissent dans des filtres de tâches ; pz_closed est exclu du Gantt et des projets proposés pour self-assignment. lockedAt/publishedAt apparaissent comme champs/DTO, sans garde d’écriture découverte. Sources : [core/src/main/java/com/planzone/api/service/ProjectService.java:169](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L169), [core/src/main/java/com/planzone/api/service/ZoneService.java:186](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ZoneService.java#L186), [core/src/main/java/com/planzone/api/repository/TaskRepository.java:78](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/repository/TaskRepository.java#L78), [src/services/core/getGantt.ts:67](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/getGantt.ts#L67), [src/services/core/getZoneGantt.ts:29](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/getZoneGantt.ts#L29). Cela n’autorise pas à généraliser les droits de saisie de temps ou de planning, non qualifiés ici.

| Champ | Limite/règle démontrée |
|---|---|
| Zone.name / Project.name | Non vide, trimming, maximum 256 |
| Zone.description | Maximum 5000, défaut domaine chaîne vide |
| Zone.color / Project.color | Maximum 19 |
| Project.description | TEXT, pas de @Size qualifié |
| Project.wiki | Maximum 256 |
| Zone.savingTemplates | false par défaut domaine ; seul le templatesZone peut porter true |
| Project.template | false par défaut domaine ; un projet non template dans templatesZone est refusé, sauf duplication forcée par en-tête |

Sources : [core/src/main/java/com/planzone/common/domain/Zone.java:53](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/Zone.java#L53), [core/src/main/java/com/planzone/common/domain/Project.java:52](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/Project.java#L52), [core/src/main/java/com/planzone/api/validation/impl/ZoneValidator.java:43](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/validation/impl/ZoneValidator.java#L43), [core/src/main/java/com/planzone/api/validation/impl/ProjectValidator.java:36](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/validation/impl/ProjectValidator.java#L36). Les noms des zones sont uniques dans le Planzone et ceux des projets dans leur zone, selon ces validateurs.

La création PZ7 comporte timezone, dates de racine, configuration/outils, statut, tags, attributs, modèles et éventuellement portefeuilles. La création métier ajoute l’activité racine et l’appartenance du créateur. Le formulaire réduit avec defaults inventés ne démontre pas cette parité. Sources : [src/services/core/saveProject.ts:42](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/saveProject.ts#L42), [src/core/projects/useCases/createProject/index.ts:6](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/core/projects/useCases/createProject/index.ts#L6), [core/src/main/java/com/planzone/api/service/ProjectService.java:146](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L146), [core/src/main/java/com/planzone/api/service/ProjectService.java:272](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L272).

Le contexte de Planzone vient du UserContext.currentPlanzone persistant ; changer de Planzone modifie cette valeur. Les permissions lisent les rôles et membres depuis la persistance. Aucun cache de permission effectif n’est démontré par les classes inspectées ; ProjectMemberService:290 comporte uniquement un TODO de cache de rôles. Le frontend remplace parfois l’UUID du rôle par son identifiant vide, et getZoneRole ne charge aucune autorité. Sources : [core/src/main/java/com/planzone/api/service/PlanzoneService.java:284](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/PlanzoneService.java#L284), [core/src/main/java/com/planzone/api/service/PlanzoneService.java:315](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/PlanzoneService.java#L315), [core/src/main/java/com/planzone/api/service/ResourceService.java:76](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ResourceService.java#L76), [core/src/main/java/com/planzone/api/service/ProjectMemberService.java:290](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectMemberService.java#L290), [src/services/core/getProjectRole.ts:29](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/getProjectRole.ts#L29). PZ8 doit vérifier le contexte explicite et l’autorité courante à chaque commande, et invalider/recharger les droits d’interface après changement d’appartenance ou de rôle.

## Différences de sécurité décidées pour PZ8

La préférence de cible donnée par le coordinateur est de contrôler **la ressource acteur active et le membre projet actif**, de normaliser le contexte projet et d’appliquer sa restriction de champs (pr_worker protège name et zone), tout en permettant au pz_admin global l’accès aux projets sans lui fabriquer des appartenances. Le cas pz_admin déjà membre avec un rôle local restreint doit rester explicite dans le moteur ; le catalogue seul ne prouve pas une règle de fusion de field maps.

La tranche ne reproduit pas :
- le contournement de restrictions dû à la casse ou au parsing des blobs ;
- la visibilité/récupération d’autorité d’un ProjectMember désactivé ;
- le bypass des collections projet ;
- la résolution de ZoneMember par un pseudo-contexte projet ;
- les recherches includeAllProjects/includeAllZones et endpoints without-rls sans garde de capacité explicite, même si leur bypass est présent dans les sources ([core/src/main/java/com/planzone/api/controller/ProjectController.java:230](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/controller/ProjectController.java#L230), [core/src/main/java/com/planzone/api/service/ProjectService.java:1198](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ProjectService.java#L1198), [core/src/main/java/com/planzone/api/service/ZoneService.java:153](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/ZoneService.java#L153)) ;
- l’affectation raw d’un rôle Planzone comme rôle projet.

Ce dernier risque est concret : ProjectMember.role accepte n’importe quelle entité Role, et le PATCH frontend transmet une URI Role. Le validateur ne borne pas le catalogue aux rôles projet ; un manager peut demander un rôle pz_admin dans ProjectMember et obtenir ses privilèges sur les objets du projet par l’union. Cela ne modifie pas le rôle global Resource, mais contourne le catalogue de rôles du projet. PZ8 doit vérifier portée projet du rôle, tenant, droits de l’acteur et règle visiteur ; les rôles personnalisés doivent porter une portée explicite. Sources : [core/src/main/java/com/planzone/common/domain/ProjectMember.java:55](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/ProjectMember.java#L55), [core/src/main/java/com/planzone/api/validation/impl/ProjectMemberValidator.java:33](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/validation/impl/ProjectMemberValidator.java#L33), [src/services/core/editProjectResource.ts:17](https://gitlab.com/augeo-software/planzone/planzone-7/planzone-core/-/blob/71d1c4153657f2e994191d390adb76a38a76a26c/src/services/core/editProjectResource.ts#L17).

Une suppression réelle et atomique des appartenances projet lors du retrait de zone, ainsi qu’un sélecteur de cibles exclusivement actives, sont des garanties à marquer comme intention/durcissement lorsque livrées, pas comme comportement PZ7 runtime déjà observé.

## Annexe réutilisable : catalogue exact des seeds

Cette annexe est l’union des insertions actives des changelogs inspectés, en excluant les lignes commentées. Les noms camelCase hérités restent présents au catalogue ; **ils ne sont pas des alias automatiques** des noms entity:action. Les fonctions PZ8 doivent comparer les noms exacts, garder les portées et ne pas transformer présence au catalogue en réception exécutée d’un parcours futur. Aucune permission d’écran de lecture n’est inventée dans ces tableaux.

Sources de reconstruction (définitions, associations et restrictions) :

- [core/src/main/resources/db/changelog/0000-init/0001-insert-roles-and-privileges.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0000-init/0001-insert-roles-and-privileges.yml#L1)
- [core/src/main/resources/db/changelog/0001-sprint-79/0001-update-resources-with-pzm-roles.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0001-sprint-79/0001-update-resources-with-pzm-roles.yml#L1)
- [core/src/main/resources/db/changelog/0008-sprint-89/0003_add_under_admin_role.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0008-sprint-89/0003_add_under_admin_role.yml#L1)
- [core/src/main/resources/db/changelog/0009-sprint-91/0001_add_uneditable_fields_to_role.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0009-sprint-91/0001_add_uneditable_fields_to_role.yml#L1)
- [core/src/main/resources/db/changelog/0009-sprint-91/0002_add_new_privileges.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0009-sprint-91/0002_add_new_privileges.yml#L1)
- [core/src/main/resources/db/changelog/0009-sprint-91/0003_add_uneditable_fields.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0009-sprint-91/0003_add_uneditable_fields.yml#L1)
- [core/src/main/resources/db/changelog/0009-sprint-91/0004_add_other_privileges.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0009-sprint-91/0004_add_other_privileges.yml#L1)
- [core/src/main/resources/db/changelog/0009-sprint-91/0005_add_other_privileges.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0009-sprint-91/0005_add_other_privileges.yml#L1)
- [core/src/main/resources/db/changelog/0009-sprint-91/0007_add_missing_privileges.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0009-sprint-91/0007_add_missing_privileges.yml#L1)
- [core/src/main/resources/db/changelog/0010-sprint-93/0005_add_project_roles_privilege_model.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0010-sprint-93/0005_add_project_roles_privilege_model.yml#L1)
- [core/src/main/resources/db/changelog/0010-sprint-93/0008_add_missing_privileges_to_roles.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0010-sprint-93/0008_add_missing_privileges_to_roles.yml#L1)
- [core/src/main/resources/db/changelog/0011-sprint-95/0001_add_missing_privileges_to_project_manager.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0011-sprint-95/0001_add_missing_privileges_to_project_manager.yml#L1)
- [core/src/main/resources/db/changelog/0011-sprint-95/0003_add_create-resource_privilege_to_project_manager.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0011-sprint-95/0003_add_create-resource_privilege_to_project_manager.yml#L1)
- [core/src/main/resources/db/changelog/0012-sprint-96/0002_add_privileges_of_constraints.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0012-sprint-96/0002_add_privileges_of_constraints.yml#L1)
- [core/src/main/resources/db/changelog/0013-sprint-97/0002_add_calendar_link_privileges.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0013-sprint-97/0002_add_calendar_link_privileges.yml#L1)
- [core/src/main/resources/db/changelog/0013-sprint-97/0003_add_update_timesheet_integration_privilege.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0013-sprint-97/0003_add_update_timesheet_integration_privilege.yml#L1)
- [core/src/main/resources/db/changelog/0013-sprint-97/0004_add_update_calendar_to_pz_user.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0013-sprint-97/0004_add_update_calendar_to_pz_user.yml#L1)
- [core/src/main/resources/db/changelog/0014-sprint-98/0002_add_delete_time_record_privilege.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0014-sprint-98/0002_add_delete_time_record_privilege.yml#L1)
- [core/src/main/resources/db/changelog/0014-sprint-98/0006_add_delete_discussion_privilege_to_worker.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0014-sprint-98/0006_add_delete_discussion_privilege_to_worker.yml#L1)
- [core/src/main/resources/db/changelog/0014-sprint-98/0010_add_log_table_privilege.yaml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0014-sprint-98/0010_add_log_table_privilege.yaml#L1)
- [core/src/main/resources/db/changelog/0016-sprint-103/0003_add_subadmin_privilege.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0016-sprint-103/0003_add_subadmin_privilege.yml#L1)
- [core/src/main/resources/db/changelog/0017-sprint-104/0000_create_pz_user_vue.yml:1](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/resources/db/changelog/0017-sprint-104/0000_create_pz_user_vue.yml#L1)

```json
{
  "rolePrivileges": {
    "pr_visitor": [
      "beingAssignedToATask",
      "comment:create",
      "comment:delete",
      "comment:update",
      "discussion:create",
      "document:create",
      "document:update",
      "seeAllProjectTasks",
      "seeTheFullProjectSummary",
      "seeTheListOfUsersInTheProject"
    ],
    "pr_manager": [
      "accessProjectDetails",
      "activity:create",
      "activity:delete",
      "activity:update",
      "allocation:create",
      "allocation:delete",
      "allocation:update",
      "attachment:create",
      "attachment:delete",
      "attachment:update",
      "beingAssignedToATask",
      "changeTheProjectRoleOfAProjectMember",
      "closeOrReopenATaskNotAssigned",
      "comment:create",
      "comment:delete",
      "comment:update",
      "constraint:create",
      "constraint:delete",
      "constraint:update",
      "createTask",
      "deleteAUserFromTheProject",
      "discussion:create",
      "discussion:delete",
      "discussion:update",
      "document:create",
      "document:delete",
      "document:update",
      "event:create",
      "event:delete",
      "event:update",
      "folder:create",
      "folder:delete",
      "folder:update",
      "inviteAPlanzoneMemberToTheProject",
      "milestone:create",
      "milestone:delete",
      "milestone:update",
      "project:delete",
      "project:update",
      "projectmember:create",
      "projectmember:delete",
      "projectmember:update",
      "projectresourcegroup:create",
      "projectresourcegroup:delete",
      "projectresourcegroup:update",
      "seeAllProjectTasks",
      "seeTheFullProjectSummary",
      "seeTheListOfUsersInTheProject",
      "status:create",
      "status:delete",
      "status:update",
      "task:create",
      "task:delete",
      "task:update",
      "timerecord:create",
      "timerecord:delete",
      "timerecord:update",
      "updateAnyTask",
      "updateProjectStatus",
      "updateTaskIHaveCreated",
      "zonemember:create"
    ],
    "pr_worker": [
      "activity:create",
      "activity:delete",
      "activity:update",
      "allocation:create",
      "allocation:delete",
      "allocation:update",
      "attachment:create",
      "attachment:delete",
      "attachment:update",
      "beingAssignedToATask",
      "closeOrReopenATaskNotAssigned",
      "comment:create",
      "comment:delete",
      "comment:update",
      "discussion:create",
      "discussion:delete",
      "document:create",
      "document:delete",
      "document:update",
      "event:create",
      "event:delete",
      "event:update",
      "milestone:create",
      "milestone:delete",
      "milestone:update",
      "project:update",
      "seeAllProjectTasks",
      "seeTheFullProjectSummary",
      "seeTheListOfUsersInTheProject",
      "task:create",
      "task:delete",
      "task:update",
      "timerecord:create",
      "timerecord:delete",
      "timerecord:update",
      "updateTaskIHaveCreated"
    ],
    "pz_admin": [
      "activity:create",
      "activity:delete",
      "activity:update",
      "allocation:create",
      "allocation:delete",
      "allocation:update",
      "attachment:create",
      "attachment:delete",
      "attachment:update",
      "calendarlink:create",
      "calendarlink:delete",
      "calendarlink:update",
      "comment:create",
      "comment:delete",
      "comment:update",
      "constraint:create",
      "constraint:delete",
      "constraint:update",
      "discussion:create",
      "discussion:delete",
      "discussion:update",
      "document:create",
      "document:delete",
      "document:update",
      "event:create",
      "event:delete",
      "event:update",
      "folder:create",
      "folder:delete",
      "folder:update",
      "log:create",
      "log:delete",
      "log:update",
      "milestone:create",
      "milestone:delete",
      "milestone:update",
      "notification:create",
      "planzone:update",
      "planzoneresourcegroup:create",
      "planzoneresourcegroup:delete",
      "planzoneresourcegroup:update",
      "project:create",
      "project:delete",
      "project:update",
      "projectmember:create",
      "projectmember:delete",
      "projectmember:update",
      "projectresourcegroup:create",
      "projectresourcegroup:delete",
      "projectresourcegroup:update",
      "projectstatus:create",
      "projectstatus:delete",
      "projectstatus:update",
      "resource:create",
      "resource:delete",
      "resource:update",
      "resourcenotification:create",
      "resourcenotification:delete",
      "resourcenotification:update",
      "status:create",
      "status:delete",
      "status:update",
      "task:create",
      "task:delete",
      "task:update",
      "timerecord:create",
      "timerecord:delete",
      "timerecord:update",
      "usercontext:create",
      "usercontext:delete",
      "usercontext:update",
      "weeklycalendar:create",
      "weeklycalendar:delete",
      "weeklycalendar:update",
      "zone:create",
      "zone:delete",
      "zone:update",
      "zonemember:create",
      "zonemember:delete",
      "zonemember:update",
      "zoneresourcegroup:create",
      "zoneresourcegroup:delete",
      "zoneresourcegroup:update"
    ],
    "pz_user": [
      "calendarlink:create",
      "calendarlink:delete",
      "calendarlink:update",
      "log:create",
      "log:delete",
      "log:update",
      "resource:create",
      "resource:update",
      "resourcenotification:create",
      "resourcenotification:update",
      "usercontext:update",
      "weeklycalendar:create",
      "weeklycalendar:update",
      "zone:update",
      "zonemember:create"
    ],
    "pz_visitor": [
      "resourcenotification:create",
      "resourcenotification:update",
      "usercontext:update",
      "weeklycalendar:update"
    ],
    "pz_under_admin": [
      "activity:create",
      "calendarlink:create",
      "calendarlink:delete",
      "calendarlink:update",
      "discussion:create",
      "discussion:delete",
      "discussion:update",
      "log:create",
      "log:delete",
      "log:update",
      "planzone:update",
      "project:create",
      "project:update",
      "projectmember:create",
      "projectresourcegroup:create",
      "resource:create",
      "resource:update",
      "resourcenotification:create",
      "resourcenotification:update",
      "usercontext:update",
      "weeklycalendar:create",
      "weeklycalendar:update",
      "zone:update",
      "zonemember:create"
    ]
  },
  "uneditableFields": {
    "pz_admin": {},
    "pz_under_admin": {
      "planzone": [
        "settings",
        "name",
        "attributes",
        "contacts"
      ],
      "zone": [
        "name",
        "description",
        "color",
        "savingTemplates",
        "planzone",
        "projects",
        "groups"
      ],
      "resource": [
        "description",
        "name",
        "type",
        "affiliation",
        "profession",
        "cost",
        "invitationAccepted",
        "avatarUrl",
        "tags",
        "attributes"
      ]
    },
    "pz_user": {
      "zone": [
        "name",
        "description",
        "color",
        "savingTemplates",
        "planzone",
        "projects",
        "groups"
      ],
      "resource": [
        "description",
        "name",
        "type",
        "affiliation",
        "profession",
        "cost",
        "invitationAccepted",
        "avatarUrl",
        "tags",
        "attributes"
      ]
    },
    "pz_visitor": {},
    "pr_manager": {},
    "pr_worker": {
      "project": [
        "description",
        "name",
        "color",
        "wiki",
        "publishedAt",
        "lockedAt",
        "template",
        "allocatedBudget",
        "status",
        "activityRoot",
        "zone",
        "data",
        "tags",
        "attributes"
      ]
    },
    "pr_visitor": {}
  }
}
```
