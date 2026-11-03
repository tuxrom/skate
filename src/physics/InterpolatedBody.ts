import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/** Tout ce qui sait écrire sa pose de simulation courante. */
export interface PoseSource {
  readPose(position: THREE.Vector3, rotation: THREE.Quaternion): void;
}

/** PoseSource d'un corps rigide Rapier. */
export function rigidBodyPose(body: RAPIER.RigidBody): PoseSource {
  return {
    readPose(position, rotation) {
      const t = body.translation();
      const r = body.rotation();
      position.set(t.x, t.y, t.z);
      rotation.set(r.x, r.y, r.z, r.w);
    },
  };
}

/**
 * Lie une pose simulée à un Object3D et l'interpole entre deux pas fixes.
 * capture() après chaque pas physique, apply(alpha) à chaque frame rendue.
 */
export class InterpolatedBody {
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();

  constructor(
    readonly source: PoseSource,
    readonly object: THREE.Object3D,
  ) {
    this.teleportSync();
  }

  /** Copie l'état courant dans l'état précédent puis lit le nouvel état. */
  capture(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.source.readPose(this.currPos, this.currRot);
  }

  /** Réinitialise les deux états (après une téléportation) pour éviter un glissement visuel. */
  teleportSync(): void {
    this.source.readPose(this.currPos, this.currRot);
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
  }

  apply(alpha: number): void {
    this.object.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
  }
}
