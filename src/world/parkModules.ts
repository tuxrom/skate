import * as THREE from 'three';
import type { SurfaceMaterial } from '@/config/physics';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { AssetProvider, Finish, Profile } from './assets';

/**
 * Constructeurs de modules de skatepark. Chaque module produit son visuel (via AssetProvider)
 * et ses colliders Rapier à partir de la même description géométrique.
 *
 * Convention des profils : coordonnées (z, y) locales, le module est abordé depuis +z
 * et monte vers -z. La largeur s'étend sur l'axe X local, centrée.
 */
export interface BuildContext {
  physics: PhysicsWorld;
  assets: AssetProvider;
  root: THREE.Object3D;
}

export interface Placement {
  x: number;
  z: number;
  /** Rotation autour de Y (rad). 0 : on aborde le module en roulant vers -Z. */
  yaw?: number;
  /** Altitude de la base (m). */
  y?: number;
}

/** Module extrudé : un contour pour le visuel, des morceaux convexes pour la physique. */
export interface ProfileModule {
  outline: Profile;
  /** Décomposition convexe du contour. */
  parts: Profile[];
}

export function addBox(
  ctx: BuildContext,
  center: THREE.Vector3Like,
  size: THREE.Vector3Like,
  yaw = 0,
  finish: Finish = 'park',
  material: SurfaceMaterial = 'concrete',
): void {
  const mesh = ctx.assets.create('box', { size, finish });
  mesh.position.set(center.x, center.y, center.z);
  mesh.rotation.y = yaw;
  ctx.root.add(mesh);
  const R = ctx.physics.rapier;
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  ctx.physics.createStatic(
    R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(center.x, center.y, center.z).setRotation(q),
    material,
  );
}

export function addProfileModule(
  ctx: BuildContext,
  module: ProfileModule,
  width: number,
  at: Placement,
  finish: Finish = 'park',
  material: SurfaceMaterial = 'concrete',
): void {
  const yaw = at.yaw ?? 0;
  const y = at.y ?? 0;
  const mesh = ctx.assets.create('prism', { profile: module.outline, width, finish });
  mesh.position.set(at.x, y, at.z);
  mesh.rotation.y = yaw;
  ctx.root.add(mesh);

  const R = ctx.physics.rapier;
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const hw = width / 2;
  for (const part of module.parts) {
    const pts = new Float32Array(part.length * 6);
    part.forEach(([pz, py], i) => {
      pts.set([-hw, py, pz, hw, py, pz], i * 6);
    });
    const desc = R.ColliderDesc.convexHull(pts);
    if (!desc) throw new Error('Enveloppe convexe invalide');
    ctx.physics.createStatic(desc.setTranslation(at.x, y, at.z).setRotation(q), material);
  }
}

/** Quarter pipe : arc de rayon `radius` jusqu'à `height`, puis un deck plat de `deckLength`. */
export function quarterPipe(radius: number, height: number, deckLength: number, segments: number): ProfileModule {
  const maxAngle = Math.acos(1 - height / radius);
  const arc: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (maxAngle * i) / segments;
    arc.push([-radius * Math.sin(a), radius * (1 - Math.cos(a))]);
  }
  const topZ = arc[arc.length - 1]![0];
  const backZ = topZ - deckLength;
  const outline: [number, number][] = [...arc, [backZ, height], [backZ, 0]];
  const parts: Profile[] = [];
  for (let i = 0; i < segments; i++) {
    const [z0, y0] = arc[i]!;
    const [z1, y1] = arc[i + 1]!;
    parts.push(y0 > 1e-4 ? [[z0, 0], [z0, y0], [z1, y1], [z1, 0]] : [[z0, 0], [z1, y1], [z1, 0]]);
  }
  parts.push([[topZ, 0], [topZ, height], [backZ, height], [backZ, 0]]);
  return { outline, parts };
}

/** Kicker : plan incliné droit, arête vive en haut. */
export function kicker(length: number, height: number): ProfileModule {
  const outline: Profile = [[length / 2, 0], [-length / 2, height], [-length / 2, 0]];
  return { outline, parts: [outline] };
}

/** Funbox : montée, plateau, descente. */
export function funbox(rampLength: number, height: number, topLength: number): ProfileModule {
  const t = topLength / 2;
  const outline: Profile = [[t + rampLength, 0], [t, height], [-t, height], [-t - rampLength, 0]];
  return { outline, parts: [outline] };
}

/** Bank : plan incliné suivi d'un deck plat. */
export function bank(length: number, height: number, deckLength: number): ProfileModule {
  const outline: Profile = [[0, 0], [-length, height], [-length - deckLength, height], [-length - deckLength, 0]];
  return { outline, parts: [outline] };
}

/** Bosse symétrique très douce, pour tester les arêtes convexes à faible angle. */
export function hump(length: number, height: number): ProfileModule {
  const outline: Profile = [[length / 2, 0], [0, height], [-length / 2, 0]];
  return { outline, parts: [outline] };
}

/**
 * Escalier avec rampe d'accès : on monte la rampe vers -z, on traverse le palier,
 * puis `steps` marches de hauteur `height / steps` redescendent au sol.
 */
export function stairSet(rampLength: number, height: number, platformLength: number, steps: number, tread: number): ProfileModule & {
  topZ: number;
  bottomZ: number;
} {
  const rise = height / steps;
  const topZ = -rampLength - platformLength;
  const outline: [number, number][] = [[0, 0], [-rampLength, height], [topZ, height]];
  for (let i = 1; i <= steps; i++) {
    outline.push([topZ - (i - 1) * tread, height - i * rise]);
    if (i < steps) outline.push([topZ - i * tread, height - i * rise]);
  }
  const bottomZ = topZ - (steps - 1) * tread;
  const parts: Profile[] = [
    [[0, 0], [-rampLength, height], [-rampLength, 0]],
    [[-rampLength, 0], [-rampLength, height], [topZ, height], [topZ, 0]],
  ];
  for (let j = 1; j < steps; j++) {
    const z0 = topZ - (j - 1) * tread;
    const z1 = topZ - j * tread;
    const y = height - j * rise;
    parts.push([[z0, 0], [z0, y], [z1, y], [z1, 0]]);
  }
  return { outline, parts, topZ, bottomZ };
}

/** Convertit un point local d'un module (x, y, z) en coordonnées monde selon son placement. */
export function placePoint(at: Placement, x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const yaw = at.yaw ?? 0;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  return out.set(at.x + x * c + z * sn, (at.y ?? 0) + y, at.z - x * sn + z * c);
}

/** Tube métallique (rail, montant) entre deux points, avec un collider capsule. */
export function addRail(ctx: BuildContext, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.divideScalar(length));
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const mesh = ctx.assets.create('rail', { length, radius });
  mesh.position.copy(mid);
  mesh.quaternion.copy(q);
  ctx.root.add(mesh);
  const R = ctx.physics.rapier;
  ctx.physics.createStatic(R.ColliderDesc.capsule(length / 2, radius).setTranslation(mid.x, mid.y, mid.z).setRotation(q), 'metal');
}

const UP = new THREE.Vector3(0, 1, 0);
