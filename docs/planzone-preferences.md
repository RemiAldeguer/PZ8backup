# Préférences de la Planzone et synthèse personnelle

L’écran « Paramètres de la Planzone » est accessible aux administrateurs dans Gestion et dans le menu du compte. Ses onze options reprennent les groupes « Suivi du temps » et « Planification ». Les préférences concernent l’espace authentifié ; elles ne constituent pas de nouveaux rôles ou droits.

`shared/planzone-preferences.ts` décrit les préférences et les règles de lecture, sans dépendance UI ou stockage. Les calculs de déplacement et d’allocation sont dans `shared/planning-preferences.ts`, les avertissements dans `shared/planning-warnings.ts`. La validation des commandes reste côté serveur. Le frontend expose un formulaire avec enregistrement explicite, annulation du brouillon et retour d’erreur.

`POST /api/planzone-preferences` exige un administrateur, les onze valeurs et `expectedVersion`. Une version périmée renvoie 409 sans écrire. Le singleton est conservé dans le stockage SQLite ou dans le snapshot chiffré D1 du prototype. La table absente d’un ancien espace devient une liste vide en lecture, sans réécriture. Les valeurs par défaut conservent les règles antérieures : intégration dès la saisie, allocations en heures, dates intégrées protégées, déplacements en jours calendaires et avertissements désactivés. Le raccordement à Java reste un chantier distinct du lot de permissions PZ7.

Effets des réglages :

- L’intégration automatique comptabilise chaque saisie dans les métriques projet, zone, budget et rapport flash. Si elle est désactivée, ces calculs utilisent uniquement les saisies validées individuellement ou couvertes par une date d’intégration. L’historique personnel conserve toutes les saisies.
- Les allocations en jours utilisent les heures par jour de la ressource (8 h sans ressource), sans modifier les heures enregistrées ni les tarifs historiques. Le formulaire de tâche et la colonne Alloué des feuilles de temps affichent cette unité ; passé et restant restent en heures.
- La protection des dates intégrées est contrôlée lors de chaque écriture serveur. La désactiver autorise les saisies dans ces périodes avec les droits habituels. Les validations individuelles exigent toujours une dévalidation distincte.
- L’avancement s’affiche dans les lignes de tâche des feuilles de temps lorsque l’option est active.
- Un déplacement peut conserver la durée ouvrée en prolongeant la période pour traverser les jours non ouvrés de la ressource. Les déplacements successifs n’accumulent pas artificiellement des week-ends. Jalons et périodes projet gardent leurs règles existantes.
- L’auto-affectation est une commande dédiée : ressource connectée, active, tâche ouverte non affectée, projet accessible et modifiable. Elle n’écrase pas l’affectation d’une autre ressource et n’accorde pas de modification aux visiteurs.
- Le lien durée/allocation calcule la capacité ouvrée lors d’une création ou modification des dates ou de la ressource. Il vérifie également le droit de modifier l’allocation.
- Les seuils horaires à 0 désactivent les avertissements. Amplitude et repos utilisent exclusivement les événements avec horaires explicites. La charge journalière additionne la charge planifiée des tâches et les événements horaires. L’indisponibilité se signale quand elle recoupe une tâche affectée. Les avertissements utilisent les données accessibles et les 31 premiers jours du périmètre affiché ; ils ne bloquent pas l’enregistrement.

« Ma synthèse » ajoute quatre compteurs réels, un accès aux tâches terminées, une recherche sur titre/projet/tags, une remise à zéro des filtres et un calendrier conservé à droite. Les surfaces et les couleurs suivent les thèmes clair/sombre ; les week-ends gardent leur teinte chaude.

Vérifications ciblées : comportements de préférences sur SQLite et mémoire, restauration après redémarrage, garde de version/droits, tarifs inchangés, déplacements répétés sans inflation, règles d’horaires, persistance chiffrée D1 et deux scénarios navigateur (enregistrement/unités/avancement, synthèse/recherche/mobile). Les tests d’intégration temporelle existants vérifient la compatibilité des protections par défaut.

## Accès aux vues par rôle global

La section « Vues » propose une sélection multiple pour chaque écran disponible : synthèse, temps et discussions personnels ; annuaire, organigramme, profils, capacité, charge, occupation et CapaPlan ; les cinq pages de personnalisation ; projets de zone ; calendrier, documents et rapports. Un réglage séparé contrôle la création et l’édition des documents. Les rôles proposés proviennent de `viewRoleCatalog` dans la réponse du serveur. Le module publié utilise son catalogue de rôles existant ; ce chantier ne modifie pas les contrats ni le catalogue Java/PZ7 du coordinateur.

`viewRoles` est une matrice optionnelle des préférences. Une ligne absente conserve les accès existants, y compris les délégations historiques d’annuaire/personnalisation. Une liste vide exclut tous les rôles de la vue. Les administrateurs peuvent modifier cette matrice et restent autorisés à ouvrir les paramètres même s’ils ont exclu leur rôle d’autres écrans. Un formulaire antérieur qui n’envoie pas `viewRoles` ne l’efface pas. Les rôles et identifiants de vue inconnus ou les listes de rôles dupliqués sont refusés. L’enregistrement conserve le contrôle `expectedVersion`, sans rejeu automatique.

Les menus et les URL directes appliquent la même règle. Les documents suivent ce réglage dans leur vue globale et projet, leur projection d’API et le téléchargement du contenu ; les écritures de documents et de dossiers le recontrôlent côté serveur. Les actions sur les catalogues de personnalisation, profils, unités et rapports vérifient aussi l’accès à leur vue. Les écrans de profils et personnalisation accordés en lecture n’activent pas les commandes d’administration. La lecture des profils inclut leurs tarifs : sélectionner ce rôle autorise explicitement la lecture du catalogue de coûts.

La matrice ne remplace pas les droits métier des projets ou domaines CapaPlan. Masquer une vue globale de calendrier, de temps ou de synthèse personnelle ne retire pas la lecture de ces informations dans un projet déjà accessible. Les données réutilisées par d’autres écrans restent soumises aux permissions projet. Autoriser une vue n’accorde jamais un projet inaccessible, la gestion des rôles ni la modification d’un tarif.

Contrôles ajoutés : un scénario de permissions/persistance sur SQLite et mémoire, extension du contrôle D1 existant pour la matrice chiffrée, et une recette navigateur administrateur/usager avec lecture autorisée, URL refusées, édition de document refusée et conservation de l’isolation des projets.
