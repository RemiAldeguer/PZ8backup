# Accueil, ordre des zones et fiche tâche

## Disponibilité constatée

Le diagnostic du 14 octobre 2026 a vérifié les réponses de production : HTML et fichiers CSS/JS 200, sonde API 200, session anonyme 200/non connectée et données anonymes 401. La connexion du compte administrateur existant et sa lecture de données réussissent. Le navigateur reproduisait un accueil « Accès réservé », car l’URL racine utilisait encore le projet historique project-nova, supprimé depuis. Cela n’établit pas la cause d’une erreur réseau intermittente signalée par l’utilisateur.

L’accueil utilise désormais Ma synthèse, sans identifiant de projet historique. Après une erreur initiale de session ou de données, un retour en ligne ou une reprise de focus relance la lecture. Les lectures initiales ont un délai maximal de 20 secondes ; les boutons Réessayer restent présents. Aucune mutation n’est renvoyée automatiquement.

## Ordre des zones

Le bouton Organiser les zones, près de + zone dans la sidebar, ouvre la liste complète. Glisser-déposer avant/après une ligne ou utiliser Monter/Descendre, puis Enregistrer l’ordre. L’ordre est partagé dans la Planzone et conservé après rechargement.

POST /api/zone-order accepte `{zoneIds:string[]}`, réservé aux administrateurs. La liste doit être unique et contenir exactement les zones actuelles ; un ajout/retrait depuis l’ouverture du dialogue provoque un conflit 409. L’écriture de leurs positions est atomique. Les anciennes zones sans position gardent leur ordre existant ; une nouvelle zone s’ajoute en fin de liste. Les projets, leurs données et les appartenances restent inchangés.

## Fiche tâche

Le composant se trouve dans src/tasks/TaskDetailDialog.tsx, exporté sous le chemin existant Dialogs.TaskDialog. La modale étendue affiche le chemin projet/liste/tâche, les métadonnées, tags, description avec mise en forme sûre, ressource affectée/allocation/temps visibles, champs personnalisés et documents du projet à gauche. Dates et discussion occupent la colonne de droite ; les deux parties défilent séparément sur grand écran et s’empilent sur mobile.

La tâche conserve son modèle à une ressource affectée. Les temps affichés pour cette ligne sont ceux de cette ressource, avec le total des temps visibles en en-tête. Les documents restent liés au projet : l’interface ne les présente pas comme pièces jointes propres à la tâche. La description utilise l’éditeur existant et son aperçu React, sans HTML arbitraire. Les contrôles de rôle et de projet clos restent appliqués ; description et dates sont en lecture seule pour l’observateur.

## Vérification ciblée

API : tests/zone-order.test.ts et tests/zone-api.test.ts (SQLite, MemoryStore, HTTP et Worker/D1). Navigateur : tests/browser/workspace-updates.spec.ts (retour après erreurs simulées, accueil sans projet historique, flèches/glisser-déposer/persistance) et tests/browser/task-detail-layout.spec.ts (enregistrement, commentaires, mobile et lecture seule). TypeScript et bundle vérifiés. La recette de production ouvre les nouveaux écrans sans mutation métier et compare les espaces chiffrés avant/après publication. Ces preuves concernent le prototype, pas le chantier Java/PZ7.
