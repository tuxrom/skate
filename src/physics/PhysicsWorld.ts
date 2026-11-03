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

/**
 * Groupes de collision (Rapier : 16 bits d'appartenance, 16 bits de filtre).
 * - décor : appartient à tout, collisionne avec tout (valeur par défaut des colliders) ;
 * - ragdoll : collisionne avec le décor seulement, jamais avec ses propres membres ni avec la planche ;
 * - planche lâchée : idem.
 * Les requêtes (sondes, caméra) utilisent STATIC_QUERY et ne voient donc que le décor.
 */
export const GROUP_DECOR = 0x0001;
export const GROUP_RAGDOLL = 0x0002;
export const GROUP_LOOSE_BOARD = 0x0004;
export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}
export const RAGDOLL_GROUPS = interactionGroups(GROUP_RAGDOLL, GROUP_DECOR);
export const LOOSE_BOARD_GROUPS = interactionGroups(GROUP_LOOSE_BOARD, GROUP_DECOR);
const STATIC_QUERY = interactionGroups(GROUP_DECOR, GROUP_DECOR);

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
  private standCapsule: RAPIER.Capsule | null = null;
  /** Colliders « rail seulement » : on les grinde, on ne roule pas dessus. */
  private readonly grindOnly = new Set<number>();
  /** Filtre qui écarte les rails : sondes de sol et corps du skateur (qui ne doit jamais se poser sur un tube). */
  readonly notGrindOnly = (c: RAPIER.Collider): boolean => !this.grindOnly.has(c.handle);

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

  /** Marque un collider comme rail : les sondes de sol (`castRay` avec groundOnly) l'ignorent. */
  markGrindOnly(collider: RAPIER.Collider): void {
    this.grindOnly.add(collider.handle);
  }

  materialOf(collider: RAPIER.Collider): SurfaceMaterial {
    return this.materials.get(collider.handle) ?? 'concrete';
  }

  /**
   * Lance un rayon solide. Avec `groundOnly`, les rails sont transparents (sondes de sol). Un départ à l'intérieur d'une forme (toi nul) n'est pas un contact
   * exploitable et renvoie null.
   */
  castRay(origin: Vec3, dir: Vec3, maxToi: number, exclude?: RAPIER.Collider, groundOnly = false): RayHit | null {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const filter = groundOnly ? this.notGrindOnly : undefined;
    const hit = this.world.castRayAndGetNormal(this.ray, maxToi, true, undefined, STATIC_QUERY, exclude, undefined, filter);
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
    // Un départ déjà au contact (point visé collé à un mur) ne bloque pas : on s'en éloigne.
    const hit = this.world.castShape(from, IDENTITY, dir, ball, 0, maxDist, false, undefined, STATIC_QUERY, exclude);
    return hit ? hit.time_of_impact : maxDist;
  }

  /** Vrai si une capsule verticale (pieds à `foot`) ne touche aucun élément du décor hors rails. */
  isStandingSpaceFree(foot: Vec3, halfHeight: number, radius: number, lift: number): boolean {
    if (!this.standCapsule || this.standCapsule.halfHeight !== halfHeight || this.standCapsule.radius !== radius) {
      this.standCapsule = new this.rapier.Capsule(halfHeight, radius);
    }
    const center = { x: foot.x, y: foot.y + lift + radius + halfHeight, z: foot.z };
    return this.world.intersectionWithShape(center, IDENTITY, this.standCapsule, undefined, STATIC_QUERY, undefined, undefined, this.notGrindOnly) === null;
  }

  dispose(): void {
    this.world.free();
  }
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
