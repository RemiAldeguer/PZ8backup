# Connexion, invitations et accès PZ7

Cette tranche poursuit P08 et P17 du [catalogue PZ7](2026-10-13-pz7-parity-baseline.md). Elle relie le module Java intégré de ressources à une session OIDC vérifiée et aux écrans React. La [validation](2026-10-14-access-validation.md) distingue PostgreSQL, HTTP, navigateur et comparaison PZ7. Le [premier contrat people](2026-10-14-people-contract.md) reste la trace de la tranche précédente ; les règles d’accès provisoires administrateur y sont remplacées par ce contrat.

## Référence fonctionnelle qualifiée

Backend GitLab 24472884, commit `a8684583e9b47826bc3061d0e089a1eee706933e` ; frontend core 34159200 au commit fixé par le web, `71d1c4153657f2e994191d390adb76a38a76a26c`. Lecture statique ciblée, sans comparaison exécutée contre une instance PZ7. Le dépôt UAA est identifié mais sa lecture reste refusée par GitLab ; ses parcours ne sont pas déclarés inspectés.

| Règle | Sources PZ7 examinées | Traduction dans cette tranche |
|---|---|---|
| Rôles persistants et extensibles | `permissions/Role.java:31`, changelogs `0001-insert-roles-and-privileges.yml`, `0003_add_under_admin_role.yml`, `0002_add_new_privileges.yml` | Catalogue privé par Planzone ; `pz_admin`, `pz_under_admin`, `pz_user`, `pz_visitor` conservés ; UUID et libellés fournis à React |
| Créer une ressource et consulter l’écran sont deux droits distincts | `ResourceController:71`, `PermissionServiceImpl:39,70,152`, frontend `accessRestrictions.ts:41`, `getAccessRestrictions.ts:35` | `resource:create` pour admin, sous-admin et utilisateur ; consultation de l’écran réservée par défaut à `pz_admin` dans un réglage configurable |
| Restrictions des champs du rôle utilisateur/sous-admin | `0003_add_uneditable_fields.yml:12`, `CustomHibernateInterceptor:56,67,83,101`, `editResource.ts:14` | Liste normalisée de champs, recontrôlée à chaque commande ; le renommage n’est pas accordé par le seul privilège `resource:update` |
| Nom 256, description 5000, noms identiques de ressources possibles | `Resource.java:64`, `ResourceValidator`, convertisseur `TrimStringType` | Validation cohérente API/interface et contraintes locales ; pas d’unicité générale de nom |
| Invitation avec nom, adresse et rôle ; doublons contrôlés sur ce parcours | `InviteUsersService:65,86,94,150`, `RoleRepository:24`, `RoleValidator:38` | Profil humain local en attente sans identité/adhésion, rôle de la Planzone, reçu et e-mail préparés atomiquement |
| Acceptation liée à l’adresse vérifiée, rôle courant conservé | Parcours d’acceptation de `InviteUsersService` et `JwtUtil` | Adresse exacte après trim, identité issuer/subject vérifiée, rôle actuellement affecté au profil et restrictions conservés |

Les privilèges projet `pr_manager`, `pr_worker`, `pr_visitor` sont identifiés, mais leur moteur n’est pas porté dans cette tranche. Le format historique des restrictions sérialisées ne prouve pas leur efficacité dans une installation PZ7 donnée.

## Garanties cibles et différences explicites

L’identité globale est identifiée par issuer/subject. Une connexion crée ou actualise ses métadonnées vérifiées ; elle ne crée aucune adhésion, ne réactive pas un compte désactivé et ne relie pas deux identités par adresse e-mail. Une même identité conserve des profils humains distincts chez deux clients. La création VIRTUAL/MATERIAL ne crée jamais de compte.

La session serveur est conservée dans PostgreSQL et partagée entre instances API. Le navigateur reçoit un cookie `PZ8SESSION` HttpOnly, SameSite=Lax, Secure lorsque l’URL API publique est HTTPS. La version de sécurité globale est contrôlée à la requête puis sous verrou dans la transaction métier ; un contexte capturé avant révocation ne suffit pas à écrire. Les adhésions et rôles courants sont recontrôlés dans la Planzone.

Le flux OIDC utilise code d’autorisation, PKCE, state et nonce ; Spring Security vérifie signature, issuer et audience. Les mutations et la déconnexion exigent le CSRF de `/session`. Un retour après connexion reste limité à des chemins applicatifs autorisés. Aucun identifiant utilisateur libre dans un en-tête ou un corps ne constitue une autorité.

Le secret d’invitation contient 32 octets aléatoires ; seul son hash est utilisé pour l’acceptation. Le secret destiné au mail est chiffré AES-256-GCM dans l’outbox avec l’identifiant d’invitation comme contexte. Il est absent des réponses de création, reçus et audits, et supprimé après livraison/acceptation/révocation. Le rôle SQL API ne peut pas lire la file globale ; seul un login distinct héritant de `pz8_mailer` peut la consommer. Ce rôle mail n’accède pas aux catalogues métier.

La préparation d’invitation est atomique avec profil, reçu, audit et outbox. Même clé et même corps se rejouent explicitement ; même clé et autre corps sont refusés. Les acceptations concurrentes convergent vers une seule adhésion. Un lien expiré/révoqué et une session révoquée ne confèrent aucun droit ; le rejeu ne ressuscite pas une adhésion retirée.

Le worker SMTP utilise des baux, une génération de tentative et des reprises bornées. Une ancienne confirmation ne peut pas terminer le bail suivant. Un envoi réussi suivi d’une confirmation SQL incertaine peut provoquer un doublon lors d’une reprise : la livraison externe n’est pas exactement une fois. Les e-mails français/anglais sont générés par le worker séparé de l’API.

Différences de sécurité assumées dans le socle cible : affectation de rôles et gestion d’invitations réservées à l’administrateur, sans reprendre une possible élévation par un PATCH de ressource historique ; expiration de lien configurable, sept jours par défaut, car le code `JwtUtil` PZ7 examiné ne démontre pas une expiration effective ; restrictions de nom du profil ciblé effectives jusque dans PostgreSQL. Ces garanties ne sont pas présentées comme des propriétés vérifiées de PZ7 déployé.

## Interface et API

Les entrées `/access`, `/invitations/accept?token=…` et `/account/validation?token=…` montent `src/pz7-access` depuis `src/main.tsx`. `VITE_PZ8_BACKEND=java` permet aussi de choisir cette entrée à la racine. Son code est chargé séparément des anciens écrans. La session et le CSRF restent en mémoire ; un changement de Planzone annule les lectures, retire les données précédentes et ignore leurs réponses tardives. Les contrôles de l’interface complètent ceux du serveur.

| Route sous `/api/v1` | Résultat |
|---|---|
| GET `/auth/login?returnTo=…` | Début de connexion et retour validé |
| GET `/auth/authorize/pz8`, `/auth/callback/pz8` | Aller-retour OIDC vérifié |
| GET `/session`, POST `/auth/logout` | Identité, Planzones autorisées et CSRF ; fin de session |
| GET `/planzones/{id}/access` | Capacités courantes, champs éditables et catalogue de rôles |
| GET/POST `/planzones/{id}/resources` | Page filtrée avec curseur ; création VIRTUAL/MATERIAL avec operationId |
| GET/PATCH `/planzones/{id}/resources/{resourceId}` | Profil ; renommage avec expectedVersion |
| PUT `/planzones/{id}/resources/{resourceId}/access` | Rôle et nonEditableFields, autorisés et atomiques |
| GET/POST `/planzones/{id}/invitations` | Liste et préparation d’une invitation avec operationId |
| POST `/planzones/{id}/invitations/{invitationId}/revoke` | Révocation confirmée |
| GET `/invitations/preview?token=…`, POST `/invitations/accept` | Prévisualisation limitée ; acceptation authentifiée |

Les UUID des réponses sont des scalaires. Les champs JSON inconnus sont refusés. Les conflits d’opération/version renvoient 409, les droits refusés 403, un profil indisponible 404, une invitation indisponible 410, une session invalide 401. Après acceptation, l’interface retire le token de l’URL, recharge la session et sélectionne la nouvelle Planzone.

La pagination est bornée, avec ordre nom/UUID et préfixe littéral. Elle n’est pas un snapshot face aux renommages concurrents. Les champs non éditables utilisent les noms métier du catalogue, dont `role` pour le verrou du rôle ; `roleId` désigne le champ de transport UUID, pas un nom de restriction.

## Configuration exécutable

Les migrations Liquibase `001` à `005` sont appliquées avant l’API, avec un opérateur de migration. Elles créent les rôles sans connexion `pz8_owner`, `pz8_migrator`, `pz8_runtime`, `pz8_mailer`. Le bootstrap nécessite CREATEROLE ; le compte applicatif n’est jamais propriétaire/superuser/BYPASSRLS. Les logins et secrets sont provisionnés hors dépôt. L’API n’applique pas automatiquement les migrations.

Configurer les variables suivantes dans l’environnement du processus API ; Java ne charge pas automatiquement un fichier `.env` :

| Variable | Valeur attendue |
|---|---|
| `PZ8_ACCESS_ENABLED` | `true` ; sinon seul le socle fermé et la sonde de santé sont actifs |
| `PZ8_JDBC_URL`, `PZ8_JDBC_USERNAME`, `PZ8_JDBC_PASSWORD` | PostgreSQL et login dédié héritant uniquement de `pz8_runtime` |
| `PZ8_OIDC_ISSUER`, `PZ8_OIDC_CLIENT_ID`, `PZ8_OIDC_CLIENT_SECRET` | Fournisseur OIDC configuré pour code/PKCE et authentification client secret basic ; scopes openid/profile/email |
| `PZ8_FRONTEND_URL`, `PZ8_PUBLIC_API_URL` | URLs publiques fiables ; callback enregistré : `{PZ8_PUBLIC_API_URL}/api/v1/auth/callback/pz8` |
| `PZ8_INVITATION_ENCRYPTION_KEY` | Clé aléatoire 32 octets, encodée Base64, identique dans API/jobs et stable entre redémarrages |
| `PZ8_MAIL_FROM` | Expéditeur d’invitation |
| `PZ8_SESSION_SECONDS`, `PZ8_INVITATION_DAYS` | Facultatif : 1800 secondes et sept jours par défaut |
| `PZ8_API_PORT` | Facultatif : 8080 |
| `PZ8_ALLOW_LOCAL_HTTP` | Facultatif : false ; true autorise HTTP uniquement sur loopback pour la recette locale |

Dans le processus jobs, activer `PZ8_INVITATION_MAIL_ENABLED=true`, fournir les variables JDBC avec un **autre login**, héritant uniquement de `pz8_mailer`, ainsi que la même clé, l’URL frontend et l’expéditeur. Ajouter `PZ8_SMTP_HOST`, `PZ8_SMTP_PORT` (587), `PZ8_SMTP_USERNAME`/`PZ8_SMTP_PASSWORD` ensemble si nécessaires, `PZ8_SMTP_STARTTLS` (true). STARTTLS ne peut être désactivé que pour un SMTP loopback. Un worker désactivé n’envoie aucun mail ; les invitations restent préparées dans l’outbox.

Depuis `backend`, construire `:api:bootJar :jobs:bootJar`, puis exécuter le JAR voulu avec JDK 21 et son environnement. En développement, lancer Vite depuis la racine ; `PZ8_JAVA_API_URL` définit sa cible proxy `/api/v1` (8080 par défaut). En hébergement, interface et `/api/v1` doivent être servis sur la même origine via le reverse proxy. Les autres parcours continuent leur transition selon le plan ; il n’existe pas de synchronisation implicite des données de l’ancien backend.

Restent ouverts : création/provisionnement de la première organisation et de son administrateur par un parcours produit ; catalogue complet de permissions zones/projets/groupes ; cycle complet du compte, récupération, SSO/MFA et contrats UAA ; désactivation avec effets projet ; autres champs people ; contrat OpenAPI et client généré ; recette avec le fournisseur/SMTP d’hébergement sélectionnés, rotation de clé, charge et restauration. Aucun fournisseur commercial ni hébergement n’est imposé par cette tranche.
