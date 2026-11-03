import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { AssetProvider } from './assets';
import { RENDER } from '@/config/render';
import {
  addBox,
  addProfileModule,
  addRail,
  bank,
  funbox,
  hump,
  kicker,
  placePoint,
  quarterPipe,
  stairSet,
  type BuildContext,
  type Placement,
} from './parkModules';

// Mise en page du skatepark de test (m).
/** Demi-côté de la zone roulable, intérieur des murs. */
const PARK_HALF = 40;
const WALL_HEIGHT = 1.5;
const WALL_THICKNESS = 0.6;
const GROUND_SIZE = 200;
const GROUND_THICKNESS = 0.5;
/** Escalier : 5 marches de 17 cm, palier de 3 m, rampe d'accès à 13°. */
const STAIRS: Placement = { x: 28, z: -2 };
const STAIRS_WIDTH = 6;
const STAIRS_HEIGHT = 0.85;
const STAIRS_STEPS = 5;
const STAIRS_TREAD = 0.35;
/** Rampe d'escalier (main courante) : décalage latéral, hauteur au-dessus des nez de marche, rayon. */
const HANDRAIL_X = 2.6;
const HANDRAIL_HEIGHT = 0.85;
const HANDRAIL_RADIUS = 0.025;
/** Petit gap : deux plateformes de 60 cm séparées de 1,6 m. */
const GAP_X = -20;
const GAP_WIDTH = 4;
const GAP_HEIGHT = 0.6;
const GAP_RAMP = 2.4;
const GAP_DECK = 2;
const GAP_LENGTH = 1.6;
const GAP_START_Z = 6;
/** Position du soleil relative au point suivi par l'ombre (m). */
const SUN_OFFSET = new THREE.Vector3(12, 20, 8);

/** Point d'apparition et cap initial du skateur. */
export const SPAWN = {
  position: new THREE.Vector3(0, 0, 12),
  forward: new THREE.Vector3(0, 0, -1),
} as const;

/**
 * Skatepark de test : dalle de béton fermée par des murs, quelques modules simples.
 * - Nord : quarter pipe large.
 * - Ouest : bank à 25°.
 * - Centre : funbox, kicker, manual pad, curb bas, bosse douce, ledge.
 * - Ajouts de l'étape 2 : marche de 20 cm, petit gap, petit quarter pipe, escalier avec rampe.
 */
export class Level {
  readonly root = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly snapped = new THREE.Vector3();

  constructor(scene: THREE.Scene, physics: PhysicsWorld, assets: AssetProvider) {
    this.root.name = 'level';
    scene.add(this.root);

    scene.background = new THREE.Color(RENDER.clearColor);
    scene.fog = new THREE.Fog(RENDER.clearColor, RENDER.fogNear, RENDER.fogFar);

    this.root.add(new THREE.HemisphereLight(0xdfe9f3, 0x4a4036, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const s = RENDER.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
    this.root.add(this.sun, this.sun.target);

    const ctx: BuildContext = { physics, assets, root: this.root };
    this.buildGround(ctx);
    this.buildWalls(ctx);
    this.buildModules(ctx);
  }

  private buildGround(ctx: BuildContext): void {
    this.root.add(ctx.assets.create('ground', { size: { x: GROUND_SIZE, y: 0, z: GROUND_SIZE } }));
    const R = ctx.physics.rapier;
    ctx.physics.createStatic(
      R.ColliderDesc.cuboid(GROUND_SIZE / 2, GROUND_THICKNESS / 2, GROUND_SIZE / 2).setTranslation(0, -GROUND_THICKNESS / 2, 0),
      'concrete',
    );
  }

  private buildWalls(ctx: BuildContext): void {
    const len = PARK_HALF * 2 + WALL_THICKNESS * 2;
    const off = PARK_HALF + WALL_THICKNESS / 2;
    const y = WALL_HEIGHT / 2;
    addBox(ctx, { x: 0, y, z: -off }, { x: len, y: WALL_HEIGHT, z: WALL_THICKNESS }, 0, 'wall');
    addBox(ctx, { x: 0, y, z: off }, { x: len, y: WALL_HEIGHT, z: WALL_THICKNESS }, 0, 'wall');
    addBox(ctx, { x: -off, y, z: 0 }, { x: WALL_THICKNESS, y: WALL_HEIGHT, z: len }, 0, 'wall');
    addBox(ctx, { x: off, y, z: 0 }, { x: WALL_THICKNESS, y: WALL_HEIGHT, z: len }, 0, 'wall');
  }

  private buildModules(ctx: BuildContext): void {
    addProfileModule(ctx, quarterPipe(3.2, 2.2, 3.9, 14), 22, { x: 0, z: -33 });
    addProfileModule(ctx, bank(3.2, 1.5, 6.75), 24, { x: -30, z: 0, yaw: Math.PI / 2 });
    addProfileModule(ctx, funbox(2.6, 0.75, 3), 5, { x: -10, z: -8 });
    addProfileModule(ctx, kicker(1.8, 0.45), 1.6, { x: 9, z: 0 });
    addProfileModule(ctx, hump(12, 0.6), 6, { x: 24, z: 14, yaw: Math.PI / 2 });
    // Manual pad : 30 cm, trop haut pour la planche, il faut le contourner (ollie à l'étape 2).
    addBox(ctx, { x: 12, y: 0.15, z: 12 }, { x: 1.6, y: 0.3, z: 4.5 });
    // Curb bas : 12 cm, bloque la planche sans bloquer la capsule du corps.
    addBox(ctx, { x: -6, y: 0.06, z: 16 }, { x: 6, y: 0.12, z: 0.3 });
    // Ledge.
    addBox(ctx, { x: 20, y: 0.25, z: -14 }, { x: 0.5, y: 0.5, z: 6 });

    // Marche de 20 cm : à monter en ollie, à descendre en roulant.
    addBox(ctx, { x: -20, y: 0.1, z: 24 }, { x: 8, y: 0.2, z: 4 });

    // Petit gap : rampe et plateforme d'appel, vide, plateforme et rampe de réception (tournée de 180°).
    const gapDeckEnd = GAP_START_Z - GAP_RAMP - GAP_DECK;
    addProfileModule(ctx, bank(GAP_RAMP, GAP_HEIGHT, GAP_DECK), GAP_WIDTH, { x: GAP_X, z: GAP_START_Z });
    addProfileModule(ctx, bank(GAP_RAMP, GAP_HEIGHT, GAP_DECK), GAP_WIDTH, {
      x: GAP_X,
      z: gapDeckEnd - GAP_LENGTH - GAP_RAMP - GAP_DECK,
      yaw: Math.PI,
    });

    // Petit quarter pipe à l'est, abordé en roulant vers +X. Les decks vont jusqu'au mur : pas de trou derrière.
    addProfileModule(ctx, quarterPipe(2, 1.2, 3.6, 10), 8, { x: 34.5, z: 6, yaw: -Math.PI / 2 });

    this.buildStairs(ctx);
  }

  private buildStairs(ctx: BuildContext): void {
    const stairs = stairSet(3.6, STAIRS_HEIGHT, 3, STAIRS_STEPS, STAIRS_TREAD);
    addProfileModule(ctx, stairs, STAIRS_WIDTH, STAIRS);
    // Main courante sur le côté : suit la ligne des nez de marche, deux montants.
    const top = placePoint(STAIRS, HANDRAIL_X, STAIRS_HEIGHT + HANDRAIL_HEIGHT, stairs.topZ + 0.25);
    const bottom = placePoint(STAIRS, HANDRAIL_X, HANDRAIL_HEIGHT, stairs.bottomZ - 0.35);
    addRail(ctx, top, bottom, HANDRAIL_RADIUS);
    addRail(ctx, placePoint(STAIRS, HANDRAIL_X, STAIRS_HEIGHT, stairs.topZ + 0.25), top, HANDRAIL_RADIUS);
    addRail(ctx, placePoint(STAIRS, HANDRAIL_X, 0, stairs.bottomZ - 0.35), bottom, HANDRAIL_RADIUS);
  }

  /** Fait suivre la shadow map autour d'un point, calé sur la grille de texels pour éviter le scintillement. */
  followShadow(focus: THREE.Vector3): void {
    const texel = (RENDER.shadowExtent * 2) / RENDER.shadowMapSize;
    this.snapped.set(Math.round(focus.x / texel) * texel, Math.round(focus.y / texel) * texel, Math.round(focus.z / texel) * texel);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).add(SUN_OFFSET);
  }
}
