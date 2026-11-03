import * as THREE from 'three';
import { BODY, POP } from '@/config/physics';
import type { SkaterPose, SkaterRig } from './SkaterRig';
import { GRAB_DEFS, GRAB_ORDER, type GrabId } from './tricks';

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

// Ollie (animation seule ; les durées de gameplay viennent de POP).
/** Pivot du tangage : contact des roues arrière. */
const PIVOT_Z = BODY.wheelbase / 2;
/** Tangage max du board au claquement du tail (rad). */
const POP_PITCH = 0.5;
/** Durée du nivelage par le pied avant après le décollage (s). */
const LEVEL_TIME = 0.2;
/** Position du pied arrière sur le tail pendant la charge. */
const TAIL_FOOT_Z = 0.31;
/** Pied avant reculé derrière les vis pendant la charge, puis glissé vers le nose. */
const FRONT_CHARGE_Z = -0.08;
const FRONT_SLIDE_Z = -0.29;
const HIP_HEIGHT_EXTEND = 0.9;
const CHARGE_CROUCH = 0.95;
const AIR_TUCK = 0.6;
const AIR_RELAX = 0.35;
/** Centre de rotation des flips et shoves : milieu du deck. */
const DECK_MID = DECK_BOTTOM + DECK_THICKNESS / 2;
/** Hauteur dont les pieds s'écartent du deck pendant une rotation (m). */
const FEET_LIFT = 0.2;
/** Écartement supplémentaire des pieds pendant une rotation (m, le long du board). */
const FEET_SPREAD = 0.05;
/** Genoux rentrés quand les pieds quittent le board (flexion 0 à 1). */
const FEET_LIFT_CROUCH = 0.75;

// Grabs (animation seule).
/** Le board remonte vers la main : genoux ramenés à la poitrine (m). */
const GRAB_BOARD_LIFT = 0.14;
/** Hauteur du bassin au-dessus du deck au repos pendant un grab (m). */
const GRAB_HIP_HEIGHT = 0.5;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
/** Étirement max des bras pour atteindre la prise (multiplicateur de longueur). */
const ARM_MAX_STRETCH = 1.2;
/** Torsion du buste par rad/s de rotation du corps : il mène la rotation. */
const SPIN_TWIST = 0.03;
const SPIN_TWIST_MAX = 0.35;

/** Pose de grab : point de prise sur le deck, tangage du board, flexion et torsion du buste (rad). */
interface GrabPose {
  x: number;
  z: number;
  pitch: number;
  bend: number;
  twist: number;
}
const GRAB_POSES: Readonly<Record<GrabId, GrabPose>> = {
  // Main arrière sur le bord côté orteils, entre les pieds.
  indy: { x: 0.11, z: 0.04, pitch: 0, bend: 0.75, twist: -0.15 },
  // Main avant sur le bord côté talons : buste penché côté talons (flexion négative).
  melon: { x: -0.11, z: -0.08, pitch: 0, bend: -1.1, twist: 0.3 },
  // Main avant sur le nose, nose remonté.
  nosegrab: { x: 0, z: -0.37, pitch: 0.22, bend: 0.6, twist: 0.6 },
  // Main arrière sur le tail, tail remonté.
  tailgrab: { x: 0, z: 0.37, pitch: -0.22, bend: 0.6, twist: -0.6 },
};

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
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
  /** Roulis (inclinaison), porte le board et le rider. */
  private readonly roll = new THREE.Group();
  /** Tangage du board seul, autour des roues arrière. */
  private readonly pitchPivot = new THREE.Group();
  /** Rotations de trick du board seul, autour du centre du deck. */
  private readonly trickPivot = new THREE.Group();
  private readonly qShove = new THREE.Quaternion();
  private readonly qFlip = new THREE.Quaternion();
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
  /** Distance restante entre la main et la prise au dernier calcul d'IK (m), pour le debug. */
  reachError = 0;
  private readonly hip = new THREE.Vector3();
  private readonly hipJoint = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly frontFoot = new THREE.Vector3();
  private readonly grabTarget = new THREE.Vector3();
  private readonly ikElbow = new THREE.Vector3();
  private readonly ikHand = new THREE.Vector3();
  private readonly torsoInverse = new THREE.Matrix4();
  private readonly armDir = new THREE.Vector3();
  private readonly armBend = new THREE.Vector3();

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

    this.root.add(this.roll);
    this.roll.add(this.pitchPivot);
    this.pitchPivot.position.z = PIVOT_Z;
    this.pitchPivot.add(this.trickPivot);
    this.trickPivot.position.set(0, DECK_MID, -PIVOT_Z);
    this.trickPivot.add(this.board);
    this.board.position.y = -DECK_MID;
    this.buildBoard(m);
    this.roll.add(this.rider);
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

    const ollie = this.ollieCurves(pose);
    const landing = this.landingCurves(pose);

    // Grab : le board remonte vers la main et s'incline pour un nose ou un tail.
    const grabId = pose.grabIndex >= 0 ? GRAB_ORDER[pose.grabIndex]! : null;
    const g = grabId ? smooth(pose.grabAmount) : 0;
    const gp = grabId ? GRAB_POSES[grabId] : null;
    const boardLift = GRAB_BOARD_LIFT * g;
    const pitch = ollie.pitch + (gp ? gp.pitch * g : 0);

    // Roulis : inclinaison, plus le déséquilibre d'une réception sale. Tangage : ollie et grab.
    this.roll.rotation.z = -(pose.lean + landing.wobble);
    this.pitchPivot.rotation.x = pitch;
    this.pitchPivot.position.y = boardLift;
    // Trick : shove autour de l'axe vertical du board, puis flip autour de son axe long (repère du board).
    this.qShove.setFromAxisAngle(AXIS_Y, -pose.trickShove);
    this.qFlip.setFromAxisAngle(AXIS_Z, pose.trickFlip);
    this.trickPivot.quaternion.multiplyQuaternions(this.qShove, this.qFlip);

    const pushing = pose.pushPhase >= 0;
    const contact = pushing && pose.pushPhase < 1;
    const pushWeight = pushing ? (contact ? 1 : 1 - smooth(pose.pushPhase - 1)) : 0;
    const lift = pose.feetLift;
    const crouch = Math.max(pose.crouch, pushWeight * 0.45, pose.brake * 0.35, ollie.crouch, landing.crouch, lift * FEET_LIFT_CROUCH);

    // Bassin : se baisse et se décale sur le pied avant pendant la poussée, se tend au pop.
    const baseHip = lerp(lerp(HIP_HEIGHT_STAND, HIP_HEIGHT_CROUCH, crouch), HIP_HEIGHT_EXTEND, ollie.extend);
    const hipHeight = lerp(baseHip, GRAB_HIP_HEIGHT, g);
    this.hip.set(-0.03 + pushWeight * 0.04, hipHeight, -0.01 - pushWeight * 0.1 + ollie.hipShift);
    this.torso.position.copy(this.hip);
    // Buste : penché vers la zone de prise, tourné vers le nose ou le tail, et en avance sur la rotation du corps.
    const spinTwist = THREE.MathUtils.clamp(-pose.spinRate * SPIN_TWIST, -SPIN_TWIST_MAX, SPIN_TWIST_MAX);
    const bend = pose.lean * 0.6 + crouch * 0.25 + pushWeight * 0.15 + landing.wobble * 0.8 + (gp ? gp.bend * g : 0);
    this.torso.rotation.set(0, (gp ? gp.twist * g : 0) + spinTwist, -bend);

    // Pied avant : sur le deck, il recule pendant la charge puis glisse vers le nose pour niveler.
    // Pendant une rotation, les pieds quittent le deck (vers le haut et un peu vers les extrémités), puis le rattrapent.
    this.deckPoint(this.frontFoot, FRONT_FOOT.x, FRONT_FOOT.y + lift * FEET_LIFT, ollie.frontZ - lift * FEET_SPREAD, pitch);
    this.frontFoot.y += boardLift;
    this.solveLeg(this.frontFoot, -1, this.frontThigh, this.frontShin, this.frontKnee, this.frontShoe);

    // Pied arrière : sur le tail pendant l'ollie, au sol pour pousser, ou en frein.
    this.deckPoint(this.foot, BACK_FOOT.x, BACK_FOOT.y + lift * FEET_LIFT, ollie.backZ + lift * FEET_SPREAD, pitch);
    this.foot.y += boardLift;
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

    // Bras : écartés pour l'équilibre, plus en l'air, en virage serré et après une réception sale.
    const balance = Math.min(1, Math.abs(pose.lean) * 2 + (pose.airborne ? 0.6 : 0) + pushWeight * 0.3 + ollie.extend * 0.5 + landing.flail);
    const grabHand = grabId ? GRAB_DEFS[grabId].hand : 0;
    if (g > 0 && gp) {
      // Prise sur le deck remonté, ramenée dans le repère du buste pour l'IK du bras.
      this.deckPoint(this.grabTarget, gp.x, 0.01, gp.z, pitch);
      this.grabTarget.y += boardLift;
      this.torso.updateMatrix();
      this.torsoInverse.copy(this.torso.matrix).invert();
      this.grabTarget.applyMatrix4(this.torsoInverse);
    }
    for (const arm of this.arms) {
      const flail = landing.flail * Math.sin(pose.landTime * 18 + arm.side) * 0.15;
      const armBalance = arm.side === grabHand ? balance : Math.min(1, balance + g);
      this.shoulder.set(0, 0.5, arm.side * 0.2);
      this.elbow.set(0.04, 0.26 + armBalance * 0.08 + flail, arm.side * (0.27 + armBalance * 0.12));
      this.hand.set(0.1 - pose.lean * 0.15, 0.06 + armBalance * 0.18 - flail, arm.side * (0.3 + armBalance * 0.25));
      if (arm.side === grabHand && g > 0) {
        this.solveArm(this.shoulder, this.grabTarget, arm.side);
        this.elbow.lerp(this.ikElbow, g);
        this.hand.lerp(this.ikHand, g);
      }
      arm.upper.set(this.shoulder, this.elbow);
      arm.lower.set(this.elbow, this.hand);
    }
  }

  /**
   * IK du bras vers une prise (repère du buste) : coude plié vers l'extérieur et l'arrière.
   * Hors de portée, le bras s'étire jusqu'à ARM_MAX_STRETCH puis pointe vers la prise.
   */
  private solveArm(shoulder: THREE.Vector3, target: THREE.Vector3, side: number): void {
    const dir = this.armDir.subVectors(target, shoulder);
    const dist = dir.length();
    const reach = UPPER_ARM + FOREARM;
    const stretch = THREE.MathUtils.clamp(dist / reach, 1, ARM_MAX_STRETCH);
    const a = UPPER_ARM * stretch;
    const b = FOREARM * stretch;
    const d = THREE.MathUtils.clamp(dist, 0.05, a + b - 1e-3);
    this.reachError = Math.max(0, dist - (a + b));
    dir.divideScalar(dist || 1);
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const bendDir = this.armBend.set(-0.4, 0, side).addScaledVector(dir, -(-0.4 * dir.x + side * dir.z)).normalize();
    this.ikElbow.copy(shoulder).addScaledVector(dir, a * cosA).addScaledVector(bendDir, a * sinA);
    this.ikHand.copy(shoulder).addScaledVector(dir, d);
  }

  /**
   * Courbes de l'ollie : charge accroupie avec le pied arrière sur le tail, claquement qui lève le nose
   * et tend les jambes, puis nivelage par glissement du pied avant et genoux rentrés.
   */
  private readonly ollieOut = { pitch: 0, crouch: 0, extend: 0, frontZ: FRONT_FOOT.z, backZ: BACK_FOOT.z, hipShift: 0 };
  private ollieCurves(pose: SkaterPose): typeof this.ollieOut {
    const o = this.ollieOut;
    o.pitch = 0;
    o.extend = 0;
    o.hipShift = 0;
    o.crouch = pose.airborne ? AIR_RELAX : 0;
    const c = smooth(pose.charge * 1.6);
    o.frontZ = lerp(FRONT_FOOT.z, FRONT_CHARGE_Z, c);
    o.backZ = lerp(BACK_FOOT.z, TAIL_FOOT_Z, c);
    o.crouch = Math.max(o.crouch, pose.charge * CHARGE_CROUCH);
    o.hipShift = c * 0.05;

    const t = pose.popTime;
    if (t < 0) return o;
    if (t < POP.popDelay) {
      // Claquement : le tail frappe, le nose monte, les jambes se détendent.
      const u = smooth(t / POP.popDelay);
      o.pitch = POP_PITCH * u;
      o.extend = u;
      o.crouch = lerp(o.crouch, 0, u);
      o.frontZ = FRONT_CHARGE_Z;
      o.backZ = TAIL_FOOT_Z;
      return o;
    }
    // Après le décollage : nivelage, genoux rentrés, puis retour à une position détendue.
    const tau = t - POP.popDelay;
    const level = smooth(tau / LEVEL_TIME);
    o.pitch = POP_PITCH * (1 - level);
    o.extend = 1 - smooth(tau / 0.08);
    const tuckIn = smooth(tau / 0.12);
    const relax = smooth((tau - 0.25) / 0.3);
    o.crouch = pose.airborne ? lerp(AIR_TUCK * tuckIn, AIR_RELAX, relax) : o.crouch;
    const slide = smooth(tau / 0.12);
    const back = smooth((tau - 0.2) / 0.2);
    o.frontZ = lerp(lerp(FRONT_CHARGE_Z, FRONT_SLIDE_Z, slide), FRONT_FOOT.z, back);
    o.backZ = lerp(TAIL_FOOT_Z, BACK_FOOT.z, back);
    return o;
  }

  /** Courbes de réception : compression proportionnelle à l'impact, déséquilibre si la réception est sale. */
  private readonly landingOut = { crouch: 0, wobble: 0, flail: 0 };
  private landingCurves(pose: SkaterPose): typeof this.landingOut {
    const o = this.landingOut;
    o.crouch = 0;
    o.wobble = 0;
    o.flail = 0;
    const l = pose.landTime;
    if (l < 0) return o;
    const envelope = l < 0.05 ? l / 0.05 : Math.exp(-(l - 0.05) * 7);
    o.crouch = envelope * (0.3 + 0.7 * pose.landImpact);
    if (pose.landQuality > 0) {
      const amount = pose.landQuality === 1 ? 0.12 : 0.25;
      o.wobble = Math.sin(l * 22) * amount * Math.exp(-l * 4);
      o.flail = Math.exp(-l * 3) * (pose.landQuality === 1 ? 0.6 : 1);
    }
    return o;
  }

  /** Point du deck (repère du rider) après tangage du board autour du pivot arrière. */
  private deckPoint(out: THREE.Vector3, x: number, yAboveDeck: number, z: number, pitch: number): THREE.Vector3 {
    const y = DECK_TOP + yAboveDeck;
    const dz = z - PIVOT_Z;
    const c = Math.cos(pitch);
    const sn = Math.sin(pitch);
    return out.set(x, y * c - dz * sn - DECK_TOP, y * sn + dz * c + PIVOT_Z);
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
