# Validation de la première tranche people

Date : 14 octobre 2026. Première implémentation backend du [contrat utilisateurs/ressources](2026-10-14-people-contract.md), dans l’objectif de couverture fonctionnelle PZ7. Le [suivi de couverture](functional-coverage.json) distingue les scénarios implémentés du reste du catalogue.

## Résultat livré

Le module Java people crée des ressources virtuelles et matérielles sans compte, enregistre le profil humain d’un membre déjà actif dans la Planzone, consulte les profils, parcourt une liste filtrée et paginée, et renomme avec contrôle de version. Les doublons de nom sont permis conformément au code PZ7 inspecté. Une même identité peut avoir deux profils indépendants chez deux clients.

La migration 002 ajoute ressources, reçus d’opérations et audit. Une création rejouée avec la même clé et les mêmes données normalisées retourne le profil courant ; une clé réutilisée avec des données différentes est refusée. La portée inclut client, acteur et type d’opération. Les échecs ne laissent pas de reçu ni de profil partiel. Le journal d’audit ne peut être modifié ou supprimé par le runtime.

Le module utilise la transaction et les verrous d’autorité du socle existant. Les tables appliquent RLS, les profils humains référencent une adhésion du même client et leur unicité est imposée en base. Les privilèges SQL de mise à jour du profil sont limités au nom, à la version et à la date de modification. Aucun service utilisateur distant ni dépendance supplémentaire n’est ajouté.

## Contrôles exécutés

Environnement : Windows, Microsoft OpenJDK 21.0.10, Gradle Wrapper 9.2.0, Docker Engine 27.5.1 et PostgreSQL 18 dans des conteneurs temporaires. Les tests utilisent un rôle applicatif réel sans privilèges de propriétaire ni contournement RLS.

Commande exécutée depuis backend :

```powershell
.\gradlew.bat --no-daemon --console=plain spotlessApply check :core:integrationTest :api:bootJar :jobs:bootJar
```

Résultat : BUILD SUCCESSFUL. Compilation, format, contrôles de frontières, intégrations et construction des deux exécutables réussis.

| Suite | Résultat | Horodatage du rapport UTC |
|---|---|---|
| PeopleIntegrationTest | 13 scénarios réussis | 2026-10-14T08:42:24.752Z |
| PlanzoneIsolationTest | 8 scénarios réussis | 2026-10-14T08:42:29.318Z |
| ArchitectureTest | 2 contrôles réussis, people inclus dans la frontière de domaine | 2026-10-14T08:42:14.826Z |
| ApiAccessBoundaryTest | 2 contrôles réussis ; API métier toujours fermée | 2026-10-14T08:42:18.431Z |

Total : 25 tests/contrôles, aucune erreur, aucun échec et aucun test ignoré. Ce total décrit l’exécution ; il ne mesure pas la couverture de PZ7.

Les scénarios people vérifient des résultats observables : profils locaux et identité commune ; refus indistinct d’une identité étrangère, inconnue, inactive ou révoquée ; unicité sous concurrence ; invisibilité et refus SQL entre clients ; absence de contexte et accès non administrateur ; pagination avec noms identiques et caractères littéraux ; rejeu simultané ; portée des clés et isolation des reçus entre acteurs ; refus de modification obsolète ; annulation sur erreur d’audit injectée ; intégrité du journal ; limites de validation ; utilisation d’une session hors transaction ou depuis un autre thread.

## Revue et limites

Un agent Sol a qualifié le contrat PZ7 ; un agent Sol a implémenté le module et un autre ses scénarios PostgreSQL. Une revue Astra ciblée a examiné isolation, liaisons d’identité, concurrence, reçus, audit et fonctions SQL à privilèges limités. Aucun défaut bloquant concret identifié ; l’agent principal a relu et exécuté la vérification finale. Cette revue ne constitue pas un audit exhaustif du produit.

Les cas d’usage sont internes et réservés aux administrateurs. Ils ne sont pas encore reliés à l’interface et ne constituent pas une API métier publique. Connexion OIDC, invitations, permissions PZ7 complètes, désactivation avec propagation projet, coûts et autres fonctions de ressources restent à implémenter. L’enregistrement d’un profil humain existant n’est pas une validation du parcours complet de création de compte.

Aucun test PZ7 ni benchmark différentiel n’a été exécuté. La correspondance repose sur le contrat sourcé et les scénarios PZ8 vérifiés, sans déclaration de parité globale. Aucun gain de performance chiffré n’est revendiqué.

Les fichiers frontend et les changements conservés dans l’autre chat n’ont pas été modifiés. Leur suite inchangée n’a pas été relancée. Aucun commit, push ni déploiement effectué pour cette tranche.
