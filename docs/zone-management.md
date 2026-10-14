# Édition et suppression des zones du prototype

Le menu « Actions de la zone » (⋯) est disponible pour les administrateurs dans la sidebar et dans la navigation des vues Projets, Liste et Gantt de la zone.

L’édition modifie le nom et la couleur en conservant l’identifiant et les projets. La suppression est possible même si la zone contient des projets, y compris clos. L’avertissement liste les projets concernés et explique que leurs listes, tâches, jalons, temps (même validés), documents, discussions, dépenses, recettes, rapports, demandes et affectations CapaPlan seront supprimés. Le bouton reste désactivé tant que la case de confirmation n’est pas cochée.

Le corps JSON de `DELETE /api/zones/:id` doit contenir `{deleteProjects:true,expectedProjectIds:string[]}` pour une suppression en cascade. Une ancienne requête sans corps ne peut supprimer qu’une zone vide. Le serveur contrôle la liste exacte des projets dans la transaction : un ajout, déplacement ou retrait intervenu depuis l’ouverture de la confirmation provoque un refus HTTP 409 et impose une nouvelle revue après rechargement. Les utilisateurs non administrateurs reçoivent un refus 403.

La suppression retire les dépendances avant leurs cibles, puis les projets et la zone. Les ressources et comptes, profils, indisponibilités, unités organisationnelles, catalogues et projets des autres zones sont conservés. Seules les références `Resource.zoneIds` et `Resource.projectIds` concernées sont retirées. CapaPlan conserve ses configurations et son audit, mais supprime les demandes, affectations et baselines des projets supprimés. Toute erreur provoque le rollback de l’ensemble, y compris la suppression finale de la zone. Supprimer la zone ou le projet actuellement ouvert renvoie vers tous les projets.

Cette évolution concerne le prototype existant ; elle ne qualifie pas le cycle de vie PZ7 du chantier Java séparé.

Vérifications ciblées : `tsx --test tests/zone-api.test.ts tests/zone-cascade.test.ts` (SQLite, MemoryStore, HTTP, Worker/D1 et rollback), `playwright test tests/browser/zone-actions.spec.ts`, `npm run build`. La recette de production ouvre les menus et modales sans mutation métier et compare les espaces chiffrés avant/après publication.
