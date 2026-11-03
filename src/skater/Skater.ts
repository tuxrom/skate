import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BODY, GROUND, INPUT, MATERIALS, SKATING, WORLD, type SurfaceMaterial } from '@/config/physics';
import type { PhysicsWorld, RayHit } from '@/physics/PhysicsWorld';
import type { PoseSource } from '@/physics/InterpolatedBody';
import type { InputSnapshot } from '@/core/Input';
import { StateMachine } from './StateMachine';
import type { SkaterStateId } from './states';
import { registerSkaterStates } from './skaterStates';
import type { SkaterPose } from './SkaterRig';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = new THREE.Vector3(0, WORLD.gravity, 0);
const COS_WALL = Math.cos(GROUND.wallAngle);
const COS_TRANSITION = Math.cos(GROUND.maxTransitionAngle);
const COS_LANDING = Math.cos(GROUND.maxLandingAngle);
const CAPSULE_CENTER = BODY.capsuleClearance + BODY.capsuleRadius + BODY.capsuleHalfHeight;
const HALF_BOARD = BODY.boardLength / 2;
const HALF_WIDTH = BODY.boardWidth / 2;
const HALF_WHEELBASE = BODY.wheelbase / 2;

const EMPTY_INPUT: InputSnapshot = { move: { x: 0, y: 0 }, flick: { x: 0, y: 0 }, held: new Set(), pressed: new Set() };

/** Résultat combiné des deux sondes de sol (trucks avant et arrière). */
interface GroundContact {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  material: SurfaceMaterial;
}

/**
 * Simulation du skateur : état cinématique, suivi du sol, collisions, machine à états.
 *
 * Le skateur n'est pas un corps dynamique : sa vitesse est intégrée ici, à pas fixe.
 * - Au sol, deux rayons (un par truck) donnent le point de contact et la normale.
 * - Les obstacles bas sont détectés par des rayons au ras de la planche.
 * - Les obstacles hauts sont gérés par une capsule et le contrôleur cinématique de Rapier.
 */
export class Skater implements PoseSource {
  /** Point de contact au sol, au milieu des trucks (m). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Cap de la planche, unitaire, tangent au sol quand on roule. */
  readonly forward = new THREE.Vector3(0, 0, -1);
  /** Normale du sol au sol, axe vertical de la planche en l'air. */
  readonly up = new THREE.Vector3(0, 1, 0);
  /** Normale lissée utilisée pour l'orientation affichée. */
  readonly visualUp = new THREE.Vector3(0, 1, 0);

  grounded = true;
  surface: SurfaceMaterial = 'concrete';
  /** Inclinaison de la planche (rad), positive vers la droite. */
  lean = 0;
  /** Temps passé en l'air (s). */
  airTime = 0;

  // Intentions écrites par les états, consommées par l'intégration.
  /** Accélération de poussée le long du cap (m/s²). */
  pushAccel = 0;
  /** Phase de poussée pour l'animation : [0, 1[ contact, [1, 2[ retour du pied, -1 sinon. */
  pushPhase = -1;
  /** Force de freinage normalisée (0 à 1). */
  brake = 0;
  tuck = false;
  /** Temps écoulé dans la poussée en cours (s). */
  pushTimer = 0;
  /** Fin de la mémorisation d'une poussée demandée trop tôt (s, temps de simulation). */
  pushQueuedUntil = -1;
  /** Temps de simulation écoulé (s). */
  time = 0;

  input: InputSnapshot = EMPTY_INPUT;
  readonly fsm: StateMachine<SkaterStateId, Skater>;

  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  // Temporaires réutilisés (pas d'allocation par pas).
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();
  private readonly right = new THREE.Vector3();
  private readonly contact: GroundContact = {
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    material: 'concrete',
  };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDir = { x: 0, y: 0, z: 0 };
  private readonly desired = { x: 0, y: 0, z: 0 };

  constructor(private readonly physics: PhysicsWorld) {
    const R = physics.rapier;
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(BODY.capsuleHalfHeight, BODY.capsuleRadius));
    this.controller = physics.world.createCharacterController(BODY.collisionSkin);
    this.controller.setSlideEnabled(true);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.controller.setMaxSlopeClimbAngle(GROUND.wallAngle);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    this.fsm = new StateMachine<SkaterStateId, Skater>(this);
    registerSkaterStates(this.fsm);
    this.fsm.start('idle');
  }

  /** Collider du corps, à exclure des requêtes externes (caméra). */
  get bodyCollider(): RAPIER.Collider {
    return this.collider;
  }

  get speed(): number {
    return this.velocity.length();
  }

  get forwardSpeed(): number {
    return this.velocity.dot(this.forward);
  }

  get state(): SkaterStateId | null {
    return this.fsm.current;
  }

  /** Téléporte le skateur à l'arrêt, posé sur le sol sous `position`. */
  reset(position: THREE.Vector3, forward: THREE.Vector3): void {
    this.position.copy(position);
    this.forward.copy(forward).setY(0).normalize();
    this.up.copy(WORLD_UP);
    this.visualUp.copy(WORLD_UP);
    this.velocity.set(0, 0, 0);
    this.lean = 0;
    this.pushAccel = 0;
    this.pushPhase = -1;
    this.brake = 0;
    this.airTime = 0;
    this.grounded = this.probeGround(GROUND.probeHeight + 2) !== null;
    if (this.grounded) this.applyContact(this.contact);
    this.syncCollider();
    this.fsm.start(this.grounded ? 'idle' : 'air');
  }

  // ---------------------------------------------------------------------------
  // Lecture de l'input, utilisée par les états.

  brakeRequested(): boolean {
    return this.input.move.y < -INPUT.brakeThreshold;
  }

  boostHeld(): boolean {
    return this.input.held.has('boost');
  }

  /** Vrai si le joueur demande une poussée (appui, maintien, Shift, ou poussée mémorisée). */
  pushRequested(): boolean {
    const i = this.input;
    return i.pressed.has('push') || i.held.has('push') || i.held.has('boost') || this.time < this.pushQueuedUntil;
  }

  updateLean(dt: number): void {
    const target = this.input.move.x * SKATING.leanMax;
    this.lean += (target - this.lean) * (1 - Math.exp(-SKATING.leanResponse * dt));
  }

  // ---------------------------------------------------------------------------
  // Pas de simulation.

  step(dt: number, input: InputSnapshot): void {
    this.input = input;
    this.time += dt;
    this.tuck = input.move.y > INPUT.tuckThreshold;
    this.fsm.update(dt);

    if (this.grounded) this.groundStep(dt);
    else this.airStep(dt);

    const k = 1 - Math.exp(-GROUND.upSmoothing * dt);
    this.visualUp.lerp(this.up, k).normalize();
    this.syncCollider();
  }

  private groundStep(dt: number): void {
    const n = this.up;
    const f = this.forward;
    const v = this.velocity;
    const mat = MATERIALS[this.surface];
    const gDotN = GRAVITY.dot(n);
    const normalLoad = Math.max(0, -gDotN);

    // Virage : le cap et la vitesse tournent ensemble autour de la normale.
    const speed = v.length();
    const leanN = this.lean / SKATING.leanMax;
    const radius = lerp(SKATING.minTurnRadius, SKATING.highSpeedTurnRadius, clamp01(speed / SKATING.maxSpeed));
    const carve = (v.dot(f) / radius) * leanN;
    const pivot = clamp01(1 - speed / SKATING.stationaryTurnBlendSpeed);
    const yawRate = carve * (1 - pivot) + SKATING.stationaryTurnRate * leanN * pivot;
    this.tmpQ.setFromAxisAngle(n, -yawRate * dt);
    f.applyQuaternion(this.tmpQ);
    v.applyQuaternion(this.tmpQ);

    // Gravité tangentielle et poussée.
    const tangentGravity = this.tmpA.copy(GRAVITY).addScaledVector(n, -gDotN);
    v.addScaledVector(tangentGravity, dt);
    v.addScaledVector(f, this.pushAccel * dt);

    // Résistances : roulement, air, frein, survitesse. Elles freinent sans jamais inverser le sens.
    const s = v.length();
    const drag = SKATING.airDrag * (this.tuck ? SKATING.tuckDragMultiplier : 1);
    let decel = mat.rollingResistance * normalLoad + drag * s * s + this.brake * SKATING.brakeDecel;
    if (s > SKATING.maxSpeed * mat.speedMultiplier) decel += SKATING.overSpeedDecel;
    if (s > 0) v.multiplyScalar(Math.max(0, s - decel * dt) / s);

    // Immobilisation : sous stopSpeed, si la pente ne vainc pas la résistance au roulement.
    const holding = mat.rollingResistance * normalLoad;
    if (v.length() < SKATING.stopSpeed && this.pushAccel === 0 && tangentGravity.length() <= holding) v.set(0, 0, 0);

    // Adhérence latérale des roues, dérapage au-delà de maxLateralGrip.
    const lateral = this.tmpB.copy(v).addScaledVector(f, -v.dot(f)).addScaledVector(n, -v.dot(n));
    const lat = lateral.length();
    if (lat > 1e-6) v.addScaledVector(lateral, -Math.min(1, (SKATING.maxLateralGrip * dt) / lat));
    v.addScaledVector(n, -v.dot(n));

    this.resolveBoardObstacles(dt);
    this.moveBody(dt);
    this.followGround();
  }

  private airStep(dt: number): void {
    const v = this.velocity;
    this.airTime += dt;
    v.addScaledVector(GRAVITY, dt);
    const s = v.length();
    if (s > 0) v.multiplyScalar(Math.max(0, s - SKATING.airDrag * s * s * dt) / s);

    // Rotation de cap à l'inclinaison, puis retour progressif vers la verticale.
    this.tmpQ.setFromAxisAngle(this.up, -(this.lean / SKATING.leanMax) * SKATING.airTurnRate * dt);
    this.forward.applyQuaternion(this.tmpQ);
    const k = 1 - Math.exp(-GROUND.airUprightRate * dt);
    this.tmpQ.setFromUnitVectors(this.up, WORLD_UP);
    this.tmpQ.slerpQuaternions(IDENTITY_Q, this.tmpQ, k);
    this.up.applyQuaternion(this.tmpQ).normalize();
    this.forward.applyQuaternion(this.tmpQ);
    orthonormalize(this.forward, this.up);

    this.resolveBoardObstacles(dt);
    this.moveBody(dt);
    this.tryLand(dt);
  }

  /**
   * Rayons au ras de la planche, vers l'avant et l'arrière, au centre et sur les bords.
   * Une face plus raide que wallAngle bloque la planche ; une pente est laissée aux sondes de sol.
   */
  private resolveBoardObstacles(dt: number): void {
    const n = this.up;
    const v = this.velocity;
    const side = this.right.crossVectors(this.forward, n).normalize();
    for (let dirSign = 1; dirSign >= -1; dirSign -= 2) {
      const dir = this.tmpC.copy(this.forward).multiplyScalar(dirSign);
      const reach = HALF_BOARD + BODY.collisionSkin + Math.max(0, v.dot(dir)) * dt;
      for (let lateral = -1; lateral <= 1; lateral++) {
        setVec(
          this.rayOrigin,
          this.position.x + n.x * GROUND.wallRayHeight + side.x * lateral * HALF_WIDTH,
          this.position.y + n.y * GROUND.wallRayHeight + side.y * lateral * HALF_WIDTH,
          this.position.z + n.z * GROUND.wallRayHeight + side.z * lateral * HALF_WIDTH,
        );
        setVec(this.rayDir, dir.x, dir.y, dir.z);
        const hit = this.physics.castRay(this.rayOrigin, this.rayDir, reach, this.collider);
        if (!hit) continue;
        const hn = this.tmpA.set(hit.normal.x, hit.normal.y, hit.normal.z);
        if (hn.dot(n) > COS_WALL) continue;
        // Normale du mur ramenée dans le plan du sol, pour ne pas pousser dans le sol.
        hn.addScaledVector(n, -hn.dot(n));
        if (hn.lengthSq() < 1e-8) continue;
        hn.normalize();
        this.wallResponse(hn);
        const penetration = HALF_BOARD + BODY.collisionSkin - hit.toi;
        if (penetration > 0) this.position.addScaledVector(hn, penetration * Math.abs(dir.dot(hn)));
      }
    }
  }

  /** Supprime la composante de vitesse entrant dans le mur, avec un léger rebond et du frottement. */
  private wallResponse(wallNormal: THREE.Vector3): void {
    const v = this.velocity;
    const vn = v.dot(wallNormal);
    if (vn >= 0) return;
    const speed = v.length();
    const steepness = speed > 1e-6 ? -vn / speed : 0;
    const retention = 1 - (1 - GROUND.wallSpeedRetention) * steepness;
    v.addScaledVector(wallNormal, -vn);
    v.multiplyScalar(retention);
    v.addScaledVector(wallNormal, -vn * GROUND.wallBounce);

    // Choc rasant : le mur redresse la planche le long de sa surface, dans le sens du roulage.
    const f = this.forward;
    const into = f.dot(wallNormal);
    if (Math.abs(into) < Math.sin(GROUND.wallDeflectAngle)) {
      const sign = v.dot(f) >= 0 ? 1 : -1;
      if (sign * into < 0) {
        f.addScaledVector(wallNormal, -into);
        orthonormalize(f, this.up);
      }
    }
  }

  /** Déplace la capsule du corps avec le contrôleur cinématique et applique les chocs contre les murs. */
  private moveBody(dt: number): void {
    const v = this.velocity;
    setVec(this.desired, v.x * dt, v.y * dt, v.z * dt);
    const classifyUp = this.grounded ? this.up : WORLD_UP;
    this.controller.setUp(classifyUp);
    this.controller.computeColliderMovement(this.collider, this.desired);
    const moved = this.controller.computedMovement();

    const count = this.controller.numComputedCollisions();
    for (let i = 0; i < count; i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      const hn = this.tmpA.set(c.normal1.x, c.normal1.y, c.normal1.z);
      if (hn.dot(classifyUp) > COS_WALL) continue;
      if (this.grounded) hn.addScaledVector(this.up, -hn.dot(this.up));
      if (hn.lengthSq() < 1e-8) continue;
      this.wallResponse(hn.normalize());
    }

    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;
  }

  /**
   * Recolle la planche au sol après le déplacement, ou la fait décoller.
   * Une arête convexe fait décoller si la vitesse d'éloignement du nouveau plan dépasse
   * ce que la gravité peut courber pendant le passage de l'entraxe.
   */
  private followGround(): void {
    const contact = this.probeGround(GROUND.probeHeight + GROUND.snapDistance);
    if (!contact) {
      this.leaveGround();
      return;
    }
    const v = this.velocity;
    const speed = v.length();
    const away = v.dot(contact.normal);
    const normalLoad = Math.max(0, -GRAVITY.dot(contact.normal));
    const absorbable = Math.max(GROUND.convexLaunchSpeed, speed > 1e-3 ? (normalLoad * BODY.wheelbase) / speed : Infinity);
    if (away > absorbable) {
      this.leaveGround();
      return;
    }
    const cosDelta = THREE.MathUtils.clamp(this.up.dot(contact.normal), -1, 1);
    v.addScaledVector(contact.normal, -v.dot(contact.normal));
    const projected = v.length();
    if (projected > 1e-6) v.multiplyScalar((speed * (1 - GROUND.transitionSpeedLoss * (1 - cosDelta))) / projected);
    this.applyContact(contact);
  }

  private tryLand(dt: number): void {
    const approach = Math.max(0, -this.velocity.dot(this.up)) * dt;
    const contact = this.probeGround(GROUND.probeHeight + GROUND.snapDistance + approach, COS_LANDING);
    if (!contact || this.velocity.dot(contact.normal) > 0) return;
    // L'impact supprime la composante normale ; la vitesse tangentielle est conservée.
    this.velocity.addScaledVector(contact.normal, -this.velocity.dot(contact.normal));
    this.applyContact(contact);
    this.grounded = true;
  }

  private leaveGround(): void {
    this.grounded = false;
    this.airTime = 0;
  }

  private applyContact(c: GroundContact): void {
    this.position.copy(c.position);
    this.up.copy(c.normal);
    this.surface = c.material;
    orthonormalize(this.forward, this.up);
  }

  /**
   * Sonde le sol sous les deux trucks, le long de -up.
   * Avec deux contacts, la planche s'appuie sur la droite qui les relie (tangage réel sur une transition).
   */
  private probeGround(maxToi: number, minCos = COS_TRANSITION): GroundContact | null {
    const front = this.probeTruck(1, maxToi, minCos);
    const frontPoint = front ? this.tmpB.set(front.point.x, front.point.y, front.point.z) : null;
    const frontNormal = front ? this.tmpC.set(front.normal.x, front.normal.y, front.normal.z) : null;
    const rear = this.probeTruck(-1, maxToi, minCos);
    const c = this.contact;

    if (frontPoint && frontNormal && rear) {
      const rearPoint = this.tmpA.set(rear.point.x, rear.point.y, rear.point.z);
      c.position.addVectors(frontPoint, rearPoint).multiplyScalar(0.5);
      const along = frontPoint.sub(rearPoint);
      const avg = frontNormal.add(this.tmpA.set(rear.normal.x, rear.normal.y, rear.normal.z)).normalize();
      if (along.lengthSq() > 1e-8) {
        along.normalize();
        const side = this.right.crossVectors(along, avg).normalize();
        c.normal.crossVectors(side, along).normalize();
      } else {
        c.normal.copy(avg);
      }
      c.material = rear.material;
      return c;
    }

    const single = front ?? rear;
    if (!single) return null;
    const sign = front ? 1 : -1;
    c.normal.set(single.normal.x, single.normal.y, single.normal.z);
    const tangent = this.tmpA.copy(this.forward).addScaledVector(c.normal, -this.forward.dot(c.normal)).normalize();
    c.position.set(single.point.x, single.point.y, single.point.z).addScaledVector(tangent, -sign * HALF_WHEELBASE);
    c.material = single.material;
    return c;
  }

  private probeTruck(sign: number, maxToi: number, minCos: number): RayHit | null {
    const n = this.up;
    const f = this.forward;
    const o = sign * HALF_WHEELBASE;
    setVec(
      this.rayOrigin,
      this.position.x + f.x * o + n.x * GROUND.probeHeight,
      this.position.y + f.y * o + n.y * GROUND.probeHeight,
      this.position.z + f.z * o + n.z * GROUND.probeHeight,
    );
    setVec(this.rayDir, -n.x, -n.y, -n.z);
    const hit = this.physics.castRay(this.rayOrigin, this.rayDir, maxToi, this.collider);
    if (!hit) return null;
    const cos = hit.normal.x * n.x + hit.normal.y * n.y + hit.normal.z * n.z;
    return cos >= minCos ? hit : null;
  }

  private syncCollider(): void {
    const n = this.up;
    this.collider.setTranslation({
      x: this.position.x + n.x * CAPSULE_CENTER,
      y: this.position.y + n.y * CAPSULE_CENTER,
      z: this.position.z + n.z * CAPSULE_CENTER,
    });
    this.tmpQ.setFromUnitVectors(WORLD_UP, n);
    this.collider.setRotation(this.tmpQ);
  }

  // ---------------------------------------------------------------------------
  // Sorties pour le rendu.

  readPose(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    position.copy(this.position);
    const up = this.visualUp;
    const fwd = this.tmpA.copy(this.forward).addScaledVector(up, -this.forward.dot(up));
    if (fwd.lengthSq() < 1e-8) fwd.copy(this.forward);
    fwd.normalize();
    const right = this.tmpB.crossVectors(fwd, up).normalize();
    const back = fwd.negate();
    this.tmpM.makeBasis(right, up, back);
    rotation.setFromRotationMatrix(this.tmpM);
  }

  writeAnimationPose(out: SkaterPose): void {
    out.lean = this.lean;
    out.pushPhase = this.pushPhase;
    out.brake = this.brake;
    out.crouch = this.grounded ? (this.tuck ? 1 : 0) : 0.6;
    out.speed = this.forwardSpeed;
    out.airborne = !this.grounded;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeCollider(this.collider, false);
  }
}

const IDENTITY_Q = new THREE.Quaternion();

function setVec(out: { x: number; y: number; z: number }, x: number, y: number, z: number): void {
  out.x = x;
  out.y = y;
  out.z = z;
}

/** Rend `forward` unitaire et orthogonal à `up` (conserve le cap précédent si dégénéré). */
function orthonormalize(forward: THREE.Vector3, up: THREE.Vector3): void {
  const x = forward.x - up.x * forward.dot(up);
  const y = forward.y - up.y * forward.dot(up);
  const z = forward.z - up.z * forward.dot(up);
  const len = Math.hypot(x, y, z);
  if (len > 1e-6) forward.set(x / len, y / len, z / len);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
