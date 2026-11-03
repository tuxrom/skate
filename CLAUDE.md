# Skate

Jeu de skateboard 3D en vue troisième personne, inspiré de la série Skate d'EA (flicks au stick droit, ressenti physique). Il se joue dans un navigateur sur PC et mobile et s'installe en PWA. Le projet n'utilise ni le nom, ni les personnages, ni les assets de la série : tout le contenu est original.

## Stack

- TypeScript (strict) et Vite
- Three.js pour le rendu
- Rapier (`@dimforge/rapier3d-compat`, WASM embarqué) pour la physique
- vite-plugin-pwa (Workbox, `generateSW`) pour le manifeste et le service worker
- Aucun asset externe obligatoire : géométries procédurales, textures dessinées sur canvas, sons synthétisés avec la Web Audio API

## Commandes npm

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de dev Vite (debug actif par défaut) |
| `npm run dev:host` | Serveur de dev exposé sur le réseau local, pour tester sur mobile |
| `npm run typecheck` | Vérification TypeScript seule |
| `npm run build` | `tsc --noEmit` puis build de production dans `dist/` (service worker inclus) |
| `npm run preview` | Sert `dist/` localement, avec le service worker actif |

En production, ajouter `?debug` à l'URL pour afficher le panneau de debug. `F3` ou `²`/`` ` `` le bascule à tout moment.

## Arborescence

```
index.html              point d'entrée HTML, styles plein écran
vite.config.ts          alias @ -> src, configuration PWA
public/icon.svg         icône de l'application
src/
  main.ts               démarrage : charge Rapier et les assets, crée Game, enregistre le SW
  config/
    physics.ts          TOUS les réglages de ressenti du gameplay
    render.ts           réglages techniques du rendu, de la caméra et du debug
  core/
    Game.ts             assemble les sous-systèmes, fixedUpdate / render
    GameLoop.ts         boucle à pas fixe avec accumulateur et stats
    Renderer.ts         WebGLRenderer, pixel ratio plafonné, resize
    Input.ts            actions abstraites, sources d'input enfichables (clavier pour l'instant)
    CameraRig.ts        caméra de suivi lissée
  physics/
    PhysicsWorld.ts     chargement WASM, monde Rapier, matériaux de surface
    InterpolatedBody.ts lien corps Rapier <-> Object3D avec interpolation
  skater/
    StateMachine.ts     machine à états générique
    states.ts           identifiants des états du skateur
  world/
    Level.ts            sol, éclairage, colliders statiques
    assets.ts           AssetProvider et son implémentation procédurale
    textures.ts         textures générées par code
  ui/
    DebugOverlay.ts     FPS, temps de frame, pas physiques, draw calls
  audio/
    AudioEngine.ts      contexte Web Audio déverrouillé au premier geste, bus master
```

## Architecture

- **Pas fixe** : la physique et toute la logique de gameplay avancent par pas de `FIXED_DT` (120 Hz) dans `Game.fixedUpdate`. `GameLoop` borne le delta de frame (`SIMULATION.maxFrameDelta`) et le nombre de pas rattrapés par frame (`SIMULATION.maxStepsPerFrame`).
- **Rendu interpolé** : chaque corps visible passe par `InterpolatedBody`. `capture()` après chaque pas physique, `apply(alpha)` dans `render`. Après une téléportation, appeler `teleportSync()`.
- **Input** : le gameplay lit un `InputSnapshot` (sticks `move` et `flick`, boutons `held` et `pressed`) produit une fois par pas fixe par `Input.poll()`. Le gameplay ne lit jamais une touche ou un pointeur directement. Les contrôles tactiles (étape 9) et la manette seront de nouvelles `InputSource`.
- **Assets** : tout visuel est demandé à un `AssetProvider` par identifiant (`AssetId`). L'implémentation actuelle est `ProceduralAssets`. Pour passer aux modèles glTF, écrire une `GltfAssets` qui implémente la même interface et la passer à `Game` dans `main.ts`. Le gameplay ne crée jamais de mesh lui-même.
- **Audio** : les voix se branchent sur `AudioEngine.output`. Même principe que les assets pour remplacer plus tard la synthèse par des samples.
- **Skateur** : chaque état implémente `State<SkaterStateId, Ctx>` et renvoie l'état suivant depuis `update`. Les transitions ne se font qu'à pas fixe.
- **Rendu** : `devicePixelRatio` plafonné à `RENDER.maxPixelRatio` (2). Cible : 60 fps sur mobile milieu de gamme.

## Conventions de code

- TypeScript strict, aucun `any`. `import type` pour les imports de types (`verbatimModuleSyntax`).
- Imports internes via l'alias `@/` (`@/config/physics`), imports relatifs seulement à l'intérieur d'un même dossier.
- Une classe principale par fichier, fichier nommé comme la classe (`GameLoop.ts`). Modules utilitaires en camelCase (`textures.ts`).
- **Aucun nombre magique de gameplay hors de `src/config/physics.ts`** : gravité, frictions, vitesses, forces, seuils, durées, fenêtres d'input, score. Les réglages techniques de rendu et de caméra vont dans `src/config/render.ts`. Les dimensions de mise en page d'un niveau restent des constantes nommées en tête du fichier du niveau.
- Unités SI partout (m, s, kg, rad). Les fenêtres d'input sont en millisecondes et leur nom se termine par `Ms`.
- Chaque réglage de config porte un commentaire JSDoc qui donne son unité et son effet.
- Le lissage dépendant du temps utilise `1 - Math.exp(-k * dt)`, jamais un facteur de lerp constant.
- Pas d'allocation dans les chemins chauds (`fixedUpdate`, `render`) : vecteurs temporaires réutilisés en champs privés.
- Toute ressource Three.js ou Rapier créée doit pouvoir être libérée (`dispose()`).
- Commentaires et textes d'interface en français, identifiants de code en anglais.

## Étapes du projet

- [x] 0. Initialisation : stack, arborescence, boucle à pas fixe 120 Hz, rendu interpolé, compteur FPS de debug, config centralisée
- [ ] 1. Scène, poussée, caméra
- [ ] 2. Ollie
- [ ] 3. Flicks et flips
- [ ] 4. Grabs
- [ ] 5. Grinds et manuals
- [ ] 6. Bails
- [ ] 7. Score et combos
- [ ] 8. HUD, menus, sauvegarde
- [ ] 9. Contrôles tactiles
- [ ] 10. PWA (icônes PNG, écran d'installation, stratégie de cache, mode hors ligne vérifié)
- [ ] 11. Optimisation (découpage du bundle, le WASM inline de Rapier pèse lourd ; profilage mobile)

## Règle de fin d'étape

Après chaque étape, sans exception :

1. Lancer `npm run build`.
2. Corriger toutes les erreurs TypeScript et de build, puis relancer jusqu'à un build propre.
3. Tester le comportement dans le navigateur (`npm run dev`, et `npm run preview` pour ce qui touche la PWA), sur viewport desktop et mobile émulé, en surveillant la console et le panneau de debug.
4. Mettre à jour la liste des étapes terminées ci-dessus.
