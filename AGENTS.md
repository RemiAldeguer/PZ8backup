# Travail sur Planzone 8

La direction technique validée est décrite dans docs/superpowers/specs/2026-10-13-planzone8-design.md. Le plan actif est docs/superpowers/plans/2026-10-13-planzone8-implementation.md. Correction utilisateur du 13 octobre 2026 : PZ7 est la référence fonctionnelle 1 pour 1 ; le prototype PZ8 ne définit pas le périmètre ni les règles de parité. Java est une décision utilisateur pour l’équipe actuelle. Ne pas réintroduire NestJS.

## Architecture et métier

- Un client possède UNE Planzone ; une Planzone contient des zones ; une zone contient des projets.
- PZ8 démarre indépendamment. Une migration PZ7 est un futur chantier, pas une hypothèse du développement initial.
- Conserver les fonctions, concepts métier et parcours de PZ7. L'indépendance du produit ne permet pas de réduire la couverture fonctionnelle. Chaque tranche doit relier sources PZ7, scénarios observables et preuves de réception ; une liste de fichiers n'est pas une preuve de parité.
- Supprimer le microservice utilisateur métier et unifier utilisateurs/ressources dans un module interne. Préserver ressources humaines, virtuelles et matérielles, comptes facultatifs, profils locaux par Planzone et historiques. Une identité de connexion globale ne doit pas devenir une ressource globale partagée entre clients.
- Le catalogue docs/refoundation/2026-10-13-pz7-parity-baseline.md précise les preuves et lacunes. Ne pas figer schéma métier ou droits tant que leurs règles PZ7 n'ont pas été qualifiées. Les rôles minimaux du socle Java ne prouvent pas la couverture des permissions PZ7.
- Mettre à jour docs/refoundation/functional-coverage.json après chaque tranche : distinguer code backend testé, API HTTP, parcours navigateur et comparaison exécutée avec PZ7. Ne jamais déclarer une famille complète parce qu’un sous-ensemble de ses scénarios passe.
- Backend Java/Spring modulaire, PostgreSQL ; frontend React/TypeScript. Domaine indépendant de HTTP et de la persistance.
- API publiques de modules petites, dépendances autorisées et sans cycles ; pas de services géants, repositories génériques ou dossier shared fourre-tout.
- Préserver les invariants de temps, tarifs historiques, capacité, planning, fermeture et confidentialité. Recenser toute différence volontaire avant de la traiter comme acquise.
- Les unités organisationnelles et les zones sont des concepts distincts. Recenser leurs restrictions PZ7 ; ne pas inventer de rôles ni supprimer une restriction existante sans preuve et décision explicite.
- Toutes les entrées clientes, y compris jobs et exports, passent par un contexte autorisé. RLS complète les droits, elle ne les remplace pas.
- Aucune identité de démonstration ou contournement de sécurité dans une API déployable. Ne jamais lier l’autorité à un identifiant fixe.

## Collaboration et consommation

- Le coordinateur attribue les fichiers et contrats avant délégation. Un seul agent écrit un fichier à la fois.
- Utiliser des paquets de contexte courts, sans historique complet lorsque la tâche est indépendante.
- Sol en effort moyen pour le code courant, Sol élevé pour transactions/autorisation, Luna pour tâches bornées ; renforcer le modèle seulement si un risque ou blocage concret le justifie.
- Pas de délégation récursive, de recherches parallèles identiques ou de multiplication des revues sans raison.
- Rapporter fichiers, comportement livré, contrôles effectivement exécutés et limites. Ne pas copier de gros journaux.
- L’agent intégrateur décide des changements transversaux, relit les différences et exécute la vérification finale.
- Ne pas écraser les modifications d’un autre agent ou de l’utilisateur. Les changements cloud conservés doivent être réconciliés avant de toucher leurs fichiers.

## Qualité et vérification

- Respecter la politique utilisateur : chaque test protège un comportement observable ou une régression réelle.
- Tester isolation, refus, limites, rollback, concurrence et écritures incertaines sur le moteur réel lorsque la garantie dépend de PostgreSQL.
- Un test mocké, H2 ou le nombre de tests ne démontre pas RLS ni une transaction réelle.
- Aucun test utile désactivé pour rendre le build vert ; aucune intégration silencieusement ignorée si une dépendance manque.
- Vérifier compilation, style, contrats et tests pertinents après modification. Ne répéter une suite inchangée qu’en cas de besoin identifié.
- Garder les logs sans secrets ; séparer rôles de migration et d’application ; verrouiller versions et dépendances.
- Aucune commande préfixée par rtk. Les éventuels fichiers sources/ synchronisés restent en lecture seule.
