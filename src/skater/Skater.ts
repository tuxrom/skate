import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BAIL, BODY, GRAB, GROUND, INPUT, LANDING, MATERIALS, POP, SKATING, SPIN, TRICKS, WORLD, type SurfaceMaterial } from '@/config/physics';
import type { PhysicsWorld, RayHit } from '@/physics/PhysicsWorld';
import type { PoseSource } from '@/physics/InterpolatedBody';
import type { InputSnapshot } from '@/core/Input';
import type { FlickEvent } from '@/core/FlickRecognizer';
import { GRAB_ORDER, TRICK_DEFS, comboName, grabFromDirection, type GrabId, type TrickId } from './tricks';
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

const MAX_LANDING_COS_UP = Math.cos(GROUND.maxLandingAngle);
const COS_LANDING_SURFACE = Math.cos(GROUND.maxLandingSurfaceAngle);

/** Qualité d'une réception. 'bail' dépasse les seuils de chute ; les chutes arrivent à l'étape 6. */
export type LandingQuality = 'clean' | 'sloppy' | 'bail';

export interface LandingInfo {
  quality: LandingQuality;
  /** Vitesse le long de la normale au moment de l'impact (m/s). */
  impactSpeed: number;
  /** Angle entre la planche et la surface (rad). */
  tilt: number;
  /** Écart entre l'axe de la planche et la vitesse (rad), fakie compris. */
  yawError: number;
  airTime: number;
  /** Hauteur max atteinte au-dessus du point de décollage (m). */
  peakHeight: number;
  /** Vrai si le vol a commencé par un pop. */
  popped: boolean;
  /** Trick du vol. */
  trick: TrickId;
  /** Rotation de board qui restait à faire au contact (rad). */
  boardResidual: number;
  /** Rotation du corps comptée, en degrés (0, 180, 360, 540...). */
  spinDegrees: number;
  /** Écart entre la rotation finale et le multiple de 180° le plus proche (rad). */
  spinError: number;
  /** Grabs tenus assez longtemps pendant le vol, dans l'ordre. */
  readonly grabs: GrabId[];
  /** Prise encore présente au contact (0 à 1). */
  grabAtContact: number;
  /** Nom complet du saut, par exemple « 360 Kickflip Indy ». */
  label: string;
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

/** Écouteurs des événements ponctuels du skateur (son, particules, caméra). */
export interface SkaterEvents {
  pop?(charge: number, position: THREE.Vector3, trick: ActiveTrick): void;
  land?(info: LandingInfo): void;
}

/** Point de réception prévu par la trajectoire balistique. */
export interface LandingPrediction {
  valid: boolean;
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  /** Temps avant l'impact (s), mesuré quand la prédiction a été calculée. */
  time: number;
  /** Temps de vol au moment du calcul (s), pour en déduire le temps restant. */
  computedAt: number;
}

type ChargeSource = 'button' | 'stick';

/** Trick en cours : rotation du board pendant le vol, figée à la réception. */
export interface ActiveTrick {
  id: TrickId;
  /** Sens du geste (+1, -1, 0). */
  side: number;
  /** Score de reconnaissance du geste (1 pour un ollie au bouton). */
  score: number;
  /** Tours de flip et de shove, signés. */
  flips: number;
  shove: number;
  /** Durée de la rotation (s), liée à la hauteur du saut. */
  duration: number;
  /** Temps écoulé depuis le décollage (s). */
  time: number;
  /** Progression adoucie figée au contact (0 à 1), -1 tant qu'on est en l'air. */
  landedProgress: number;
}

/** Progression de rotation adoucie : rapide au flick, ralentie au rattrapage. */
export function trickEase(p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return 1 - (1 - x) * (1 - x);
}

const EMPTY_INPUT: InputSnapshot = {
  move: { x: 0, y: 0 },
  flick: { x: 0, y: 0 },
  gesture: { charging: false, flicking: false, event: null, cancelled: false },
  grab: { x: 0, y: 0 },
  held: new Set(),
  pressed: new Set(),
};

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
  /** Nombre de poussées enchaînées sans relâcher la touche. */
  pushChain = 0;

  // Ollie.
  /** Charge de l'ollie (0 à 1). */
  charge = 0;
  private chargeSource: ChargeSource | null = null;
  /** Temps écoulé dans l'état pop (s). */
  popTimer = 0;
  /** Temps depuis le début du pop, pour l'animation (s), -1 sinon. */
  popTime = -1;
  /** Charge conservée en quittant le sol pendant la charge (coyote time), -1 sinon. */
  coyoteCharge = -1;
  /** Instant du dernier appui d'ollie, pour le buffer de réception (s). */
  private lastOllieTap = -Infinity;
  // Rotation du corps en l'air.
  /** Angle de rotation accumulé depuis le décollage (rad), positif vers la droite. */
  spinAngle = 0;
  /** Vitesse de rotation (rad/s), positive vers la droite. */
  spinRate = 0;
  /** Multiple de 180° visé par l'aimantation, verrouillé une fois choisi (NaN tant qu'aucun). */
  private spinSnapTarget = Number.NaN;

  // Grab.
  /** Grab en cours ou en train d'être lâché, null sinon. */
  grabId: GrabId | null = null;
  /** Prise de la main sur le board (0 lâché, 1 main sur le board). */
  grabAmount = 0;
  /** Temps passé main sur le board pour le grab courant (s). */
  private grabHold = 0;
  private grabCounted = false;
  /** Grabs comptés pendant le vol en cours. */
  private readonly grabsThisAir: GrabId[] = [];
  /** Geste reconnu en attente du pop. */
  private pendingFlick: FlickEvent | null = null;
  readonly trick: ActiveTrick = { id: 'ollie', side: 0, score: 1, flips: 0, shove: 0, duration: 1, time: 0, landedProgress: 1 };
  private takeoffY = 0;
  private peakY = 0;
  private popped = false;
  private predictionCountdown = 0;

  // Réception.
  /** Temps depuis la dernière réception évaluée (s), -1 sinon. */
  landTime = -1;
  /** Temps de récupération restant après une réception (s). */
  recovery = 0;
  readonly lastLanding: LandingInfo = {
    quality: 'clean',
    impactSpeed: 0,
    tilt: 0,
    yawError: 0,
    airTime: 0,
    peakHeight: 0,
    popped: false,
    trick: 'ollie',
    boardResidual: 0,
    spinDegrees: 0,
    spinError: 0,
    grabs: [],
    grabAtContact: 0,
    label: '',
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
  };
  readonly prediction: LandingPrediction = {
    valid: false,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    time: 0,
    computedAt: 0,
  };
  events: SkaterEvents = {};

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
  private readonly predPos = new THREE.Vector3();
  private readonly predVel = new THREE.Vector3();
  private readonly predNext = new THREE.Vector3();

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

  /** +1 en roulant nose devant, -1 en fakie. Sous 0,3 m/s, le sens du board. */
  travelSign(): number {
    const s = this.velocity.dot(this.forward);
    return s < -0.3 ? -1 : 1;
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
    this.charge = 0;
    this.chargeSource = null;
    this.popTime = -1;
    this.coyoteCharge = -1;
    this.landTime = -1;
    this.recovery = 0;
    this.resetAirMoves();
    this.grabAmount = 0;
    this.grabId = null;
    this.pendingFlick = null;
    this.trick.landedProgress = 1;
    this.trick.flips = this.trick.shove = 0;
    this.prediction.valid = false;
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

  /** Poussées enchaînées en maintenant la touche : plus fortes et plus rapides. */
  boostHeld(): boolean {
    return this.pushChain > 0 && this.input.held.has('push');
  }

  /** Vrai si le joueur demande une poussée (appui, maintien, ou poussée mémorisée). */
  pushRequested(): boolean {
    const i = this.input;
    return i.pressed.has('push') || i.held.has('push') || this.time < this.pushQueuedUntil;
  }

  // ---------------------------------------------------------------------------
  // Ollie : charge, relâchement, pop.

  /**
   * Demande de début de charge : bouton d'ollie appuyé ou maintenu, ou stick droit vers le bas.
   * Un tap fait juste avant la réception compte aussi (buffer).
   */
  ollieStartRequested(): ChargeSource | 'buffered' | null {
    const i = this.input;
    if (i.pressed.has('ollie') || i.held.has('ollie')) return 'button';
    if (i.gesture.charging) return 'stick';
    // Geste terminé alors que la charge n'avait pas été vue (récupération) : pop immédiat.
    if (i.gesture.event) {
      this.pendingFlick = i.gesture.event;
      return 'buffered';
    }
    if (this.time - this.lastOllieTap < INPUT.popBufferMs / 1000) return 'buffered';
    return null;
  }

  startCharge(source: ChargeSource): void {
    this.chargeSource = source;
    this.charge = 0;
    this.lastOllieTap = -Infinity;
    if (source === 'button') this.pendingFlick = null;
  }

  /**
   * Pop immédiat, sans charge vue au sol : tap mémorisé avant la réception, ou geste terminé
   * pendant la récupération. La charge vient de la durée de charge du geste s'il y en a un.
   */
  startBufferedPop(): void {
    this.chargeSource = 'button';
    this.lastOllieTap = -Infinity;
    const chargeTime = this.pendingFlick?.features.chargeTime ?? 0;
    this.charge = clamp01(chargeTime / POP.chargeTime);
  }

  /** Fait monter la charge, linéaire jusqu'à POP.chargeTime. */
  updateCharge(dt: number): void {
    this.charge = Math.min(1, this.charge + dt / POP.chargeTime);
  }

  /**
   * Fin de charge : 'pop' au relâchement du bouton ou quand le geste du stick droit est reconnu,
   * 'cancel' si le stick revient au centre sans flick (voir FlickRecognizer).
   * Un geste reconnu pendant une charge au bouton choisit aussi le trick.
   */
  ollieReleaseRequested(): 'pop' | 'cancel' | null {
    const g = this.input.gesture;
    if (g.event) {
      this.pendingFlick = g.event;
      return 'pop';
    }
    if (this.chargeSource === 'button') return this.input.held.has('ollie') ? null : 'pop';
    return g.cancelled ? 'cancel' : null;
  }

  cancelCharge(): void {
    this.charge = 0;
    this.chargeSource = null;
  }

  /** Vitesse verticale d'un pop pour une charge donnée : √(2·g·h), h linéaire en charge. */
  static popSpeed(charge: number): number {
    const h = lerp(POP.minHeight, POP.maxHeight, clamp01(charge));
    return Math.sqrt(2 * -WORLD.gravity * h);
  }

  /**
   * Décollage : la vitesse tangentielle est conservée, le pop s'ajoute le long de la normale.
   * Le trick en attente démarre ; sa rotation dure une part fixe du temps de vol prévu.
   */
  performPop(charge: number): void {
    const v = this.velocity;
    const n = this.up;
    const vn = v.dot(n);
    const popSpeed = Skater.popSpeed(charge);
    v.addScaledVector(n, -vn).multiplyScalar(POP.takeoffSpeedRetention);
    v.addScaledVector(n, Math.max(0, vn) + popSpeed);
    this.startTrick(this.pendingFlick, popSpeed);
    this.pendingFlick = null;
    this.grounded = false;
    this.airTime = 0;
    this.popped = true;
    this.takeoffY = this.peakY = this.position.y;
    this.resetAirMoves();
    this.charge = 0;
    this.chargeSource = null;
    this.coyoteCharge = -1;
    this.predictionCountdown = 0;
    if (this.popTime < 0 || this.popTime < POP.popDelay) this.popTime = POP.popDelay;
    this.events.pop?.(charge, this.position, this.trick);
  }

  private startTrick(flick: FlickEvent | null, popSpeed: number): void {
    const t = this.trick;
    const id: TrickId = flick?.trick ?? 'ollie';
    const def = TRICK_DEFS[id];
    t.id = id;
    t.side = flick?.side ?? 0;
    t.score = flick?.score ?? 1;
    t.flips = def.flips;
    t.shove = def.shove * (def.shoveFollowsGesture && t.side < 0 ? -1 : 1);
    const airTime = (2 * popSpeed) / -WORLD.gravity;
    t.duration = THREE.MathUtils.clamp(airTime * TRICKS.rotationAirFraction, TRICKS.minRotationTime, TRICKS.maxRotationTime);
    t.time = 0;
    t.landedProgress = -1;
  }

  /** Rotation de board restant à faire si l'on touchait le sol maintenant (rad). */
  boardResidual(): number {
    const t = this.trick;
    const remaining = 1 - trickEase(t.time / t.duration);
    return Math.max(Math.abs(t.flips), Math.abs(t.shove)) * 2 * Math.PI * remaining;
  }

  /** En l'air juste après une arête : le relâchement de la charge déclenche encore le pop. */
  tryCoyotePop(): boolean {
    if (this.coyoteCharge < 0) return false;
    if (this.airTime * 1000 > INPUT.coyoteMs) {
      this.coyoteCharge = -1;
      this.chargeSource = null;
      return false;
    }
    const g = this.input.gesture;
    if (g.event) this.pendingFlick = g.event;
    const release = g.event !== null || (this.chargeSource === 'button' && !this.input.held.has('ollie'));
    if (!release) return false;
    // Le pop part de la vitesse actuelle : on annule la chute déjà acquise.
    const vy = this.velocity.dot(this.up);
    if (vy < 0) this.velocity.addScaledVector(this.up, -vy);
    this.performPop(this.coyoteCharge);
    return true;
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
    if (input.pressed.has('ollie')) this.lastOllieTap = this.time;
    if (this.popTime >= 0) this.popTime = this.popTime > 2 ? -1 : this.popTime + dt;
    if (this.landTime >= 0) this.landTime = this.landTime > 2 ? -1 : this.landTime + dt;
    if (this.recovery > 0) this.recovery = Math.max(0, this.recovery - dt);
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
    // Le virage suit le sens de la marche : en fakie, incliner à droite tourne aussi à droite.
    const carve = (Math.abs(v.dot(f)) / radius) * leanN;
    const pivot = clamp01(1 - speed / SKATING.stationaryTurnBlendSpeed);
    const yawRate = carve * (1 - pivot) + SKATING.stationaryTurnRate * leanN * pivot;
    this.tmpQ.setFromAxisAngle(n, -yawRate * dt);
    f.applyQuaternion(this.tmpQ);
    v.applyQuaternion(this.tmpQ);

    // Gravité tangentielle et poussée.
    const tangentGravity = this.tmpA.copy(GRAVITY).addScaledVector(n, -gDotN);
    v.addScaledVector(tangentGravity, dt);
    // La poussée agit dans le sens de la marche (vers l'arrière du board en fakie).
    v.addScaledVector(f, this.pushAccel * this.travelSign() * dt);

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

  /**
   * En l'air : la vitesse horizontale est conservée exactement, seule la gravité agit.
   * Le corps tourne légèrement (avec inertie) et la planche s'aligne sur la surface de réception prévue.
   */
  private airStep(dt: number): void {
    const v = this.velocity;
    this.airTime += dt;
    if (this.trick.landedProgress < 0) this.trick.time += dt;
    v.addScaledVector(GRAVITY, dt);

    if (--this.predictionCountdown <= 0) {
      this.updatePrediction();
      this.predictionCountdown = POP.predictionInterval;
    }
    this.updateGrab(dt);
    this.updateSpin(dt);

    const p = this.prediction;
    const alignTo = p.valid && p.normal.dot(WORLD_UP) >= MAX_LANDING_COS_UP ? p.normal : WORLD_UP;
    const k = 1 - Math.exp(-POP.airAlignRate * dt);
    this.tmpQ.setFromUnitVectors(this.up, alignTo);
    this.tmpQ.slerpQuaternions(IDENTITY_Q, this.tmpQ, k);
    this.up.applyQuaternion(this.tmpQ).normalize();
    this.forward.applyQuaternion(this.tmpQ);
    orthonormalize(this.forward, this.up);
    this.peakY = Math.max(this.peakY, this.position.y);

    this.resolveBoardObstacles(dt);
    this.moveBody(dt);
    this.tryLand(dt);
  }

  /**
   * Rotation du corps : le stick gauche fait monter la vitesse de rotation, relâché elle continue
   * sur son élan en ralentissant. Dans les SPIN.snapLead dernières secondes avant la réception prévue,
   * l'angle est aimanté vers le multiple de 180° que la rotation atteindrait sur son élan, s'il en est assez près.
   */
  private updateSpin(dt: number): void {
    const x = this.input.move.x;
    const maxRate = SPIN.maxRate * (this.grabAmount > 0 ? GRAB.spinRateMultiplier : 1);
    const steering = Math.abs(x) > SPIN.inputDeadzone;
    if (steering) {
      const target = x * maxRate;
      this.spinRate += (target - this.spinRate) * (1 - Math.exp(-SPIN.response * dt));
    } else {
      this.spinRate *= Math.exp(-SPIN.coastDamping * dt);
    }

    const p = this.prediction;
    const remaining = p.valid ? p.time - (this.airTime - p.computedAt) : Infinity;
    if (remaining < SPIN.snapLead) {
      // Cible : le multiple de 180° que la rotation atteindrait sur son élan, pas le plus proche de l'angle actuel.
      const coast = SPIN.coastDamping > 0 ? (1 - Math.exp(-SPIN.coastDamping * remaining)) / SPIN.coastDamping : remaining;
      const projected = this.spinAngle + this.spinRate * coast;
      // La cible est verrouillée une fois choisie, sauf si le joueur tourne encore : sans ce verrou,
      // une projection proche de 270° fait hésiter l'aimantation entre 180 et 360.
      if (Number.isNaN(this.spinSnapTarget) || steering) {
        const candidate = Math.round(projected / Math.PI) * Math.PI;
        this.spinSnapTarget = Math.abs(candidate - projected) < SPIN.snapMaxError ? candidate : Number.NaN;
      }
      const target = this.spinSnapTarget;
      const error = target - this.spinAngle;
      if (!Number.isNaN(target)) {
        // Vitesse qui fermerait l'écart juste au contact.
        const desired = error / Math.max(remaining - SPIN.snapContactLead, dt);
        this.spinRate += (desired - this.spinRate) * (1 - Math.exp(-SPIN.snapResponse * dt));
      }
    }

    const step = this.spinRate * dt;
    this.spinAngle += step;
    // Rotation vers la droite (sens horaire vu de dessus) pour un angle positif.
    this.tmpQ.setFromAxisAngle(this.up, -step);
    this.forward.applyQuaternion(this.tmpQ);
  }

  /**
   * Grab : tant que le bouton est tenu, la main va vers la zone du board désignée par le stick de grab,
   * puis y reste ; relâché, elle revient. Pendant la rotation d'un flip, le grab attend GRAB.startAfterFlip :
   * le flip a la priorité d'animation, le grab enchaîne.
   */
  private updateGrab(dt: number): void {
    const wants = this.input.held.has('grab');
    const t = this.trick;
    const flipping = (t.flips !== 0 || t.shove !== 0) && t.landedProgress < 0 && t.time / t.duration < GRAB.startAfterFlip;
    if (wants && !flipping) {
      const dir = grabFromDirection(this.input.grab.x, this.input.grab.y, GRAB.directionThreshold);
      const next = dir ?? this.grabId ?? 'indy';
      if (next !== this.grabId) {
        this.grabId = next;
        this.grabHold = 0;
        this.grabCounted = false;
      }
      this.grabAmount = Math.min(1, this.grabAmount + dt / GRAB.reachTime);
    } else {
      this.grabAmount = Math.max(0, this.grabAmount - dt / GRAB.releaseTime);
    }
    if (this.grabAmount >= 1 && this.grabId) {
      this.grabHold += dt;
      if (!this.grabCounted && this.grabHold >= GRAB.minHold) {
        this.grabCounted = true;
        if (this.grabsThisAir[this.grabsThisAir.length - 1] !== this.grabId) this.grabsThisAir.push(this.grabId);
      }
    }
    if (this.grabAmount === 0) this.grabId = null;
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

  /**
   * Réception : l'impact supprime la composante normale de la vitesse, puis la réception est évaluée.
   * - tilt : angle entre l'axe vertical de la planche et la normale de la surface ;
   * - yawError : écart entre l'axe de la planche et la vitesse tangentielle (fakie accepté) ;
   * - impactSpeed : vitesse le long de la normale.
   */
  private tryLand(dt: number): void {
    const approach = Math.max(0, -this.velocity.dot(this.up)) * dt;
    const contact = this.probeGround(GROUND.probeHeight + GROUND.snapDistance + approach, COS_LANDING);
    if (!contact || this.velocity.dot(contact.normal) > 0) return;
    if (contact.normal.dot(WORLD_UP) < COS_LANDING_SURFACE) return;

    const n = contact.normal;
    const v = this.velocity;
    const impact = Math.max(0, -v.dot(n));
    const tilt = Math.acos(THREE.MathUtils.clamp(this.up.dot(n), -1, 1));
    v.addScaledVector(n, -v.dot(n));
    const tangentSpeed = v.length();
    const fT = this.tmpA.copy(this.forward).addScaledVector(n, -this.forward.dot(n));
    let yawError = 0;
    if (tangentSpeed > LANDING.yawCheckMinSpeed && fT.lengthSq() > 1e-8) {
      fT.normalize();
      yawError = Math.acos(THREE.MathUtils.clamp(Math.abs(fT.dot(v)) / tangentSpeed, 0, 1));
    }

    // Rotation du corps : écart au multiple de 180° le plus proche. À l'arrêt, il remplace l'écart
    // à la vitesse, qui n'est pas mesurable.
    const spinTarget = Math.round(this.spinAngle / Math.PI) * Math.PI;
    const spinError = Math.abs(this.spinAngle - spinTarget);
    if (tangentSpeed <= LANDING.yawCheckMinSpeed) yawError = spinError;

    // Une simple descente d'arête sans impact notable n'est pas une réception à évaluer.
    const significant = this.popped || impact >= LANDING.minImpactForRecovery;
    // Board pas encore rattrapé : il reste de la rotation à faire au contact.
    const residual = this.popped ? this.boardResidual() : 0;
    const grabAtContact = this.grabAmount;
    let quality: LandingQuality = 'clean';
    if (significant) {
      if (tilt > BAIL.maxLandingTilt || yawError > BAIL.maxLandingYawError || impact > BAIL.maxImpactSpeed) quality = 'bail';
      else if (tilt > LANDING.cleanMaxTilt || yawError > LANDING.cleanMaxYawError) quality = 'sloppy';
      if (residual > 2 * TRICKS.landFlipTolerance) quality = 'bail';
      else if (residual > TRICKS.landFlipTolerance && quality === 'clean') quality = 'sloppy';
      // Main encore sur le board : on ne peut pas recevoir l'impact.
      if (grabAtContact > GRAB.landBailAmount) quality = 'bail';
      else if (grabAtContact > GRAB.landSloppyAmount && quality === 'clean') quality = 'sloppy';
    }
    this.grabAmount = 0;
    this.grabId = null;
    if (this.trick.landedProgress < 0) this.trick.landedProgress = trickEase(this.trick.time / this.trick.duration);
    const retention =
      quality === 'clean' ? LANDING.cleanSpeedRetention : quality === 'sloppy' ? LANDING.sloppySpeedRetention : LANDING.bailSpeedRetention;
    if (significant) v.multiplyScalar(retention);

    // Les roues remettent la planche dans l'axe de la vitesse, dans le sens le plus proche.
    if (tangentSpeed > LANDING.yawCheckMinSpeed && fT.lengthSq() > 1e-8) {
      const sign = fT.dot(v) >= 0 ? 1 : -1;
      this.forward.copy(v).normalize().multiplyScalar(sign);
    }
    this.applyContact(contact);
    this.grounded = true;

    if (!significant) return;
    const info = this.lastLanding;
    info.quality = quality;
    info.impactSpeed = impact;
    info.tilt = tilt;
    info.yawError = yawError;
    info.airTime = this.airTime;
    info.peakHeight = Math.max(0, this.peakY - this.takeoffY);
    info.popped = this.popped;
    info.trick = this.popped ? this.trick.id : 'ollie';
    info.boardResidual = residual;
    info.spinError = spinError;
    info.spinDegrees = Math.abs(this.spinAngle) >= SPIN.minCountedAngle ? Math.round(Math.abs(spinTarget) / Math.PI) * 180 : 0;
    info.grabs.length = 0;
    for (const g of this.grabsThisAir) info.grabs.push(g);
    info.grabAtContact = grabAtContact;
    info.label = comboName(info.spinDegrees, info.trick, this.trick.side, info.grabs);
    info.position.copy(this.position);
    info.normal.copy(this.up);
    this.landTime = 0;
    this.recovery = quality === 'clean' ? LANDING.cleanRecovery : quality === 'sloppy' ? LANDING.sloppyRecovery : LANDING.bailRecovery;
    this.popped = false;
    this.events.land?.(info);
  }

  /**
   * Trajectoire balistique depuis l'état courant, découpée en segments testés par rayons.
   * Donne le point, la normale et le délai de réception (caméra, alignement de la planche).
   */
  private updatePrediction(): void {
    const p = this.predPos.copy(this.position);
    const v = this.predVel.copy(this.velocity);
    const h = POP.predictionStep;
    const pred = this.prediction;
    for (let t = 0; t < POP.predictionHorizon; t += h) {
      const next = this.predNext.copy(p).addScaledVector(v, h).addScaledVector(GRAVITY, 0.5 * h * h);
      const dir = this.tmpB.subVectors(next, p);
      const len = dir.length();
      if (len > 1e-6) {
        dir.divideScalar(len);
        setVec(this.rayOrigin, p.x, p.y, p.z);
        setVec(this.rayDir, dir.x, dir.y, dir.z);
        const hit = this.physics.castRay(this.rayOrigin, this.rayDir, len, this.collider);
        if (hit) {
          pred.valid = true;
          pred.point.set(hit.point.x, hit.point.y, hit.point.z);
          pred.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
          pred.time = t + (hit.toi / len) * h;
          pred.computedAt = this.airTime;
          return;
        }
      }
      p.copy(next);
      v.addScaledVector(GRAVITY, h);
    }
    pred.valid = false;
  }

  private leaveGround(): void {
    this.grounded = false;
    this.airTime = 0;
    this.takeoffY = this.peakY = this.position.y;
    this.resetAirMoves();
    this.predictionCountdown = 0;
  }

  /** Remet à zéro rotation du corps et grabs comptés pour un nouveau vol. */
  private resetAirMoves(): void {
    this.spinAngle = 0;
    this.spinRate = 0;
    this.spinSnapTarget = Number.NaN;
    this.grabHold = 0;
    this.grabCounted = false;
    this.grabsThisAir.length = 0;
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
    out.crouch = this.grounded && this.tuck ? 1 : 0;
    out.speed = this.forwardSpeed;
    out.airborne = !this.grounded;
    out.charge = this.chargeSource ? this.charge : 0;
    out.popTime = this.popTime;
    out.airTime = this.grounded ? 0 : this.airTime;
    out.landTime = this.landTime;
    out.landImpact = this.landTime >= 0 ? clamp01(this.lastLanding.impactSpeed / BAIL.maxImpactSpeed) : 0;
    out.landQuality = this.landTime >= 0 ? (this.lastLanding.quality === 'clean' ? 0 : this.lastLanding.quality === 'sloppy' ? 1 : 2) : 0;
    this.writeTrickPose(out);
    out.grabIndex = this.grabId ? GRAB_ORDER.indexOf(this.grabId) : -1;
    out.grabAmount = this.grabAmount;
    out.spinRate = this.grounded ? 0 : this.spinRate;
  }

  /**
   * Angles du board pendant le trick. En l'air : rotation adoucie, pieds décollés jusqu'au rattrapage.
   * Après la réception : l'angle figé au contact se recale sur l'orientation alignée la plus proche,
   * vite si le board était rattrapé, après un temps de flottement sinon.
   */
  private writeTrickPose(out: SkaterPose): void {
    const t = this.trick;
    out.trickFlip = 0;
    out.trickShove = 0;
    out.feetLift = 0;
    out.trickProgress = 1;
    if (t.flips === 0 && t.shove === 0) return;
    const full = 2 * Math.PI;
    if (t.landedProgress < 0) {
      const p = t.time / t.duration;
      const e = trickEase(p);
      out.trickFlip = t.flips * full * e;
      out.trickShove = t.shove * full * e;
      out.trickProgress = Math.min(1, p);
      const lift = smoothstep(t.time / 0.05);
      const caught = smoothstep((p - (1 - TRICKS.catchFraction)) / TRICKS.catchFraction);
      out.feetLift = lift * (1 - caught);
      return;
    }
    const e = t.landedProgress;
    const flip = t.flips * full * e;
    const shove = t.shove * full * e;
    const missed = this.lastLanding.boardResidual > TRICKS.landFlipTolerance;
    const l = this.landTime < 0 ? 10 : this.landTime;
    const settle = missed ? smoothstep((l - 0.25) / 0.3) : smoothstep(l / 0.12);
    // Le board est symétrique : un demi-tour de shove le remet dans l'axe.
    out.trickFlip = flip + (Math.round(flip / full) * full - flip) * settle;
    out.trickShove = shove + (Math.round(shove / Math.PI) * Math.PI - shove) * settle;
    out.trickProgress = e;
    out.feetLift = missed ? 1 - settle : 0;
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

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
