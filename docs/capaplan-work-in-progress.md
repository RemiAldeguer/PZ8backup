# État conservé du module CapaPlan

> Mise à jour du 14 octobre 2026 : l’utilisateur a autorisé la publication des changements locaux. Le module initial est repris avec les corrections et vérifications décrites dans [le compte rendu de publication](release-2026-10-14.md). Ce document conserve l’état et les limites constatés lors de la sauvegarde initiale ; il ne constitue pas une validation exhaustive des spécifications.

Cette branche conserve le travail commencé avant le passage au cadrage « Ajouter ce chat au projet ». Elle sert à la revue et à la reprise du code. Le module CapaPlan est **en cours de développement**, sans validation fonctionnelle complète et sans déploiement sur l'application publique.

## Code présent

- Modèle partagé : domaines, compétences, rattachements, contrats externes, réservations Run/Autres, demandes mensuelles, affectations, photos au Go et journal des actions.
- API de commandes avec validation des entrées et contrôles des rôles administrateur, PMO, manager de domaine et chef de projet.
- Stockage additif compatible avec les espaces existants, sans réinitialisation des données ; adaptateurs SQLite et D1 conservés.
- Vues Ressources, Domaines, Projets, Non affecté, Compétences et Journal, avec un accès dans Gestion et un panneau de consultation dans la synthèse projet.
- Ajustement conservé du script Cloudflare : nouvelles tentatives bornées pour certains rejets explicites et certaines requêtes D1 idempotentes. Ce script décrit l'exploitation de la démonstration existante, pas le choix d'hébergement du futur produit.

## Vérifications encore nécessaires

Le 13 octobre 2026, `npm run build` et `npx tsc --noEmit` ont réussi, ainsi que les **364 tests existants** de `npm test`. Deux jeux de données de tests D1 ont été actualisés pour utiliser les clés synthétiques et le chiffrement déjà requis par le backend. Ces vérifications ne remplacent pas une recette spécifique de CapaPlan ; les tests navigateur n'ont pas été rejoués pour cette sauvegarde.

Avant toute activation en production, il reste notamment à vérifier et corriger :

- les périmètres de lecture du journal et du catalogue de projets/ressources pour chaque rôle ;
- les ressources absentes ou masquées dans les calculs de temps consommé ;
- le regroupement des besoins multiples d'une même personne dans la recherche d'une fenêtre commune ;
- la cohérence des références métier à l'import d'un état enregistré ;
- l'horizon des demandes non affectées, les bornes temporelles et les règles de reconduction ;
- les classifications du travail hors projet et les règles de remplacement des anciennes allocations ;
- les parcours d'affectation, leurs refus, la persistance et les calculs sans double comptage, avec des tests spécifiques.

Les paramètres et comportements présents ne constituent pas une validation des arbitrages ouverts dans les spécifications fournies.

## Suite à cadrer

Le périmètre confirmé est un produit indépendant de PZ7, destiné à plusieurs organisations clientes isolées, avec une architecture portable et un hébergement choisi ultérieurement. La migration de PZ7 sera étudiée séparément. La proposition technique du chat de cadrage reste à valider ; cette branche ne fige ni PostgreSQL ni une nouvelle architecture serveur.

Les demandes suivantes restent à implémenter après ce cadrage : fin de CapaPlan et amélioration des gestes du Gantt, connexion/import Outlook et Google Agenda avec guide OAuth, compte superadministrateur, site vitrine et approbation des demandes de création d'espaces. Aucun compte superadministrateur ni raccordement OAuth réel n'est créé par cette sauvegarde.

Les bases, comptes, clés de chiffrement, jetons, reçus et copies de récupération privés restent exclus de Git. Aucune nouvelle publication de l'application en ligne n'est effectuée par l'enregistrement de cette branche.
