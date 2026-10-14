# Connexion OIDC sur planzone8.codex.f10web.com

Le site est publié derrière nginx et le service local `server/oidc-gateway.ts` (`deploy/planzone8-oidc.service`). nginx transmet **toutes** les requêtes d'assets à la passerelle : un navigateur sans session est redirigé vers l'autorisation CAS (puis `/cas/login` si nécessaire). Le callback `/auth/callback` échange le code contre un access token, vérifie la signature et les attributs du jeton d'identité ainsi que le profil CAS, et revient à la racine. Avec une session encore valide, les requêtes restent sur Planzone et ne consultent pas CAS. Le token d'accès est uniquement dans un cookie chiffré `HttpOnly`, `Secure`, `SameSite=Lax`, limité à une heure et à son expiration OIDC ; les données SQLite du navigateur ne sont pas envoyées à CAS.

Le registre CAS est préparé depuis `components/cas/deploy/planzone8-oidc-client.json.template` sur la branche `feat/planzone8-oidc-client` du dépôt `/home/planzone/src/augeo-software/planzone/components/cas` (le chemin `/home/planzone/src/augeo-software/components/cas` n'existe pas sur cette machine). Le fichier de service JSON généré contient un secret et reste ignoré par Git. L'ID client est `planzone8-codex` ; l'URI de retour enregistrée est exactement `https://planzone8.codex.f10web.com/auth/callback`. Le flux utilise `authorization_code`, PKCE `S256`, `RS256` et `openid profile email`.

Le fichier **privé** `env.cas.local` à la racine de Planzone8 (mode 0600, ignoré par Git) porte `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` et `OIDC_COOKIE_KEY` (32 octets aléatoires en hexadécimal). Ne pas copier ces valeurs dans un commit, des logs ou les assets publics. Pour régénérer le registre CAS depuis ce fichier :

```bash
python3 /home/planzone/src/augeo-software/planzone/components/cas/deploy/register-planzone8-client.py --env-file env.cas.local
```

Recompiler puis redémarrer CAS pour charger le client ; démarrer `planzone8-oidc.service` ; installer `deploy/nginx-planzone8-static.conf` dans le vhost nginx existant après `nginx -t`. Ne jamais republier `dist/` directement par nginx, ce qui contournerait la protection. `npm run build` et les tests ne prouvent pas à eux seuls qu'un compte réel peut se connecter : ce parcours requiert un essai navigateur avec un compte CAS valide.

La route `GET /api/planzones/current` est la seule exception à l'ancienne règle nginx qui refuse `/api/*` : le relais prend le token du cookie chiffré, interroge `https://core.codex.f10web.com/api/planzones/current` avec `Authorization: Bearer`, et renvoie seulement `name` et `uuid` (jamais le token ni la réponse métier complète). La page d'import SQLite affiche le nom courant ; les identifiants `PLANZONE_LOGIN` et `PLANZONE_PASSWORD` du `.env` local ne sont utilisés que pour les vérifications de connexion, jamais servis au navigateur. Le service CAS enregistré émet un access token JWT (`jwtAccessToken: true`), nécessaire pour l'API core.

Le Worker Cloudflare `cloudflare/oidc.ts` reste une variante de déploiement, mais **n'est pas nécessaire pour ce domaine**, qui utilise le relais nginx local.
