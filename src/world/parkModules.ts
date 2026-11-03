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

const UP = new THREE.Vector3(0, 1, 0);
