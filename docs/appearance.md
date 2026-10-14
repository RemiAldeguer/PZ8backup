# Apparence de l’application

Inter Variable est servie localement depuis `public/fonts`, avec sa licence SIL OFL. Les textes secondaires restent contrastés ; les bordures sont discrètes et les cartes se détachent par leur surface et une ombre légère. Aucun service de polices tiers n’est appelé par le navigateur.

Le sélecteur « Thème de l’application » propose Automatique, Clair et Sombre dans la barre supérieure et à la connexion. Automatique suit `prefers-color-scheme`, y compris lors d’un changement en cours de session. Le choix est enregistré sous `planzone8-theme` ; si le stockage est bloqué, il fonctionne pour la visite actuelle. Les changements sont synchronisés entre onglets. Cette préférence ne contient aucune donnée client.

`src/theme/theme.ts` décrit le choix et sa résolution sans dépendance navigateur. `browser-theme.ts` adapte le stockage, le système et le document. `ThemeControl.tsx` est la présentation React. `main.tsx` initialise le thème avant le montage de l’interface.

Les nouvelles vues doivent utiliser les variables sémantiques de `theme.css` : `--canvas`, `--surface`, `--surface-subtle`, `--surface-muted`, `--ink`, `--muted`, `--border`, `--action-bg`, `--action-text`. Le thème sombre conserve les couleurs d’identité des ressources et adapte les surfaces, formulaires, fenêtres, tableaux et Gantt. Le mode impression utilise une palette claire.

Les séparations décoratives utilisent `--separator` et les cartes `--card-shadow`, sans cadre gris. Les week-ends partagent `--weekend-surface` et `--weekend-ink` : pêche claire en mode clair, teinte chaude en mode sombre. Le calendrier personnel, les calendriers projet/global et les suivis temporels utilisent la même palette. Le repère d’aujourd’hui reste prioritaire et les états métier conservent leurs couleurs.

Les vues existantes gardent leurs feuilles de style. L’adaptateur `legacy-theme.css` est généré à partir de ces feuilles ; ne pas le modifier directement. Il adapte les couleurs et les petites tailles de texte, sans filtre d’inversion ni modification du métier. Après une modification d’une feuille existante, le régénérer avant de construire :

```sh
node scripts/build-app-theme.mjs
npm run build
```

La vérification ciblée est `node_modules/.bin/playwright test tests/browser/theme.spec.ts`. Elle exerce le choix du thème, sa conservation, le mode système, le stockage bloqué, les couleurs réellement calculées, les principales vues, une fenêtre et l’affichage mobile. Les captures de vérification sont dans les sorties Playwright. Elle utilise une base temporaire avec le compte de test existant, sans toucher aux comptes de l’application déployée.

Cette modification appartient au frontend du prototype présent dans ce checkout. Pour l’intégration Java, reprendre le module `src/theme`, la police et l’initialisation dans le point d’entrée du coordinateur ; les nouveaux écrans d’accès auront besoin de leur propre adaptation sémantique. La refonte du module d’accès est conservée dans Git et séparée de l’apparence. La publication autorisée le 14 octobre 2026 est décrite dans [le compte rendu de publication](release-2026-10-14.md).
