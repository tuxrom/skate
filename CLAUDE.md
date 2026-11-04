# Skate

Jeu de skateboard 3D en vue troisième personne, inspiré de la série Skate d'EA (flicks au stick droit, ressenti physique). Il se joue dans un navigateur sur PC et mobile et s'installe en PWA. Le projet n'utilise ni le nom, ni les personnages, ni les assets de la série : tout le contenu est original.

## Stack

- TypeScript (strict) et Vite
- Three.js pour le rendu
- Rapier (`@dimforge/rapier3d-compat`, WASM embarqué) pour la physique
- vite-plugin-pwa (Workbox, `generateSW`) pour le manifeste et le service worker
- Aucun asset externe obligatoire : géométries procédurales, textures dessinées sur canvas, sons synthétisés avec la Web Audio API

Le README décrit l'installation, le déploiement statique en HTTPS, les contrôles et les réglages mesurés.

## Commandes npm

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de dev Vite (debug actif par défaut) |
| `npm run dev:host` | Serveur de dev exposé sur le réseau local, pour tester sur mobile |
| `npm run typecheck` | Vérification TypeScript seule |
| `npm run build` | `tsc --noEmit` puis build de production dans `dist/` (service worker inclus) |
| `npm run preview` | Sert `dist/` localement, avec le service worker actif |
| `npm run icons` | Régénère les icônes PWA (PNG 64, 192, 512, maskable, Apple, favicon) depuis `public/icon.svg` (`pwa-assets.config.ts`) |

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
| S / Z (W) tenu à l'accrochage | LB tenue = 5-0, RB tenue = nosegrind / lipslide | Choix du grind |
| Shift | A / Croix | Pousser ; maintenir enchaîne des poussées plus fortes (accélérer) |
| R | Select (View / Share) | Pendant une chute : se relever tout de suite. Sinon : retour au départ |
| Échap | Start (Menu / Options) | Pause ; dans les menus, retour |
| Flèches, Entrée, Espace | Croix ou stick gauche, A / Croix, B / Rond | Navigation dans les menus |
| F3 ou ² | | Panneau de debug |

Au doigt (smartphone en paysage) : pouce gauche n'importe où sur la moitié gauche, un joystick flottant apparaît sous le doigt et le suit (poussé à fond vers l'avant, il pousse) ; pouce droit sur la moitié droite, glisser trace le geste de flick, exactement comme la souris (bas puis haut = ollie). Boutons : Pousser, Grab (tenu, le glissé à droite choisit le grab), Manual (tenu, équilibre au joystick), Grind (tenu à l'accrochage : nosegrind ou lipslide), ↺ (se relever, retour au départ), ❚❚ (pause). Position et taille des boutons : Réglages > Tactile > Disposer les boutons.

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

### Chutes

- **Déclencheurs** : réception hors limites (angle planche / surface `BAIL.maxLandingTilt`, écart de cap `maxLandingYawError`, impact `maxImpactSpeed`, flip pas rattrapé, grab tenu), jauge d'équilibre sortie en grind ou en manual, choc contre un mur (`wallImpactSpeed`) ou planche qui bute sur un obstacle bas (`tripImpactSpeed`, le corps passe par-dessus).
- **Chute** : le corps part en ragdoll avec la vitesse du skateur, la planche continue seule. La caméra suit le bassin.
- **Relève** : quand le corps est posé (`settleSpeed` pendant `settleTime`), au plus tard après `ragdollDuration`, ou tout de suite avec R. Point dégagé cherché près du bassin, fondu vers la pose debout, planche ramenée aux pieds.

### En l'air

- **Grabs** : la main part vers la zone du board désignée et y reste tant que le bouton est tenu. Il faut lâcher avant la réception : main encore sur le board au contact, la réception est sale (`GRAB.landSloppyAmount`) ou c'est une chute (`GRAB.landBailAmount`). Pendant un flip, le grab attend que la rotation soit assez avancée (`GRAB.startAfterFlip`).
- **Rotations** : tenir gauche ou droite fait monter la vitesse de rotation ; relâché, le corps continue sur son élan en ralentissant. Juste avant la réception (`SPIN.snapLead`), l'angle est aimanté vers le multiple de 180° que l'élan atteindrait. Entre deux multiples, l'aimantation ne joue pas : sous-tourner ou sur-tourner donne une réception sale ou une chute. Un grab ralentit la rotation (`GRAB.spinRateMultiplier`).
- **Repères de timing**, sur un ollie à pleine charge (environ 0,77 s de vol) : D tenu 100 à 200 ms donne un 180, 280 ms et plus un 360 ; un 540 demande un saut plus long (escalier). Un flip et un grab tiennent ensemble sur le plat avec un timing serré, confortablement depuis l'escalier ou le gap.

Un trait coupe le disque intérieur du stick, un arc reste sur le bord : c'est le rayon minimal du chemin qui sépare les deux familles. Ce rayon est mesuré sur les segments entre échantillons, si bien qu'un flick très vif, réduit à deux ou trois points, reste bien reconnu. `FLICK.sensitivity` élargit ou resserre toutes les tolérances.

## Arborescence

```
index.html              point d'entrée HTML, styles plein écran
vite.config.ts          alias @ -> src, configuration PWA (manifeste, précache, cache des autres requêtes)
pwa-assets.config.ts    génération des icônes PWA (npm run icons)
public/                 icon.svg (source) et icônes générées : pwa-*.png, maskable-icon-512x512.png, apple-touch-icon, favicon
src/
  main.ts               démarrage : charge Rapier et les assets, crée Game, enregistre le SW
  config/
    physics.ts          TOUS les réglages de ressenti du gameplay
    render.ts           réglages techniques du rendu, de la caméra et du debug
  core/
    Game.ts             assemble les sous-systèmes, fixedUpdate / render
    GameLoop.ts         boucle à pas fixe avec accumulateur et stats
    Renderer.ts         WebGLRenderer, pixel ratio plafonné, resize
    EventBus.ts         bus d'événements typé (charges réutilisées, à copier pour les garder)
    Input.ts            actions abstraites, sources d'input enfichables (clavier, souris, manette)
    FlickRecognizer.ts  analyse du geste du stick droit, événement de trick normalisé
    CameraRig.ts        caméra troisième personne : amortissement, FOV selon la vitesse, collision, anticipation de réception
  physics/
    PhysicsWorld.ts     chargement WASM, monde Rapier, colliders statiques et matériaux, rayons
    InterpolatedBody.ts interpolation d'une PoseSource (corps Rapier, skateur) vers un Object3D
  score/
    ScoreSystem.ts      combos : éléments, multiplicateur, variété, répétition, validation ou annulation, bus d'événements
  progress/
    Profile.ts          profil en mémoire : niveau et XP, défis, records, réglages, personnalisation, écriture différée
    ChallengeSystem.ts  objectifs de zone : présence dans les zones, progression, chronos, réussite
    unlocks.ts          catalogue des boards et couleurs, conditions de déblocage, apparence du skateur
  platform/
    device.ts           détection : écran tactile, iOS, application installée
    InstallPrompt.ts    invite d'installation (beforeinstallprompt retenu, aide iOS)
    DisplayMode.ts      plein écran, verrouillage en paysage, écran de rotation, menu contextuel bloqué
    PwaUpdates.ts       service worker, bandeaux « Prêt hors ligne » et « Nouvelle version »
  replay/
    ReplayRecorder.ts   tampon circulaire des 30 dernières secondes (skateur, planche, ragdoll, caméra), lecture interpolée
  save/
    SaveStore.ts        stockage IndexedDB avec repli localStorage, reprise des anciens records
    SaveData.ts         format de sauvegarde, valeurs par défaut, validation, niveau selon l'XP
  skater/
    Skater.ts           simulation : intégration, suivi du sol, obstacles, ollie, prédiction, évaluation de réception
    skaterStates.ts     états idle, pushing, riding, braking, popCharge, pop, air, landing, grind, manual, bail
    StateMachine.ts     machine à états générique
    states.ts           identifiants de tous les états prévus
    tricks.ts           définitions des tricks : tours de flip et de shove, noms, grabs, nom du saut
    grinds.ts           définitions des grinds et manuals : géométrie de contact, choix du type
    SkaterRig.ts        interface du visuel animable et pose d'animation
    ProceduralSkaterRig.ts skateur en primitives (planche, 4 roues, rider à IK)
    SkaterVisual.ts     relie simulation et rig, interpole la pose d'animation, fondu de la planche à la relève
    Ragdoll.ts          ragdoll Rapier : 11 corps reliés par des rotules, garde-fous, articulations interpolées
    BailController.ts   chute : ragdoll, planche lâchée, sons d'impact, stabilisation, point de relève, fondu
  world/
    Level.ts            skatepark de test : sol, murs, modules, rails, ledges, éclairage
    parkModules.ts      constructeurs de modules (visuel + colliders depuis un même profil), ledges et rails grindables
    GrindNetwork.ts     lignes de grind explicites : segments orientés, nature, matériau, chaînage
    assets.ts           AssetProvider et son implémentation procédurale
    textures.ts         textures générées par code
    DustEffect.ts       poussière d'impact : pool fixe de points, shader de fondu
    challenges.ts       zones et défis du skatepark de test (données de niveau)
    ZoneMarkers.ts      repères des zones au sol, regroupés en deux draw calls (anneaux fusionnés, colonnes instanciées)
    StaticBatcher.ts    regroupement du décor statique : fusion par matériau, InstancedMesh pour les pièces répétées
  ui/
    DebugOverlay.ts     FPS, temps de frame, pas physiques, draw calls, état du skateur
    FlickDebugPanel.ts  debug du flick : stick, chemin du geste, mesures, trick et scores
    BalanceMeter.ts     jauge d'équilibre des grinds et manuals
    ReplayView.ts       lecteur du replay : lecture, temps, ralenti, caméra de jeu ou libre
    ErrorScreen.ts      écran d'erreur autonome (démarrage WebGL / WASM, boucle arrêtée, contexte perdu)
    TouchControls.ts    contrôles tactiles : joystick flottant, zone de swipe, boutons, éditeur de disposition, détection du mode tactile
    Hud.ts              HUD : combo, nom du trick, validation et annulation animées, vitesse, niveau, objectifs, notifications
    Menus.ts            accueil, pause, réglages, personnalisation, objectifs, aide ; navigation clavier et manette
    helpContent.ts      schémas SVG des gestes, tables de contrôles, libellés Xbox / PlayStation
    styles.ts           feuille de style du HUD et des menus
  audio/
    AudioEngine.ts      contexte Web Audio déverrouillé au premier geste, bus master
    sfx.ts              sons synthétisés : pop du tail, claque de réception, chocs du corps et de la planche
```

## Architecture

- **Pas fixe** : la physique et toute la logique de gameplay avancent par pas de `FIXED_DT` (120 Hz) dans `Game.fixedUpdate`. `GameLoop` borne le delta de frame (`SIMULATION.maxFrameDelta`) et le nombre de pas rattrapés par frame (`SIMULATION.maxStepsPerFrame`).
- **Rendu interpolé** : chaque corps visible passe par `InterpolatedBody`. `capture()` après chaque pas physique, `apply(alpha)` dans `render`. Après une téléportation, appeler `teleportSync()`.
- **Input** : le gameplay lit un `InputSnapshot` (sticks `move` et `flick`, boutons `held` et `pressed`, geste `gesture`) produit une fois par pas fixe par `Input.poll()`. Le gameplay ne lit jamais une touche ou un pointeur directement. Chaque périphérique est une `InputSource` qui écrit dans les sticks : clavier, souris, manette, tactile (`TouchControls`).
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
- **En l'air** : seule la gravité agit, la vitesse horizontale est conservée exactement. Le corps tourne au stick gauche avec inertie (`SPIN`). La trajectoire balistique est prédite par segments de rayons (`Skater.prediction`) ; la planche s'aligne sur la normale de réception prévue (`POP.airAlignRate`) et la caméra s'en sert.
- **Lignes de grind** : géométrie explicite dans `GrindNetwork` (segments orientés de a vers b, nature `round`, `flat`, `ledge` ou `coping`, matériau, collider porteur), chaînés quand ils se touchent. Les colliders de rails et de montants sont marqués `markGrindOnly` : les sondes de sol et le corps du skateur les ignorent (on ne roule pas sur un tube et le corps ne s'y pose pas), seuls les rayons au ras de la planche butent sur les montants.
- **Détection de grind** (`Skater.tryStartGrind`) : en l'air après le déplacement, la capsule de l'axe du board (queue-nez) cherche la ligne la plus proche, puis `acceptGrind` filtre : délai de réaccrochage, recouvrement (board dans l'axe) ou centre au-dessus (slide), fenêtre de hauteur, distance horizontale, arrivée par le dessus au pas précédent, vitesse le long de la ligne, rayon de visibilité libre jusqu'à la ligne. Au sol, seuls les copings sur une transition raide. `grindReject` donne la dernière raison de refus (debug).
- **Grind** (`Skater.grindStep`, état `grind`) : la vitesse le long du segment suit la pente et la friction du matériau (`MATERIALS.grindFriction` × `GRIND.typeFriction`). L'écart initial au rail se résorbe en `GRIND.snapResponse` (accrochage progressif). Sorties : ollie ou flip (`updateGrindPop`), bout du rail, vitesse trop faible, obstacle, chute. Un slide quitté remet le board dans l'axe.
- **Jauge d'équilibre** : commune aux grinds et manuals, dynamique instable (`BALANCE`) : divergence qui croît avec la durée, perturbation pseudo-aléatoire, correction au stick, difficulté par type. Une sortie de zone sûre déclenche une chute ; en grind, le skateur est poussé du côté du déséquilibre.
- **Manual** (état `manual`) : touche tenue au sol au-dessus de `MANUAL.minSpeed`, résistance au roulement accrue, même jauge. On y entre aussi à la réception si la touche est tenue (grind → manual) ; on en sort par un ollie ou un flip, qui peut mener à un grind. Les événements `balanceStart` / `balanceEnd` (type, durée, distance, raison) alimenteront les combos de l'étape 7.
- **Aimantation des rotations** : suspendue tant qu'une ligne de grind passe sous le board (`GRIND.spinMagnetSuspendRadius`), pour pouvoir arriver en travers sur un slide.
- **Chutes** (`Skater.triggerBail`, état `bail`) : la simulation du skateur se fige, son collider est désactivé et l'événement `bail` (cause, vitesse, position, cap) part vers `Game`. Les chocs violents détectés pendant un pas (`wallResponse`) sont différés à la fin du pas avec la vitesse d'avant l'impact ; un rayon à hauteur du torse distingue un mur d'un obstacle bas.
- **Ragdoll** (`Ragdoll`) : bassin, torse, tête, bras et jambes en deux segments, reliés par des rotules. Créé sur la pose affichée (`SkaterRig.captureJoints`), donc les articulations sont satisfaites dès le premier pas. Les membres ne collisionnent qu'avec le décor (`RAGDOLL_GROUPS`), CCD active, vitesses plafonnées (`BAIL.maxPartSpeed`), garde-fou au-dessus du sol. Ces quatre mesures évitent les explosions et les membres sous le sol.
- **Groupes de collision** (`PhysicsWorld`) : décor, ragdoll, planche lâchée. Les requêtes (`castRay`, `sphereClearance`, `isStandingSpaceFree`) ne voient que le décor.
- **BailController** : planche lâchée en corps dynamique (pose du rig via `Skater.poseOverride`), sons d'impact sur les variations brutales de vitesse, stabilisation jugée sur le bassin et le torse. Relève : recherche en anneaux d'un point au sol peu pentu, pas plus haut que le bassin (`respawnMaxRise`), où la capsule du corps tient sans toucher le décor ; repli sur `Skater.lastSafePosition`. Le rig fond de la pose au sol vers la pose animée (`applyRagdoll` avec un poids qui décroît), la planche glisse jusqu'aux pieds (`SkaterVisual.blendFromCurrent`).
- **Grabs** : couche du vol gérée par `Skater.updateGrab` (pas un état de la machine). Direction lue sur un stick dédié, `InputSnapshot.grab` (flèches avec E, glissé du clic droit, stick droit avec une gâchette), séparé du stick de flick pour qu'un tailgrab ne déclenche jamais une charge. Un grab compte après `GRAB.minHold` main sur le board ; les grabs comptés et la prise au contact entrent dans `LandingInfo`.
- **Rotations du corps** : `Skater.updateSpin` accumule `spinAngle` ; la rotation fait tourner le cap du board et du corps ensemble. L'aimantation projette l'angle sur l'élan restant, verrouille le multiple visé et vise le contact anticipé (`SPIN.snapContactLead`). À la réception, `spinError` (écart au multiple de 180° le plus proche) remplace l'écart à la vitesse quand on est à l'arrêt.
- **Nom du saut** : `comboName` assemble rotation, trick et grabs (« 180 Kickflip Indy ») dans `LandingInfo.label`.
- **Fakie** : la poussée agit dans le sens de la marche et le virage suit le sens de la marche. La caméra suit aussi le sens de la marche (vitesse horizontale en l'air), donc elle ne tourne pas avec le skateur pendant une rotation.
- **Tricks** : `performPop` démarre le trick du dernier `FlickEvent` (`Skater.trick`). La rotation du board dure `TRICKS.rotationAirFraction` du temps de vol prévu, bornée par `minRotationTime` et `maxRotationTime` : plus le saut est haut, plus la rotation est lente. La progression est adoucie (`trickEase`), les pieds quittent le board puis le rattrapent sur `TRICKS.catchFraction`. À la réception, la rotation restante (`boardResidual`) dégrade la qualité au-delà de `TRICKS.landFlipTolerance` (sale) et du double (hors limites), et le board raté reste de travers un instant avant de se recaler.
- **Réception** : `tryLand` mesure l'angle planche / surface (`tilt`), l'écart entre l'axe de la planche et la vitesse (`yawError`, fakie accepté) et la vitesse d'impact. Qualité `clean`, `sloppy` (seuils `LANDING`, perte de vitesse et récupération dans l'état `landing`) ou `bail` (seuils `BAIL`, chute). Une surface plus inclinée que `GROUND.maxLandingSurfaceAngle` n'accepte jamais de réception. Les effets (son, poussière, affaissement caméra) passent par `Skater.events`.
- **Modules de skatepark** : un profil 2D extrudé donne le visuel, sa décomposition convexe donne les colliders (`ColliderDesc.convexHull`). Les colonnes adjacentes partagent leurs arêtes exactement, ce qui évite les accrocs aux raccords.
- **Caméra** : les requêtes de collision passent par un callback fourni par `Game`, `CameraRig` ne dépend pas de Rapier. Rapprochement immédiat quand le décor bouche la vue, recul amorti ; un départ déjà au contact d'un mur ne bloque pas le balayage. Pendant une chute, elle suit le bassin du ragdoll sans avance du point visé, puis revient derrière le skateur. En l'air, le suivi vertical se relâche et glisse vers l'altitude de réception prévue (`CAMERA.landingLead`, `landingAnticipation`) ; à l'impact, affaissement proportionnel à la vitesse.
- **Animation** : `SkaterPose` porte des temps (`popTime`, `landTime`, `airTime`) plutôt que des angles ; chaque rig en tire ses propres courbes. Le rig procédural fait pivoter la planche autour des roues arrière (nose qui se lève puis nivelage), applique les rotations de trick autour du centre du deck (shove sur l'axe vertical, puis flip sur l'axe long) et place les pieds sur le deck par IK, décollés pendant la rotation (`feetLift`). En grind et en manual (`BALANCE_POSES`), le board se cabre sur la paire de roues qui porte (5-0, manual) ou pique du nose (nosegrind, nose manual, avec compensation de hauteur), et le buste suit la jauge. Pour un grab, le board remonte vers la main, le buste se penche et tourne vers la zone de prise, et le bras qui attrape est placé par IK (`GRAB_POSES`).
- **Score et combos** (`ScoreSystem`, barème dans `SCORING`) : branché par `Game` sur les événements du skateur (`land`, `grindEntry`, `balanceStart` / `balanceEnd`, `bail`), avancé à pas fixe après `Skater.step`. Un élément est un saut (popé et assez long, ou avec rotation ou grab), un grind ou un manual (durée minimale). Le combo dure tant que le temps au sol hors manual reste sous `comboGroundTime` ; le compteur repart à chaque élément et se suspend en l'air, en grind et en manual. Score = (Σ points + bonus de variété par famille) × multiplicateur (éléments distincts). Points d'un élément = (base + hauteur, distance de grind/manual, transition grind ↔ manual) × facteur de répétition (`repeatDecay` dans le combo, `recentRepeatFactor` sur les combos validés récents). Validation à l'échéance après une réception propre, immédiate et réduite (`sloppyLandingFactor`) sur une réception sale. Rien n'est acquis avant : une chute (réception, grind, manual, mur, même pendant le délai au sol) ou un retour au départ annule tout. `score.events` (`EventBus<ScoreEvents>`) publie `comboStart`, `element`, `liveStart`, `comboBanked`, `comboLost`, `record` pour l'UI et les objectifs. Total et meilleur combo de session en mémoire ; records dans le localStorage (`skate.scores.v1`) via `ScoreStore`, qui tolère un stockage indisponible. Un vol qui finit sur un rail est signalé par `grindEntry` et remet `popped` à faux : la réception après la sortie ne recompte pas le trick.
- **Tactile** (`TouchControls`, une `InputSource`) : chaque doigt est suivi par son `pointerId`, capturé à l'appui ; joystick, swipe et boutons fonctionnent ensemble. `pointercancel` et `lostpointercapture` relâchent le doigt ; perte de focus, menu ouvert ou changement de mode relâchent tout. Le joystick et le swipe sont des `DragStick`, la même classe que le glissé de la souris : la trajectoire du swipe alimente le stick de flick et passe par le même `FlickRecognizer`. Un `DragStick` relâché garde sa dernière position pour une lecture, pour qu'un flick fini dans la même image que le relâchement soit reconnu. Gestes du navigateur neutralisés : `touch-action: none`, `touchmove` bloqué hors des panneaux de menu, `gesturestart` et `dblclick` bloqués, `overscroll-behavior: none`. Boutons placés en fractions de la zone sûre (safe areas lues par une sonde `env()`), taille selon le petit côté de l'écran (`TOUCH`) et les réglages. Mode tactile : détecté (pointeur grossier sans pointeur fin), activé par un toucher, désactivé par le clavier, la souris ou la manette ; la classe `touch-ui` sur `<html>` réagence le HUD. Retour haptique (`navigator.vibrate`) à la réception, à la validation d'un combo et à la chute.
- **Modes et menus** : `Game.mode` vaut `home` (accueil, simulation figée, caméra en orbite) ou `play`. Un menu ouvert met la simulation en pause. `Menus` gère une pile d'écrans ; Échap / Start passent par l'action `pause` d'`Input` et appellent `menus.back()`. La navigation à la manette lit `navigator.getGamepads` dans le rendu. À la fermeture d'un menu, `Input.suppressHeld()` ignore les boutons encore tenus (Espace, A) jusqu'à leur relâchement. En personnalisation, la caméra passe devant le skateur (`HUD.showcase*`).
- **HUD** (`Hud`) : écoute `score.events`, `challenges.events` et `profile.events` ; écrit le DOM seulement sur changement, animations en CSS (`styles.ts`). La jauge d'équilibre (`BalanceMeter`) lui appartient.
- **Profil et sauvegarde** : `main.ts` ouvre `SaveStore` (IndexedDB `skate` / `save` / `profile`, repli localStorage `skate.save.v1`, reprise unique de l'ancienne clé `skate.scores.v1`), puis `Profile.load` valide les données (`sanitizeSave`). `Profile` sert de `RecordsStore` au score et de `ChallengeStore` aux défis ; chaque modification est écrite après 400 ms, et tout de suite quand la page se cache. Les réglages et l'apparence sont appliqués par `Game` sur les événements `settings` et `custom`.
- **Progression** : XP = points des combos validés × `PROGRESSION.xpPerPoint` + récompenses des défis ; niveau par paliers croissants (`levelBaseXp`, `levelGrowth`). Boards et couleurs se débloquent par niveau, certains boards par un défi (`unlocks.ts`).
- **Défis de zone** (`ChallengeSystem`) : zones circulaires (`world/challenges.ts`), suivies par masque de bits à chaque pas. Types : combo validé avec un élément dans la zone, grind ou manual d'une longueur ou durée, saut d'une famille (flip, rotation...), chrono lancé en entrant dans la zone (points ou nombre d'éléments). Progression maximale gardée, réussite unique.
- **Qualité graphique** (`QUALITY_PRESETS`) : bas, moyen, haut ; appliquée à chaud par `Renderer.setQuality` (pixel ratio, ombres, recompilation des matériaux) et `Level.setQuality` (brouillard, shadow map). La distance de rendu de la caméra suit le brouillard. L'antialiasing reste celui du démarrage. Par défaut : moyen sur écran tactile, haut sinon.
- **PWA** (`vite.config.ts`, `registerType: 'prompt'`) : manifeste complet (`display: standalone` avec `display_override` plein écran, paysage, `start_url` et `scope` à `/`, icônes 192 et 512 dont une maskable). Le service worker précache tout le build ; le WASM de Rapier est intégré en base64 au bundle JS (`rapier3d-compat`) et part donc avec lui, d'où `maximumFileSizeToCacheInBytes` relevé. Navigations hors ligne servies par `index.html`, autres requêtes de même origine en stale-while-revalidate (`skate-runtime`). `clientsClaim` : le premier service worker prend la page ouverte ; une nouvelle version attend l'accord du joueur (bandeau, `PwaUpdates`), qui recharge aussi au changement de contrôleur quand workbox-window ne le fait pas (première visite).
- **Plateforme** : `InstallPrompt` est créé dans `main.ts` avant tout `await` pour ne pas manquer `beforeinstallprompt` ; carte d'installation sur l'accueil (« Plus tard » mémorisé dans les réglages), écran d'aide iOS. `DisplayMode.enterGame` (appelé dans le clic de « Jouer » ou « Reprendre », geste du joueur oblige) demande le plein écran si le réglage l'autorise et en interface tactile, puis `screen.orientation.lock('landscape')` ; en portrait sur interface tactile, l'écran de rotation recouvre tout et met la partie en pause. Zoom, pull-to-refresh, défilement élastique, sélection et menu contextuel sont neutralisés (`index.html`, `DisplayMode`, `TouchControls`).
- **Vérification PWA** : Lighthouse a retiré sa catégorie PWA à partir de la v12 ; l'audit se fait avec `lighthouse@11` (`--only-categories=pwa`) sur `npm run preview`. Le hors ligne se vérifie à part (navigateur hors ligne après installation du service worker, rechargement, partie lancée).
- **Performances** (étape 11) : le décor est regroupé après construction (`batchStatic`) ; les géométries identiques sont partagées par l'`AssetProvider` (cache par paramètres, tubes à longueur 1 mis à l'échelle), ce qui permet l'instanciation. Ombres : skateur seul en qualité basse et moyenne, décor en haute, zone d'ombre réduite (`QualityPreset.shadowExtent`), petites pièces du rig sans ombre. Le pas Rapier ne tourne que s'il y a des corps dynamiques (plus un pas après leur retrait). La manette est lue une fois par image (`GAMEPAD_REFRESH_MS`). Sons en pools de voix (`AUDIO`). Bundle découpé en `three`, `rapier` et code du jeu. Profilage : `GameLoop.stats.fixedMs` / `renderMs`, et dans `debugState()` draw calls, triangles, meshes, objets projetant une ombre. Mesures et méthode dans le README.
- **Garde-fous** (`Game.checkSafety`, réglages `SAFETY`) : position invalide, sortie du parc ou sous le plan de chute, capsule enfoncée dans le décor (sur sol plat), skateur figé en l'air : retour au dernier point sûr, ou au départ si ce point est lui-même en cause ou hors du parc. Pause automatique à la perte de focus.
- **Erreurs** : `main.ts` vérifie WebAssembly et WebGL 2 avant de démarrer et affiche un message clair (`BootError`, `ErrorScreen`). Une exception dans la boucle l'arrête (`LoopCallbacks.onError`) avec un message, après écriture de la sauvegarde. Contexte WebGL perdu : pause et écran d'attente, restauration automatique (`Renderer.onContextLost` / `onContextRestored`).
- **Replay** : `Game.recordReplay` enregistre un pas fixe sur deux l'état affiché (pose de `Skater.readPose`, planche lâchée comprise, pose d'animation de `SkaterVisual.currentPose`, articulations du ragdoll, caméra). Pause > Replay : la simulation reste figée, `renderReplay` applique l'image interpolée au rig et à la caméra (enregistrée ou orbite libre), puis le rendu normal reprend à la sortie.
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
- [x] 6. Bails : déclencheurs (réception, équilibre, mur, obstacle bas), ragdoll Rapier à rotules lancé depuis la pose affichée, planche indépendante, relève sur un point dégagé avec fondu, R pour se relever, caméra sur le corps, sons d'impact
- [x] 7. Score et combos : valeur de base par trick, combos prolongés par grinds et manuals, délai au sol configurable, multiplicateur par éléments distincts, bonus de variété, de hauteur, de distance et de transition grind ↔ manual, pénalité de répétition, validation sur réception propre, annulation totale sur chute, bus d'événements typé, meilleur score de session et records en localStorage
- [x] 8. HUD, menus, sauvegarde : HUD (combo, nom du trick, validation et annulation animées, jauge, vitesse, niveau, objectifs, notifications), écran de chargement, menus responsive (accueil, pause, réglages, personnalisation, objectifs, aide illustrée), qualité graphique réelle, défis de zone, niveau et déblocages, sauvegarde IndexedDB avec repli localStorage, manette Xbox / PlayStation dans le jeu et les menus
- [x] 9. Contrôles tactiles : joystick flottant, swipe des flicks par le même code que la souris, boutons déplaçables et redimensionnables, multitouch, touchcancel, gestes du navigateur neutralisés, retour haptique, bascule automatique HUD PC / mobile, safe areas ; reconnaissance des flicks vifs (rayon minimal mesuré sur les segments)
- [x] 10. PWA : manifeste complet et icônes PNG (dont maskable), précache de tout le build (WASM compris) et stale-while-revalidate pour le reste, mise à jour sur accord du joueur, hors ligne vérifié, invite d'installation et aide iOS, plein écran et verrouillage en paysage, écran de rotation ; Lighthouse 11 PWA : 100
- [x] 11. Optimisation et finitions : profilage CPU et GPU, décor fusionné et instancié, ombres limitées, pools de sons, allocations réduites, qualité qui règle aussi les particules, bundle découpé ; passe de réglage mesurée (sensibilité des flicks 1,2, repli des gestes flous) ; garde-fous anti-coincement et hors zone, pause à la perte de focus, erreurs WASM et WebGL ; replay des 30 dernières secondes avec caméra libre et ralenti ; README

## Règle de fin d'étape

Après chaque étape, sans exception :

1. Lancer `npm run build`.
2. Corriger toutes les erreurs TypeScript et de build, puis relancer jusqu'à un build propre.
3. Tester le comportement dans le navigateur (`npm run dev`, et `npm run preview` pour ce qui touche la PWA), sur viewport desktop et mobile émulé, en surveillant la console et le panneau de debug.
4. Mettre à jour la liste des étapes terminées ci-dessus.
