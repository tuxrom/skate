import * as THREE from 'three';
import { REPLAY } from '@/config/render';
import { createJoints, createPose, type RagdollJoints, type SkaterPose } from '@/skater/SkaterRig';

/** Champs numériques de la pose d'animation, dans l'ordre du tampon. */
const POSE_KEYS = [
  'lean', 'pushPhase', 'brake', 'crouch', 'speed', 'airborne', 'charge', 'popTime', 'airTime', 'landTime', 'landImpact',
  'landQuality', 'trickFlip', 'trickShove', 'feetLift', 'trickProgress', 'grabIndex', 'grabAmount', 'spinRate', 'balanceIndex', 'balance',
] as const satisfies readonly (keyof SkaterPose)[];
/** Champs discrets : pris tels quels sur l'image la plus proche, jamais interpolés. */
const DISCRETE = new Set<keyof SkaterPose>(['airborne', 'landQuality', 'grabIndex', 'balanceIndex', 'trickProgress', 'landImpact']);
/** Temps qui croissent pendant un segment et repartent de zéro (ou valent -1) : voir SkaterVisual. */
const TIMERS = new Set<keyof SkaterPose>(['pushPhase', 'popTime', 'airTime', 'landTime']);
const PAIRS = ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'hand'] as const;

// Disposition d'une image dans le tampon.
const ROOT = 0; // position (3) + orientation (4)
const POSE = 7;
const WEIGHT = POSE + POSE_KEYS.length;
const JOINTS = WEIGHT + 1; // bassin 3, torse 4, tête 3, 6 paires × 2 × 3
const CAMERA = JOINTS + 3 + 4 + 3 + PAIRS.length * 6; // position (3) + orientation (4)
const STRIDE = CAMERA + 7;

/** Image reconstituée pour l'affichage. */
export interface ReplayFrame {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly pose: SkaterPose;
  readonly joints: RagdollJoints;
  /** Poids du ragdoll (0 hors chute). */
  weight: number;
  readonly cameraPosition: THREE.Vector3;
  readonly cameraQuaternion: THREE.Quaternion;
}

export function createFrame(): ReplayFrame {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    pose: createPose(),
    joints: createJoints(),
    weight: 0,
    cameraPosition: new THREE.Vector3(),
    cameraQuaternion: new THREE.Quaternion(),
  };
}

/**
 * Enregistrement des REPLAY.duration dernières secondes : un tampon circulaire de Float32Array, rempli à
 * REPLAY.sampleHz sans allocation. Chaque image contient la pose affichée du skateur (planche lâchée comprise
 * pendant une chute), sa pose d'animation, les articulations du ragdoll et la caméra de jeu.
 */
export class ReplayRecorder {
  readonly hz = REPLAY.sampleHz;
  private readonly capacity = Math.ceil(REPLAY.duration * REPLAY.sampleHz);
  private readonly data = new Float32Array(this.capacity * STRIDE);
  /** Index de la prochaine écriture, et nombre d'images valides. */
  private head = 0;
  private count = 0;
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  /** Durée enregistrée (s). */
  get duration(): number {
    return Math.max(0, (this.count - 1) / this.hz);
  }

  clear(): void {
    this.head = this.count = 0;
  }

  record(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    pose: Readonly<SkaterPose>,
    ragdoll: { readonly joints: RagdollJoints; readonly weight: number } | null,
    cameraPosition: THREE.Vector3,
    cameraQuaternion: THREE.Quaternion,
  ): void {
    const d = this.data;
    const o = this.head * STRIDE;
    writeVec(d, o + ROOT, position);
    writeQuat(d, o + ROOT + 3, quaternion);
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const v = pose[POSE_KEYS[i]!];
      d[o + POSE + i] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    }
    d[o + WEIGHT] = ragdoll ? ragdoll.weight : 0;
    if (ragdoll) {
      const j = ragdoll.joints;
      let k = o + JOINTS;
      writeVec(d, k, j.pelvis);
      writeQuat(d, k + 3, j.torso);
      writeVec(d, k + 7, j.head);
      k += 10;
      for (const name of PAIRS) {
        writeVec(d, k, j[name][0]);
        writeVec(d, k + 3, j[name][1]);
        k += 6;
      }
    }
    writeVec(d, o + CAMERA, cameraPosition);
    writeQuat(d, o + CAMERA + 3, cameraQuaternion);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /** Image au temps `t` (s, 0 = la plus ancienne), interpolée entre les deux images voisines. */
  sample(t: number, out: ReplayFrame): void {
    if (this.count === 0) return;
    const f = Math.max(0, Math.min(this.count - 1, t * this.hz));
    const i0 = Math.floor(f);
    const i1 = Math.min(this.count - 1, i0 + 1);
    const a = this.offset(i0);
    const b = this.offset(i1);
    const k = f - i0;
    const d = this.data;
    lerpVec(d, a + ROOT, b + ROOT, k, out.position);
    this.slerp(a + ROOT + 3, b + ROOT + 3, k, out.quaternion);
    const pose = out.pose as unknown as Record<string, number | boolean>;
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const key = POSE_KEYS[i]!;
      const va = d[a + POSE + i]!;
      const vb = d[b + POSE + i]!;
      let v: number;
      if (DISCRETE.has(key)) v = k < 0.5 ? va : vb;
      else if (TIMERS.has(key)) v = va >= 0 && vb >= va ? va + (vb - va) * k : vb;
      else if ((key === 'trickFlip' || key === 'trickShove') && Math.abs(vb - va) > Math.PI) v = vb;
      else v = va + (vb - va) * k;
      pose[key] = key === 'airborne' ? v > 0.5 : v;
    }
    const wa = d[a + WEIGHT]!;
    const wb = d[b + WEIGHT]!;
    out.weight = wa + (wb - wa) * k;
    if (out.weight > 0) {
      // Entrée ou sortie de chute entre les deux images : on garde les articulations de celle qui en a.
      const ja = wa > 0 ? a : b;
      const jb = wb > 0 ? b : a;
      const j = out.joints;
      let p = JOINTS;
      lerpVec(d, ja + p, jb + p, k, j.pelvis);
      this.slerp(ja + p + 3, jb + p + 3, k, j.torso);
      lerpVec(d, ja + p + 7, jb + p + 7, k, j.head);
      p += 10;
      for (const name of PAIRS) {
        lerpVec(d, ja + p, jb + p, k, j[name][0]);
        lerpVec(d, ja + p + 3, jb + p + 3, k, j[name][1]);
        p += 6;
      }
    }
    lerpVec(d, a + CAMERA, b + CAMERA, k, out.cameraPosition);
    this.slerp(a + CAMERA + 3, b + CAMERA + 3, k, out.cameraQuaternion);
  }

  /** Décalage dans le tampon de l'image n° `i` (0 = la plus ancienne). */
  private offset(i: number): number {
    const start = this.count < this.capacity ? 0 : this.head;
    return ((start + i) % this.capacity) * STRIDE;
  }

  private slerp(a: number, b: number, k: number, out: THREE.Quaternion): void {
    const d = this.data;
    this.qa.set(d[a]!, d[a + 1]!, d[a + 2]!, d[a + 3]!);
    this.qb.set(d[b]!, d[b + 1]!, d[b + 2]!, d[b + 3]!);
    out.slerpQuaternions(this.qa, this.qb, k);
  }
}

function writeVec(d: Float32Array, o: number, v: THREE.Vector3): void {
  d[o] = v.x;
  d[o + 1] = v.y;
  d[o + 2] = v.z;
}

function writeQuat(d: Float32Array, o: number, q: THREE.Quaternion): void {
  d[o] = q.x;
  d[o + 1] = q.y;
  d[o + 2] = q.z;
  d[o + 3] = q.w;
}

function lerpVec(d: Float32Array, a: number, b: number, k: number, out: THREE.Vector3): void {
  out.set(d[a]! + (d[b]! - d[a]!) * k, d[a + 1]! + (d[b + 1]! - d[a + 1]!) * k, d[a + 2]! + (d[b + 2]! - d[a + 2]!) * k);
}
