# Validation de la tranche connexion, invitations et permissions

Validation locale terminée le 14 octobre 2026. Le [contrat](2026-10-14-access-contract.md) précise les sources PZ7, comportements et différences de sécurité. Le [suivi fonctionnel](functional-coverage.json) reste partiel : aucun nombre de tests ne représente un pourcentage de parité.

## Résultats exécutés

| Vérification | Résultat | Garantie observée |
|---|---|---|
| PostgreSQL 18, Liquibase et logins restreints | 42 scénarios réussis, aucun ignoré | Ressources sans compte, profils locaux, frontières client, rollback/audit, concurrence, versions, rôles/champs, invitations et baux mail |
| HTTP avec fournisseur OIDC de test signé et deux instances API | 6 scénarios réussis | Signature/issuer/audience/nonce/state/PKCE, cookies et sessions partagées, CSRF, réponses API, acceptation/refus et révocation |
| API ordinaire et architecture | 3 contrôles API et 2 contrôles d’architecture réussis | API fermée par défaut, cookie Secure en HTTPS même avec IdP local autorisé, domaine indépendant et absence de cycle de modules |
| Dialogue SMTP loopback | 3 scénarios réussis | Messages français/anglais réellement transmis, refus SMTP et confirmation SQL incertaine |
| UI isolée avec fixtures HTTP | 25 scénarios réussis | Changement de client et réponses tardives, curseurs, refus, conflits, reprise explicite, invitation, restrictions, session et clavier/mobile |
| Entrée réelle `src/main.tsx` → Vite → Java → PostgreSQL/OIDC | Un seul scénario de réception réussi en 14,1 secondes | Connexion et callback réels, création/renommage persistants, invitation/acceptation, mise à jour de permissions et déconnexion |
| TypeScript et bundle de production | Réussite | Contrats compilés et écrans d’accès chargés séparément des anciens écrans |
| Exécutables API/jobs et style Java | Réussite | JARs construits, format et frontières vérifiés |

Les 56 contrôles Java comprennent les tests du socle précédemment livré ; ils n’ont pas été ajoutés pour obtenir ce nombre. La suite essentielle complète a été exécutée après les derniers correctifs métier en 46 secondes. Après la précision utilisateur sur les tests, la fin de réception s’est limitée au parcours navigateur pertinent et à la compilation, sans nouvelle suite étendue.

La recette réelle utilise deux contextes de navigateur distincts. L’administrateur se connecte sur la page du fournisseur de test, crée une ressource virtuelle avec un nom de 256 caractères, recharge pour vérifier la persistance puis la renomme. Il invite un membre ; celui-ci ouvre successivement les deux chemins de prévisualisation, se connecte et accepte. Le token disparaît de l’URL et la nouvelle Planzone devient accessible. Le rôle est ensuite changé en visiteur depuis l’interface, avec une restriction de champ ; au rechargement, les ressources disparaissent et les droits sont refusés. La déconnexion rend `/session` inaccessible.

Aucune réponse API ou donnée métier n’est substituée dans cette recette. Le fournisseur est une fixture HTTP signant ses jetons et vérifiant le code/PKCE ; ses comptes restent exclusivement dans les sources de test. Le lien mail est récupéré par le rôle mail restreint de la fixture, depuis l’outbox chiffrée. Cette recette ne prétend pas inclure un service SMTP commercial : le dialogue SMTP est vérifié séparément.

## Reproduire les contrôles nécessaires

Depuis `backend`, avec JDK 21 et Docker Linux disponible :

```powershell
.\gradlew.bat check :core:integrationTest :api:integrationTest :api:bootJar :jobs:bootJar
```

Depuis la racine, avec les dépendances du lockfile et Chrome/Chromium installé :

```powershell
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run build
npm run test:e2e:access
```

Choisir les contrôles selon la modification. Un texte ou un style à faible impact n’exige pas une nouvelle recette PostgreSQL/OIDC. Une modification d’autorisation, transaction ou invitation exige les tests concernés ; ne pas recopier ces comportements dans une seconde suite de tests de mocks.

Pour le seul parcours complet, utiliser une fixture **neuve** par exécution. Dans un premier terminal situé dans `backend` :

```powershell
$env:PZ8_BROWSER_FIXTURE_FILE = Join-Path (Split-Path -Parent (Get-Location)) '.access-acceptance.json'
.\gradlew.bat :api:browserAcceptanceFixture
```

Attendre le message de disponibilité du manifeste. Dans un second terminal situé à la racine :

```powershell
$env:PZ8_BROWSER_FIXTURE_FILE = Join-Path (Get-Location) '.access-acceptance.json'
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e:access:java
```

La configuration démarre Vite sur `127.0.0.1:3000`, avec proxy vers l’API éphémère. Après la recette, fermer proprement la fixture :

```powershell
$fixtureState = Get-Content -Raw .access-acceptance.json | ConvertFrom-Json
Invoke-WebRequest -Uri ($fixtureState.controlUrl + '/shutdown') -Method Post
```

Cette commande est limitée au serveur de contrôle de test loopback, absent du produit. Elle ferme API, IdP, pools, rôles temporaires et conteneur, puis supprime le manifeste. L’environnement de la recette exécutée a été fermé avec succès. Les anciennes données de démonstration et les données métier existantes n’ont pas été utilisées.

## Intégration et limites

Le lot UI de l’autre chat `Planzone 8`, commit `bf03650a32c91c9170fd03df2ef7ecb98534b7b4` sur `parallel/pz7-access-ui`, a été récupéré uniquement pour ses fichiers attribués. Ses autres travaux ne sont pas écrasés. Le coordinateur a intégré les entrées, proxy et contrats, puis exécuté la réception. Les instructions de coordination et la règle de tests strictement utiles ont été transmises à cet autre chat.

Les règles PZ7 proviennent d’une lecture statique au commit qualifié. Aucune comparaison différentielle contre PZ7 déployé, aucun test de charge ni recette avec fournisseur OIDC/SMTP d’hébergement ne sont déclarés réussis. Le backend de référence UAA reste inaccessible. La famille comptes/invitations et la famille ressources restent partielles, avec leurs éléments restants nommés dans le suivi.

Le build signale encore un gros chunk des anciens écrans, chargé séparément de l’entrée d’accès. Il ne mesure ni saturation serveur ni scalabilité. Provisionnement initial, autres permissions et domaines, exploitation, rotation des secrets et migration ultérieure des données restent des lots distincts. Aucun déploiement n’a été réalisé.
