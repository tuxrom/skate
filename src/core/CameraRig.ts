import * as THREE from 'three';
import { CAMERA } from '@/config/render';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Caméra de suivi derrière la cible, lissée de façon indépendante du framerate.
 * Elle tourne à la cadence d'affichage et lit des transforms déjà interpolés.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private yaw = 0;
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Place la caméra instantanément derrière la cible (spawn, respawn). */
  snap(targetPos: THREE.Vector3, targetYaw: number): void {
    this.yaw = targetYaw;
    this.computeDesired(targetPos);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.lookAt);
  }

  /**
   * @param targetPos position interpolée de la cible
   * @param targetYaw cap de la cible (rad), 0 = regarde vers -Z
   * @param dt durée de la frame (s)
   */
  update(targetPos: THREE.Vector3, targetYaw: number, dt: number): void {
    this.yaw = dampAngle(this.yaw, targetYaw, CAMERA.yawStiffness, dt);
    this.computeDesired(targetPos);
    const k = 1 - Math.exp(-CAMERA.positionStiffness * dt);
    this.camera.position.lerp(this.desired, k);
    this.camera.lookAt(this.lookAt);
  }

  private computeDesired(targetPos: THREE.Vector3): void {
    this.offset.set(0, CAMERA.followHeight, CAMERA.followDistance).applyAxisAngle(UP, this.yaw);
    this.desired.copy(targetPos).add(this.offset);
    this.lookAt.copy(targetPos).addScaledVector(UP, CAMERA.lookHeight);
  }
}

function dampAngle(current: number, target: number, stiffness: number, dt: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-stiffness * dt));
}
