# Site vitrine de Planzone 8

Site public : **https://planzone8-site.aldeguer-remi.workers.dev/**.

La page présente Planzone 8 et conduit à l’application existante : `https://planzone8-demo.aldeguer-remi.workers.dev/`. Le logo est le PNG original fourni par l’utilisateur. Les aperçus du produit utilisent exclusivement des données fictives.

Les fichiers autonomes sont dans `public/site/`. La vitrine comprend 19 pages : accueil, fonctionnalités (six pages détaillées), usages (trois rôles), guides (trois articles pratiques), FAQ de 22 questions, présentation et découverte de l’application. Elle ne charge ni session ni données métier. Les interactions concernent le menu mobile, les aperçus Gantt/Tableau/Budget, la navigation, la recherche de guides et les questions fréquentes.

Le contenu original est défini dans `scripts/site-content.mjs` et le modèle de l’accueil dans `scripts/site-home.template.html`. La plaquette de présentation Planzone fournie par l’utilisateur a servi de référence éditoriale ; l’accès direct à Planzone.fr était bloqué dans l’environnement de travail. Les textes décrivent les fonctions existantes de la démonstration, sans inventer de tarifs, de références clients ou d’engagements d’hébergement.

Générer les pages, le manifeste des routes et le sitemap avant publication :

```sh
node scripts/build-site.mjs
```

Pour une prévisualisation locale, depuis la racine du dépôt :

```sh
python3 -m http.server 4190 --bind 127.0.0.1 --directory public
```

Ouvrir `http://127.0.0.1:4190/site/` sur la machine qui exécute le serveur.

La publication statique utilise un service distinct, `planzone8-site`, avec une liste fermée de 24 fichiers publics et sans binding de base de données ou de secret. Les routes supplémentaires proviennent du manifeste généré et sont validées avant lecture. Le script refuse de remplacer un service existant qui n’est pas identifié comme cette vitrine. Il vérifie les empreintes des fichiers publiés et contrôle que le déploiement de l’application n’a pas changé. Le reçu est conservé dans `.cloudflare/site-deployment.json`, ignoré par Git.

```sh
node --use-env-proxy scripts/deploy-site.mjs
```

Les variables `CLOUDFLARE_ACCOUNT_ID` et `CLOUDFLARE_API_TOKEN` doivent être fournies par l’environnement. Elles ne sont pas intégrées aux fichiers publics. Les fichiers peuvent également être servis par un hébergement statique classique ; le choix d’hébergement du futur backend PZ8 reste indépendant de cette vitrine.

Ce site ne crée pas de comptes ou de Planzones. Le circuit de demande et de validation par superadministrateur reste un chantier distinct.
