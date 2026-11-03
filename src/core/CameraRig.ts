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
  airborne: boolean;
  /** Réception prévue (valide seulement en l'air). */
  landingValid: boolean;
  landingPoint: THREE.Vector3;
  /** Temps avant la réception prévue (s). */
  landingTime: number;
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
  private readonly look = new THREE.Vector3();
  /** Point visé lissé, décalé vers la réception prévue. */
  private lookBlend = 0;
  private dip = 0;

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
    this.lookBlend = 0;
    this.dip = 0;
    this.camera.fov = CAMERA.fovMin;
    this.camera.updateProjectionMatrix();
    this.place(0, true);
  }

  update(target: CameraTarget, dt: number): void {
    this.yaw = dampAngle(this.yaw, this.targetYaw(target.forward, this.yaw), CAMERA.yawStiffness, dt);

    // Ancre : suivi horizontal et vertical avec des raideurs différentes.
    // En l'air, le suivi vertical se relâche et anticipe l'altitude de réception.
    const kh = 1 - Math.exp(-CAMERA.positionStiffness * dt);
    this.anchor.x += (target.position.x - this.anchor.x) * kh;
    this.anchor.z += (target.position.z - this.anchor.z) * kh;
    let targetY = target.position.y;
    let lookGoal = 0;
    if (target.airborne && target.landingValid) {
      const lead = 1 - Math.min(1, target.landingTime / CAMERA.landingLead);
      const anticipation = lead * CAMERA.landingAnticipation;
      targetY += (target.landingPoint.y - target.position.y) * anticipation;
      lookGoal = lead * CAMERA.landingLookBlend;
      this.look.copy(target.landingPoint);
    }
    const kv = 1 - Math.exp(-(target.airborne ? CAMERA.airHeightStiffness : CAMERA.heightStiffness) * dt);
    this.anchor.y += (targetY - this.anchor.y) * kv;
    this.lookBlend += (lookGoal - this.lookBlend) * (1 - Math.exp(-CAMERA.heightStiffness * dt));
    this.dip *= Math.exp(-CAMERA.impactDipRecovery * dt);

    const speedRatio = Math.min(1, target.speed / SKATING.maxSpeed);
    const fov = CAMERA.fovMin + (CAMERA.fovMax - CAMERA.fovMin) * speedRatio * speedRatio * (3 - 2 * speedRatio);
    const nextFov = this.camera.fov + (fov - this.camera.fov) * (1 - Math.exp(-CAMERA.fovStiffness * dt));
    if (Math.abs(nextFov - this.camera.fov) > 1e-4) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    this.place(dt, false);
  }

  /** Affaissement bref à la réception, proportionnel à la vitesse d'impact. */
  impact(speed: number): void {
    this.dip = Math.min(CAMERA.impactDipMax, this.dip + speed * CAMERA.impactDipPerSpeed);
  }

  private place(dt: number, instant: boolean): void {
    this.lookAt.copy(this.anchor).addScaledVector(UP, CAMERA.lookHeight - this.dip);
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
    // Le point visé avance dans le sens du cap, et glisse vers la réception prévue en fin de saut.
    this.offset.set(0, 0, -CAMERA.lookAhead).applyAxisAngle(UP, this.yaw);
    this.lookAt.add(this.offset);
    if (this.lookBlend > 1e-3) {
      this.offset.copy(this.look).addScaledVector(UP, CAMERA.lookHeight * 0.5);
      this.lookAt.lerp(this.offset, this.lookBlend);
    }
    this.camera.lookAt(this.lookAt);
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
