# Organigramme — vérification

Gestion → Organigramme propose les unités et sous-unités avec leurs ressources, la création Nom / Unité parente / Ressources, les rôles et responsables, les classifications et champs personnalisés. Les unités se replient, se filtrent et se déplacent depuis leur formulaire. Les ressources sans unité et inactives restent consultables.

| Contrôle | Résultat |
|---|---|
| Compilation | TypeScript/Vite réussis ; `index-FNog82u8.js`, `index-C_iLFuIH.css` |
| Métier et API | 35 tests ciblés réussis, puis dix contrôles d’organisation/migration réussis après durcissement de la restauration |
| Hiérarchie | Références et sélections validées, cycles refusés, limites de profondeur vérifiées sur les descendants, suppression des seules unités vides |
| Persistance | SQLite rouvert, ancien schéma sans table organisation enrichi sans réécriture des ressources ; snapshots anciens et nouveaux conservés, restauration invalide refusée |
| Responsables | Références, cycles et responsables matériels contrôlés ; inactivation conservée, aucune permission accordée, propriété reprise dans la fiche |
| Navigateur SQLite | Six parcours distincts organisation/fiche validés ; contrôle final de deux parcours de présentation réussi |
| Navigateur Worker/D1 | Quatre parcours organisation et un parcours fiche/authentification réussis |
| Permissions | Lecture conditionnée par l’annuaire, création/modification/suppression réservées à l’administrateur ; rôle global protégé |
| Métadonnées | Rôle, responsable, classification et champs persistants ; modification d’un champ conserve les autres valeurs ; colonnes locales conservées au rechargement |
| Présentation | Captures ordinateur/mobile inspectées ; formulaire sombre, entrée orange et lignes indentées ; page mobile sans débordement, erreur de sauvegarde gardant le formulaire |
| Publication | Worker `ba3effae-7306-4727-a556-65e2ddcd3dbe`, compte et base existants conservés |
| Sonde HTTPS | Réussie le 13/10/2026 à 15:49:06 (Europe/Paris) : fichiers livrés, collection organisation lisible, accès anonymes refusés ; aucune mutation métier |

Captures : `organization-desktop.png`, `organization-unit-create.png`, `organization-mobile.png` et `organization-create-mobile.png`. Les tests emploient des bases temporaires. La hiérarchie n’accorde aucun droit de projet ; les rattachements à plusieurs unités sont possibles et le compteur d’unité porte sur ses membres directs. Les données de la capture servent uniquement de référence visuelle.

Les vérifications précédentes sont conservées ci-dessous.

# Gantt graphique et rapport flash — vérification

Les poignées modifient les dates des tâches et jalons, les barres déplacent leurs intervalles, et le mode Relier les barres crée les contraintes depuis le graphique. Détails propose des colonnes configurables, et les boutons de repli sont centrés. Le rapport flash reprend les rubriques et la présentation du PDF fourni avec les données de l’application.

| Contrôle | Résultat |
|---|---|
| Compilation | TypeScript/Vite réussis ; `index-D-tSKqk5.js`, `index-CBc1zJOR.css` |
| Métier et API | 14 tests ciblés réussis : dates inclusives, année bissextile, changement d’heure, bornes, dates nulles, colonnes, hiérarchie, cycles et rôles |
| Navigateurs | 14 parcours distincts vérifiés sur SQLite et Worker/D1, avec reprises ciblées du tactile et d’un artefact de test concurrent ; dernier contrôle de pagination réussi |
| Dates | Début/fin, déplacement, durée minimale, jalon, capture hors période, synchronisation Liste, préservation des heures/tags/progression/liens ; aucune modale ouverte après déplacement |
| Échecs et annulation | Échap n’écrit pas ; refus serveur restauré ; projets interrompus et lecteurs sans poignées, API refusée |
| Contraintes et repli | Points et barres, clavier/tactile, cycles et remplacement explicite ; centrage géométrique des icônes vérifié |
| Colonnes | Alloué/passé avec historique, tags, champs/formules, ordre et affichage conservés par utilisateur/projet, en-tête et lignes synchronisés |
| Rapport flash | Objet et compte rendu du même projet, contenu enregistré et indicateurs, données étrangères exclues, budget vérifié, export A4 de cinq pages inspecté |
| Présentation | Ordinateur/mobile et PDF inspectés ; champs label/valeur alignés ; controles de l’application absents de l’impression |
| Publication | Worker `beb506a3-35e6-4679-8ecf-12d1f7353f46`, base et compte existants conservés |
| Sonde HTTPS | Réussie le 13/10/2026 à 15:14:31 (Europe/Paris) ; fichiers livrés, connexion et refus anonymes vérifiés, aucune mutation métier |

Les tests utilisent des bases temporaires. Les personnalisations Détails restent locales au navigateur. Les listes portent les dates de leurs descendants ; seules les dates des éléments et du projet sont modifiables directement. Les contraintes conservent un prédécesseur fin → début et n’effectuent pas de replanification automatique. Le PDF de référence apporte sa structure, pas ses valeurs. Les dates de réalisation de jalons non disponibles dans le modèle ne sont pas inventées.

Captures : `gantt-graphical-dates.png`, `gantt-configurable-details.png`, `gantt-resize-touch.png`, `flash-report-reference-cover.png` et `flash-report-reference-mobile.png`.

Les vérifications précédentes sont conservées ci-dessous.

# Gantt hiérarchique et navigation projet — vérification

Le Gantt reprend l’ordre de Liste, les sous-listes, les phases historiques et les éléments sans date. Les barres portent progression et dates, les agrégats des listes sont conservés, et les liens fin → début se créent à la souris, au clavier, au tactile ou depuis un formulaire. Le menu vertical de la synthèse devient un rail commun à toutes les vues du projet, y compris Rapports.

| Contrôle | Résultat |
|---|---|
| Compilation | TypeScript et Vite réussis ; `index-CSjUzRKk.js`, `index-DMz6ky_H.css` |
| Métier et API | 42 tests réussis : hiérarchie, agrégats, plages calendaires, années longues, cycles, tâches démarrées, API et permissions existantes |
| Navigateurs | Six nouveaux parcours Gantt/navigation passent sur SQLite et Worker/D1 ; 16 parcours distincts SQLite et 15 Worker/D1 validés après correction d’une attente obsolète du rapport et de la synchronisation d’un test |
| Liens | Création sur les points de barres, persistance après rechargement et dans Liste, cycle refusé, remplacement explicite, suppression, sans date et lecture seule |
| Gestes | Souris, clavier, tactile et Échap sans écriture ; champs et flèches associés aux véritables tâches |
| Navigation | Un seul rail, cinq accès latéraux, six vues horizontales, projet et lien actif conservés au rechargement ; Budget et Rapports accessibles selon le rôle |
| Régressions | Synthèse, création et préférences de projet, membres, rôles, accès de connexion et personnalisation vérifiés |
| Présentation | Captures sur ordinateur et mobile inspectées ; planning contenu dans son cadre, noms visibles, dates centrées sur mobile et page sans débordement horizontal |
| Publication | Worker `d3a7dcaa-43cf-4ee0-85c9-7acd62a08407` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 14:02:18 (Europe/Paris), soit 12:02:18 UTC : Gantt hiérarchique, contraintes et navigation commune livrés, compte et accès anonymes vérifiés |

Le modèle conserve un prédécesseur par tâche et les règles de fin → début du serveur. Le lien n’effectue pas de replanification automatique. Les bornes du projet entier incluent toutes ses dates, sans plafond d’un an ; les repères sont bornés en nombre pour les plages extrêmes. Les filtres et replis ne modifient pas les liens ni les agrégats enregistrés. Un projet interrompu ou clos et un observateur connecté consultent les contraintes en lecture seule. La configuration des rôles et les vingt et une collections restent inchangées.

Captures : `project-gantt-hierarchy-desktop.png`, `project-gantt-links-desktop.png`, `project-gantt-mobile.png` et `project-gantt-touch.png`. Les tests emploient des bases temporaires. La sonde publique contrôle uniquement les fichiers, l’authentification et les refus anonymes ; elle ne crée aucune contrainte ni aucune autre donnée métier sur l’espace public.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Rôles globaux et projet — vérification

Les quatre rôles globaux et les trois rôles projet sont attribuables depuis l’annuaire et l’équipe. Des connexions de membres du même espace utilisent réellement ces droits. La matrice Excel est conservée en transcription de référence ; les droits conditionnels des fonctions disponibles se configurent dans Gestion → Droits et rôles.

| Contrôle | Résultat |
|---|---|
| Compilation | TypeScript et Vite réussis ; `index-OPrYxfb4.js`, `index-Ny0qL9Dy.css` |
| API et métier | 81 tests ciblés réussis après adaptation des anciennes attentes ; dernière série de 17 tests rôles/calendrier réussie après les contrôles de contraintes et de périmètre |
| Authentification | Comptes liés aux ressources, rôles relus sur session active, comptes inactive/non humains exclus et administrateur principal protégé ; tests Express et Worker/D1 |
| Navigateurs | Cinq parcours rôles validés sur les deux stockages au cours des séries ; régression finale de 13 parcours réussie sur chacun |
| Permissions | Création limitée aux zones accessibles, rôles projet indépendants, absence d’auto-promotion, budget/temps chef, observateur en lecture avec commentaires, collaborateurs sur leurs tâches et actions conditionnelles |
| Données | Projets étrangers retirés, budget/dépenses/recettes/profils masqués selon les droits, tarifs des temps protégés aussi dans les réponses de mutation |
| Configuration | Sauvegarde initiale puis modification après rechargement ; mise à jour partielle conservant les autres droits |
| Régressions | Fiche ressource, création de projet, synthèse, dossiers, glisser-déposer et intégration personnelle/équipe/projet vérifiés |
| Présentation | Captures annuaire/équipe sur ordinateur et configuration sur mobile inspectées ; aucun débordement horizontal sur mobile |
| Publication | Worker `82095b35-1483-4efe-a67b-3415c23fd239` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 13:25:58 (Europe/Paris), soit 11:25:58 UTC ; nouveaux contrôles livrés, compte existant opérationnel, 21 collections et accès anonymes refusés |

Les parcours avec comptes distincts couvrent l’observateur, le collaborateur, le chef de projet et le créateur. Le parcours administrateur vérifie les quatre et trois choix ainsi que la sauvegarde des droits. La création d’un accès depuis la fiche membre est testée dans une base temporaire, avec connexion réelle puis création de son propre projet. Les treize parcours de la série finale comprennent quatre scénarios de rôles et neuf régressions de synthèse, dossiers, déplacement et intégration.

Les captures sont `roles-global-desktop.png`, `roles-project-desktop.png` et `roles-policy-mobile.png`. Les tests utilisent exclusivement des bases temporaires. La sonde publique vérifie les fichiers livrés, l’authentification conservée, les vingt et une collections et le refus des écritures anonymes. Elle ne crée aucun compte public et ne modifie aucune donnée métier.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Création de projet et ressources — vérification

La création de projet reprend le choix Depuis zéro / À partir d’un modèle, l’en-tête sombre et le formulaire large à deux colonnes. Les métadonnées sont persistantes, les vues configurées gouvernent la navigation et les modèles continuent de cloner leurs tâches, listes, dates et dépendances. L’annuaire propose les trois natures de ressource ; l’équipe d’un projet permet aussi de choisir une ressource existante dans la Planzone ou d’en créer une déjà associée.

| Contrôle | Résultat |
|---|---|
| Compilation | TypeScript et Vite réussis ; `index-Dgxv-Wso.js`, `index-D7KibAE3.css` |
| API et métier | Première série de 35 tests réussie, puis 22 tests ciblés réussis après l’ajout de la conservation du format des descriptions dans les modèles |
| Navigateurs | Cinq nouveaux parcours passent sur SQLite et Worker/D1 ; série de régression finale : sept parcours SQLite et huit Worker/D1 réussis |
| Persistance | Tags, portefeuilles nommés, format de description, vues, capacité et types de ressource conservés après rechargement ; ajout depuis un modèle et association au seul projet ciblé |
| Validation | Au moins une vue obligatoire, rejet atomique des préférences invalides, snapshots historiques acceptés, champs non concernés et date d’intégration conservés |
| Régressions | Statuts personnalisés et axes stratégiques, champs de fiches, compte rendu, synthèse projet, fiche ressource et création depuis une zone vérifiés |
| Présentation | Captures de choix, formulaire de projet et ressources inspectées sur ordinateur et mobile, sans débordement horizontal |
| Publication | Worker `64bd64c2-e046-4d2e-ac9a-e4432028837c` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 11:35:07 (Europe/Paris), soit 09:35:07 UTC : nouveaux formulaires livrés, authentification conservée et accès anonyme refusé |

Les cinq nouveaux parcours couvrent la création depuis zéro et la réactivation d’une vue, le retour et l’annulation sur mobile, les trois natures de ressource, l’équipe avec ressource existante/nouvelle et la création depuis un modèle avec format, budget et décalages de dates. Les séries précédentes passent leurs autres régressions de personnalisation et de synthèse. Les captures sont `project-creation-choice.png`, `project-creation-desktop.png`, `project-creation-mobile.png`, `resource-creation-choices.png` et `resource-creation-mobile.png`. La fenêtre de choix des ressources conserve une hauteur adaptée à son contenu.

# Synthèse projet inspirée de la référence Planzone

La synthèse présente une barre compacte de stratégie/météo/statut et les actions de compte rendu bleu et rapport flash orange. Un rail donne accès à l’équipe, aux discussions, documents, budget et rapports du projet. Trois rangées réunissent comptes rendus/description, jalons/activité et tâches à venir/en retard, avec contenu défilant et filtres personnels indépendants. La mise en page se réorganise sur mobile.

| Contrôle | Résultat |
|---|---|
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-9kxR-Glf.js` et `index-1-18cr33.css` |
| Métier et API existants | 30 tests passés : calculs du domaine, métriques de zone et comptes rendus SQLite/MemoryStore |
| Navigateurs SQLite et Worker/D1 | Huit parcours distincts passés sur chaque stockage : trois nouveaux et cinq de régression |
| Cartes et calculs | Données du seul projet, 28 h allouées/5 h passées/23 h restantes, activité pondérée 39,29 %/32,14 %/28,57 %, jalons et compteurs, périmètres personnels indépendants et coches persistantes |
| Actions | Description réellement enregistrée, stratégie éditable, lecture/création de compte rendu, rapport flash du seul projet et cinq liens associés au projet affiché |
| Cas limites et présentation | Vide, sans allocation, dates/jalons non planifiés, projet interrompu, consultation, contrôles désactivés et mobile sans débordement horizontal |
| Publication | Worker `90f22cbf-22ff-4b5f-b1f4-f8764040a0a9` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 10:08:28 (Europe/Paris), soit 08:08:28 UTC |

Les cinq régressions couvrent les statuts/axes stratégiques, les comptes rendus figés et éditables, le budget/rapport flash imprimé, les actions mobiles et la coche de tâche. Les captures finales `project-summary-desktop.png` et `project-summary-mobile.png` sont inspectées. La description et les tableaux longs défilent dans leurs cartes ; les statuts restent affichés sur mobile. Les fixtures comportent des projets étrangers pour contrôler le périmètre.

Les tests utilisent exclusivement des bases temporaires. La sonde publique vérifie les nouveaux fichiers/styles, les vingt collections, les fonctionnalités précédentes, l’authentification conservée et la révocation de sa propre session. Aucune donnée métier publique n’est modifiée par la sonde. Les schémas et règles serveur sont conservés ; seuls les composants d’interface et le callback d’ouverture des paramètres projet sont adaptés.

Version en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/summary.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vues Liste et Gantt des zones

Les zones proposent Projets, Liste et Gantt. Les nouvelles vues réunissent leurs projets, listes imbriquées, tâches et jalons. Les filtres combinent projet, statut, ressource, type et recherche. L’arbre se replie par branche ou globalement ; les tâches s’ouvrent dans leur véritable projet et les coches respectent les projets verrouillés. Le Gantt propose un axe commun, des barres projet/liste/tâche, les jalons, les éléments sans date et les échelles zone/mois/trimestre/année.

| Contrôle | Résultat |
|---|---|
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-7F6ouA4j.js` et `index-Hn_uBSWi.css` |
| Modèle et régressions métier | 21 tests passés : quatre nouveaux tests d’arbre de zone, plus les tests existants de listes et métriques de zone |
| Navigateurs SQLite et Worker/D1 | Neuf parcours distincts passés sur chaque stockage : trois nouveaux et six de régression |
| Périmètre et hiérarchie | Projets hors zone exclus, listes/sous-listes conservées, phases identiques indépendamment repliables, filtrage avec ancêtres et agrégats complets sans double comptage |
| Actions et dates | Ouverture dans le bon projet, validation d’une tâche et persistance, projet interrompu verrouillé, jalons, éléments sans date, échelles, périodes et exclusion d’une barre se terminant juste avant la période suivante |
| Navigation et affichage | Vue et zone conservées au rechargement, changement de zone conservant le mode, Toutes les zones, zone vide, accès au clavier, création préremplie et mobile sans débordement horizontal |
| Publication | Worker `f62a235c-baa7-4df8-a248-3a10fc76df9e` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 08:36:29 (Europe/Paris), soit 06:36:29 UTC |

Les six régressions couvrent les quatre parcours de tableaux de zone et les deux de budget. Les quatre captures `zone-views-*.png` sont inspectées sur ordinateur et mobile ; le planning mobile est également capturé après défilement dans son cadre. Les tests métier vérifient les totaux et clés stables, et la consultation du Gantt compare les projets/tâches/listes avant et après sans mutation.

Les tests utilisent des bases temporaires. La sonde publique charge la page avec un paramètre de vérification pour éviter une ancienne page HTML en cache, puis vérifie les nouveaux assets avec leurs types MIME, les vingt collections, les fonctionnalités précédentes, l’authentification et la révocation de sa propre session. Aucune donnée métier publique n’est modifiée par la sonde. Cette extension ne change ni les règles serveur ni les collections existantes.

Versions en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#projects/list et https://planzone8-demo.aldeguer-remi.workers.dev/#projects/gantt. Le sélecteur Zone permet de choisir le périmètre.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Documents globaux dans la sidebar

La sidebar propose Documents, entre Calendrier et Rapports / Exports. La route `#documents` réunit les fichiers et liens de tous les projets, avec recherche dans les noms/descriptions/auteurs/projets/chemins et filtres projet/type. Chaque ligne donne accès à l’aperçu, au téléchargement ou lien web et au dossier d’origine. L’ajout choisit explicitement un projet modifiable et son dossier ; la modification réutilise le formulaire projet. Les projets clos ou interrompus restent en lecture seule.

| Contrôle | Résultat |
|---|---|
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-BybBNm8H.js` et `index-DQf1IpDc.css` |
| Navigateurs SQLite et Worker/D1 | Sept parcours distincts passés sur chaque stockage : trois nouveaux et quatre de régression |
| Catalogue et consultation | Plusieurs projets et dossiers imbriqués, filtres combinés, état vide, aperçu texte/lien, téléchargement vérifié par son contenu, retour direct au dossier et rechargement |
| Ajout et modification | Choix de projet obligatoire, exclusion des projets verrouillés, dossiers du bon projet, ajout lien/fichier, classement, modification et persistance |
| Navigation et affichage | Entrée active de la sidebar, accès quand elle est repliée, menu mobile refermé, absence de débordement horizontal et captures ordinateur/mobile inspectées |
| Publication | Worker `422b9357-8f2b-4914-9fd1-2de5699079a4` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 08:13:43 (Europe/Paris), soit 06:13:43 UTC |

Les quatre régressions couvrent l’arborescence et le classement des documents projet ainsi que les trois parcours de sidebar. La consultation globale compare documents et dossiers avant/après et ne les modifie pas. Les créations des tests utilisent exclusivement des bases temporaires. La sonde publique confirme les nouveaux fichiers/styles, les vingt collections, le compte existant, les refus d’écritures anonymes et la révocation de sa propre session, sans mutation métier publique. Les captures sont `docs/screenshots/global-documents-desktop.png` et `global-documents-mobile.png`.

Cette livraison est une extension de l’interface et de la navigation, sans modification du serveur ni des collections existantes.

Version en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#documents.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Boutons d’intégration dans les totaux journaliers

Les totaux des lignes ressource/projet et du pied de tableau proposent une icône calendrier avec coche. Elle ouvre le formulaire avec la date du jour choisi. Le suivi projet conserve un seuil pour le projet entier, même avec un filtre individuel. Les feuilles personnelle et Équipe conservent un seuil par ressource ; le total général Équipe exige une sélection explicite avant toute écriture.

| Contrôle | Résultat |
|---|---|
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-Daz2rdOV.js` et `index-CLLHS1G0.css` |
| Métier et API d’intégration | 19 tests passés sur SQLite et MemoryStore, dont un contrôle HTTP Express |
| Navigateurs SQLite et Worker/D1 | Douze parcours distincts passés sur chaque stockage : quatre nouveaux et huit de régression |
| Nouveaux parcours | Préremplissage au clavier, total projet malgré filtre individuel, jour sans heures, persistance, projet interrompu, total personnel, choix Équipe explicite et total d’une ressource filtrée |
| Publication | Worker `3c445d31-c6e7-45a7-ba95-55ddb90e1017` publié sur la cible existante |
| Sonde HTTPS | Réussie le 13/10/2026 à 00:00:42 (Europe/Paris), soit le 12/10/2026 à 22:00:42 UTC |

Les nouveaux parcours démontrent qu’ouvrir le formulaire ne valide aucun temps, que chaque bouton préremplit la journée exacte, que le total général Équipe ne soumet rien avant le choix d’une ressource et qu’une seule action est envoyée à la validation. Les heures et les autres périmètres restent conservés. Les huit régressions couvrent les trois parcours d’intégration existants et les cinq parcours de grille temporelle. Les trois captures `time-integration-daily-totals-*.png` sont inspectées sur ordinateur et mobile, sans débordement horizontal de la page.

Cette extension ne change pas les règles serveur ni les collections. Les tests utilisent des bases temporaires. La sonde publique confirme les boutons et styles livrés, les vingt collections, l’authentification existante, le refus d’une action d’intégration invalide sans mutation métier et la révocation de sa propre session. Aucune date métier n’est appliquée au site public par ces vérifications.

Version en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/time.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Dates d’intégration projet et ressource

Le suivi temporel projet propose une date d’intégration inclusive pour toutes ses ressources. La feuille personnelle propose une date pour la ressource courante ; la feuille Équipe offre un contrôle sur chaque ligne de ressource et lorsque cette ressource est sélectionnée. Le seuil ressource porte sur tous ses projets, indépendamment du filtre affiché. Les journées intégrées sont cochées et leurs temps verrouillés, avec consultation de l’historique. Les dates peuvent être ajustées ou retirées sans effacer les validations individuelles ni la couverture par l’autre périmètre.

| Contrôle | Résultat |
|---|---|
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-CHOqBtJp.js` et `index-CPxF8ZbO.css` |
| Suite métier et API globale | 325 tests passés, aucun ignoré ; 19 nouveaux tests |
| Règles d’intégration | SQLite et MemoryStore : périmètres indépendants, date incluse, historique hors semaine, droits de validation, schéma strict et champs gérés |
| Verrous et réouverture | Création, correction, antidatage, dévalidation et suppression refusés dans la période ; dates réduites/retirées sans perte des autres validations |
| Persistance et atomicité | SQLite fermé/réouvert, snapshots MemoryStore, absence de réécriture à la lecture, conservation des validations individuelles/heures/tarifs/notes et annulation en cas de dépassement de quota |
| Navigateurs SQLite et Worker/D1 | Douze parcours passés sur chaque stockage : trois nouveaux et neuf de régression |
| Publication | Worker `cfba2439-ca13-41ea-b224-72f167b36742` publié sur la cible existante |
| Sonde HTTPS | Réussie le 12/10/2026 à 23:41:43 (Europe/Paris) ; nouvelle action reconnue et payload invalide refusé sans mutation |

Les nouveaux parcours valident le seuil projet malgré le filtre d’une seule ressource, la journée limite, les cellules et les filtres de validation, la consultation des temps intégrés, le retrait, la persistance au rechargement et les dates hors semaine. La feuille personnelle valide aussi les temps de cette seule ressource dans un autre projet masqué par le filtre, sans changer les dates projet. La feuille Équipe permet de sélectionner une autre ressource depuis sa ligne, sans valider ses collègues, puis démontre le cumul des deux seuils et la conservation de la validation projet après retrait du seuil ressource. Les neuf régressions couvrent cinq parcours de temps, deux de suivi projet, les champs personnalisés de temps et la fiche/capacité de la ressource. Quatre captures sont générées ; les vues projet sur ordinateur et personnelle sur mobile sont inspectées.

Les tests API contrôlent également la date civile, les années bissextiles et les bornes autour du changement d’heure, les jours sans saisie, la délégation de la véritable identité, les visiteurs, les projets interrompus/clos, les payloads mêlant les périmètres, les tentatives de modification via les formulaires ordinaires, les anciennes données et les lectures sans mutation. Un contrôle HTTP Express vérifie authentification et origine. Les périodes intégrées ne réécrivent pas les enregistrements de temps ; l’API expose une validation effective dérivée. Les JSON projet/ressource portent un champ facultatif, sans nouvelle collection ni migration destructive.

Les vérifications utilisent des bases temporaires. La sonde publique contrôle les fichiers livrés, les vingt collections, le compte existant, les refus d’écritures anonymes et une action d’intégration volontairement invalide, puis compare projets, ressources et temps avant/après. Aucune date métier publique n’est choisie ni appliquée par la vérification ; sa session est révoquée après contrôle.

Version en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/time.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Imbriquer une liste dans une autre liste

Chaque liste propose maintenant un bouton **Imbriquer**, situé à côté de son nom. Il ouvre un sélecteur de listes et sous-listes de destination, avec leur chemin complet, et force un placement à l’intérieur. Les destinations comprennent les anciennes phases du projet. La liste source et ses descendants sont exclus pour empêcher les cycles. L’enregistrement conserve toutes les tâches et sous-listes, puis affiche leur nouveau niveau. Le glisser-déposer au centre d’une autre liste reste disponible.

| Contrôle | Résultat |
|---|---|
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-DRDJgpV6.js` et `index-B9SOATyD.css` |
| Déplacements métier et API | 13 tests passés sur SQLite et MemoryStore, avec contrôles HTTP Express, cycles, profondeur, quotas et persistance |
| Navigateurs SQLite et Worker/D1 | Neuf parcours passés sur chaque stockage : deux pour Imbriquer et sept de glisser-déposer |
| Publication | Worker `5b33d987-12ba-47cc-972d-d303c23e7db0` publié sur la cible existante |
| Sonde HTTPS | Réussie le 12/10/2026 à 20:20:57 (Europe/Paris), avec lecture authentifiée des vingt collections |

Les nouveaux parcours vérifient une destination sur plusieurs niveaux, les chemins complets, la conservation des descendants et commentaires/temps, le rechargement, l’ouverture au clavier, l’absence de destinations cycliques, l’enregistrement désactivé sans destination, le projet verrouillé et le placement d’une liste existante dans une ancienne phase depuis un écran mobile. Les sept parcours de déplacement conservent les gestes souris et tactiles, les placements avant/dans/après, les phases historiques, les filtres, le tri, la configuration des colonnes, l’annulation et les clics de consultation. Les captures existantes sont renouvelées et l’action visible à côté du nom des listes est inspectée.

Les tests utilisent uniquement des bases temporaires. La sonde publique confirme les nouveaux fichiers, le compte existant, les refus d’écritures anonymes et la révocation de sa propre session, sans modifier de donnée métier publique. Le serveur et le modèle de données ne changent pas : cette action utilise la transaction de déplacement existante.

Version en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/list.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Correction du glisser-déposer depuis les noms

La précédente version amorçait le glissement depuis la poignée uniquement, et le désactivait lorsqu’un tri était actif. Le geste souris depuis le nom d’une tâche a été reproduit en échec avant correction. Il fonctionne maintenant depuis le nom ou la poignée des tâches, jalons et listes, à la souris et au tactile. Le tri revient automatiquement à Aucun tri après un déplacement enregistré.

La capture du pointeur remplace le démarrage natif HTML. Un déplacement rapide conserve son repère de destination ; le relâchement enregistre avant, dans ou après la ligne choisie. Un clic simple continue à ouvrir la fiche. Le clic qui suit un glissement est absorbé, sans bloquer un nouveau clic ni le clavier. Échap et un dépôt hors du tableau n’enregistrent aucun changement.

| Contrôle | Résultat |
|---|---|
| Reproduction | Geste souris réel depuis le nom en échec sur la précédente version |
| TypeScript et Vite | Compilation finale réussie ; fichiers `index-9GVy9hJ5.js` et `index-DuTwb3aX.css` |
| Suite métier et API | 306 tests passés, aucun ignoré |
| Navigateurs SQLite et Worker/D1 | 17 parcours distincts validés sur chaque stockage : sept déplacements et dix régressions |
| Publication | Worker `a1fa47d4-cc75-422f-af2b-46b33e955bed` publié sur la cible existante |
| Sonde HTTPS | Réussie le 12/10/2026 à 20:11:33 (Europe/Paris) ; vingt collections lisibles avec le compte existant |

Les sept parcours utilisent des gestes souris avec appui, mouvement et relâchement, ainsi que les événements tactiles natifs Chromium. Ils vérifient les noms, poignées, gestes rapides, repères visibles pendant le geste, listes repliées, avant/dans/après, racine, descendants, cycles, phases historiques, tri actif, filtres, colonnes réordonnées, rechargement, annulation, absence de mutation hors cible, clavier, clic de consultation et projets verrouillés. Les dix régressions couvrent six parcours de listes imbriquées, trois de coche de tâche et un de tags/préférences de colonnes. Le lot a validé seize parcours ; le parcours d’annulation a ensuite été repassé sur chaque stockage après correction d’une attente de test : un rattachement ancien peut être absent plutôt que nul. Le code applicatif reste identique entre ces vérifications.

Les captures de destination, d’ordre mixte et de vue mobile sont renouvelées. Le repère de destination est désormais capturé pendant un vrai geste souris, avec vérification de sa couleur dans les styles calculés. Les bases de test sont temporaires ; la sonde publique vérifie les fichiers livrés, l’authentification, les refus d’écritures anonymes et la révocation de sa propre session. Elle ne modifie aucune donnée métier publique. Les données, le compte administrateur et le retrait de l’entrée Projets de la sidebar sont conservés.

Version en ligne : https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/list.

Les vérifications des versions précédentes sont conservées ci-dessous.

# Vérification du glisser-déposer et de la sidebar

La vue Liste permet de déplacer tâches, jalons et listes avant, dans ou après une liste. Leur ordre partagé est sauvegardé dans le projet ; les descendants suivent la liste déplacée. La poignée fonctionne à la souris et au tactile, et ouvre également un formulaire accessible au clic ou au clavier. L’entrée Projets entre Personnalisation et Calendrier est retirée ; Tout, les zones et les projets récents restent accessibles.

| Contrôle | Résultat actuel |
|---|---|
| Suite métier et API globale | 306 tests passés, aucun ignoré ; 13 nouveaux tests |
| Déplacement partagé | SQLite et MemoryStore : ordre mixte tâches/listes, avant/dans/après, descendants, phases historiques, références du même projet, verrous et absence de double comptage |
| Persistance et références | Fermeture/réouverture SQLite, snapshot MemoryStore, import/clonage de modèle avec positions, changement de parent par formulaire et conservation des autres collections |
| Refus atomiques | Cycles, profondeur supérieure à vingt, destination étrangère, données invalides et croissance de stockage refusés sans changement des records ; authentification et origine vérifiées via HTTP Express |
| TypeScript et Vite | Compilation intégrée réussie sur le code final |
| Parcours navigateur SQLite et Worker/D1 | 21 parcours distincts passés sur chaque stockage : cinq nouveaux et seize de régression ; contrôle du surlignage repassé sur chaque stockage après correction CSS |
| Publication et sonde HTTPS | Worker `727ceecd-91c0-4e0c-a8d0-de4bf0de1bbe` publié ; sonde HTTPS réussie le 12/10/2026 à 19:32:41 (Europe/Paris) |

Les parcours vérifient le dépôt natif dans une liste repliée, avant et après une liste, retour à la racine, ordre DOM égal à l’ordre enregistré, rechargement, listes déplacées avec leurs descendants, cycle sans requête, projet verrouillé, phases historiques, recherche et colonnes réordonnées. Ils couvrent également les gestes tactiles natifs Chromium, l’ouverture au clavier, les repères visuels pendant un DragEvent, le dépôt enregistré et la navigation mobile sans l’entrée Projets. Les régressions conservent les six parcours de listes imbriquées, trois de sidebar, trois de coche de tâche, les modèles et la personnalisation mobile, les tags/colonnes et l’édition-validation des temps.

Trois captures `project-item-moves-*.png` sont inspectées sur ordinateur/mobile : repère de destination, ordre mixte après déplacement et vue mobile. Le repère central possède la couleur de fond attendue, vérifiée dans les styles calculés du navigateur. Les déplacements refusés ne créent pas de faux ordre dans l’interface. Les tests utilisent uniquement des bases temporaires indépendantes des données publiques.

Le déplacement s’enregistre dans une seule transaction, sans créer de nouvelle collection : les vingt collections précédentes restent présentes. Les champs facultatifs position sont ajoutés aux tâches/listes et aux modèles. La lecture des anciens espaces ne réécrit pas leurs données ; la matérialisation des phases se produit uniquement lors d’un déplacement explicite. Les commentaires, temps, dates, coûts et identifiants des éléments sont conservés.

La version est disponible sur https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/list. La sonde HTTPS confirme les nouveaux fichiers, la lecture authentifiée des vingt collections et le refus des écritures anonymes sur project-item-moves. Le compte existant reste fonctionnel, son mot de passe est absent des fichiers publiés et la sonde révoque uniquement sa propre session. Aucune donnée métier publique n’a été modifiée par cette vérification.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification des listes de tâches imbriquées

La vue Liste utilise un seul tableau compact, avec listes et sous-listes repliables, tâches et jalons, dates, statuts, tags, responsable, allocation et commentaires. Les éléments peuvent être créés au niveau choisi puis déplacés ; les listes peuvent être renommées, déplacées ou supprimées lorsqu’elles sont vides. Les anciennes phases restent visibles sans écriture à la lecture et leur organisation en listes conserve leurs tâches.

| Contrôle | Résultat actuel |
|---|---|
| Suite métier et API globale | 293 tests passés, aucun ignoré ; 30 nouveaux tests |
| Listes et API | 16 nouveaux tests passés : SQLite, MemoryStore et Worker/D1 ; profondeur, cycles, projets étrangers, droits du compte authentifié, verrous, listes non vides, migrations additives, conversion de phases, quotas et annulation atomique |
| Arbre et agrégats | 9 nouveaux tests passés : groupes historiques, listes vides, chemins sûrs, mêmes noms avec identifiants distincts, tâches du seul projet, filtres conservant les ancêtres, totaux sans doublon et dates des jalons |
| Modèles de projet | 5 nouveaux tests passés, et 4 précédents conservés : import de la hiérarchie et listes vides, références de parents, clés des tâches, validation et compatibilité des phases ; clonage/remapping/rollback également vérifiés par API |
| TypeScript et Vite | Compilation intégrée réussie sur le code final |
| Parcours navigateur SQLite et Worker/D1 | 12 parcours distincts passés sur chaque stockage : six nouveaux et six de régression |
| Publication et sonde HTTPS | Worker `cff74cd5-bf4b-4138-924e-541f70c1cea4` publié ; sonde HTTPS réussie le 12/10/2026 à 13:04:16 (Europe/Paris) |

Les parcours couvrent la lecture des phases historiques sans mutation, leur conversion atomique, une hiérarchie sur trois niveaux, création contextuelle de tâche et jalon, changement de parent et rattachement des éléments, rechargement, listes vides, totaux complets, dates, filtres, repli par niveau et global, configuration des colonnes, dépendances, projets verrouillés et clonage des modèles avec nouvelles références. Les régressions incluent l’ancien import de modèle, les trois parcours de coche de tâche, l’édition/validation des temps et les tags/préférences de colonnes. La correction finale d’une attente de test après réinitialisation de la recherche ne modifie pas le code applicatif.

Les huit captures `nested-lists-*.png` ont été inspectées sur ordinateur et mobile : colonnes et agrégats alignés, noms indentés, tableau défilant dans son cadre, menus de dernière ligne non découpés, formulaires et retour du focus utilisables au clavier. Les menus flottants sont placés dans le viewport en dehors du conteneur défilant. Une phase vide importée reste éditable et clonable.

Les bases de test sont temporaires, sans utilisation ni modification des données métier publiques. La vingtième collection `taskLists` est facultative dans les snapshots historiques ; sa lecture ne réécrit ni les dix-neuf collections précédentes ni la révision. Les références et les quotas sont contrôlés dans les mêmes transactions que les conversions et clonages. Aucune suppression en cascade de tâche, temps ou commentaire n’est effectuée.

La version est accessible sur https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/list. La sonde HTTPS confirme les nouveaux fichiers de la vue Liste et la lecture authentifiée des vingt collections. Les créations, modifications et suppressions anonymes de listes sont refusées. Le compte existant reste fonctionnel ; la sonde vérifie le cookie sécurisé et révoque uniquement sa propre session. Le mot de passe est absent des fichiers publiés et aucune donnée métier publique n’a été modifiée par ces contrôles.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification des dossiers, champs des temps et tableaux de ressources

Les projets permettent de créer des dossiers et sous-dossiers, déplacer leurs documents et conserver les anciens documents à la racine. La catégorie **Saisies de temps** ajoute les neuf types de champs à la création, correction et consultation des temps, avec formule `{hours}` et valeurs persistantes. Une seule entrée **Mon espace** donne accès aux trois vues personnelles. Gestion ouvre **Capacité**, **Charge prévisionnelle** et **Taux d’occupation**, depuis les calendriers hebdomadaires des ressources.

| Contrôle | Résultat actuel |
|---|---|
| Suite métier et API globale | 263 tests passés, aucun ignoré ; 26 nouveaux tests |
| Dossiers et champs de saisie | 14 nouveaux tests API passés sur SQLite, MemoryStore et Worker/D1 : références du même projet, cycles, dossiers non vides, auteurs serveur, droits, projets verrouillés, typage et formules, validation des temps, raster borné, anciennes valeurs et redémarrage |
| Calculs et navigation de dossiers | 10 tests de planification et 2 tests d’arbre passés : somme des projets, absences fusionnées, jours fériés, unités propres aux ressources, taux nul/indéfini, calendrier mensuel/hebdomadaire sans doublon, branches et projets étrangers |
| TypeScript et Vite | Compilation intégrée réussie après correction du confinement mobile des noms de ressources |
| Parcours navigateur SQLite et Worker/D1 | 13 parcours distincts passés sur chaque stockage : cinq nouveaux et huit de régression ; les deux tableaux concernés repassent sur chaque stockage après correction CSS |
| Publication et sonde HTTPS | Worker `08e5a46f-7ca1-42e9-8da7-f12448861388` publié ; sonde HTTPS réussie le 12/10/2026 à 12:36:51 (Europe/Paris) |

Les treize parcours couvrent dossiers imbriqués, renommage et déplacement, fichiers et liens rechargés, racine historique, suppression des seuls dossiers vides, capacité mensuelle exacte après modification de la fiche, jours fériés et absences qui se chevauchent, semaines et années, couleurs de surcharge, capacité nulle avec charge conservée, filtres de ressources et branches de projet. La saisie des temps couvre les neuf champs, image importée, formule recalculée, correction et consultation d’une saisie validée. Les régressions portent sur les cinq parcours du suivi temporel, les indisponibilités du calendrier, les coûts inconnus et la navigation Personnalisation.

Les bases de test sont temporaires et n’utilisent aucune donnée métier publique. Les contrôles de dossiers et champs personnalisés restent atomiques ; la lecture des anciens espaces ne réécrit ni les dix-huit collections précédentes ni la révision. Les capacités sont issues du calendrier courant, sans prétendre fournir un historique des calendriers. Le taux à capacité nulle est affiché « — » ; les branches gardent la charge dans l’unité choisie.

Dix captures `folders-capacity-time-*.png` couvrent dossiers, champs de temps, navigation personnelle et tableaux sur ordinateur/mobile. Les noms et fonctions restent dans la colonne fixe, et le tableau défile dans son cadre. Les formulaires restent navigables et les noms complets de ressources sont accessibles.

La version est accessible sur https://planzone8-demo.aldeguer-remi.workers.dev/#resources/capacity, la charge sur `#resources/load` et le taux sur `#resources/occupancy`. La sonde HTTPS confirme les nouveaux assets, les dix-neuf collections authentifiées et le refus des créations, modifications et suppressions anonymes de dossiers. Le compte et les attributs du cookie restent fonctionnels ; la sonde révoque uniquement sa propre session. Le mot de passe est absent des fichiers publiés. Aucune donnée métier publique n’a été modifiée par ces contrôles.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification des champs, listes, collaboration et Mon espace

Les sept types demandés sont configurables dans Personnalisation : texte simple, texte riche, listes multiples ou simple, formule, image et lien web. Nombre et Date restent compatibles. La Liste conserve l’ordre et la visibilité des colonnes par utilisateur/projet ; les tags s’éditent par puces. Les projets proposent Documents et Discussions, et la sidebar ouvre Mes discussions. Mon espace affiche les tâches à gauche et un calendrier hebdomadaire personnel à droite.

| Contrôle | Résultat actuel |
|---|---|
| Suite métier et API globale | 237 tests passés, aucun ignoré ; 46 nouveaux tests |
| Champs personnalisés et images | 14 nouveaux tests passés : typage, choix, parseur et cycles de formules, conversion de type et références, raster borné, sauvegarde d’une requête de deux images puis redémarrage SQLite et Worker/D1 |
| Collaboration et documents | 18 nouveaux tests passés : auteurs serveur, mentions, contextes exacts, droits, projets verrouillés, vrais fichiers, validation, quotas atomiques, migration additive et redémarrage |
| Calculs personnels et préférences | 6 tests du calendrier, 4 des discussions et 4 des colonnes passés : dates, chevauchements, périmètre ressource, historique, contexte, IDs obsolètes et isolation des préférences |
| TypeScript et Vite | Compilation intégrée réussie |
| Parcours navigateur SQLite et Worker/D1 | 14 parcours distincts passés sur chaque stockage : six nouveaux et huit de régression ; les quatre parcours touchés par les dernières corrections repassent sur la version finale |
| Publication et sonde HTTPS | Worker `5376b4cf-2d90-4867-8ab8-b312623ca68b` publié ; sonde HTTPS réussie le 12/10/2026 à 12:00:29 (Europe/Paris) |

Les bases de test sont temporaires et indépendantes des données publiques. Les requêtes volumineuses de champs sont bornées, et les écritures dépassant le stockage disponible sont annulées sans modifier les autres collections ni la révision. Les espaces historiques restent lisibles, sans réécriture à la lecture. L’auteur, le contexte et les dates techniques des documents/commentaires sont contrôlés par le serveur.

La version est accessible sur https://planzone8-demo.aldeguer-remi.workers.dev/#personal, les champs sur `#customization/custom-fields`, les documents et discussions dans chaque projet, et les discussions personnelles sur `#discussions`. La sonde publique confirme les nouveaux fichiers, la lecture authentifiée des dix-huit collections et le refus des écritures anonymes des documents et commentaires. Le compte existant est conservé, le mot de passe est absent des assets et la session propre à la sonde a été révoquée. Aucune donnée métier publique n’a été modifiée par ces contrôles.

Dix captures `workspace-expansion-*.png` ont été inspectées sur ordinateur/mobile. Les essais utilisent une vraie image raster importée, des fichiers téléchargés et des commentaires enregistrés. Ils vérifient aussi la saisie au clavier sans perte de focus, la navigation vers les liens d’une fenêtre, le choix de mention par Entrée, la suppression d’un commentaire en cours d’édition, les commentaires historiques de la ressource courante et la conversion d’une formule inutilisée en texte. Les vues restent contenues dans leur cadre sur mobile ; le texte du calendrier utilise un contraste noir/blanc adapté au fond.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification du suivi et des rapports dans le projet

L’onglet Suivi temporel du projet présente les membres explicites, affectés ou historiques, y compris les inactifs par défaut, et exclut les ressources étrangères. Les comptes rendus sont enregistrés dans leur projet avec une copie indépendante du modèle et un auteur fixé par le serveur. La Synthèse ouvre leur formulaire bleu et le rapport flash jaune orangé. La carte Budget alloué ouvre son montant modifiable et l’enregistrement recalcule les indicateurs du projet.

| Contrôle | Résultat actuel |
|---|---|
| Calculs du suivi hebdomadaire | 15 tests ciblés passés : les 12 précédents et 3 nouveaux parcours de calcul pour appartenance, historique après réaffectation, périmètre étranger, branches vides et filtres/changement d’heure |
| Compilation globale et suite métier/API | TypeScript/Vite réussis sur le code final ; 191 tests passés, aucun ignoré |
| API des comptes rendus | 14 tests réussis : validation, snapshots, auteur serveur, références, verrous, redémarrage SQLite/D1 et conservation des seize collections précédentes |
| Parcours navigateur SQLite et Worker/D1 | Quatre parcours distincts passés sur chaque stockage : suivi projet, comptes rendus persistants, rapport flash/budget éditable, mobile |
| Publication et sonde HTTPS | Worker `e5c55a06-6710-4de7-adfe-16a18e6ba48b` publié ; sonde réussie le 12/10/2026 à 11:12:41 (Europe/Paris) |

Les contrôles locaux utilisent des bases temporaires et ne modifient pas les données publiques. Les captures `project-actions-*.png` ont été inspectées sur ordinateur et mobile ; tableaux et dialogues défilent dans leur cadre, et l’impression contient seulement le rapport demandé.

Un champ date valide entouré d’espaces est normalisé à l’écriture ; les anciennes valeurs sont lues sans réécriture et sans erreur de formatage. Les champs de texte conservent leurs espaces et sauts de ligne. Les vérifications couvrent également le maintien des indicateurs et champs d’un compte rendu après modification ou suppression de son modèle, et la conservation des centimes du budget alloué après rechargement.

La livraison est disponible sur https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/summary et le suivi projet sur https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/time. La sonde HTTPS confirme les fichiers des trois actions, la lecture authentifiée des dix-sept collections et le refus des écritures anonymes de comptes rendus. Elle conserve le compte existant, vérifie les attributs sécurisés du cookie et révoque sa propre session. Le mot de passe est absent des assets ; aucune donnée métier publique n’a été modifiée par cette sonde.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification des cinq vues de Personnalisation

La sidebar ouvre les modèles de projet, champs personnalisés, modèles de compte rendu, statuts de projet et axes stratégiques. Leurs catalogues sont persistants et initialement vides ; aucun contenu des captures n’est importé dans l’espace existant.

Les modèles de projet recréent une structure avec de nouveaux identifiants, des dépendances remappées et des dates relatives en jours calendaires, sans reprendre les affectations, avancements ou historiques. Les définitions de champs FR/EN sont typées et reliées aux fiches projet, tâche et ressource ; les champs compatibles de compte rendu sont copiés dans le modèle. Les permissions affichées correspondent au compte administrateur disponible. Les modèles de compte rendu sont persistants ; leur rédaction est un brouillon local, conservable par impression/PDF.

Les statuts personnalisés conservent les quatre comportements natifs et leurs verrous. Les axes portent une échelle de −2 à 2 et un poids entier ; les projets enregistrent leurs évaluations et un score pondéré explicite. Les suppressions de définitions utilisées sont refusées avec un conflit HTTP 409 sans supprimer les valeurs, projets ou évaluations référencés.

| Contrôle | Résultat actuel |
|---|---|
| Compilation TypeScript/Vite | Réussie sur le code final des cinq vues et leurs contrats |
| Suite métier/API | 174 tests passés, aucun ignoré, dont 16 nouveaux tests API et 4 tests de modèle/score |
| Helpers de modèle et score | Périmètre exact du projet, dépendances internes, dates absentes et négatives, changements d’heure français, tags copiés sans alias, scores négatifs/positifs, poids nul et axes non évalués vérifiés |
| API et persistance | CRUD des cinq catalogues, clonage atomique, champs typés, références et verrous vérifiés sur SQLite et Worker/D1 ; redémarrage et conservation des onze collections précédentes |
| Parcours navigateur SQLite et Worker/D1 | Cinq parcours distincts passés sur chaque stockage : modèles, champs aux fiches, compte rendu et impression, gouvernance, navigation/formulaires mobiles |
| Captures et contrôle d’affichage | Cartes, accordéons, constructeur bleu et formulaires inspectés sur ordinateur/mobile ; défilement contenu dans les dialogues et tableau des axes |
| Publication et sonde HTTPS | Worker `ffa44dfc-b8cb-44f5-933a-a2fd5619a29c` publié ; sonde réussie le 12/10/2026 à 02:15:09 (Europe/Paris) |

Les cinq vues sont disponibles depuis https://planzone8-demo.aldeguer-remi.workers.dev/#customization/project-templates. La sonde HTTPS confirme les fichiers publiés, la lecture authentifiée des seize collections, le refus des écritures anonymes sur les cinq catalogues et la révocation de sa propre session. Le compte existant est conservé, son mot de passe est absent des assets et aucune donnée métier publique n’a été modifiée par la sonde.

Les neuf captures `customization-*.png` sous `docs/screenshots/` couvrent les cartes de modèle, les accordéons de champs, le constructeur de compte rendu, les axes et les formulaires mobiles. Les deux captures de tableau/builder ont été renouvelées avec le défilement remis en haut ; les deux parcours concernés passent de nouveau. Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification des recettes et répartitions du budget projet

Le budget projet permet de créer, modifier et supprimer des recettes persistantes, avec libellé, catégorie, montant saisi au centime, date prévue et date d’encaissement facultative. La date d’encaissement peut précéder la date prévue ; la retirer remet la recette à encaisser. Les résultats distinguent recettes prévues moins coûts planifiés et recettes encaissées moins coûts réels. Les recettes ne modifient pas l’enveloppe allouée du projet et ne sont pas ajoutées aux coûts des synthèses de zone.

La synthèse financière sépare ressources et dépenses. Le sélecteur Planifié/Réel pilote les répartitions par six catégories de dépenses — Achat logiciel, Formation, Matériels, Fournitures, Frais juridiques, Autres — et par ressources Externes, Internes, Matérielles, Virtuelles, avec Non classées pour les références sans type connu. L’accès principal Suivi temporel est ajouté directement sous Mon espace dans la sidebar ; il ouvre la grille personnelle et fonctionne dans le menu mobile.

| Contrôle | Résultat |
|---|---|
| Compilation TypeScript/Vite | Réussie sur la version finale, avec le correctif CSS des graphiques |
| Suite métier/API | 154 tests passés, aucun ignoré, dont 12 nouveaux tests backend de recettes et 8 de répartitions |
| SQLite / navigateur | 6 parcours distincts passés, couvrant recettes, répartitions, sidebar et régressions du budget |
| Worker/D1 / navigateur | Les mêmes 6 parcours passés avec le runtime réel local |
| Conservation des données | Ancien snapshot sans recettes lu sans écriture ni changement de révision ; CRUD de recettes et redémarrage D1 conservant les 10 autres collections ; ajout SQLite sans réinitialisation |
| Contrôles API | Authentification et origine appliquées aux recettes ; validation stricte des montants/dates ; rattachement au projet immuable ; mutations refusées dans les projets clos ou interrompus |
| Affichage final | Captures ordinateur/mobile inspectées ; barre et donut contenus sous leur en-tête ; les deux parcours graphiques retestés sur chaque backend après le correctif CSS |
| Publication de cette livraison | Worker `1f1b5523-e911-403a-97c9-b434c0c44190` publié ; sonde HTTPS réussie le 12/10/2026 à 01:51:19 (Europe/Paris) |

Les calculs conservent les tarifs historiques et la ressource de chaque saisie pour le réel, alors que le planifié suit l’affectation et le profil actuels. Les dépenses prévues ou réglées n’entrent pas dans l’acquis des allocations. Les tests couvrent les fractions, le tarif zéro connu, les tarifs manquants et les recettes hors périmètre. Les sommes des répartitions correspondent aux agrégats financiers existants. Les valeurs incomplètes sont affichées comme minimums pour les coûts et maximums pour les marges ou résultats ; une borne positive incomplète ne s’affiche pas comme un bénéfice certain. Les proportions sont limitées aux coûts connus, avec les valorisations manquantes explicites.

Les parcours navigateur vérifient le CRUD des recettes, l’encaissement anticipé, la persistance après rechargement, le maintien du budget alloué, le verrouillage du projet, les catégories de dépenses, les répartitions planifiées et réelles, les tarifs conservés après modification de profil, le formulaire mobile et l’accès direct à la grille personnelle depuis la sidebar. Ils utilisent les serveurs locaux Express/SQLite et Worker/D1. Les captures finales sont `budget-revenues-desktop.png`, `budget-revenues-mobile.png` et `budget-revenue-form-mobile.png`, sous `docs/screenshots/`.

La livraison est disponible sur https://planzone8-demo.aldeguer-remi.workers.dev/#project/project-nova/budget et le suivi direct sur https://planzone8-demo.aldeguer-remi.workers.dev/#time. La sonde publique vérifie les assets des recettes/répartitions et du suivi, la lecture authentifiée des onze collections, le refus des écritures anonymes sur les recettes et la révocation de sa propre session. Le mot de passe est absent des assets ; le compte existant est conservé. La sonde n’a modifié aucune donnée métier.

Les vérifications des livraisons précédentes sont conservées ci-dessous.

# Vérification de la sidebar et des colonnes Budget

La sidebar sombre regroupe les projets dans leurs zones et affiche des compteurs issus des données. Les projets récemment ouverts sont conservés dans le navigateur. La barre se replie sur ordinateur et fonctionne comme menu mobile ; son menu de compte reste accessible. Les boutons de création de zone et de projet sont reliés à la persistance existante.

Le groupe Budget du tableau contient Alloué, Planifié, Réel, Marge planifiée, Marge réelle et Acquis, avec synthèses sur les projets affichés. Les montants sans tarif sont signalés comme bornes, les marges négatives sont conservées, et un montant arrondi à zéro s’affiche sans « −0,00 € » ni couleur de dépassement.

| Contrôle | Résultat |
|---|---|
| Compilation TypeScript/Vite | Réussie sur les derniers correctifs |
| Suite métier/API | 134 tests passés, aucun ignoré : notamment 9 nouveaux calculs budgétaires et 6 tests de zones |
| SQLite / navigateur | 11 parcours passés : sidebar3, Budget2, zone4, anciennes création annuaire/profil et rotation du mot de passe |
| Worker/D1 / navigateur | Les mêmes 9 parcours sidebar/Budget/zone passés avec le runtime réel local |
| Création de zone | Session et origine contrôlées, écritures strictes, SQLite/D1 persistants ; suppression refusée, autres données conservées |
| Affichage | Captures ordinateur/mobile inspectées ; tableau défilant dans son cadre et compte accessible après repli |

Les calculs vérifiés distinguent tarifs courants et historiques, heures déclarées validées ou non, dépenses prévues et réglées, et valorisation de l’avancement des allocations hors dépenses. Les agrégats ne sont pas une moyenne de montants de projets arrondis. Une fixture au tarif 1 €/3 h avec une saisie de 0,01 h couvre les fractions de cent.

Les parcours de sidebar vérifient les vrais comptes tâches/jalons, l’ordre et la persistance des récents, la création de zone et de projet dans la bonne zone, le repli persistant, le menu du compte dans la fenêtre et la navigation Profils → Annuaire → Profils avec une URL cohérente. Les parcours existants de budget et de zones restent exercés. Les sondes publiques utilisent HTTPS ; les parcours Chromium utilisent les deux serveurs locaux.

Les captures de cette livraison sont `sidebar-desktop.png`, `sidebar-mobile.png`, `zone-budget-desktop.png` et `zone-budget-mobile.png`, sous `docs/screenshots/`.

Publication sur https://planzone8-demo.aldeguer-remi.workers.dev/#projects (version Worker `c0d10ae8-4ae9-4326-9fd7-d7a3b7fc2444`). La sonde HTTPS du 12/10/2026 à 01:27:38 (Europe/Paris) confirme les nouveaux fichiers de sidebar et Budget, la lecture authentifiée des zones/projets, le refus des écritures anonymes sur les zones et la révocation de sa propre session. Le compte existant est conservé et le mot de passe est absent des assets publiés. La sonde n’a modifié aucune donnée métier.

# Vérification antérieure des vues de zone

Les zones et la liste de tous les projets utilisent le tableau compact : lignes de synthèse repliables, en-têtes gris sur deux niveaux, météo, équipe, tags des tâches et colonnes d’activité et de travail. Le lien conserve la zone sélectionnée après rechargement ; la création présélectionne cette zone.

| Contrôle | Résultat |
|---|---|
| Compilation TypeScript/Vite | Réussie sur le code final |
| Calculs de zone et régression métier | 16 tests passés : 8 nouveaux tests de zone et 8 tests métier existants, aucun ignoré |
| Navigateur SQLite | 4 nouveaux parcours passés après les derniers correctifs ; anciennes création de projet et navigation calendrier/mobile également validées |
| Navigateur Worker/D1 | Les mêmes 4 nouveaux parcours passés après les derniers correctifs ; ancienne navigation calendrier/mobile validée |
| Affichage | Captures inspectées en 1920×1080 et 390×844 ; défilement contenu dans le tableau, en-têtes mobiles cohérents et contraste ajusté |

Les parcours vérifient les pourcentages pondérés par allocation, le passé réellement saisi, le restant négatif, la synthèse limitée aux projets visibles, les membres associés explicitement sans tâche, le rechargement et la création dans la bonne zone. Un refus API409 du changement de statut conserve la valeur précédente ; une modification acceptée persiste après rechargement. Recherche, filtre, tri, ouverture du projet et replis sont exercés dans le navigateur.

Les captures finales sont `zone-projects-all.png`, `zone-projects-table.png` et `zone-projects-mobile.png`, dans `docs/screenshots/`. Les tests navigateur exécutent Express/SQLite et le Worker/D1 locaux. La livraison HTTPS sur le site public est vérifiée séparément.

La version a été publiée sur https://planzone8-demo.aldeguer-remi.workers.dev/#projects (Worker `caa7818d-bd2c-43de-8b3a-2c53468c2f63`). La sonde HTTPS du 12/10/2026 à 01:00:39 (Europe/Paris) confirme les fichiers du tableau, l’authentification existante, la lecture des zones et projets et la révocation de sa propre session. Le mot de passe est absent des assets. Aucune donnée métier n’a été modifiée par cette sonde.

# Vérification antérieure du menu Ajouter au calendrier

Le calendrier global et celui du projet proposent Ajouter → Tâche, Jalon, Événement, Indisponibilité. Les événements et absences disposent de créations, modifications et suppressions persistantes. Les absences couvrent des dates inclusives en journée entière, ou une seule date avec deux horaires en journée partielle.

| Contrôle | Résultat |
|---|---|
| Compilation TypeScript/Vite | Réussie avec les formulaires et nouveaux contrats |
| Suite métier/API | 110 tests passés, aucun ignoré ; 11 nouveaux tests de persistance/API et 8 de capacité/calendrier |
| Régression D1 supplémentaire | 1 test ciblé passé : ancienne ligne sans collections calendrier lue sans réécriture, premières créations conservant les 8 tableaux historiques, redémarrage identique |
| Navigateur SQLite | 6 parcours distincts réussis : 5 nouveaux et l’ancien calendrier/recherche/mobile |
| Navigateur Worker/D1 | Les mêmes 6 parcours réussis avec le runtime et la base réels locaux |
| Dernier correctif d’affichage | Plage horaire d’événement sur deux dates, y compris une heure de fin plus tôt le lendemain, revalidée sur les deux stockages ; parcours absences et captures relancés sur SQLite |
| Bundle Cloudflare | Worker et bindings D1/ASSETS vérifiés sans publication |

Les parcours vérifient tâches et jalons distincts, projet présélectionné, événement avec participants et filtre, horaires invalides refusés, création/édition/suppression, rechargement, éléments masqués accessibles, projet clos et formulaire mobile sans débordement. La capacité mensuelle affichée est vérifiée : pour une ressource à 176 h en octobre, deux journées entières et deux heures partielles donnent 158 h ; supprimer la plage partielle restaure 160 h. Les tests de calcul vérifient les chevauchements, la priorité des journées entières, les jours fériés, les week-ends et les changements d’heure.

Les nouvelles collections sont ajoutées aux snapshots et à SQLite sans supprimer, réinitialiser ni repeupler les données existantes. L’authentification et la vérification d’origine des nouveaux endpoints suivent les mêmes règles que les mutations existantes.

Les captures inspectées sont `calendar-add-menu.png`, `calendar-event-form.png`, `calendar-unavailability-full.png`, `calendar-unavailability-partial.png`, `calendar-unavailability-mobile.png` et `calendar-unavailabilities.png`, sous `docs/screenshots/`.

Le calendrier a été publié le 12/10/2026 à 00:42:11 (Europe/Paris), version Worker `777f6b17-41cc-4b38-8ec9-2415ddb10ef8`, sur https://planzone8-demo.aldeguer-remi.workers.dev/#calendar. La sonde HTTPS du 12/10/2026 à 00:43:14 (Europe/Paris) confirme les assets des formulaires, la lecture des deux nouvelles collections par le compte administrateur, le refus des écritures anonymes vers leurs endpoints et la révocation de sa propre session. Le mot de passe est absent des assets publiés ; aucune donnée métier n’a été modifiée par cette sonde.

## Vérification antérieure de la coche des tâches

Dans le suivi temporel, la liste et les priorités, la case permet de terminer la tâche (statut Terminé, avancement 100 %) ou de la remettre à faire (statut À faire, avancement 0 %). Le titre ouvre séparément la fiche.

La compilation TypeScript/Vite passe. Huit parcours navigateur passent sur Express/SQLite et les mêmes huit sur le Worker/D1 local : trois nouveaux parcours de coche et les cinq régressions hebdomadaires. Ils vérifient la persistance après rechargement, le passage entre suivi/liste/synthèse, la réouverture au clavier, l’absence de modification des validations de temps, les refus de dépendances sans faux statut coché et les projets clos/interrompus. Les captures `task-check-time.png` et `task-check-list.png` ont été inspectées.

Publication Cloudflare le 12/10/2026 à 00:12:43 (Europe/Paris), version Worker `2d5d6583-15bc-4e41-96c0-d7ba2686b582`. La sonde HTTPS du 12/10/2026 à 00:13:30 (Europe/Paris) confirme les nouveaux assets de la coche, la connexion et la lecture de l’espace administrateur, le refus des lectures anonymes et la révocation de sa propre session. Aucune donnée métier n’a été modifiée par cette sonde.

## Vérification antérieure du suivi temporel hebdomadaire

La grille utilise les données de l’API, avec calcul des heures par jour et consolidation ressource/projet/phase/tâche. Les vérifications spécifiques couvrent les totaux historiques et hebdomadaires, les changements de semaine, les filtres, les affectations modifiées, les fractions d’heures et les validations séparées.

| Contrôle actuel | Résultat |
|---|---|
| `npm run build` | TypeScript et interface Vite compilés avec la nouvelle grille |
| `npm test` | 91 tests réussis, aucun test ignoré ; 12 portent sur les semaines et les consolidations de temps |
| Navigateur Express/SQLite | 6 parcours ciblés réussis : les 5 nouveaux parcours hebdomadaires et le parcours existant de saisie/tarif |
| Navigateur Worker/D1 local | Les mêmes 5 parcours hebdomadaires réussis avec le vrai runtime Worker et la base D1 |
| `npm run check:cloudflare` | Bundle et bindings D1/ASSETS vérifiés sans publication |
| Affichage | Captures ordinateur et mobile inspectées ; noms lisibles, week-ends grisés, défilement horizontal interne et colonne de noms fixe |

Les parcours navigateur utilisent des projets et ressources isolés. Ils vérifient : la vue personnelle globale, le passage en Équipe, les heures de chaque jour, la distinction entre passé historique et semaine, le changement d’année, les lignes dépliables et Détails, la saisie préremplie depuis une cellule, la validation, le retrait séparé, la correction, le rechargement et la suppression. Un projet clos bloque les écritures. Les filtres couvrent les ressources inactives, les tâches terminées et les temps validés/à valider ; retirer une ressource inactive du périmètre réinitialise une sélection devenue incompatible.

Les tests de calcul couvrent aussi les réaffectations, les tâches sans assignee, les appartenances explicites vides, les jours de changement d’heure et les fractions inférieures à 0,01 h. Les calculs conservent les fractions d’heures ; leur formatage à deux décimales reste un choix d’affichage.

Les captures actuelles sont `docs/screenshots/time-personnel.png`, `time-equipe.png`, `time-desktop.png` et `time-mobile.png`. Les tests de navigateur ont tourné dans l’environnement local sur les deux stockages ; la sonde HTTPS du site publié vérifie séparément les assets et l’API.

La vue hebdomadaire a été publiée le 2026-10-11T22:03:14.364Z sur https://planzone8-demo.aldeguer-remi.workers.dev/#time (version Worker `d3c05d09-46cd-4588-93ef-2f957bdc5678`). La sonde HTTPS du 2026-10-11T22:04:12.512Z confirme les nouveaux fichiers de la grille, la connexion réelle du compte administrateur, la lecture de son espace, le refus des lectures anonymes et la révocation de la session de vérification. Le mot de passe est absent des assets publiés. Cette sonde n’a modifié aucune donnée métier.

## Vérification antérieure de l’authentification

Vérification dans l’environnement cloud avec Node.js 24.19.0, npm 11.9.0 et Chromium.

| Contrôle | Résultat |
|---|---|
| `npm run build` | TypeScript et interface Vite compilés |
| `npm test` | 79 tests réussis, aucun échec ou test ignoré ; 17 tests exécutent le Worker avec workerd et D1 locaux |
| `npm run test:e2e` | Suite complète initiale : 14 parcours SQLite réussis |
| `npm run test:e2e:cloudflare` | Suite complète initiale : 8 parcours Worker/D1 réussis |
| Régression supplémentaire et vérification du dernier correctif UI | Six parcours d’authentification sur chaque stockage, dont la réponse401 retardée ; 15 parcours SQLite et 9 Cloudflare distincts au total |
| `npm run check:cloudflare` | Bundle Worker et bindings D1/ASSETS vérifiés sans publication |
| Démarrage local réel | Compte aléatoire, fichier privé0600, connexion et conservation du compte après redémarrage vérifiés |
| Affichage | Écran de connexion inspecté en1440×1000 et390×844, champs et actions lisibles, aucun débordement |

Les parcours existants restent vérifiés : création et modification de projets, tâches, commentaires, ressources et profils, changements de statut et rechargement, budgets, saisie/validation des temps, téléchargementCSV, rapport imprimable, calendriers, navigation mobile et fiche ressource complète.

Les tests d’authentification vérifient le refus des lectures et écritures anonymes, l’absence d’accès avec l’ancien cookie de démonstration, l’erreur générique pour un mauvais identifiant ou mot de passe, les cookiesHttpOnly/Secure/SameSite, l’absence de jeton dans le JSON et de jeton brut en base, l’expiration des sessions après sept jours et la limitation persistante des tentatives.

La déconnexion révoque la session côté serveur : son cookie rejoué est refusé, y compris après un redémarrage. Le changement de mot de passe demande le mot de passe actuel, conserve le compte et ses données, crée une nouvelle session et invalide toutes les anciennes. Le rôle et le nom d’une fiche ressource ne peuvent pas modifier les droits ni l’identité du compte administrateur.

Les tests navigateur vérifient le formulaire de connexion, le maintien du lien vers le projet, la persistance après rechargement, la déconnexion, le changement de mot de passe et la disparition d’une fiche ouverte si sa session est révoquée. Une requête suspendue de l’ancienne session est libérée avec HTTP401 après une nouvelle connexion : elle ne déconnecte pas la nouvelle session et n’enregistre aucune tâche.

Les tests déterministes de concurrence vérifient qu’un changement de mot de passe intervenant après la mise à jour d’un premier changement empêche l’émission d’une session valable pour la version suivante. Un autre test change l’association du workspace juste avant une écritureD1 : l’écriture retourne409 et les deux espaces conservent leurs données et leurs révisions.

La reprise d’un ancien espace est vérifiée avec des bases temporaires : l’ancien cookie seul est refusé ; après une connexion réussie, ses données sont reprises et partagées par les sessions du compte. Un espace du compte déjà modifié ne peut pas être remplacé automatiquement. Aucune ligne historique n’est effacée ou réinitialisée.

Les six scénarios d’authentification utilisent le même fichier de tests contre Express/SQLite et le Worker/D1. Les serveurs de test et leurs comptes sont isolés dans des dossiers temporaires. Les valeurs connues dans les fixtures sont réservées aux tests et ne sont pas utilisées pour le compte publié.

Les captures de connexion sont dans `docs/screenshots/auth-desktop.png` et `auth-mobile.png`. Les captures de synthèse et de fiche ressource précédentes restent disponibles.

Les sondes du site public utilisent Node avec le proxy et les certificatsCA configurés. Elles vérifient les réponsesHTTPS ; les parcoursChromium sont exécutés localement, sans désactiver la validationTLS.

La version authentifiée a été publiée le 2026-10-11T21:16:59.710Z sur https://planzone8-demo.aldeguer-remi.workers.dev (version Worker `6eecc63f-583c-4b4b-a472-03bcd1932caf`). La recette HTTPS du 2026-10-11T21:17:40.833Z confirme : connexion réelle du compte `admin`, lecture de l’espace, cookie HTTPS sécurisé, refus anonyme en lecture et écriture, refus de l’ancien cookie de démonstration, refus d’une déconnexion depuis une origine étrangère et refus du cookie rejoué après déconnexion. Le mot de passe est absent des fichiers JavaScript/CSS publiés.

Les hashes et révisions des 24 espaces existants avant cette publication sont identiques après celle-ci. La recette publique n’a modifié aucun projet ; elle a laissé disponible la reprise de l’ancien espace au premier login du navigateur de l’utilisateur. Les identifiants initiaux ont été générés aléatoirement et conservés dans le fichier privé ignoré `.cloudflare/admin-credentials.json` ; ils ne sont pas inclus dans l’archive source.
