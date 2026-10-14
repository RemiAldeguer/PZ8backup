# Planzone 8

Application française de gestion de projets, adaptée à l’ordinateur et au mobile. **SQLite fonctionne dans le navigateur** (WASM, Web Worker et stockage OPFS) : pas d’API métier, de base distante, de comptes ni de synchronisation. Chaque navigateur conserve sa propre copie et doit importer puis sauvegarder ses données manuellement. Voir le [guide SQLite navigateur](docs/browser-sqlite.md).

**Site local HTTPS : [Planzone 8](https://planzone8.codex.f10web.com/).** Tant que sa bascule statique n’a pas été annoncée, cette URL peut encore afficher l’ancienne version serveur ; n’y importer aucun fichier avant la vérification du nouvel écran local.

![Synthèse d’un projet](docs/screenshots/planzone8-desktop.png)

## Lancer l’application statique

Prérequis : **Node.js 24 ou supérieur**, npm et un navigateur compatible OPFS sur une origine sécurisée.

```bash
npm ci
npm run build
npm start             # aperçu statique Vite : http://127.0.0.1:3001
# ou npm run dev      # développement : http://127.0.0.1:5173
```

Le premier écran demande de choisir **manuellement** un fichier SQLite PZ7 préparé ; aucun fichier privé n’est inclus dans les assets. La copie reste propre à l’origine et au profil du navigateur. Pour préparer un export privé de la base serveur historique sans comptes ni sessions :

```bash
python3 scripts/export-pz7-browser.py \
  --source data/pz7-runtime-active.sqlite \
  --output /chemin/prive/planzone-import.sqlite
```

Ne jamais placer ce fichier dans `dist/`, `public/` ni sur un serveur public. Exporter régulièrement une sauvegarde depuis le menu **Base locale**. La page exige `Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: require-corp` ; le serveur Vite les fournit pour les essais.

## Publier sur Cloudflare

`npm run check:cloudflare` vérifie les assets hors ligne ; `npm run deploy:cloudflare` publie uniquement `dist/` via Wrangler, **sans Worker applicatif ni binding D1**. Aucune donnée personnelle n’est publiée. Vérifier sur l’URL finale les en-têtes d’isolation et l’absence de route `/api`. L’ancienne base D1 n’est ni transférée ni détruite par cette publication. Voir [le guide de migration](docs/browser-sqlite.md) avant toute bascule.

## Parcours disponibles

- Rôles de ressources et projets utilisés pour organiser les vues locales ; **ils ne protègent pas les données du navigateur**. Aucun compte, mot de passe ni espace partagé.
- Création de projet en deux étapes, depuis zéro ou depuis un modèle : zone, statut, dates, description mise en forme, tags, portefeuilles nommés, champs personnalisés et activation des vues ; modification persistante de ces paramètres.
- Classement par zones, recherche globale et espace personnel avec listes de tâches à gauche et calendrier hebdomadaire à droite.
- Sidebar proche de PZ7 : projets récents, menus de gestion, zones avec projets imbriqués, compteurs réels, repli sur ordinateur et menu mobile ; Mon espace réunit Ma synthèse, Mes discussions et Suivi temporel dans des onglets communs.
- Vues de zone en tableau : synthèses repliables, dates, tags des tâches, équipe affectée, météo, travail et Budget (alloué, planifié, réel, marges, acquis selon l’avancement des allocations) ; recherche, tri, filtre de statut et statut du projet modifiable dans la ligne.
- Tâches, jalons, phases, tags éditables par puces, affectation, dates facultatives, avancement et dépendance à un prédécesseur ; coche cliquable pour terminer ou remettre une tâche à faire.
- Liste : listes et sous-listes repliables contenant des tâches, jalons et autres listes ; glisser-déposer avant, dans ou après une liste, ordre partagé persistant, création contextuelle, totaux récursifs et colonnes configurables.
- Synthèse, liste filtrable, tableau avec glisser-déposer et sélecteur de statut, Gantt, calendriers du projet et global, équipe, budget et suivi temporel du projet.
- Calendrier : bouton Ajouter pour tâche, jalon, événement ou indisponibilité ; événements avec participants, journées entières et plages horaires, modification et suppression, capacité recalculée.
- Documents du projet : dossiers et sous-dossiers, classement et déplacement des fichiers/liens, recherche, aperçu, téléchargement et gestion persistante.
- Discussions du projet et des tâches avec mentions, modification et suppression ; Mes discussions rassemble les fils où l’utilisateur est mentionné ou a participé.
- Annuaire : ajout direct d’un membre, création d’une ressource virtuelle ou matérielle ; équipe projet enrichie depuis les ressources déjà présentes dans la Planzone ou par création d’une ressource associée. Désactivation avec conservation des références ; profils de coûts séparés des droits d’accès.
- Fiche ressource complète : identité, e-mail, fonction, rôle, description, tags, profil de coût, champs personnalisés et projets associés.
- Gestion : tableaux Capacité, Charge prévisionnelle et Taux d’occupation par ressource, sur douze mois ou par semaine, calculés depuis les capacités des sept jours, les jours fériés et les indisponibilités ; affichage en heures ou jours et détail par projet.
- Délégations de validation des temps appliquées dans le suivi temporel local.
- Suivi temporel hebdomadaire Personnel/Équipe, lignes dépliables par ressource, projet, phase et tâche, sept jours et totaux historiques ; saisie, correction et validation des temps avec conservation du tarif associé.
- Budget projet : budget alloué modifiable depuis sa carte ou le bouton Modifier le budget ; dépenses prévues/réglées et recettes prévues/encaissées, avec création, modification, suppression et conservation après rechargement ; résultats prévisionnel et réel.
- Répartitions des coûts planifiés ou réels par catégorie de dépenses et type de ressources, synthèse ressources/dépenses, valeur acquise des allocations et budget disponible.
- Personnalisation : modèles de projet, champs personnalisés partagés, modèles de compte rendu, statuts de projet et axes stratégiques, accessibles directement dans la sidebar.
- Champs personnalisés : texte simple sur une ligne, texte riche, listes à choix multiples ou simple, formule, image, lien web ; les types Nombre et Date sont conservés. La catégorie Saisies de temps ajoute ces champs aux formulaires de création, correction et consultation des temps.
- Synthèse projet : compte rendu persistant depuis le bouton bleu, derniers comptes rendus avec auteur, date et indicateurs ; rapport flash depuis le bouton jaune orangé, imprimable ou enregistrable en PDF.
- Exports CSV des tâches, ressources et temps ; rédaction, consultation, modification, suppression et impression des comptes rendus du projet.

L’[état de couverture et les règles métier](docs/implementation.md) décrivent précisément la portée de cette première version.

### Rôles globaux et rôles projet

**Gestion → Ressources** permet d’attribuer Administrateur, Créateur de projet, Usager ou Visiteur à chaque membre humain. Dans **Projet → Équipe**, choisir Chef(fe) de projet, Collaborateur ou Observateur indépendamment pour chaque projet. Un visiteur reste observateur. Les membres voient leurs projets associés ; un créateur peut créer dans ses zones accessibles et devient chef du nouveau projet. L’administrateur accède à tous les projets.

Les rôles importés influencent les vues et validations métier locales ; la ressource de référence est celle de la base préparée. **Il n’y a plus d’authentification ni de droits de confidentialité** : toute personne ayant accès au profil du navigateur peut consulter la copie entière et exporter la base. **Gestion → Droits et rôles** n’est qu’une configuration métier locale. La [matrice historique](docs/role-permissions-matrix.json) décrit les rôles de l’ancienne version serveur, pas une protection d’accès de cette variante.

### Dossiers, saisies de temps et tableaux de ressources

Dans **Documents** du projet, **Nouveau dossier** crée un dossier à la racine ou dans le dossier ouvert. Le fil de navigation et l’arbre donnent accès aux sous-dossiers ; le formulaire d’un document permet de choisir sa destination. Les dossiers peuvent être renommés ou déplacés dans le même projet. Seuls les dossiers vides peuvent être supprimés. Les documents existants restent à la racine jusqu’à leur classement.

L’onglet **Documents** de la sidebar ouvre le catalogue global des fichiers et liens de tous les projets. La recherche couvre aussi les projets et chemins de dossiers ; les filtres portent sur le projet et le type. Chaque document indique son emplacement et permet d’ouvrir directement son dossier dans le projet, de consulter son aperçu ou de le télécharger. L’ajout demande de choisir un projet modifiable, puis son dossier. Les documents des projets clos ou interrompus restent consultables en lecture seule.

Chaque zone propose les onglets **Projets**, **Liste** et **Gantt**. Liste réunit les projets, leurs listes et sous-listes, tâches et jalons dans un tableau repliable. Gantt reprend cette hiérarchie sur un planning commun, avec une vue de l’ensemble de la zone et des échelles mois/trimestre/année. Les filtres portent sur le projet, le statut des tâches, la ressource, le type et le texte recherché. Les tâches s’ouvrent dans leur véritable projet ; leurs coches respectent les projets clos ou interrompus. L’option Toutes les zones conserve la vue choisie.
La **synthèse projet** reprend une disposition compacte : barre stratégique, météo et statut, actions bleue de compte rendu et orange de rapport flash, comptes rendus/description, jalons/activité et tâches à venir/en retard. Les deux listes de tâches proposent des filtres personnels indépendants. L’activité porte toujours sur le projet entier et présente les heures, les compteurs et une frise de jalons. Les accès Équipe, Discussions, Documents, Budget et Rapports restent associés au projet affiché. Les crayons ouvrent ses paramètres pour modifier description, stratégie, météo ou statut.


Dans **Personnalisation → Champs personnalisés**, choisir **Saisies de temps** pour définir les champs de la modale. Les neuf types disponibles sont utilisables ; une formule peut notamment référencer `{hours}`. Les valeurs sont sauvegardées avec le temps et restent consultables après validation. Corriger une saisie validée exige d’abord de retirer sa validation.

**Mon espace** propose les onglets **Ma synthèse**, **Suivi temporel** et **Mes discussions**, sans occuper trois lignes dans la sidebar. **Gestion** propose les routes `#resources/capacity`, `#resources/load` et `#resources/occupancy`. La capacité est la somme des capacités quotidiennes configurées, après déduction des jours fériés et absences. La charge vient des allocations datées ; le taux est charge/capacité. Une capacité nulle affiche un tiret, tout en conservant la charge visible. Le calendrier courant est utilisé pour toutes les périodes, sans historique de capacités.

Dépôt source : [RemiAldeguer/Planzone8](https://github.com/RemiAldeguer/Planzone8). Les reçus de déploiement, identifiants et bases locales sont exclus de Git.

### Organigramme

**Gestion → Organigramme** affiche les unités organisationnelles, leurs sous-unités et les ressources rattachées. Le bouton orange **Unité organisationnelle** ouvre le formulaire Nom / Unité parente / Ressources. Les unités existantes se renomment et se déplacent depuis le crayon ; le **+** crée une sous-unité. Les boutons bleus replient la hiérarchie. Une ressource peut être rattachée à plusieurs unités ; les ressources sans rattachement restent visibles dans leur propre groupe, et les inactives restent barrées.

Les lignes proposent le rôle global, le responsable organisationnel, la classification interne/externe et les champs personnalisés des ressources. Le responsable se retrouve dans la fiche ressource et n’accorde aucun droit de projet ou de validation. Les filtres portent sur la nature/activité et la recherche conserve les parents des résultats. Le bouton de colonnes choisit les champs affichés dans ce navigateur. Seul l’administrateur modifie l’organisation ; les autres rôles y accèdent en lecture selon le droit de consultation des ressources. Les cycles sont refusés et seules les unités vides peuvent être supprimées.

### Gantt et navigation du projet

Le **Gantt** reprend le même ordre manuel que Liste : projet, listes et sous-listes, tâches et jalons, y compris les éléments sans date. Les listes portent les dates et les allocations de leurs descendants. Recherche, filtres, repli par niveau, zoom, échelles projet entier/mois/trimestre/année, charges et repère d’aujourd’hui permettent de parcourir les projets longs. **Créer** et les boutons **+** des listes réutilisent les formulaires de Liste.

Relier le point de fin d’une barre au début d’une autre crée une contrainte **fin → début**. Cliquer sur le point puis sur l’élément suivant fonctionne aussi au clavier et au tactile. **Créer une contrainte** permet de choisir les éléments sans date ; les badges ou les flèches ouvrent le lien pour le modifier ou le supprimer. Le prédécesseur doit être terminé pour démarrer le successeur. Les cycles sont refusés. Le modèle conserve un prédécesseur par élément : remplacer un lien ouvre un formulaire explicite. Les contraintes et les dates planifiées sont persistantes, et modifier un lien conserve les dates existantes.

Les poignées aux deux extrémités des barres modifient le début et la fin ; glisser la barre déplace son intervalle. Les jalons se déplacent par leur poignée. Les gestes fonctionnent à la souris et au tactile, avec aperçu des dates, annulation par Échap et durée minimale d’un jour. Au clavier, les flèches déplacent une borne d’un jour (Maj : sept jours) ; cliquer une poignée ouvre la saisie des dates. Les dates sont enregistrées dans les éléments existants et reprises dans Liste. Les barres de listes restent les agrégats de leurs descendants. Le mode **Relier les barres** accepte deux clics ou un glissement entre barres.

Dans **Détails**, l’icône de réglage permet de choisir et d’ordonner statut, début, fin, durée, alloué, passé, restant, avancement, tags, responsable et champs personnalisés de tâches/projet. Le nom reste visible pendant le défilement des colonnes ; les choix sont personnels à ce projet et conservés dans le navigateur. Le passé inclut tout l’historique du projet.

Le menu vertical **Équipe, Discussions, Documents, Budget, Rapports** est commun à toutes les vues du projet. La barre horizontale garde **Synthèse, Liste, Tableau, Gantt, Calendrier, Suivi temporel**. Les deux menus tiennent compte des vues activées et des rôles ; la page Rapports conserve ce même contexte projet. Sur mobile, le menu projet devient une rangée compacte.

### Listes imbriquées du projet

La vue **Liste** utilise un seul tableau compact, avec niveaux indentés, dates, statut, tags, responsable, heures allouées et commentaires. **Créer → Liste** ajoute une liste à la racine ; le bouton **+** d’une liste permet d’y créer une tâche, un jalon ou une sous-liste. Les flèches replient ou déplient un niveau ou toute l’arborescence. La fiche d’une tâche propose un sélecteur **Liste** pour la déplacer, et l’édition d’une liste permet de changer son nom ou son parent. Seules les listes vides peuvent être supprimées.

Glisser le **nom ou la poignée** d’une tâche, d’un jalon ou d’une liste permet de le placer **avant** une ligne, **dans** une liste ou **après** une ligne. Une ligne orange marque l’insertion ; le centre d’une liste s’éclaire pour indiquer un dépôt à l’intérieur. La zone en bas du tableau place l’élément à la fin du projet, hors des listes. Les gestes tactiles et le formulaire ouvert par clic ou au clavier sur la poignée utilisent le même déplacement. L’ordre est partagé entre tâches et listes et conservé après rechargement ; un déplacement revient automatiquement à Aucun tri si un tri était actif. Les gestes rapides, le tactile et la souris utilisent les mêmes événements de pointeur. Échap annule le geste ; un dépôt hors du tableau ne change rien. Les descendants suivent leur liste et les cycles sont refusés. Le bouton **Imbriquer**, à côté du nom de chaque liste, permet de choisir directement une autre liste ou sous-liste de destination. Il conserve toutes ses tâches et sous-listes, y compris lorsque la destination est une ancienne phase.

Les listes affichent le nombre d’éléments, les dates et les heures allouées de tous leurs descendants, sans double comptage. Les filtres conservent les listes parentes des résultats ; les totaux restent ceux de la liste complète. La configuration des colonnes existante est conservée. Les anciennes phases restent visibles sans conversion automatique à la lecture ; les organiser en sous-listes ou les renommer crée leur liste persistante et conserve leurs tâches. L’import d’un projet dans un modèle et le clonage d’un modèle conservent les listes imbriquées et vides, avec de nouveaux identifiants.

La sidebar ne contient plus l’entrée Projets entre Personnalisation et Calendrier. **Tout**, les zones et les projets récents permettent d’accéder aux projets.

La **date d’intégration projet** du suivi du projet valide toutes les journées jusqu’à la date incluse, pour toutes ses ressources. La **date d’intégration ressource** de la feuille personnelle, ou de chaque ligne de la feuille Équipe, concerne uniquement cette ressource sur tous ses projets. Les dates s’appliquent à l’historique complet, indépendamment des filtres et de la semaine affichée. Les journées intégrées portent une coche ; leurs temps sont consultables et verrouillés. Ajuster ou retirer une date rouvre uniquement les périodes qui ne restent pas couvertes par une autre date ou une validation individuelle.

Les totaux journaliers des lignes de ressource et de projet, ainsi que la ligne **Total**, proposent aussi une icône calendrier avec coche. Elle ouvre la date d’intégration préremplie avec le jour choisi. Dans le suivi projet, elle cible le projet entier ; dans les feuilles personnelle et Équipe, elle cible une seule ressource. Le total général de la feuille Équipe demande de choisir la ressource à intégrer avant de valider.

### Suivi temporel et rapports du projet

L’onglet **Suivi temporel** du projet, sous `#project/<identifiant>/time`, ouvre sa grille hebdomadaire avec les ressources associées explicitement, affectées aux tâches ou jalons, ou ayant saisi du temps sur le projet. Les ressources inactives sont incluses par défaut pour conserver leur historique. Le filtre de personne et les nouvelles saisies restent limités aux membres du projet ; une nouvelle saisie exige une ressource active et une tâche disponible du projet. Les heures allouées suivent l’affectation actuelle et le passé reste attribué à son auteur. Le suivi global Personnel/Équipe reste accessible dans les onglets de Mon espace.

Dans **Synthèse**, **Créer un compte rendu** ouvre un formulaire bleu fondé sur les modèles de Personnalisation, ou sur un modèle simple si le catalogue est vide. Le titre, la date, les indicateurs et les champs sont enregistrés dans le projet avec l’auteur et les dates techniques de la base locale. Chaque compte rendu conserve sa propre structure : modifier ou supprimer le modèle ne réécrit pas les comptes rendus existants. Les comptes rendus d’un projet clos ou interrompu restent consultables et imprimables ; leurs écritures sont verrouillées.

**Rapport flash** reprend la présentation du PDF de référence : couverture avec projet, zone, objet, météo, statut, dates, score stratégique, portefeuilles et description ; champs personnalisés, activité, travail, jalons, budget et tâches ouvertes. Un sélecteur permet de joindre un compte rendu enregistré du même projet ; l’objet et le compte rendu choisis se retrouvent dans l’export. Il s’imprime ou s’enregistre en PDF via le navigateur. Les comptes rendus enregistrés se rouvrent depuis la Synthèse ou Rapports ; leur impression utilise la version enregistrée. Le brouillon de rédaction dans Rapports peut également être imprimé ou envoyé au formulaire d’enregistrement.

### Recettes et répartitions du budget projet

Dans Budget, la carte **Budget alloué** et **Modifier le budget** ouvrent un montant modifiable au centime. L’enregistrement met à jour uniquement l’enveloppe du projet et recalcule les marges et la consommation, sans changer les coûts ni les recettes. Les paramètres de budget restent accessibles pour un projet clos ou interrompu, comme les autres paramètres du projet.

**Nouvelle recette** enregistre un libellé, une catégorie, un montant saisi au centime, une date prévue et une date d’encaissement facultative. Une recette peut être encaissée avant sa date prévue ; renseigner cette date la classe comme encaissée, et la vider la remet à encaisser. Les recettes restent séparées de l’enveloppe allouée au projet. Le résultat prévisionnel correspond aux recettes prévues moins les coûts planifiés ; le résultat réel aux recettes encaissées moins les coûts réels. Les dépenses et recettes restent consultables dans un projet clos ou interrompu, mais leurs mutations sont bloquées par les validations métier locales.

Le sélecteur Planifié/Réel commande les répartitions : Achat logiciel, Formation, Matériels, Fournitures, Frais juridiques et Autres pour les dépenses ; Externes, Internes, Matérielles, Virtuelles et Non classées pour les ressources. Le planifié utilise les allocations et les tarifs actuels. Le réel conserve le tarif de chaque saisie et la ressource ayant déclaré le temps, même après une réaffectation. Une date de règlement classe une dépense dans le réel. Les dépenses ne contribuent pas à la valeur acquise, calculée sur l’avancement des allocations. Sans tarif, les coûts affichés sont des minimums connus et les résultats des maximums ; les proportions portent uniquement sur les coûts connus.

### Personnalisation

Le menu Personnalisation propose cinq vues proches des références PZ7. Leurs catalogues sont persistants et initialement vides : les exemples et les noms présents sur les captures ne sont pas importés dans l’espace.

Les **modèles de projet** se préparent depuis une structure vide ou un projet existant. Ils conservent description, budget, couleur, phases, listes imbriquées, tâches, jalons, allocations, tags et dépendances internes. Créer un projet à partir d’un modèle recrée tous les identifiants et décale les dates en jours calendaires depuis son début, dans une transaction unique. Les affectations, avancements, temps, dépenses, recettes et commentaires historiques ne sont pas copiés.

Les **champs personnalisés** définissent un nom, des libellés français et anglais et l’un des neuf types disponibles. Ils apparaissent selon leur périmètre dans les fiches projet, tâche/jalon et ressource, ou dans la saisie des temps. Les champs de compte rendu compatibles peuvent être copiés dans un modèle. La gestion des définitions dépend des droits de personnalisation ; les valeurs respectent le rôle dans leur périmètre. Les anciens champs propres à chaque ressource restent conservés.

Les **modèles de compte rendu** enregistrent le titre, jusqu’à cinq indicateurs et l’ordre des champs. La rédaction depuis Rapports utilise ce modèle dans un brouillon local, imprimable ou enregistrable dans le projet ; le bouton de la Synthèse ouvre directement le formulaire persistant. Les comptes rendus enregistrés conservent une copie des libellés, types, indicateurs et valeurs indépendamment des évolutions du modèle.

Les **statuts de projet** personnalisés portent un libellé, une description, une couleur et un comportement Demandé, Ouvert, Interrompu ou Clos. Les quatre statuts natifs sont conservés en lecture seule. Un comportement Interrompu ou Clos applique les verrous existants. Les **axes stratégiques** définissent un code, une couleur, cinq libellés d’évaluation de −2 à 2 et un poids entier de 0 à 1000. Les paramètres du projet permettent son évaluation ; le score additionne les évaluations multipliées par leurs poids, avec zéro pour les axes non évalués.

Un statut utilisé, un axe évalué ou un champ portant encore des valeurs ne peut pas être supprimé : le moteur local refuse l’opération avec une erreur explicite, sans supprimer les données référencées.

## Vérifier

```bash
npm test
npm run build
npm run test:e2e
npm run check:cloudflare
```

Les tests du moteur historique et les parcours navigateur utilisent des bases temporaires indépendantes des données actives. Les tests Playwright locaux nécessitent Chromium (`npx playwright install chromium --only-shell`) et le schéma PZ7 fourni pour le parcours d’import ; sans ce schéma, ce parcours est explicitement ignoré. Ils vérifient l’OPFS, l’import, une mutation persistante, l’export/réimport et un remplacement invalide.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/` | Interface React, Worker SQLite WASM/OPFS et styles |
| `shared/` | Contrats TypeScript et calculs métier |
| `server/pz7-store-core.ts` | Adaptateur PZ7 portable utilisé dans le Worker |
| `server/`, `cloudflare/` | Anciennes implémentations serveur conservées pour tests/migration/retour arrière, **non déployées par le site statique** |
| `tests/` | Tests métier, export privé et parcours Chromium locaux |
| `scripts/` | Import/export des bases PZ7 et outils historiques |
| `data/` | Bases serveur privées et sauvegardes, exclues de Git et des assets publiés |

Le navigateur conserve SQLite dans son stockage propre à l’origine et au profil. Pour sauvegarder, choisir **Exporter une sauvegarde .sqlite** et mettre ce fichier en lieu sûr ; l’effacement des données du navigateur ou un changement de domaine peut supprimer l’accès à la copie OPFS. Le site statique ne propose ni compte partagé, ni synchronisation, ni création d’une base vierge. Les limites métier et le retour arrière sont décrits dans [le guide navigateur](docs/browser-sqlite.md).
