import * as THREE from 'three';
import { CAMERA } from '@/config/render';
import { SKATING } from '@/config/physics';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Renvoie la distance libre le long d'un rayon (sphère balayée de rayon `radius`),
 * ou maxDist si rien ne gêne. Fourni par Game pour garder la caméra indépendante de Rapier.
 */
export type ClearanceQuery = (from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, radius: number) => number;

export interface CameraTarget {
  /** Position interpolée du skateur (contact au sol). */
  position: THREE.Vector3;
  /** Cap du skateur (unitaire). */
  forward: THREE.Vector3;
  /** Vitesse (m/s), pour le FOV. */
  speed: number;
}

/**
 * Caméra troisième personne derrière le skateur.
 * Tout le lissage est en 1 - exp(-k·dt), donc indépendant du framerate.
 * Collision : on se rapproche immédiatement quand le décor bouche la vue, on recule en douceur.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private yaw = 0;
  private distance: number = CAMERA.followDistance;
  private readonly anchor = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  constructor(private readonly clearance: ClearanceQuery | null = null) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovMin, 1, CAMERA.near, CAMERA.far);
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Place la caméra instantanément derrière la cible (spawn, respawn). */
  snap(target: CameraTarget): void {
    this.yaw = this.targetYaw(target.forward, 0);
    this.anchor.copy(target.position);
    this.distance = CAMERA.followDistance;
    this.camera.fov = CAMERA.fovMin;
    this.camera.updateProjectionMatrix();
    this.place(0, true);
  }

  update(target: CameraTarget, dt: number): void {
    this.yaw = dampAngle(this.yaw, this.targetYaw(target.forward, this.yaw), CAMERA.yawStiffness, dt);

    // Ancre : suivi horizontal et vertical avec des raideurs différentes.
    const kh = 1 - Math.exp(-CAMERA.positionStiffness * dt);
    const kv = 1 - Math.exp(-CAMERA.heightStiffness * dt);
    this.anchor.x += (target.position.x - this.anchor.x) * kh;
    this.anchor.z += (target.position.z - this.anchor.z) * kh;
    this.anchor.y += (target.position.y - this.anchor.y) * kv;

    const speedRatio = Math.min(1, target.speed / SKATING.maxSpeed);
    const fov = CAMERA.fovMin + (CAMERA.fovMax - CAMERA.fovMin) * speedRatio * speedRatio * (3 - 2 * speedRatio);
    const nextFov = this.camera.fov + (fov - this.camera.fov) * (1 - Math.exp(-CAMERA.fovStiffness * dt));
    if (Math.abs(nextFov - this.camera.fov) > 1e-4) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    this.place(dt, false);
  }

  private place(dt: number, instant: boolean): void {
    this.lookAt.copy(this.anchor).addScaledVector(UP, CAMERA.lookHeight);
    this.offset.set(0, CAMERA.followHeight - CAMERA.lookHeight, CAMERA.followDistance).applyAxisAngle(UP, this.yaw);
    const fullLength = this.offset.length();
    this.dir.copy(this.offset).divideScalar(fullLength);

    let allowed = fullLength;
    if (this.clearance) {
      allowed = Math.max(CAMERA.minDistance, this.clearance(this.lookAt, this.dir, fullLength, CAMERA.collisionRadius));
    }
    if (instant || allowed < this.distance) this.distance = allowed;
    else this.distance += (allowed - this.distance) * (1 - Math.exp(-CAMERA.releaseStiffness * dt));

    this.desired.copy(this.lookAt).addScaledVector(this.dir, this.distance);
    this.camera.position.copy(this.desired);
    // Le point visé avance dans le sens du cap pour voir où l'on va.
    this.offset.set(0, 0, -CAMERA.lookAhead).applyAxisAngle(UP, this.yaw);
    this.camera.lookAt(this.lookAt.add(this.offset));
  }

  /** Cap visé : derrière le skateur. Garde le cap courant si la planche est presque verticale. */
  private targetYaw(forward: THREE.Vector3, fallback: number): number {
    const h = Math.hypot(forward.x, forward.z);
    if (h < CAMERA.minYawProjection) return fallback;
    return Math.atan2(-forward.x, -forward.z);
  }
}

function dampAngle(current: number, target: number, stiffness: number, dt: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-stiffness * dt));
}
