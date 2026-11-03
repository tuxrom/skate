import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BAIL } from '@/config/physics';
import { RAGDOLL_GROUPS, type PhysicsWorld } from '@/physics/PhysicsWorld';
import { copyJoints, createJoints, lerpJoints, type RagdollJoints } from './SkaterRig';

// Gabarit des membres (m), cohérent avec le rig procédural.
const LEG_RADIUS = 0.06;
const ARM_RADIUS = 0.045;
const PELVIS_HALF = { x: 0.12, y: 0.08, z: 0.16 };
const TORSO_HALF = { x: 0.12, y: 0.2, z: 0.17 };
/** Centre du torse dans le repère du buste (origine au bassin). */
const TORSO_CENTER_Y = 0.32;
const WAIST_Y = 0.1;
const NECK_Y = 0.6;
const HEAD_RADIUS = 0.11;
/** Le sol du parc est à y = 0 : un membre plus bas que ça est remonté (garde-fou, la CCD fait le gros du travail). */
const FLOOR_Y = 0;

/** Membre : corps Rapier et, pour un segment, la demi-longueur le long de son Y local. */
interface Part {
  body: RAPIER.RigidBody;
  halfLength: number;
  radius: number;
  lastVel: THREE.Vector3;
  soundCooldown: number;
}

type LimbName = 'thigh' | 'shin' | 'upperArm' | 'forearm';

/**
 * Ragdoll simplifié : bassin, torse, tête, bras et jambes en deux segments, reliés par des rotules.
 * Créé exactement sur la pose affichée (pas de saut), membres sans collision entre eux, CCD active,
 * vitesses plafonnées : c'est ce qui évite les explosions et les membres sous le sol.
 */
export class Ragdoll {
  private readonly parts: Part[] = [];
  private readonly joints: RAPIER.ImpulseJoint[] = [];
  private pelvis!: Part;
  private torso!: Part;
  private head!: Part;
  private readonly limbs: Record<LimbName, [Part, Part]> = {} as Record<LimbName, [Part, Part]>;
  private readonly prev = createJoints();
  private readonly curr = createJoints();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private active = false;
  /** Vitesse max du bassin et du torse au dernier pas (m/s). */
  coreSpeed = 0;

  constructor(private readonly physics: PhysicsWorld) {}

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Crée les corps sur la pose `pose`, avec la vitesse `velocity` et une rotation d'ensemble `spin`
   * (chaque membre reçoit v + ω × r, la chute reste cohérente).
   */
  spawn(pose: RagdollJoints, velocity: THREE.Vector3, spin: THREE.Vector3, seed: number): void {
    this.dispose();
    const R = this.physics.rapier;
    const center = pose.pelvis;
    let rnd = seed;
    const random = () => {
      rnd = (rnd * 16807 + 11) % 2147483647;
      return rnd / 2147483647 - 0.5;
    };
    const makeBody = (pos: THREE.Vector3, rot: THREE.Quaternion, desc: RAPIER.ColliderDesc, halfLength: number, radius: number): Part => {
      const r = this.tmpV.subVectors(pos, center);
      const lin = new THREE.Vector3().crossVectors(spin, r).add(velocity);
      const body = this.physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation(rot)
          .setLinvel(lin.x, lin.y, lin.z)
          .setAngvel({
            x: spin.x + random() * BAIL.limbTumble,
            y: spin.y + random() * BAIL.limbTumble,
            z: spin.z + random() * BAIL.limbTumble,
          })
          .setLinearDamping(BAIL.linearDamping)
          .setAngularDamping(BAIL.angularDamping)
          .setCcdEnabled(true),
      );
      this.physics.world.createCollider(
        desc
          .setDensity(BAIL.bodyDensity)
          .setFriction(BAIL.bodyFriction)
          .setRestitution(BAIL.bodyRestitution)
          .setCollisionGroups(RAGDOLL_GROUPS)
          .setSolverGroups(RAGDOLL_GROUPS),
        body,
      );
      const part: Part = { body, halfLength, radius, lastVel: lin.clone(), soundCooldown: 0 };
      this.parts.push(part);
      return part;
    };
    const segment = (a: THREE.Vector3, b: THREE.Vector3, radius: number): Part => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = Math.max(0.05, dir.length());
      const rot = new THREE.Quaternion().setFromUnitVectors(UP, dir.divideScalar(len));
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      return makeBody(mid, rot, R.ColliderDesc.capsule(Math.max(0.01, len / 2 - radius), radius), len / 2, radius);
    };

    const q = pose.torso;
    this.pelvis = makeBody(pose.pelvis.clone(), q.clone(), R.ColliderDesc.cuboid(PELVIS_HALF.x, PELVIS_HALF.y, PELVIS_HALF.z), 0, PELVIS_HALF.y);
    const torsoPos = new THREE.Vector3(0, TORSO_CENTER_Y, 0).applyQuaternion(q).add(pose.pelvis);
    this.torso = makeBody(torsoPos, q.clone(), R.ColliderDesc.cuboid(TORSO_HALF.x, TORSO_HALF.y, TORSO_HALF.z), 0, TORSO_HALF.x);
    this.head = makeBody(pose.head.clone(), q.clone(), R.ColliderDesc.ball(HEAD_RADIUS), 0, HEAD_RADIUS);
    for (const name of ['thigh', 'shin', 'upperArm', 'forearm'] as const) {
      const radius = name === 'thigh' || name === 'shin' ? LEG_RADIUS : ARM_RADIUS;
      const [from, to] =
        name === 'thigh' ? [pose.hip, pose.knee] : name === 'shin' ? [pose.knee, pose.ankle] : name === 'upperArm' ? [pose.shoulder, pose.elbow] : [pose.elbow, pose.hand];
      this.limbs[name] = [segment(from[0], to[0], radius), segment(from[1], to[1], radius)];
    }

    // Rotules, ancrées sur les points de la pose : elles sont satisfaites dès le premier pas.
    this.connect(this.pelvis, this.torso, new THREE.Vector3(0, WAIST_Y, 0).applyQuaternion(q).add(pose.pelvis));
    this.connect(this.torso, this.head, new THREE.Vector3(0, NECK_Y, 0).applyQuaternion(q).add(pose.pelvis));
    for (let i = 0; i < 2; i++) {
      this.connect(this.pelvis, this.limbs.thigh[i]!, pose.hip[i]!);
      this.connect(this.limbs.thigh[i]!, this.limbs.shin[i]!, pose.knee[i]!);
      this.connect(this.torso, this.limbs.upperArm[i]!, pose.shoulder[i]!);
      this.connect(this.limbs.upperArm[i]!, this.limbs.forearm[i]!, pose.elbow[i]!);
    }
    this.active = true;
    this.read(this.curr);
    copyJoints(this.prev, this.curr);
  }

  private connect(a: Part, b: Part, worldPoint: THREE.Vector3): void {
    const R = this.physics.rapier;
    const la = this.toLocal(a.body, worldPoint, new THREE.Vector3());
    const lb = this.toLocal(b.body, worldPoint, new THREE.Vector3());
    this.joints.push(this.physics.world.createImpulseJoint(R.JointData.spherical(la, lb), a.body, b.body, true));
  }

  private toLocal(body: RAPIER.RigidBody, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const t = body.translation();
    const r = body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w).invert();
    return out.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(this.tmpQ);
  }

  /**
   * Après chaque pas physique : garde-fous (vitesses plafonnées, membres remontés au-dessus du sol),
   * détection d'impacts pour le son, puis lecture des articulations pour l'interpolation.
   * Renvoie la vitesse linéaire max des membres ; `coreSpeed` reçoit celle du bassin et du torse
   * (la tête ou une main peuvent rouler longtemps sans que le corps bouge).
   */
  afterStep(dt: number, onImpact: (strength: number, position: THREE.Vector3) => void): number {
    if (!this.active) return 0;
    let maxSpeed = 0;
    this.coreSpeed = 0;
    for (const part of this.parts) {
      const b = part.body;
      const v = b.linvel();
      let speed = Math.hypot(v.x, v.y, v.z);
      if (speed > BAIL.maxPartSpeed) {
        const k = BAIL.maxPartSpeed / speed;
        b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
        speed = BAIL.maxPartSpeed;
      }
      const w = b.angvel();
      const ws = Math.hypot(w.x, w.y, w.z);
      if (ws > BAIL.maxPartAngularSpeed) {
        const k = BAIL.maxPartAngularSpeed / ws;
        b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
      }
      const t = b.translation();
      if (t.y < FLOOR_Y + part.radius * 0.5) {
        b.setTranslation({ x: t.x, y: FLOOR_Y + part.radius, z: t.z }, true);
        if (v.y < 0) b.setLinvel({ x: v.x, y: 0, z: v.z }, true);
      }
      // Impact : variation brutale de vitesse en un pas.
      const nv = b.linvel();
      const dv = Math.hypot(nv.x - part.lastVel.x, nv.y - part.lastVel.y, nv.z - part.lastVel.z);
      part.soundCooldown = Math.max(0, part.soundCooldown - dt);
      if (dv > BAIL.impactSoundSpeed && part.soundCooldown === 0) {
        part.soundCooldown = BAIL.impactSoundCooldown;
        onImpact(Math.min(1, dv / (BAIL.impactSoundSpeed * 4)), this.tmpV.set(t.x, t.y, t.z));
      }
      part.lastVel.set(nv.x, nv.y, nv.z);
      maxSpeed = Math.max(maxSpeed, speed);
      if (part === this.pelvis || part === this.torso) this.coreSpeed = Math.max(this.coreSpeed, speed);
    }
    copyJoints(this.prev, this.curr);
    this.read(this.curr);
    return maxSpeed;
  }

  /** Articulations interpolées entre les deux derniers pas. */
  interpolate(alpha: number, out: RagdollJoints): void {
    lerpJoints(out, this.prev, this.curr, alpha);
  }

  /** Position du bassin (dernier pas). */
  get pelvisPosition(): THREE.Vector3 {
    return this.curr.pelvis;
  }

  /** Point le plus bas atteint par un membre (debug, tests). */
  lowestPoint(): number {
    let low = Infinity;
    for (const p of this.parts) low = Math.min(low, p.body.translation().y - p.radius);
    return low;
  }

  private read(out: RagdollJoints): void {
    const pt = this.pelvis.body.translation();
    const tr = this.torso.body.rotation();
    out.torso.set(tr.x, tr.y, tr.z, tr.w);
    // Origine du buste : centre du torse ramené au bassin dans le repère du torse.
    const tt = this.torso.body.translation();
    out.pelvis.set(0, -TORSO_CENTER_Y, 0).applyQuaternion(out.torso).add(this.tmpV.set(tt.x, tt.y, tt.z));
    // Le bassin réel tire légèrement l'origine vers lui, pour que les hanches restent cohérentes.
    out.pelvis.lerp(this.tmpV.set(pt.x, pt.y, pt.z), 0.5);
    const ht = this.head.body.translation();
    out.head.set(ht.x, ht.y, ht.z);
    for (let i = 0; i < 2; i++) {
      this.segmentEnds(this.limbs.thigh[i]!, out.hip[i]!, out.knee[i]!);
      this.segmentEnds(this.limbs.shin[i]!, this.tmpV, out.ankle[i]!);
      this.segmentEnds(this.limbs.upperArm[i]!, out.shoulder[i]!, out.elbow[i]!);
      this.segmentEnds(this.limbs.forearm[i]!, this.tmpV, out.hand[i]!);
    }
  }

  /** Extrémités d'un segment : -Y local puis +Y local. */
  private segmentEnds(part: Part, a: THREE.Vector3, b: THREE.Vector3): void {
    const t = part.body.translation();
    const r = part.body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    a.set(0, -part.halfLength, 0).applyQuaternion(this.tmpQ).add(TMP_T.set(t.x, t.y, t.z));
    b.set(0, part.halfLength, 0).applyQuaternion(this.tmpQ).add(TMP_T);
  }

  dispose(): void {
    for (const j of this.joints) this.physics.world.removeImpulseJoint(j, false);
    for (const p of this.parts) this.physics.world.removeRigidBody(p.body);
    this.joints.length = 0;
    this.parts.length = 0;
    this.active = false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP_T = new THREE.Vector3();
