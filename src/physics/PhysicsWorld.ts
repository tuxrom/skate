import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, MATERIALS, WORLD, type SurfaceMaterial } from '@/config/physics';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

/** Charge le module WASM de Rapier une seule fois. */
export function loadRapier(): Promise<Rapier> {
  rapierReady ??= RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

/**
 * Monde physique Rapier piloté à pas fixe.
 * Ne jamais appeler step() avec un dt variable : c'est GameLoop qui cadence.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;

  constructor(readonly rapier: Rapier) {
    this.world = new rapier.World({ x: 0, y: WORLD.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  step(): void {
    this.world.step();
  }

  /** Applique friction et restitution d'un matériau de surface à un descripteur de collider. */
  withMaterial(desc: RAPIER.ColliderDesc, material: SurfaceMaterial): RAPIER.ColliderDesc {
    const m = MATERIALS[material];
    return desc.setFriction(m.friction).setRestitution(m.restitution);
  }

  dispose(): void {
    this.world.free();
  }
}
