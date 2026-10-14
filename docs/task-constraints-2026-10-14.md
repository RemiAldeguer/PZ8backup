# Contraintes de planning du prototype — 14 octobre 2026

## Comportement livré

Le formulaire fin → début propose une relation exacte, au plus tôt ou au plus tard, un décalage entier en jours ou semaines calendaires, avant/après, et l’activation de la replanification automatique. Les dates sont civiles et inclusives : zéro jour après une fin signifie le lendemain.

L’enregistrement du lien aligne le successeur si nécessaire. Un déplacement direct ou un redimensionnement, depuis le Gantt ou l’éditeur de tâche, ancre la tâche modifiée et réconcilie ses prédécesseurs, puis ses successeurs et branches liées. Les autres éléments conservent leur durée ; la préférence de calendrier de travail préserve leur durée ouvrée lorsqu’elle est activée. Les jalons restent des points. L’aperçu graphique montre la cascade avant le relâchement.

Le plan est calculé sans écriture, chaque élément déplacé est autorisé et validé, puis l’ensemble est enregistré dans la transaction existante. Une erreur de droit, de calendrier, de plage de dates ou de cycle annule toute la commande. D1 enregistre la cascade dans une seule révision du snapshot chiffré.

Les temps saisis, tarifs historiques, tags et appartenances aux listes sont conservés. Les paramètres des contraintes suivent les modèles de projet et leurs identifiants de prédécesseurs sont remappés à la création.

## Compatibilité et limites

- Une tâche conserve un seul prédécesseur, dans son projet. Les cycles sont interdits.
- Les anciennes dépendances gardent leur contrôle de démarrage et ne déplacent aucune date. Enregistrer les nouveaux paramètres les convertit explicitement en contraintes de planning.
- Désactiver la replanification garde le lien sans déplacement automatique. Les éléments sans dates/durée suffisantes attendent leur renseignement.
- Les heures ne sont pas proposées : le modèle de tâche utilise des dates civiles. Le décalage est borné à 36 500 unités ; toute date calculée doit rester entre 0001 et 9999. Le calendrier ouvré conserve ses bornes de calcul.
- Ce changement concerne le prototype publié. Il ne qualifie ni ne modifie le contrat de refondation Java/PZ7.

## Vérifications exécutées

- TypeScript et bundle Vite : passent.
- Quatre scénarios API SQLite/Memory : paramètres, chaîne et branches dans les deux sens, bornes, refus/rollback, durées ouvrées, historiques et modèles.
- Douze contrôles existants Gantt/préférences : passent.
- Un scénario Worker/D1 : cascade en une révision chiffrée, refus de cycle sans écriture, persistance après redémarrage.
- Trois scénarios navigateur ciblés : liaison/cycle/suppression ; clavier/remplacement/sans date/verrouillage ; formulaire/déplacement/redimensionnement/Liste, avec captures desktop, sombre et mobile. Ils passent ; la dernière recette du nouveau formulaire dure 17,2 secondes.

Aucune suite générale, mesure de charge ou comparaison runtime PZ7 n’est déclarée.
