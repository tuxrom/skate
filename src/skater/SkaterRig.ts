import type * as THREE from 'three';

/** Pose d'animation de haut niveau, indépendante de la façon dont le skateur est dessiné. */
export interface SkaterPose {
  /** Inclinaison de la planche (rad), positive vers la droite. */
  lean: number;
  /** Phase de poussée : [0, 1[ contact, [1, 2[ retour du pied, -1 sinon. */
  pushPhase: number;
  /** Force de freinage (0 à 1). */
  brake: number;
  /** Flexion des jambes (0 à 1). */
  crouch: number;
  /** Vitesse signée le long du cap (m/s), pour la rotation des roues. */
  speed: number;
  airborne: boolean;
}

export function createPose(): SkaterPose {
  return { lean: 0, pushPhase: -1, brake: 0, crouch: 0, speed: 0, airborne: false };
}

/**
 * Représentation visuelle animable du skateur.
 * Repère local : X à droite, Y en haut, -Z vers l'avant ; origine au contact du sol, entre les trucks.
 * Une version glTF implémentera la même interface avec un AnimationMixer.
 */
export interface SkaterRig {
  readonly root: THREE.Object3D;
  /** Appelé à chaque frame rendue avec la pose interpolée. */
  update(pose: SkaterPose, dt: number): void;
  dispose(): void;
}
