import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BAIL, BODY } from '@/config/physics';
import { LOOSE_BOARD_GROUPS, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { PoseSource } from '@/physics/InterpolatedBody';
import { Ragdoll } from './Ragdoll';
import { copyJoints, createJoints, type RagdollJoints } from './SkaterRig';
import type { BailInfo, Skater } from './Skater';

export type BailPhase = 'none' | 'ragdoll' | 'getup';

/** Demi-épaisseur et hauteur du centre de la planche lâchée au-dessus du contact des roues (m). */
const BOARD_HALF = { x: BODY.boardWidth / 2, y: 0.03, z: BODY.boardLength / 2 };
const BOARD_CENTER_HEIGHT = 0.09;
/** Capsule de vérification d'un point de relève : celle du corps du skateur. */
const STAND_HALF_HEIGHT = BODY.capsuleHalfHeight;
const STAND_RADIUS = BODY.capsuleRadius;
/** Recherche d'un point de relève : anneaux espacés de ce pas, 8 directions par anneau (m). */
const SEARCH_STEP = 0.5;
const SEARCH_DIRECTIONS = 8;
/** Hauteur de départ et portée du rayon qui cherche le sol sous un candidat (m). */
const SEARCH_RAY_UP = 1.5;
const SEARCH_RAY_LENGTH = 4;

/**
 * Chute du skateur : ragdoll du corps, planche lâchée sur sa propre trajectoire, puis relève.
 * Phases : `ragdoll` (physique), `getup` (fondu de la pose au sol vers la pose debout), `none`.
 * La planche lâchée sert de pose au skateur pendant la chute (PoseSource), le rig y reste accroché.
 */
export class BailController implements PoseSource {
  phase: BailPhase = 'none';
  cause = '';
  private time = 0;
  private settled = 0;
  private getUpTime = 0;
  private getUpDuration: number = BAIL.getUpTime;
  private getUpRequested = false;
  private quick = false;
  private readonly ragdoll: Ragdoll;
  private board: RAPIER.RigidBody | null = null;
  private readonly frozen = createJoints();
  private readonly interpolated = createJoints();
  private readonly info = { velocity: new THREE.Vector3(), forward: new THREE.Vector3() };
  /** Statistiques pour le debug et les tests. */
  lowestPoint = Infinity;
  maxPartSpeed = 0;
  count = 0;

  private readonly prevBoardPos = new THREE.Vector3();
  private readonly currBoardPos = new THREE.Vector3();
  private readonly currBoardQuat = new THREE.Quaternion();
  private readonly boardLastVel = new THREE.Vector3();
  private boardSoundCooldown = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly spot = new THREE.Vector3();
  private readonly ray = { x: 0, y: 0, z: 0 };
  private readonly down = { x: 0, y: -1, z: 0 };

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly skater: Skater,
  ) {
    this.ragdoll = new Ragdoll(physics);
  }

  /** Lance la chute depuis la pose affichée (`pose`) et la pose de la planche (`boardPos`, `boardQuat`). */
  start(info: BailInfo, pose: RagdollJoints, boardPos: THREE.Vector3, boardQuat: THREE.Quaternion): void {
    this.end();
    this.count++;
    this.cause = info.cause;
    this.time = 0;
    this.settled = 0;
    this.getUpRequested = false;
    this.lowestPoint = Infinity;
    this.maxPartSpeed = 0;
    this.info.forward.copy(info.forward);

    const v = this.tmp.copy(info.velocity).multiplyScalar(BAIL.inheritVelocity);
    if (v.length() > BAIL.maxInheritedSpeed) v.setLength(BAIL.maxInheritedSpeed);
    this.info.velocity.copy(v);
    // Rotation d'ensemble : on bascule autour de l'axe horizontal perpendiculaire à la marche.
    const spin = new THREE.Vector3();
    if (info.cause === 'trip' || info.cause === 'wall') {
      const travel = new THREE.Vector3(v.x, 0, v.z);
      if (travel.lengthSq() > 1e-4) spin.crossVectors(UP, travel.normalize()).multiplyScalar(BAIL.tripTumble);
      v.y += BAIL.tripLift;
    }
    this.ragdoll.spawn(pose, v, spin, Math.floor(Math.random() * 1e6) + 1);

    const R = this.physics.rapier;
    const c = this.tmp.set(0, BOARD_CENTER_HEIGHT, 0).applyQuaternion(boardQuat).add(boardPos);
    this.board = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(c.x, c.y, c.z)
        .setRotation(boardQuat)
        .setLinvel(this.info.velocity.x, this.info.velocity.y, this.info.velocity.z)
        .setAngvel({ x: (Math.random() - 0.5) * BAIL.boardTumble, y: (Math.random() - 0.5) * BAIL.boardTumble, z: (Math.random() - 0.5) * BAIL.boardTumble })
        .setLinearDamping(BAIL.linearDamping)
        .setAngularDamping(BAIL.angularDamping * 0.5)
        .setCcdEnabled(true),
    );
    this.physics.world.createCollider(
      R.ColliderDesc.cuboid(BOARD_HALF.x, BOARD_HALF.y, BOARD_HALF.z)
        .setDensity(BAIL.bodyDensity * 0.4)
        .setFriction(0.6)
        .setRestitution(0.2)
        .setCollisionGroups(LOOSE_BOARD_GROUPS)
        .setSolverGroups(LOOSE_BOARD_GROUPS),
      this.board,
    );
    this.boardLastVel.set(0, 0, 0);
    this.readBoard();
    this.prevBoardPos.copy(this.currBoardPos);
    this.phase = 'ragdoll';
  }

  /** R : se relever tout de suite (fondu raccourci). */
  requestGetUp(): void {
    if (this.phase !== 'ragdoll') return;
    this.getUpRequested = true;
    this.quick = true;
  }

  /**
   * Après chaque pas physique. Pendant la chute : garde-fous, sons, stabilisation, puis relève
   * quand le corps est posé, au délai max ou sur demande. Pendant la relève : avance le fondu.
   */
  fixedStep(dt: number, onImpact: (strength: number, board: boolean) => void): void {
    if (this.phase === 'getup') {
      this.getUpTime += dt;
      if (this.getUpTime >= this.getUpDuration) this.phase = 'none';
      return;
    }
    if (this.phase !== 'ragdoll') return;
    this.time += dt;
    const speed = this.ragdoll.afterStep(dt, (s) => onImpact(s, false));
    this.maxPartSpeed = Math.max(this.maxPartSpeed, speed);
    this.lowestPoint = Math.min(this.lowestPoint, this.ragdoll.lowestPoint());
    this.stepBoard(dt, onImpact);

    this.settled = this.ragdoll.coreSpeed < BAIL.settleSpeed ? this.settled + dt : 0;
    const settled = this.time >= BAIL.minRagdollTime && this.settled >= BAIL.settleTime;
    if (settled || this.time >= BAIL.ragdollDuration || this.getUpRequested) this.beginGetUp();
  }

  private stepBoard(dt: number, onImpact: (strength: number, board: boolean) => void): void {
    const b = this.board;
    if (!b) return;
    const v = b.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > BAIL.maxPartSpeed) b.setLinvel({ x: (v.x * BAIL.maxPartSpeed) / sp, y: (v.y * BAIL.maxPartSpeed) / sp, z: (v.z * BAIL.maxPartSpeed) / sp }, true);
    const t = b.translation();
    if (t.y < BOARD_HALF.y) {
      b.setTranslation({ x: t.x, y: BOARD_HALF.y, z: t.z }, true);
      if (v.y < 0) b.setLinvel({ x: v.x, y: 0, z: v.z }, true);
    }
    const nv = b.linvel();
    const dv = Math.hypot(nv.x - this.boardLastVel.x, nv.y - this.boardLastVel.y, nv.z - this.boardLastVel.z);
    this.boardSoundCooldown = Math.max(0, this.boardSoundCooldown - dt);
    if (dv > BAIL.impactSoundSpeed && this.boardSoundCooldown === 0) {
      this.boardSoundCooldown = BAIL.impactSoundCooldown;
      onImpact(Math.min(1, dv / (BAIL.impactSoundSpeed * 4)), true);
    }
    this.boardLastVel.set(nv.x, nv.y, nv.z);
    this.prevBoardPos.copy(this.currBoardPos);
    this.readBoard();
  }

  private readBoard(): void {
    const b = this.board!;
    const t = b.translation();
    const r = b.rotation();
    this.currBoardQuat.set(r.x, r.y, r.z, r.w);
    // Point de contact des roues : sous le centre de la planche, dans son repère.
    this.currBoardPos.set(0, -BOARD_CENTER_HEIGHT, 0).applyQuaternion(this.currBoardQuat).add(this.tmp.set(t.x, t.y, t.z));
  }

  /**
   * Relève : on fige la pose au sol pour le fondu, on cherche un point dégagé près du bassin,
   * on supprime les corps et on replace le skateur debout, planche aux pieds.
   */
  private beginGetUp(): void {
    this.ragdoll.interpolate(1, this.frozen);
    const pelvis = this.ragdoll.pelvisPosition;
    const spot = this.findSpot(pelvis) ?? this.skater.lastSafePosition;
    const heading = this.tmp.set(this.info.velocity.x, 0, this.info.velocity.z);
    if (heading.lengthSq() < 0.25) heading.set(this.info.forward.x, 0, this.info.forward.z);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1);
    heading.normalize();
    this.disposeBodies();
    this.skater.recover(spot, heading);
    this.getUpDuration = this.quick ? BAIL.quickGetUpTime : BAIL.getUpTime;
    this.quick = false;
    this.getUpTime = 0;
    this.phase = 'getup';
  }

  /** Point au sol, peu pentu, où le corps tient debout sans toucher le décor ; anneaux autour du bassin. */
  private findSpot(around: THREE.Vector3): THREE.Vector3 | null {
    const maxRing = Math.ceil(BAIL.respawnSearchRadius / SEARCH_STEP);
    const minCos = Math.cos(BAIL.respawnMaxSlope);
    for (let ring = 0; ring <= maxRing; ring++) {
      const n = ring === 0 ? 1 : SEARCH_DIRECTIONS;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = around.x + Math.cos(a) * ring * SEARCH_STEP;
        const z = around.z + Math.sin(a) * ring * SEARCH_STEP;
        this.ray.x = x;
        this.ray.y = around.y + SEARCH_RAY_UP;
        this.ray.z = z;
        const hit = this.physics.castRay(this.ray, this.down, SEARCH_RAY_LENGTH, undefined, true);
        if (!hit || hit.normal.y < minCos || hit.point.y > around.y + BAIL.respawnMaxRise) continue;
        if (!this.physics.isStandingSpaceFree(hit.point, STAND_HALF_HEIGHT, STAND_RADIUS, BODY.capsuleClearance)) continue;
        return this.spot.set(hit.point.x, hit.point.y, hit.point.z);
      }
    }
    return null;
  }

  /**
   * Articulations à appliquer au rig pour ce rendu et leur poids, ou null hors chute.
   * Pendant la relève, le poids décroît de 1 à 0 : la pose au sol fond vers la pose debout.
   */
  renderJoints(alpha: number): { joints: RagdollJoints; weight: number } | null {
    if (this.phase === 'ragdoll') {
      this.ragdoll.interpolate(alpha, this.interpolated);
      return { joints: this.interpolated, weight: 1 };
    }
    if (this.phase === 'getup') {
      const t = Math.min(1, this.getUpTime / this.getUpDuration);
      copyJoints(this.interpolated, this.frozen);
      return { joints: this.interpolated, weight: 1 - t * t * (3 - 2 * t) };
    }
    return null;
  }

  /** Point suivi par la caméra pendant la chute : le bassin interpolé. */
  cameraFocus(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    this.ragdoll.interpolate(alpha, this.interpolated);
    return out.copy(this.interpolated.pelvis);
  }

  /** Pose de la planche lâchée (contact des roues), pour le rig pendant la chute. */
  readPose(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    position.copy(this.currBoardPos);
    rotation.copy(this.currBoardQuat);
  }

  private disposeBodies(): void {
    this.ragdoll.dispose();
    if (this.board) this.physics.world.removeRigidBody(this.board);
    this.board = null;
  }

  /** Interrompt tout (respawn complet). */
  end(): void {
    this.disposeBodies();
    this.phase = 'none';
  }
}

const UP = new THREE.Vector3(0, 1, 0);
