import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, MATERIALS, WORLD, type SurfaceMaterial } from '@/config/physics';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

/** Charge le module WASM de Rapier une seule fois. */
export function loadRapier(): Promise<Rapier> {
  rapierReady ??= RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Résultat d'un rayon : distance, point, normale, collider et matériau touchés. */
export interface RayHit {
  toi: number;
  point: Vec3;
  normal: Vec3;
  collider: RAPIER.Collider;
  material: SurfaceMaterial;
}

/**
 * Monde physique Rapier piloté à pas fixe.
 * Ne jamais appeler step() avec un dt variable : c'est GameLoop qui cadence.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly materials = new Map<number, SurfaceMaterial>();
  private readonly ray: RAPIER.Ray;
  private probeBall: RAPIER.Ball | null = null;

  constructor(readonly rapier: Rapier) {
    this.world = new rapier.World({ x: 0, y: WORLD.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  step(): void {
    this.world.step();
  }

  /** Applique friction et restitution d'un matériau de surface à un descripteur de collider. */
  withMaterial(desc: RAPIER.ColliderDesc, material: SurfaceMaterial): RAPIER.ColliderDesc {
    const m = MATERIALS[material];
    return desc.setFriction(m.friction).setRestitution(m.restitution);
  }

  /** Crée un collider statique sans corps parent et mémorise son matériau. */
  createStatic(desc: RAPIER.ColliderDesc, material: SurfaceMaterial): RAPIER.Collider {
    const collider = this.world.createCollider(this.withMaterial(desc, material));
    this.materials.set(collider.handle, material);
    return collider;
  }

  materialOf(collider: RAPIER.Collider): SurfaceMaterial {
    return this.materials.get(collider.handle) ?? 'concrete';
  }

  /**
   * Lance un rayon solide. Un départ à l'intérieur d'une forme (toi nul) n'est pas un contact
   * exploitable et renvoie null.
   */
  castRay(origin: Vec3, dir: Vec3, maxToi: number, exclude?: RAPIER.Collider): RayHit | null {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const hit = this.world.castRayAndGetNormal(this.ray, maxToi, true, undefined, undefined, exclude);
    if (!hit || hit.timeOfImpact <= 1e-5) return null;
    const t = hit.timeOfImpact;
    return {
      toi: t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: hit.normal,
      collider: hit.collider,
      material: this.materialOf(hit.collider),
    };
  }

  /**
   * Balaye une sphère de `from` vers `dir` (unitaire) et renvoie la distance libre,
   * ou maxDist si rien n'est touché. Sert à la collision caméra.
   */
  sphereClearance(from: Vec3, dir: Vec3, maxDist: number, radius: number, exclude?: RAPIER.Collider): number {
    if (!this.probeBall || this.probeBall.radius !== radius) this.probeBall = new this.rapier.Ball(radius);
    const ball = this.probeBall;
    const hit = this.world.castShape(from, IDENTITY, dir, ball, 0, maxDist, true, undefined, undefined, exclude);
    return hit ? hit.time_of_impact : maxDist;
  }

  dispose(): void {
    this.world.free();
  }
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
