# Première tranche utilisateurs et ressources

Date : 14 octobre 2026. Contrat de la première implémentation du module interne people, rattachée aux fonctions P08 et P17 du [catalogue PZ7](2026-10-13-pz7-parity-baseline.md). La couverture porte sur les opérations ci-dessous ; les invitations et la gestion complète du compte restent à livrer.

## Règles qualifiées avant implémentation

Référence backend : projet GitLab 24472884, commit a8684583e9b47826bc3061d0e089a1eee706933e. Référence frontend core : projet 34159200, commit 71d1c4153657f2e994191d390adb76a38a76a26c. Lecture ciblée indépendante ; aucune exécution PZ7 réalisée.

| Règle | Preuve |
|---|---|
| Ressources HUMAN, VIRTUAL, MATERIAL ; compte et rôle facultatifs côté entité | [Resource.java](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/common/domain/Resource.java) |
| Nom non vide, maximum 256 ; description maximum 5000 ; nom normalisé à la persistance | Resource.java et son convertisseur TrimStringType |
| Noms identiques permis | [ResourceValidator.java, contrôle de nom commenté](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/validation/impl/ResourceValidator.java#L26) |
| Une identité ne possède qu’un profil ressource dans une même Planzone, y compris parmi les profils désactivés | [ResourceValidator.java](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/validation/impl/ResourceValidator.java#L45) |
| Création matérielle sans compte ni rôle ; rôle optionnel pour une virtuelle | Services frontend saveMaterialResourceInPlanzone.ts et saveVirtualResourceInPlanzone.ts au commit référencé |
| Écriture dépend des privilèges et champs, au-delà du nom de rôle | [PermissionServiceImpl.java](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/service/permission/PermissionServiceImpl.java#L69) |
| Désactivation ressource propagée aux membres projet ; réactivation sans propagation inverse démontrée | [ResourceEventHandler.java](https://gitlab.com/augeo-software/planzone/components/core/-/blob/a8684583e9b47826bc3061d0e089a1eee706933e/core/src/main/java/com/planzone/api/handlers/ResourceEventHandler.java#L66), ProjectMemberService.java:72 |

Correction du prototype : aucune unicité de nom, même insensible à la casse, n’est ajoutée. La création ne nécessite pas de compte fictif pour une ressource sans connexion.

## Opérations livrables et limites

| ID | Opération | Résultat attendu |
|---|---|---|
| P08.R01 | Créer une ressource virtuelle ou matérielle | Profil local, nom et description, sans identité ni création de droit |
| P08.R02 | Lire un profil ou une page de ressources | Données de la Planzone autorisée uniquement ; préfixe littéral, filtre type/activité et curseur de tri stable |
| P08.R03 | Renommer un profil | Même identité et historique, version attendue requise, conflit explicite si modification concurrente |
| P08.R04 | Enregistrer le profil humain d’un membre déjà autorisé | Liaison locale unique ; la même identité peut posséder un autre profil chez un autre client |
| P08.G01 | Rejouer une création après résultat incertain | Une seule ressource et un seul événement d’audit ; même clé et contenu différent refusés |
| P08.G02 | Échouer après préparation de la création ou du renommage | Profil, reçu et audit validés ou annulés ensemble |

Ces cas d’usage sont internes et réservés aux administrateurs pendant cette tranche. Cette restriction provisoire ne vaut pas parité de la matrice complète des permissions PZ7. L’API HTTP déployable reste fermée tant que connexion OIDC, sessions et permissions métier ne sont pas branchées ; aucun en-tête permettant de choisir librement une identité n’est ajouté.

L’enregistrement d’un profil humain ne provisionne aucun compte, n’envoie aucune invitation et n’accorde aucune adhésion. Il exige une identité active et une adhésion active déjà présentes dans la Planzone courante. Identité inconnue, étrangère ou inactive donnent une erreur métier indistincte. Les profils locaux, leur nom et leur version restent indépendants entre clients.

Cette tranche ne modifie pas les états d’invitation, de compte, de ressource ni de membre projet. Le champ de désactivation peut être lu et filtré ; sa commande attend le portage des effets sur les projets. Suppression, transfert, coût, affiliation, profession, groupes, tags, responsables et OBS restent des capacités à porter explicitement. Un profil humain en attente d’invitation sera pris en charge par le futur parcours d’invitation, sans imposer un compte à toute personne planifiable.

## Contrats techniques

Le domaine people utilise Java sans Spring, SQL ni HTTP. Ses ports restent distincts du port de gestion des zones : aucune dépendance cyclique people/planzones n’est ajoutée. L’adaptateur JDBC réutilise la frontière transactionnelle existante, ses verrous d’autorité et son contexte PostgreSQL local.

Les ressources portent une clé composée Planzone/identifiant. La liaison facultative vers un membre possède une clé étrangère de même Planzone ; son unicité locale est imposée en base, y compris en concurrence. Les noms n’ont aucune contrainte d’unicité.

Création et enregistrement humain exigent un identifiant d’opération UUID. Sa portée est Planzone, acteur et opération. L’empreinte porte sur les entrées normalisées avec un encodage sans ambiguïté. Un rejeu identique restitue la projection actuelle du profil après une nouvelle autorisation ; il ne restaure pas un ancien nom ou d’anciens droits. Le reçu, le profil et l’audit sont écrits dans une seule transaction.

Le renommage utilise une version attendue et une mise à jour conditionnelle. Une réponse perdue peut être vérifiée par lecture du profil ; cette tranche ne promet pas un reçu idempotent pour le renommage. Un échec de version ne produit aucun audit de succès.

La pagination lit au maximum la taille demandée plus une ligne, avec ordre nom/identifiant. Le préfixe traite %, _ et la barre oblique inverse comme des caractères littéraux. Les pages ne constituent pas un snapshot immuable face à des renommages concurrents ; un rafraîchissement peut être nécessaire. Le curseur ne confère aucun droit.

RLS et privilèges limitent les tables au contexte administrateur autorisé. Le runtime ne dispose d’aucun droit de modification/suppression sur l’audit ni d’un accès général au catalogue des identités. Une fonction de disponibilité éventuelle expose seulement la réponse nécessaire pour un membre de la Planzone autorisée.

L’audit de cette tranche conserve acteur, ressource, opération et version ; ce journal local n’est pas une preuve cryptographique contre une compromission de l’application. Aucun effet externe n’est produit ; une outbox sera ajoutée avec les premiers effets externes.

## Améliorations explicites et réception

Le refus d’un nom vide après normalisation est une amélioration de validation : PZ7 ne démontre pas clairement ce cas avec sa validation avant conversion. Idempotence, contrôle de version, transaction avec audit et contraintes d’isolation sont des garanties cibles PZ8, pas des fonctions prétendument vérifiées dans PZ7.

La réception utilise PostgreSQL réel avec le rôle applicatif non privilégié : ressources sans compte, doublons de noms, identité multi-clients, créations concurrentes, cible étrangère/inactive, pagination, conflits de version et annulation sur échec d’audit. Les tests vérifient résultats et données persistées ; leur nombre ne mesure pas la couverture globale.

État de validation : tranche backend implémentée et vérifiée sur PostgreSQL réel le 14 octobre 2026. Voir les [résultats exécutés et limites](2026-10-14-people-validation.md) et le [suivi de couverture](functional-coverage.json). La parité globale et la connexion à l’interface ne sont pas déclarées acquises.
