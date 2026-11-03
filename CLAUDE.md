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

En mode debug, `window.__skate` expose le jeu : `debugState()` (état du skateur, de la dernière réception, de la prédiction et de la caméra), `debugTeleport(x, z, yaw)` et `debugCameraOverride({x, y, z} | null)` (caméra fixe relative au skateur, pour les captures). Les tests automatisés Playwright s'appuient dessus ; une manette se simule en remplaçant `navigator.getGamepads`.

## Contrôles

| Clavier | Manette | Action |
| --- | --- | --- |
| Z Q S D (AZERTY) / W A S D (QWERTY) | Stick gauche | Direction : gauche-droite inclinent la planche, arrière freine, avant groupe. En l'air, gauche-droite font tourner le corps (180, 360, 540) |
| Glisser bouton gauche maintenu, ou flèches en repli | Stick droit | Pieds du skateur : gestes de flick (tableau ci-dessous) |
| Espace maintenu puis relâché | | Ollie : la durée de charge règle la hauteur |
| E tenu (+ flèche), ou clic droit tenu (+ glissé) | LT / RT tenue (+ stick droit) | Grab, tant que c'est tenu : haut = nosegrab, bas = tailgrab, droite = indy, gauche = melon, sans direction = indy |
| Ctrl tenu (ou C), équilibre avec ↑ / ↓ | LB / RB tenue, équilibre au stick gauche | Manual au sol ; ↑ tenu à l'entrée = nose manual |
| Shift | A / Croix | Pousser ; maintenir enchaîne des poussées plus fortes (accélérer) |
| R | Select | Retour au départ |
| Échap | Start | Pause |
| F3 ou ² | | Panneau de debug |

Les touches sont liées par code physique (`KeyboardEvent.code`), donc ZQSD et WASD sont la même rangée. À la souris, un glissé de `INPUT.mouseStickRadiusPx` met le stick en butée ; relâcher le bouton ramène le stick au centre et termine le geste. Aux flèches, le stick virtuel glisse vers la direction tenue (`INPUT.keyStickResponse`) et longe le bord entre deux flèches voisines (`keyStickArcMaxAngle`) : une suite ↓ ↙ ← ↖ ↑ trace un demi-cercle.

### Gestes de flick (stick droit)

Tout geste commence stick en bas (charge, le skateur s'accroupit ; la durée règle la hauteur). Le flick qui suit choisit le trick. Ramener le stick au centre sans flick annule la charge.

| Geste après la charge | Trick |
| --- | --- |
| Trait vers le haut | Ollie |
| Trait vers la diagonale haut-gauche | Kickflip |
| Trait vers la diagonale haut-droite | Heelflip |
| Demi-cercle par un côté, sortie en haut | Pop shove-it (par la droite : backside, par la gauche : frontside) |
| Cercle complet | 360 flip |
| Arc de 225° par la droite, sortie haut-gauche | Varial flip |
| Arc de 225° par la gauche, sortie haut-droite | Hardflip |

### Grinds et manuals

- **Accrocher** : arriver en l'air au-dessus d'une ligne de grind (rail, arête de ledge ou de box, main courante), dans son axe, en redescendant. Au sol, seul un coping se prend, en haut d'une transition.
- **Choix du grind** : board dans l'axe du rail (moins de 45°) → trucks : 50-50, S tenu = 5-0, Z/W tenu = nosegrind. Board en travers (tourné en l'air) → slide : boardslide, Z/W tenu = lipslide.
- **Tenir** : la jauge d'équilibre (en bas de l'écran) dérive ; Q/D (stick gauche) la recentre. Hors de la zone sûre, chute. En manual, ↑/↓ avec Ctrl.
- **Sortir** : Espace ou un geste de flick (flip de sortie), ou au bout du rail. En dessous de `GRIND.minSpeed`, le board tombe du rail.
- **Enchaîner** : Ctrl tenu à la réception d'une sortie de grind donne un manual ; un ollie depuis un manual peut accrocher un rail.
- **Attention** : Ctrl+W ferme l'onglet et aucune page ne peut l'empêcher. C fait la même chose que Ctrl.

### En l'air

- **Grabs** : la main part vers la zone du board désignée et y reste tant que le bouton est tenu. Il faut lâcher avant la réception : main encore sur le board au contact, la réception est sale (`GRAB.landSloppyAmount`) ou c'est une chute (`GRAB.landBailAmount`). Pendant un flip, le grab attend que la rotation soit assez avancée (`GRAB.startAfterFlip`).
- **Rotations** : tenir gauche ou droite fait monter la vitesse de rotation ; relâché, le corps continue sur son élan en ralentissant. Juste avant la réception (`SPIN.snapLead`), l'angle est aimanté vers le multiple de 180° que l'élan atteindrait. Entre deux multiples, l'aimantation ne joue pas : sous-tourner ou sur-tourner donne une réception sale ou une chute. Un grab ralentit la rotation (`GRAB.spinRateMultiplier`).
- **Repères de timing**, sur un ollie à pleine charge (environ 0,77 s de vol) : D tenu 100 à 200 ms donne un 180, 280 ms et plus un 360 ; un 540 demande un saut plus long (escalier). Un flip et un grab tiennent ensemble sur le plat avec un timing serré, confortablement depuis l'escalier ou le gap.

Un trait coupe le disque intérieur du stick, un arc reste sur le bord : c'est le rayon minimal du chemin qui sépare les deux familles. `FLICK.sensitivity` élargit ou resserre toutes les tolérances.

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
    Input.ts            actions abstraites, sources d'input enfichables (clavier, souris, manette)
    FlickRecognizer.ts  analyse du geste du stick droit, événement de trick normalisé
    CameraRig.ts        caméra troisième personne : amortissement, FOV selon la vitesse, collision, anticipation de réception
  physics/
    PhysicsWorld.ts     chargement WASM, monde Rapier, colliders statiques et matériaux, rayons
    InterpolatedBody.ts interpolation d'une PoseSource (corps Rapier, skateur) vers un Object3D
  skater/
    Skater.ts           simulation : intégration, suivi du sol, obstacles, ollie, prédiction, évaluation de réception
    skaterStates.ts     états idle, pushing, riding, braking, popCharge, pop, air, landing
    StateMachine.ts     machine à états générique
    states.ts           identifiants de tous les états prévus
    tricks.ts           définitions des tricks : tours de flip et de shove, noms, grabs, nom du saut
    grinds.ts           définitions des grinds et manuals : géométrie de contact, choix du type
    SkaterRig.ts        interface du visuel animable et pose d'animation
    ProceduralSkaterRig.ts skateur en primitives (planche, 4 roues, rider à IK)
    SkaterVisual.ts     relie simulation et rig, interpole la pose d'animation
  world/
    Level.ts            skatepark de test : sol, murs, modules, rails, ledges, éclairage
    parkModules.ts      constructeurs de modules (visuel + colliders depuis un même profil), ledges et rails grindables
    GrindNetwork.ts     lignes de grind explicites : segments orientés, nature, matériau, chaînage
    assets.ts           AssetProvider et son implémentation procédurale
    textures.ts         textures générées par code
    DustEffect.ts       poussière d'impact : pool fixe de points, shader de fondu
  ui/
    DebugOverlay.ts     FPS, temps de frame, pas physiques, draw calls, état du skateur
    PauseOverlay.ts     voile de pause
    FlickDebugPanel.ts  debug du flick : stick, chemin du geste, mesures, trick et scores
    BalanceMeter.ts     jauge d'équilibre des grinds et manuals
  audio/
    AudioEngine.ts      contexte Web Audio déverrouillé au premier geste, bus master
    sfx.ts              sons synthétisés : pop du tail, claque de réception
```

## Architecture

- **Pas fixe** : la physique et toute la logique de gameplay avancent par pas de `FIXED_DT` (120 Hz) dans `Game.fixedUpdate`. `GameLoop` borne le delta de frame (`SIMULATION.maxFrameDelta`) et le nombre de pas rattrapés par frame (`SIMULATION.maxStepsPerFrame`).
- **Rendu interpolé** : chaque corps visible passe par `InterpolatedBody`. `capture()` après chaque pas physique, `apply(alpha)` dans `render`. Après une téléportation, appeler `teleportSync()`.
- **Input** : le gameplay lit un `InputSnapshot` (sticks `move` et `flick`, boutons `held` et `pressed`, geste `gesture`) produit une fois par pas fixe par `Input.poll()`. Le gameplay ne lit jamais une touche ou un pointeur directement. Chaque périphérique est une `InputSource` qui écrit dans les sticks ; les contrôles tactiles (étape 9) en seront une de plus.
- **Flick** : `FlickRecognizer` tourne dans `Input.poll()` sur le stick droit normalisé, donc indépendamment du périphérique. Phases `idle`, `charging` (stick en bas), `flicking`, puis fin au relâchement, à l'immobilité (`FLICK.holdEndMs`) ou au délai max. Il mesure angle de départ (direction moyenne de la charge), angle de sortie, angle balayé, rayon minimal (trait ou arc), amplitude et durée, puis note chaque modèle par des gaussiennes sur ces écarts. Il publie un `FlickEvent` (trick, score, sens, mesures, candidats) dans `gesture.event`.
- **Assets** : tout visuel est demandé à un `AssetProvider` par identifiant (`AssetId`). L'implémentation actuelle est `ProceduralAssets`. Pour passer aux modèles glTF, écrire une `GltfAssets` qui implémente la même interface et la passer à `Game` dans `main.ts`. Le gameplay ne crée jamais de mesh lui-même.
- **Audio** : les voix se branchent sur `AudioEngine.output`. Même principe que les assets pour remplacer plus tard la synthèse par des samples.
- **Skateur** : chaque état implémente `State<SkaterStateId, Skater>` et renvoie l'état suivant depuis `update`. Les états écrivent des intentions (`pushAccel`, `brake`, `lean`) ; `Skater.step` les intègre. Les transitions ne se font qu'à pas fixe.
- **Physique du skateur** : pas de corps dynamique. La vitesse est intégrée à la main, puis :
  - deux rayons de sol, un par truck, donnent contact et normale (la planche s'appuie sur la droite qui les relie) ;
  - une arête convexe fait décoller si la vitesse d'éloignement du nouveau plan dépasse ce que la gravité courbe pendant le passage de l'entraxe (`GROUND.convexLaunchSpeed`), sinon la planche suit sans perte d'énergie autre que `transitionSpeedLoss` ;
  - six rayons au ras de la planche (`GROUND.wallRayHeight`) arrêtent les obstacles bas (curbs, ledges) ; une face plus raide que `GROUND.wallAngle` est un mur, une pente est laissée aux sondes ;
  - une capsule surélevée (`BODY.capsuleClearance`) et le `KinematicCharacterController` de Rapier gèrent les obstacles hauts ;
  - un choc rasant (`GROUND.wallDeflectAngle`) redresse la planche le long du mur.
- **Ollie** : `popCharge` accumule la charge (linéaire jusqu'à `POP.chargeTime`), `pop` attend `POP.popDelay` puis `performPop` ajoute `√(2·g·h)` le long de la normale du sol, h interpolé entre `POP.minHeight` et `POP.maxHeight`. La vitesse tangentielle est conservée. Coyote time (`INPUT.coyoteMs`) si la planche quitte une arête pendant la charge, buffer (`INPUT.popBufferMs`) pour un tap juste avant la réception.
- **En l'air** : seule la gravité agit, la vitesse horizontale est conservée exactement. Le corps tourne au stick gauche avec inertie (`POP.airSpinRate`, `POP.airSpinResponse`). La trajectoire balistique est prédite par segments de rayons (`Skater.prediction`) ; la planche s'aligne sur la normale de réception prévue (`POP.airAlignRate`) et la caméra s'en sert.
- **Lignes de grind** : géométrie explicite dans `GrindNetwork` (segments orientés de a vers b, nature `round`, `flat`, `ledge` ou `coping`, matériau, collider porteur), chaînés quand ils se touchent. Les colliders de rails et de montants sont marqués `markGrindOnly` : les sondes de sol et le corps du skateur les ignorent (on ne roule pas sur un tube et le corps ne s'y pose pas), seuls les rayons au ras de la planche butent sur les montants.
- **Détection de grind** (`Skater.tryStartGrind`) : en l'air après le déplacement, la capsule de l'axe du board (queue-nez) cherche la ligne la plus proche, puis `acceptGrind` filtre : délai de réaccrochage, recouvrement (board dans l'axe) ou centre au-dessus (slide), fenêtre de hauteur, distance horizontale, arrivée par le dessus au pas précédent, vitesse le long de la ligne, rayon de visibilité libre jusqu'à la ligne. Au sol, seuls les copings sur une transition raide. `grindReject` donne la dernière raison de refus (debug).
- **Grind** (`Skater.grindStep`, état `grind`) : la vitesse le long du segment suit la pente et la friction du matériau (`MATERIALS.grindFriction` × `GRIND.typeFriction`). L'écart initial au rail se résorbe en `GRIND.snapResponse` (accrochage progressif). Sorties : ollie ou flip (`updateGrindPop`), bout du rail, vitesse trop faible, obstacle, chute. Un slide quitté remet le board dans l'axe.
- **Jauge d'équilibre** : commune aux grinds et manuals, dynamique instable (`BALANCE`) : divergence qui croît avec la durée, perturbation pseudo-aléatoire, correction au stick, difficulté par type. Une sortie de zone sûre en grind pousse le skateur du côté du déséquilibre et force une réception en chute ; en manual, elle déclenche une réception en chute sur place. Les vraies chutes arrivent à l'étape 6.
- **Manual** (état `manual`) : touche tenue au sol au-dessus de `MANUAL.minSpeed`, résistance au roulement accrue, même jauge. On y entre aussi à la réception si la touche est tenue (grind → manual) ; on en sort par un ollie ou un flip, qui peut mener à un grind. Les événements `balanceStart` / `balanceEnd` (type, durée, distance, raison) alimenteront les combos de l'étape 7.
- **Aimantation des rotations** : suspendue tant qu'une ligne de grind passe sous le board (`GRIND.spinMagnetSuspendRadius`), pour pouvoir arriver en travers sur un slide.
- **Grabs** : couche du vol gérée par `Skater.updateGrab` (pas un état de la machine). Direction lue sur un stick dédié, `InputSnapshot.grab` (flèches avec E, glissé du clic droit, stick droit avec une gâchette), séparé du stick de flick pour qu'un tailgrab ne déclenche jamais une charge. Un grab compte après `GRAB.minHold` main sur le board ; les grabs comptés et la prise au contact entrent dans `LandingInfo`.
- **Rotations du corps** : `Skater.updateSpin` accumule `spinAngle` ; la rotation fait tourner le cap du board et du corps ensemble. L'aimantation projette l'angle sur l'élan restant, verrouille le multiple visé et vise le contact anticipé (`SPIN.snapContactLead`). À la réception, `spinError` (écart au multiple de 180° le plus proche) remplace l'écart à la vitesse quand on est à l'arrêt.
- **Nom du saut** : `comboName` assemble rotation, trick et grabs (« 180 Kickflip Indy ») dans `LandingInfo.label`.
- **Fakie** : la poussée agit dans le sens de la marche et le virage suit le sens de la marche. La caméra suit aussi le sens de la marche (vitesse horizontale en l'air), donc elle ne tourne pas avec le skateur pendant une rotation.
- **Tricks** : `performPop` démarre le trick du dernier `FlickEvent` (`Skater.trick`). La rotation du board dure `TRICKS.rotationAirFraction` du temps de vol prévu, bornée par `minRotationTime` et `maxRotationTime` : plus le saut est haut, plus la rotation est lente. La progression est adoucie (`trickEase`), les pieds quittent le board puis le rattrapent sur `TRICKS.catchFraction`. À la réception, la rotation restante (`boardResidual`) dégrade la qualité au-delà de `TRICKS.landFlipTolerance` (sale) et du double (hors limites), et le board raté reste de travers un instant avant de se recaler.
- **Réception** : `tryLand` mesure l'angle planche / surface (`tilt`), l'écart entre l'axe de la planche et la vitesse (`yawError`, fakie accepté) et la vitesse d'impact. Qualité `clean`, `sloppy` (seuils `LANDING`) ou `bail` (seuils `BAIL`, en attendant les chutes de l'étape 6), avec perte de vitesse et temps de récupération (état `landing`). Une surface plus inclinée que `GROUND.maxLandingSurfaceAngle` n'accepte jamais de réception. Les effets (son, poussière, affaissement caméra) passent par `Skater.events`.
- **Modules de skatepark** : un profil 2D extrudé donne le visuel, sa décomposition convexe donne les colliders (`ColliderDesc.convexHull`). Les colonnes adjacentes partagent leurs arêtes exactement, ce qui évite les accrocs aux raccords.
- **Caméra** : les requêtes de collision passent par un callback fourni par `Game`, `CameraRig` ne dépend pas de Rapier. Rapprochement immédiat quand le décor bouche la vue, recul amorti. En l'air, le suivi vertical se relâche et glisse vers l'altitude de réception prévue (`CAMERA.landingLead`, `landingAnticipation`) ; à l'impact, affaissement proportionnel à la vitesse.
- **Animation** : `SkaterPose` porte des temps (`popTime`, `landTime`, `airTime`) plutôt que des angles ; chaque rig en tire ses propres courbes. Le rig procédural fait pivoter la planche autour des roues arrière (nose qui se lève puis nivelage), applique les rotations de trick autour du centre du deck (shove sur l'axe vertical, puis flip sur l'axe long) et place les pieds sur le deck par IK, décollés pendant la rotation (`feetLift`). En grind et en manual (`BALANCE_POSES`), le board se cabre sur la paire de roues qui porte (5-0, manual) ou pique du nose (nosegrind, nose manual, avec compensation de hauteur), et le buste suit la jauge. Pour un grab, le board remonte vers la main, le buste se penche et tourne vers la zone de prise, et le bras qui attrape est placé par IK (`GRAB_POSES`).
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
- [x] 1. Scène, poussée, caméra : skatepark de test, skateur en primitives, machine à états (idle, pousse, roule, freine, air), carve à l'inclinaison, caméra amortie avec collision
- [x] 2. Ollie : charge et pop, contrôle aérien, prédiction de trajectoire, évaluation de réception, caméra d'anticipation, poussière, sons synthétisés ; parc : marche, petit gap, petit quarter pipe, escalier avec main courante
- [x] 3. Flicks et flips : stick droit à la souris et aux flèches, reconnaissance de gestes (ollie, kickflip, heelflip, pop shove-it, 360 flip, varial flip, hardflip), rotation du board liée à la hauteur, rattrapage par les pieds, réception évaluée sur la rotation restante, panneau de debug du geste
- [x] 4. Grabs : indy, melon, nosegrab, tailgrab à E, au clic droit ou à la gâchette ; rotations 180, 360, 540 avec aimantation ; enchaînement flip, grab et rotation dans un même saut ; caméra et poussée en fakie
- [x] 5. Grinds et manuals : lignes de grind explicites, 50-50, 5-0, nosegrind, boardslide, lipslide, manual et nose manual, jauge d'équilibre, sorties par ollie ou flip, transitions grind ↔ manual ; parc : six rails, ledge continu, boîte de manual
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
