import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Lie un corps Rapier à un Object3D et interpole son transform entre deux pas fixes.
 * capture() après chaque pas physique, apply(alpha) à chaque frame rendue.
 */
export class InterpolatedBody {
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();

  constructor(
    readonly body: RAPIER.RigidBody,
    readonly object: THREE.Object3D,
  ) {
    this.teleportSync();
  }

  /** Copie l'état courant dans l'état précédent puis lit le nouvel état du corps. */
  capture(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.readBody();
  }

  /** Réinitialise les deux états (après une téléportation) pour éviter un glissement visuel. */
  teleportSync(): void {
    this.readBody();
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
  }

  apply(alpha: number): void {
    this.object.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
  }

  private readBody(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }
}
