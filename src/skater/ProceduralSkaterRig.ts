import * as THREE from 'three';
import { BODY } from '@/config/physics';
import type { SkaterPose, SkaterRig } from './SkaterRig';

// Gabarit visuel (m). Les dimensions qui comptent pour la physique viennent de BODY.
const WHEEL_RADIUS = 0.027;
const WHEEL_WIDTH = 0.032;
const WHEEL_TRACK = 0.085;
const TRUCK_HEIGHT = 0.03;
const DECK_THICKNESS = 0.013;
const DECK_BOTTOM = WHEEL_RADIUS * 2 + TRUCK_HEIGHT;
const DECK_TOP = DECK_BOTTOM + DECK_THICKNESS;
const KICK_LENGTH = 0.12;
const KICK_ANGLE = 0.33;

const THIGH = 0.44;
const SHIN = 0.44;
const ANKLE_HEIGHT = 0.07;
const HIP_HEIGHT_STAND = 0.82;
const HIP_HEIGHT_CROUCH = 0.6;
const HIP_HALF_WIDTH = 0.1;
const FRONT_FOOT = new THREE.Vector3(0.02, ANKLE_HEIGHT, -0.17);
const BACK_FOOT = new THREE.Vector3(0.0, ANKLE_HEIGHT, 0.16);
/** Trajet du pied de poussée au sol, côté orteils (repère du rider). */
const PUSH_FOOT_X = 0.16;
const PUSH_START_Z = -0.08;
const PUSH_END_Z = 0.5;
const PUSH_LIFT = 0.14;
const BRAKE_FOOT = new THREE.Vector3(0.1, ANKLE_HEIGHT - DECK_TOP + 0.005, 0.48);

const UP = new THREE.Vector3(0, 1, 0);
const KNEE_HINT = new THREE.Vector3(1, 0, 0);

/** Segment cylindrique tendu entre deux points (membres). */
class Limb {
  readonly mesh: THREE.Mesh;
  private readonly dir = new THREE.Vector3();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
  }

  set(from: THREE.Vector3, to: THREE.Vector3): void {
    this.dir.subVectors(to, from);
    const len = this.dir.length();
    this.mesh.position.addVectors(from, to).multiplyScalar(0.5);
    if (len > 1e-6) this.mesh.quaternion.setFromUnitVectors(UP, this.dir.divideScalar(len));
    this.mesh.scale.set(1, len, 1);
  }
}

/** Skateur en primitives : planche (deck, kicks, trucks, 4 roues) et rider animé par IK. */
export class ProceduralSkaterRig implements SkaterRig {
  readonly root = new THREE.Group();
  private readonly board = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  private readonly frontThigh: Limb;
  private readonly frontShin: Limb;
  private readonly backThigh: Limb;
  private readonly backShin: Limb;
  private readonly frontShoe: THREE.Mesh;
  private readonly backShoe: THREE.Mesh;
  private readonly frontKnee: THREE.Mesh;
  private readonly backKnee: THREE.Mesh;
  private readonly arms: { upper: Limb; lower: Limb; side: number }[] = [];

  private wheelAngle = 0;
  private readonly hip = new THREE.Vector3();
  private readonly hipJoint = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();

  constructor() {
    this.root.name = 'skater';
    const m = {
      wood: this.track(new THREE.MeshStandardMaterial({ color: 0xb5835a, roughness: 0.7 })),
      grip: this.track(new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 1 })),
      metal: this.track(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 })),
      wheel: this.track(new THREE.MeshStandardMaterial({ color: 0xefe9dc, roughness: 0.5 })),
      shirt: this.track(new THREE.MeshStandardMaterial({ color: 0xc8553d, roughness: 0.85 })),
      pants: this.track(new THREE.MeshStandardMaterial({ color: 0x33414a, roughness: 0.9 })),
      skin: this.track(new THREE.MeshStandardMaterial({ color: 0xd9a37a, roughness: 0.75 })),
      shoe: this.track(new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.8 })),
      cap: this.track(new THREE.MeshStandardMaterial({ color: 0x2c6e91, roughness: 0.8 })),
    };

    this.root.add(this.board);
    this.buildBoard(m);
    this.board.add(this.rider);
    this.rider.position.y = DECK_TOP;

    const limbGeo = this.track(new THREE.CylinderGeometry(0.065, 0.055, 1, 10));
    const armGeo = this.track(new THREE.CylinderGeometry(0.045, 0.038, 1, 8));
    const jointGeo = this.track(new THREE.SphereGeometry(0.062, 10, 8));
    const shoeGeo = this.track(new THREE.BoxGeometry(0.27, 0.07, 0.1));

    this.frontThigh = this.addLimb(limbGeo, m.pants, this.rider);
    this.frontShin = this.addLimb(limbGeo, m.pants, this.rider);
    this.backThigh = this.addLimb(limbGeo, m.pants, this.rider);
    this.backShin = this.addLimb(limbGeo, m.pants, this.rider);
    this.frontKnee = this.addMesh(jointGeo, m.pants, this.rider);
    this.backKnee = this.addMesh(jointGeo, m.pants, this.rider);
    this.frontShoe = this.addMesh(shoeGeo, m.shoe, this.rider);
    this.backShoe = this.addMesh(shoeGeo, m.shoe, this.rider);

    this.rider.add(this.torso);
    const chest = this.addMesh(this.track(new THREE.CapsuleGeometry(0.16, 0.3, 4, 12)), m.shirt, this.torso);
    chest.position.y = 0.3;
    chest.scale.set(0.8, 1, 1.15);
    const pelvis = this.addMesh(this.track(new THREE.SphereGeometry(0.14, 12, 8)), m.pants, this.torso);
    pelvis.scale.set(0.85, 0.7, 1.2);
    const head = this.addMesh(this.track(new THREE.SphereGeometry(0.11, 14, 10)), m.skin, this.torso);
    head.position.set(0.01, 0.72, 0);
    const cap = this.addMesh(this.track(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), m.cap, this.torso);
    cap.position.set(0.01, 0.74, 0);
    const brim = this.addMesh(this.track(new THREE.BoxGeometry(0.1, 0.012, 0.16)), m.cap, this.torso);
    brim.position.set(0.11, 0.75, 0);
    for (const side of [-1, 1]) {
      this.arms.push({ upper: this.addLimb(armGeo, m.shirt, this.torso), lower: this.addLimb(armGeo, m.skin, this.torso), side });
    }
  }

  private buildBoard(m: Record<'wood' | 'grip' | 'metal' | 'wheel', THREE.Material>): void {
    const flatLength = BODY.boardLength - 2 * KICK_LENGTH;
    const deckMaterials = [m.wood, m.wood, m.grip, m.wood, m.wood, m.wood];
    const deck = this.addMesh(this.track(new THREE.BoxGeometry(BODY.boardWidth, DECK_THICKNESS, flatLength)), deckMaterials, this.board);
    deck.position.y = DECK_BOTTOM + DECK_THICKNESS / 2;
    const kickGeo = this.track(new THREE.BoxGeometry(BODY.boardWidth, DECK_THICKNESS, KICK_LENGTH).translate(0, 0, -KICK_LENGTH / 2));
    for (const sign of [-1, 1]) {
      const kick = this.addMesh(kickGeo, deckMaterials, this.board);
      kick.position.set(0, DECK_BOTTOM + DECK_THICKNESS / 2, (sign * flatLength) / 2);
      kick.rotation.x = sign < 0 ? KICK_ANGLE : -KICK_ANGLE;
      if (sign > 0) kick.rotation.y = Math.PI;
    }

    const hangerGeo = this.track(new THREE.BoxGeometry(WHEEL_TRACK * 2 - 0.02, 0.022, 0.04));
    const baseGeo = this.track(new THREE.BoxGeometry(0.07, TRUCK_HEIGHT - 0.008, 0.09));
    const wheelGeo = this.track(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 16).rotateZ(Math.PI / 2));
    for (const sign of [-1, 1]) {
      const z = sign * (BODY.wheelbase / 2);
      const base = this.addMesh(baseGeo, m.metal, this.board);
      base.position.set(0, DECK_BOTTOM - (TRUCK_HEIGHT - 0.008) / 2, z);
      const hanger = this.addMesh(hangerGeo, m.metal, this.board);
      hanger.position.set(0, WHEEL_RADIUS + 0.004, z);
      for (const side of [-1, 1]) {
        const wheel = this.addMesh(wheelGeo, m.wheel, this.board);
        wheel.position.set(side * WHEEL_TRACK, WHEEL_RADIUS, z);
        this.wheels.push(wheel);
      }
    }
  }

  update(pose: SkaterPose, dt: number): void {
    // Roues : rotation proportionnelle à la distance parcourue.
    if (!pose.airborne) this.wheelAngle -= (pose.speed / WHEEL_RADIUS) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;

    // La planche s'incline dans le virage, le rider suit avec elle.
    this.board.rotation.z = -pose.lean;

    const pushing = pose.pushPhase >= 0;
    const contact = pushing && pose.pushPhase < 1;
    const pushWeight = pushing ? (contact ? 1 : 1 - smooth(pose.pushPhase - 1)) : 0;
    const crouch = Math.max(pose.crouch, pushWeight * 0.45, pose.brake * 0.35);

    // Bassin : se baisse et se décale sur le pied avant pendant la poussée.
    this.hip.set(-0.03 + pushWeight * 0.04, lerp(HIP_HEIGHT_STAND, HIP_HEIGHT_CROUCH, crouch), -0.01 - pushWeight * 0.1);
    this.torso.position.copy(this.hip);
    this.torso.rotation.set(0, 0, -(pose.lean * 0.6 + crouch * 0.25 + pushWeight * 0.15));

    // Pied avant : toujours sur la planche.
    this.solveLeg(FRONT_FOOT, -1, this.frontThigh, this.frontShin, this.frontKnee, this.frontShoe);

    // Pied arrière : sur la planche, au sol pour pousser, ou en frein.
    this.foot.copy(BACK_FOOT);
    if (pushing) {
      const groundY = ANKLE_HEIGHT - DECK_TOP;
      if (contact) {
        this.foot.set(PUSH_FOOT_X, groundY, lerp(PUSH_START_Z, PUSH_END_Z, pose.pushPhase));
      } else {
        const t = smooth(pose.pushPhase - 1);
        this.foot.set(
          lerp(PUSH_FOOT_X, BACK_FOOT.x, t),
          lerp(groundY, BACK_FOOT.y, t) + Math.sin(t * Math.PI) * PUSH_LIFT,
          lerp(PUSH_END_Z, BACK_FOOT.z, t),
        );
      }
    } else if (pose.brake > 0) {
      this.foot.lerpVectors(BACK_FOOT, BRAKE_FOOT, smooth(Math.min(1, pose.brake * 1.5)));
    }
    this.solveLeg(this.foot, 1, this.backThigh, this.backShin, this.backKnee, this.backShoe);

    // Bras : écartés pour l'équilibre, plus en l'air et en virage serré.
    const balance = Math.min(1, Math.abs(pose.lean) * 2 + (pose.airborne ? 0.6 : 0) + pushWeight * 0.3);
    for (const arm of this.arms) {
      this.shoulder.set(0, 0.5, arm.side * 0.2);
      this.elbow.set(0.04, 0.26 + balance * 0.08, arm.side * (0.27 + balance * 0.12));
      this.hand.set(0.1 - pose.lean * 0.15, 0.06 + balance * 0.18, arm.side * (0.3 + balance * 0.25));
      arm.upper.set(this.shoulder, this.elbow);
      arm.lower.set(this.elbow, this.hand);
    }
  }

  /** IK à deux segments, genou plié vers l'avant du rider (+X). */
  private solveLeg(foot: THREE.Vector3, side: number, thigh: Limb, shin: Limb, kneeMesh: THREE.Mesh, shoe: THREE.Mesh): void {
    const hip = this.hipJoint.set(this.hip.x, this.hip.y - 0.05, this.hip.z + side * HIP_HALF_WIDTH);
    const toFoot = this.knee.subVectors(foot, hip);
    const dist = THREE.MathUtils.clamp(toFoot.length(), 0.05, THIGH + SHIN - 1e-3);
    toFoot.normalize();
    const cosHip = (THIGH * THIGH + dist * dist - SHIN * SHIN) / (2 * THIGH * dist);
    const sinHip = Math.sqrt(Math.max(0, 1 - cosHip * cosHip));
    // Direction du genou : l'indice +X rendu orthogonal à l'axe hanche-pied.
    const bendX = KNEE_HINT.x - toFoot.x * toFoot.x;
    const bendY = -toFoot.y * toFoot.x;
    const bendZ = -toFoot.z * toFoot.x;
    const bendLen = Math.hypot(bendX, bendY, bendZ) || 1;
    const kx = hip.x + toFoot.x * THIGH * cosHip + (bendX / bendLen) * THIGH * sinHip;
    const ky = hip.y + toFoot.y * THIGH * cosHip + (bendY / bendLen) * THIGH * sinHip;
    const kz = hip.z + toFoot.z * THIGH * cosHip + (bendZ / bendLen) * THIGH * sinHip;
    this.knee.set(kx, ky, kz);

    thigh.set(hip, this.knee);
    shin.set(this.knee, foot);
    kneeMesh.position.copy(this.knee);
    shoe.position.set(foot.x + 0.06, foot.y - ANKLE_HEIGHT + 0.035, foot.z);
  }

  private addLimb(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): Limb {
    const limb = new Limb(geo, mat);
    parent.add(limb.mesh);
    return limb;
  }

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.root.removeFromParent();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
