import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { AssetProvider } from './assets';
import { RENDER, type QualityPreset } from '@/config/render';
import { GrindNetwork } from './GrindNetwork';
import {
  addBox,
  addGrindRail,
  addLedge,
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
const HANDRAIL_HEIGHT = 0.6;
const HANDRAIL_RADIUS = 0.025;
/** Petit gap : deux plateformes de 60 cm séparées de 1,6 m. */
const GAP_X = -20;
const GAP_WIDTH = 4;
const GAP_HEIGHT = 0.6;
const GAP_RAMP = 2.4;
const GAP_DECK = 2;
const GAP_LENGTH = 1.6;
const GAP_START_Z = 6;
/** Série de rails (sud-est) : [début, fin] du dessus du rail, forme. Longueurs et pentes variées. */
const RAILS: ReadonlyArray<{ from: [number, number, number]; to: [number, number, number]; shape: 'round' | 'flat' }> = [
  { from: [4, 0.35, 22], to: [8, 0.35, 22], shape: 'round' },
  { from: [4, 0.5, 26], to: [11, 0.5, 26], shape: 'round' },
  { from: [4, 0.4, 30], to: [9, 0.4, 30], shape: 'flat' },
  // Descentes et montée, abordées depuis l'est (côté +X) où l'élan est libre.
  { from: [19.5, 0.62, 22], to: [14, 0.28, 22], shape: 'round' },
  { from: [19, 0.3, 26], to: [14, 0.55, 26], shape: 'flat' },
  { from: [18, 0.75, 30], to: [14, 0.25, 30], shape: 'round' },
];
const RAIL_RADIUS = 0.025;
const FLAT_BAR_HALF = 0.025;
const RAIL_POST_SPACING = 2.5;
const RAIL_POST_RADIUS = 0.03;
/** Ledge continu (sud-ouest), le long de X. */
const LONG_LEDGE = { center: { x: -28, y: 0.225, z: 33 }, size: { x: 0.6, y: 0.45, z: 16 } };
/** Boîte de manual (remplace l'ancien manual pad). */
const MANUAL_BOX = { center: { x: 12, y: 0.125, z: 12 }, size: { x: 1.6, y: 0.25, z: 6 } };
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
 * - Ajouts de l'étape 5 : six rails (ronds, plats, à plat, en descente, en montée), ledge continu,
 *   boîte de manual. Les ledges, la main courante et les copings sont grindables.
 */
export class Level {
  readonly root = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  /** Lignes de grind : rails, arêtes de ledges et de boxes, copings. */
  readonly grinds = new GrindNetwork();
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

    const ctx: BuildContext = { physics, assets, root: this.root, grinds: this.grinds };
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
    this.addQuarterPipe(ctx, quarterPipe(3.2, 2.2, 3.9, 14), 2.2, 22, { x: 0, z: -33 });
    addProfileModule(ctx, bank(3.2, 1.5, 6.75), 24, { x: -30, z: 0, yaw: Math.PI / 2 });
    addProfileModule(ctx, funbox(2.6, 0.75, 3), 5, { x: -10, z: -8 });
    addProfileModule(ctx, kicker(1.8, 0.45), 1.6, { x: 9, z: 0 });
    addProfileModule(ctx, hump(12, 0.6), 6, { x: 24, z: 14, yaw: Math.PI / 2 });
    // Boîte de manual : 25 cm, on y monte en ollie ; ses deux arêtes longues se grindent.
    addLedge(ctx, MANUAL_BOX.center, MANUAL_BOX.size);
    // Curb bas : 12 cm, bloque la planche sans bloquer la capsule du corps.
    addBox(ctx, { x: -6, y: 0.06, z: 16 }, { x: 6, y: 0.12, z: 0.3 });
    // Ledge court, grindable des deux côtés.
    addLedge(ctx, { x: 20, y: 0.25, z: -14 }, { x: 0.5, y: 0.5, z: 6 });
    // Ledge continu de 16 m, le long de X.
    addLedge(ctx, LONG_LEDGE.center, LONG_LEDGE.size, Math.PI / 2);
    for (const r of RAILS) {
      addGrindRail(ctx, [new THREE.Vector3(...r.from), new THREE.Vector3(...r.to)], {
        shape: r.shape,
        radius: r.shape === 'round' ? RAIL_RADIUS : FLAT_BAR_HALF,
        postSpacing: RAIL_POST_SPACING,
        postRadius: RAIL_POST_RADIUS,
      });
    }

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
    this.addQuarterPipe(ctx, quarterPipe(2, 1.2, 3.6, 10), 1.2, 8, { x: 34.5, z: 6, yaw: -Math.PI / 2 });

    this.buildStairs(ctx);
  }

  private buildStairs(ctx: BuildContext): void {
    const stairs = stairSet(3.6, STAIRS_HEIGHT, 3, STAIRS_STEPS, STAIRS_TREAD);
    addProfileModule(ctx, stairs, STAIRS_WIDTH, STAIRS);
    // Main courante sur le côté : suit la ligne des nez de marche, deux montants.
    const top = placePoint(STAIRS, HANDRAIL_X, STAIRS_HEIGHT + HANDRAIL_HEIGHT, stairs.topZ + 0.25);
    const bottom = placePoint(STAIRS, HANDRAIL_X, HANDRAIL_HEIGHT, stairs.bottomZ - 0.35);
    // La main courante se grinde : sa ligne est le dessus du tube.
    const handrail = addRail(ctx, top, bottom, HANDRAIL_RADIUS);
    ctx.physics.markGrindOnly(handrail);
    const lift = new THREE.Vector3(0, HANDRAIL_RADIUS, 0);
    this.grinds.addLine([top.clone().add(lift), bottom.clone().add(lift)], 'round', 'metal', handrail);
    addRail(ctx, placePoint(STAIRS, HANDRAIL_X, STAIRS_HEIGHT, stairs.topZ + 0.25), top, HANDRAIL_RADIUS);
    addRail(ctx, placePoint(STAIRS, HANDRAIL_X, 0, stairs.bottomZ - 0.35), bottom, HANDRAIL_RADIUS);
  }

  /** Quarter pipe et son coping (arête supérieure), grindable depuis la transition. */
  private addQuarterPipe(ctx: BuildContext, qp: ReturnType<typeof quarterPipe>, height: number, width: number, at: Placement): void {
    addProfileModule(ctx, qp, width, at);
    const a = placePoint(at, -width / 2, height, qp.copingZ);
    const b = placePoint(at, width / 2, height, qp.copingZ);
    ctx.grinds.addLine([a, b], 'coping', 'concrete');
  }

  /** Qualité graphique : distance du brouillard, ombres du soleil et taille de leur shadow map. */
  setQuality(q: QualityPreset, scene: THREE.Scene): void {
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = q.fogNear;
      scene.fog.far = q.fogFar;
    }
    this.sun.castShadow = q.shadows;
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== q.shadowMapSize) {
      shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      // La shadow map est recréée à la bonne taille au prochain rendu.
      shadow.map?.dispose();
      shadow.map = null;
    }
  }

  /** Fait suivre la shadow map autour d'un point, calé sur la grille de texels pour éviter le scintillement. */
  followShadow(focus: THREE.Vector3): void {
    const texel = (RENDER.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    this.snapped.set(Math.round(focus.x / texel) * texel, Math.round(focus.y / texel) * texel, Math.round(focus.z / texel) * texel);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).add(SUN_OFFSET);
  }
}
