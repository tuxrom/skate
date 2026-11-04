# Skate

Jeu de skateboard 3D en vue troisième personne, jouable dans le navigateur sur ordinateur et sur mobile, installable en PWA et jouable hors ligne. Les tricks se font au stick droit (flicks), avec des grinds, des manuals, des grabs, des rotations et un système de combos.

Tout le contenu est original et généré par le code : géométries procédurales, textures dessinées sur canvas, sons synthétisés avec la Web Audio API. Aucun asset externe n'est nécessaire.

- **Rendu** : Three.js. **Physique** : Rapier (`@dimforge/rapier3d-compat`, WebAssembly intégré au bundle).
- **Langage et build** : TypeScript strict, Vite, vite-plugin-pwa (Workbox).

## Démarrage

Prérequis : Node.js 20 ou plus récent.

```sh
npm ci
npm run dev
```

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement (http://localhost:5173), panneau de debug actif |
| `npm run dev:host` | Idem, exposé sur le réseau local pour tester sur un téléphone |
| `npm run typecheck` | Vérification TypeScript seule |
| `npm run build` | Vérification TypeScript puis build de production dans `dist/`, service worker compris |
| `npm run preview` | Sert `dist/` localement (http://localhost:4173), service worker actif |
| `npm run icons` | Régénère les icônes PWA depuis `public/icon.svg` |

En production, ajouter `?debug` à l'URL affiche le panneau de debug (`F3` ou `²` le bascule). En mode debug, `window.__skate` donne accès au jeu : `debugState()`, `debugTeleport(x, z, yaw)`, `debugCameraOverride(offset)`.

## Déploiement statique en HTTPS

Le build est un site statique : il suffit de servir le contenu de `dist/`. Trois exigences :

1. **HTTPS obligatoire** (sauf `localhost`). Le service worker, l'installation, le plein écran, le verrouillage de l'orientation et les vibrations en dépendent.
2. **Servi à la racine du domaine.** Le manifeste déclare `start_url` et `scope` à `/`. Pour un sous-chemin, régler `base` dans `vite.config.ts`, ainsi que `start_url` et `scope` du manifeste.
3. **En-têtes de cache adaptés.** `sw.js`, `index.html` et `manifest.webmanifest` ne doivent jamais être mis en cache longtemps, sinon les mises à jour n'arrivent pas. Les fichiers de `assets/` ont un hash dans leur nom et peuvent l'être indéfiniment.

Exemple Nginx :

```nginx
server {
  listen 443 ssl http2;
  server_name skate.example.fr;
  root /var/www/skate/dist;

  types { application/manifest+json webmanifest; }

  location = /sw.js               { add_header Cache-Control "no-cache"; }
  location = /index.html          { add_header Cache-Control "no-cache"; }
  location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }
  location /assets/               { add_header Cache-Control "public, max-age=31536000, immutable"; }

  # Repli sur l'application (le service worker fait de même hors ligne).
  location / { try_files $uri $uri/ /index.html; }

  gzip on;
  gzip_types application/javascript text/css application/json application/manifest+json image/svg+xml;
}
```

Derrière un reverse proxy (nginx-proxy-manager, Caddy, Traefik), le principe est le même : un serveur statique pour `dist/`, et le certificat sur le proxy. Netlify, Cloudflare Pages ou GitHub Pages conviennent aussi, à condition de respecter les en-têtes ci-dessus.

Pour vérifier après un déploiement : ouvrir le site, attendre le message « Prêt à jouer hors ligne », couper le réseau, recharger. Le jeu doit démarrer et la partie se lancer.

## Contrôles

| Action | Clavier et souris | Manette (Xbox / PlayStation) | Tactile |
| --- | --- | --- | --- |
| Diriger, freiner (arrière), se grouper (avant) | Z Q S D (AZERTY) ou W A S D | Stick gauche | Joystick sous le pouce gauche |
| Pousser, accélérer | Shift (tenu : poussées plus fortes) | A / Croix | Bouton Pousser, ou joystick à fond vers l'avant |
| Flicks (pieds) | Glisser bouton gauche, ou flèches | Stick droit | Glisser du pouce droit |
| Ollie | Espace tenu puis relâché, ou flick bas puis haut | Stick droit bas puis haut | Glisser bas puis haut |
| Grab | E tenu + flèche, ou clic droit + glisser | LT / RT (L2 / R2) tenue + stick droit | Bouton Grab tenu + glisser à droite |
| Rotation en l'air | Q / D | Stick gauche | Joystick |
| Manual, nose manual | Ctrl ou C tenu, ↑ / ↓ pour l'équilibre | LB / RB (L1 / R1) tenue, équilibre au stick gauche | Bouton Manual tenu, équilibre au joystick |
| Choix du grind à l'accrochage | S tenu : 5-0, Z / W tenu : nosegrind ou lipslide | LB : 5-0, RB : nosegrind ou lipslide | Bouton Grind : nosegrind ou lipslide, joystick en arrière : 5-0 |
| Équilibre en grind | Q / D | Stick gauche | Joystick |
| Se relever, retour au départ | R | View / Share | Bouton ↺ |
| Pause, retour dans les menus | Échap | Menu / Options, B / Rond dans les menus | Bouton ❚❚ |
| Replay | Pause > Replay | idem | idem |

**Gestes de flick** : tout geste part du stick en bas (charge, dont la durée règle la hauteur).

| Geste | Trick |
| --- | --- |
| Trait vers le haut | Ollie |
| Trait vers la diagonale haut-gauche | Kickflip |
| Trait vers la diagonale haut-droite | Heelflip |
| Demi-cercle par un côté | Pop shove-it |
| Cercle complet | 360 flip |
| 225° par la droite, sortie haut-gauche | Varial flip |
| 225° par la gauche, sortie haut-droite | Hardflip |

L'écran « Aide et gestes » du jeu montre ces gestes en schémas. Les touches sont liées par position physique : ZQSD et WASD sont la même rangée. Ctrl+W ferme l'onglet et aucune page ne peut l'en empêcher : C fait la même chose que Ctrl.

## Structure du code

```
src/
  main.ts            démarrage : vérifications WebGL et WebAssembly, chargement, création du jeu, service worker
  config/
    physics.ts       tous les réglages de gameplay (physique, tricks, score, progression, garde-fous)
    render.ts        réglages techniques : rendu, qualité graphique, caméra, HUD, tactile, audio, replay
  core/              boucle à pas fixe (120 Hz), rendu, entrées (clavier, souris, manette), reconnaissance des flicks, caméra, bus d'événements
  physics/           monde Rapier, colliders, requêtes ; interpolation des corps vers le rendu
  skater/            simulation du skateur et machine à états, tricks, grinds et manuals, rig procédural, ragdoll et chutes
  score/             combos, multiplicateur, variété, répétition, validation et annulation
  progress/          profil (niveau, XP), défis de zone, catalogue des boards et couleurs
  save/              sauvegarde IndexedDB avec repli localStorage, format et validation
  replay/            enregistrement des 30 dernières secondes
  platform/          installation PWA, plein écran et orientation, mises à jour du service worker
  world/             skatepark, modules, lignes de grind, assets procéduraux, textures, regroupement du décor statique, repères de zone
  ui/                HUD, menus, contrôles tactiles, lecteur de replay, écrans d'erreur, panneaux de debug
  audio/             moteur Web Audio et sons synthétisés (pools de voix)
```

Principes :

- La simulation avance à pas fixe ; le rendu interpole entre deux pas.
- Le gameplay lit des actions abstraites, jamais une touche.
- Tout visuel passe par un `AssetProvider` : passer à des modèles glTF ne demande d'écrire qu'une implémentation.
- Aucune allocation dans les chemins chauds.

Le détail de l'architecture est dans [`CLAUDE.md`](CLAUDE.md).

## Réglages de physique

Tous les réglages de ressenti sont dans `src/config/physics.ts`, avec leur unité et leur effet en commentaire. Unités SI ; les fenêtres d'input sont en millisecondes. Les valeurs ci-dessous ont été vérifiées lors de la passe de réglage de l'étape 11, en simulant des séquences complètes hors temps réel.

| Réglage | Valeur | Mesure |
| --- | --- | --- |
| `WORLD.gravity` | −11,5 m/s² | Un peu plus forte que le réel, pour un air plus nerveux |
| `SKATING.pushImpulse`, `pushSpeedCap` | 1,9 m/s, 7,5 m/s | Poussée tenue : 3,4 m/s après 1 s, 5,5 après 2 s, 7,3 après 4 s |
| `MATERIALS.concrete.rollingResistance` | 0,018 | Roue libre de 6 à 1 m/s en 19 s sur 64 m (0,26 m/s²) : l'élan porte d'un module à l'autre |
| `POP.minHeight`, `maxHeight`, `chargeTime` | 0,22 m, 0,85 m, 0,4 s | Pleine charge : 0,83 m et 0,73 s de vol ; saut de 4,3 m à 6 m/s |
| Gap du parc (1,6 m) | | Passe dès 5 m/s d'appel ; réception propre à 6 m/s |
| `BAIL.maxImpactSpeed` | 11 m/s | Escalier de 85 cm descendu à 7–9 m/s : impact de 6 m/s, réception propre |
| `BAIL.maxLandingTilt`, `maxLandingYawError` | 0,6 rad, 0,7 rad | Au-delà : chute ; sale au-delà de `LANDING.cleanMaxTilt` (0,2) et `cleanMaxYawError` (0,22) |
| `INPUT.popBufferMs`, `coyoteMs` | 120 ms, 90 ms | Tap juste avant la réception ; relâchement juste après une arête |
| `FLICK.sensitivity` | 1,2 (était 1) | Sur 300 gestes bruités par trick : 92 % de reconnaissance (91 % à 1, 86 % à 0,8), gestes nets tous reconnus |
| `FLICK.fallbackMaxArcness` | 0,8 (nouveau) | Un geste flou mais rectiligne prend le trait le plus proche au lieu de l'ollie : kickflip 89 → 92 %, heelflip 87 → 91 % |
| `SCORING.comboGroundTime` | 1 s | Enchaîner deux sauts demande 0,55 s au sol : la marge laisse viser sans rendre le combo infini |
| `SAFETY.*` | | Retour au dernier point sûr hors du parc, capsule enfoncée dans le décor 0,3 s, figé en l'air 0,8 s |

La sensibilité des flicks et celle du glissé sont aussi réglables dans le jeu (Réglages > Contrôles).

## Performances

La simulation tourne à 120 Hz. Trois niveaux de qualité graphique jouent sur la résolution, les ombres, la distance du brouillard et la densité des particules.

| Qualité | Résolution | Ombres | Particules |
| --- | --- | --- | --- |
| Bas | 70 %, pixel ratio ≤ 1 | aucune | 35 % |
| Moyen | pixel ratio ≤ 1,5 | skateur seul, 10 m autour, 1024 px | 70 % |
| Haut | pixel ratio ≤ 2 | skateur et décor, 24 m, 2048 px | 100 % |

La qualité moyenne est choisie par défaut sur écran tactile.

Optimisations de l'étape 11 :

- **Décor regroupé** : un mesh fusionné par matériau, et `InstancedMesh` pour les montants et tronçons de rail. Le décor passe de 49 meshes à 6, les repères de zone de 16 draw calls à 2.
- **Ombres limitées** : au skateur et au sol proche ; les petites pièces (roues, trucks) n'en projettent pas.
- **Physique** : le pas Rapier ne tourne que s'il existe des corps dynamiques (ragdoll, planche lâchée).
- **Entrées** : la manette est lue une fois par image au lieu d'une fois par pas.
- **Sons** : pools de voix, nombre de voix simultanées plafonné.
- **Allocations** : textes du HUD reconstruits seulement quand une valeur change, plus d'objet neuf par image pendant une chute.

Mesures sur la même séquence de jeu (poussée, ollies, kickflip, chute), en téléphone émulé en paysage avec le CPU ralenti 4 fois, qualité moyenne, médiane de trois passages alternés :

| | Avant | Après |
| --- | --- | --- |
| Draw calls par image | 171 | 86 |
| Objets projetant une ombre | 76 | 18 |
| Rendu, CPU par image | 16,1 ms | 10,9 ms |
| Simulation, par pas | 2,46 ms | 2,09 ms |
| Allocations | 18 Ko/s | 15 Ko/s |

À 60 images/s, il y a deux pas de simulation par image : il faut environ 15 ms de CPU par image dans ces conditions, sous les 16,7 ms du budget. Les mesures GPU d'un navigateur sans écran ne sont pas représentatives (rendu logiciel). Le budget GPU repose donc sur la réduction des draw calls et des ombres, et reste à confirmer sur un vrai téléphone de milieu de gamme.

## Robustesse

- **Garde-fous** : le skateur est ramené à son dernier point sûr s'il sort du parc, s'enfonce dans le décor, reste figé en l'air ou prend une position invalide (au départ si ce point est lui-même en cause).
- **Pause automatique** : à la perte de focus, au changement d'onglet et quand l'appareil passe en portrait.
- **Messages d'erreur** : explication claire si WebGL 2 ou WebAssembly manque, et restauration automatique si le contexte graphique est perdu. Une erreur dans la boucle arrête la partie avec un message, après sauvegarde de la progression.

## Replay

Les 30 dernières secondes sont enregistrées en continu (pose du skateur et de la planche, ragdoll, caméra, à 60 Hz). Dans la pause, **Replay** les rejoue :

- **Commandes** : lecture et pause, barre de temps, ralenti ½× et ¼×.
- **Caméra** : la caméra de jeu enregistrée, ou une caméra libre en orbite (glisser pour tourner, molette ou pincement pour zoomer).
- **Clavier** : Espace met en lecture ou en pause, ← et → avancent ou reculent d'une seconde, Échap quitte.

## Pistes d'évolution

- **Multijoueur** : sessions en ligne (WebRTC ou WebSocket) avec les fantômes des autres joueurs, interpolés comme le replay ; défis de score partagés, classements.
- **Éditeur de niveau** : poser et orienter les modules (profils extrudés, rails, ledges) dans le jeu, générer automatiquement colliders et lignes de grind, sauvegarder et partager les parcs en JSON.
- **Modèles glTF** : une implémentation `GltfAssets` de l'`AssetProvider` pour des modules et un skateur modélisés ; un rig squeletté qui implémente `SkaterRig` à la place du rig procédural.
- **Plus de spots** : rue (marches, bancs, plans inclinés), bowl, mini-rampe, park en bois ; zones d'objectifs propres à chaque spot.
- **Tricks** : nollie, fakie flips, reverts, bluntslides, wallrides, grabs supplémentaires.
- **Partage** : exporter un replay (clip vidéo via `MediaRecorder` sur le canvas, ou données rejouables), séquences de caméra.
- **Son** : samples enregistrés derrière la même interface que la synthèse, musique.
- **Bundle** : découpage du bundle et chargement du WASM de Rapier en fichier séparé, pour un premier affichage plus rapide.
