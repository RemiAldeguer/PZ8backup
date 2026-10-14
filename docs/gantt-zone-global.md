# Gantt de zone et global

Les routes `#zones/:zoneId/gantt` et `#projects/gantt` utilisent le même composant que le Gantt d’un projet. Les vues Liste de zone restent inchangées.

Fonctions communes :

- listes imbriquées et ordre manuel du projet ; repli par niveau ou de toutes les listes ;
- recherche et filtres par responsable, statut et type, avec sélection supplémentaire de zone et de projet ;
- zoom de 25 à 400 %, périodes mensuelle, trimestrielle, annuelle ou de tous les projets, accès à aujourd’hui ;
- déplacement de barres, modification du début et de la fin, aperçu pendant le geste, édition au clavier et par formulaire ;
- contraintes fin → début par liaison des barres ou par formulaire, avec consultation et suppression des liens ;
- détails configurables : dates, durée, alloué, passé, restant, avancement, tags, responsables et champs personnalisés ;
- création ciblée de listes, sous-listes, tâches et jalons.

Chaque ligne conserve son projet. Les droits et le verrouillage sont vérifiés pour ce projet, avant l’affichage des commandes et avant chaque modification. Deux anciennes phases de même nom dans des projets différents ont des clés de repli distinctes. Les contraintes restent internes à un projet et conservent les contrôles de cycles ; leur création ne déplace pas automatiquement les dates.

Les colonnes et l’ouverture du panneau Détails sont conservées par utilisateur et par vue dans le navigateur : projet, zone ou global. Le menu « Créer dans » indique le projet choisi pour les actions de la barre d’outils. Les menus des lignes ciblent directement le projet de leur ligne.

## Vérification et publication

Les tests navigateur couvrent les gestes, la synchronisation avec Liste, les colonnes, les jalons, la création dans le deuxième projet, les droits différents dans une même vue et la navigation mobile. Les tests de domaine couvrent notamment le repli indépendant des phases homonymes, les dates civiles et les contraintes.

La publication de cette évolution est limitée au frontend. L’artefact a été construit depuis `d17227f`, avec les changements du Gantt et de marque appliqués ; les travaux CapaPlan en attente de validation ne sont pas inclus. Le script `scripts/deploy-frontend.mjs` exige une empreinte du backend actif, récupère ses modules sans les modifier et conserve les bindings, y compris les secrets. Il n’exécute aucune migration ou requête de données. Les assets sont vérifiés après publication et le reçu privé est dans `.cloudflare/frontend-deployment.json` (ignoré par Git).

```sh
PLANZONE_EXPECTED_BACKEND_HASH='<empreinte vérifiée des modules actifs>' \
  node --use-env-proxy scripts/deploy-frontend.mjs /chemin/vers/artefact/dist
```

L’architecture Java validée pour la refonte reste un chantier séparé.
