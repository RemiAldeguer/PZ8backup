# Projets non planifiés et imports

Les projets du prototype peuvent conserver des dates de début et de fin nulles. Un import ne doit pas remplacer une date absente par la date d’import. La vue Gantt utilise une période d’affichage bornée sans créer de barre ni modifier le projet ; la synthèse signale les dates à renseigner. Une modification de nom conserve les dates vides. Une météo égale à zéro signifie non renseignée et est exclue de la moyenne des projets.

Les modèles sans dates peuvent être créés sans ancrage. Un modèle avec des éléments datés exige une date de début à la création ; le refus annule toute la transaction. Sauvegarder un projet non planifié en modèle utilise la première date réellement présente dans ses éléments lorsqu’il en contient.

Pour les imports de classeurs : préserver les enregistrements existants, utiliser des identifiants stables, conserver les affectations multiples et les valeurs brutes non représentables, vérifier les références et les pièces originales. Les agrégats d’un rapport ne permettent pas de reconstruire des saisies de temps, tarifs historiques ou dépenses ventilées. Les fichiers fournis et les snapshots privés ne doivent pas entrer dans les assets web ou le dépôt.

Le chargement administratif ponctuel prépare et valide un snapshot avec le service métier existant avant une écriture chiffrée protégée par la révision du workspace et le contexte de compte. Une sauvegarde chiffrée précède cette écriture ; les autres espaces et les comptes sont contrôlés après. Cela ne définit pas l’import ou la migration PZ7 du socle Java.

Vérifications du 14 octobre 2026 : TypeScript/Vite ; scénario API non planifié, édition et modèles avec rollback ; contrôles Gantt/synthèse de zone affectés ; recette navigateur de renommage sans invention de dates et Gantt sans barre. Les fichiers métier issus des exports restent privés.
