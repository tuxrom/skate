import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BAIL, BALANCE, BODY, GRAB, GRIND, GROUND, INPUT, LANDING, MANUAL, MATERIALS, POP, SKATING, SPIN, TRICKS, WORLD, type BalanceMoveId, type SurfaceMaterial } from '@/config/physics';
import type { PhysicsWorld, RayHit } from '@/physics/PhysicsWorld';
import type { PoseSource } from '@/physics/InterpolatedBody';
import type { InputSnapshot } from '@/core/Input';
import type { FlickEvent } from '@/core/FlickRecognizer';
import { GRAB_ORDER, TRICK_DEFS, comboName, grabFromDirection, type GrabId, type TrickId } from './tricks';
import { BALANCE_MOVES, BALANCE_ORDER, chooseGrind, type GrindTypeId, type ManualTypeId } from './grinds';
import type { GrindNetwork, GrindQuery, GrindSegment } from '@/world/GrindNetwork';
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
/** Hauteur et portée du rayon qui distingue un mur d'un obstacle bas (m). */
const BODY_CHECK_HEIGHT = 0.8;
const BODY_CHECK_REACH = 0.6;
/** Sol assez plat pour servir de point de relève de repli (cos de la pente). */
const SAFE_GROUND_COS = 0.97;
/** Portée de recherche d'une ligne sous le board en l'air (m) : couvre toute la hauteur d'un saut. */
const RAIL_BELOW_SEARCH = 2.5;

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
/** Cause d'une chute. */
export type BailCause = 'landing' | 'grind' | 'manual' | 'wall' | 'trip';

/** Instantané au moment de la chute, pour lancer le ragdoll. */
export interface BailInfo {
  cause: BailCause;
  readonly velocity: THREE.Vector3;
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
}

/** Raison de fin d'un grind ou d'un manual. */
export type BalanceEndReason = 'end' | 'pop' | 'slow' | 'bail' | 'blocked' | 'release' | 'air';

export interface SkaterEvents {
  pop?(charge: number, position: THREE.Vector3, trick: ActiveTrick): void;
  /** Début d'un grind ou d'un manual. */
  balanceStart?(move: BalanceMoveId): void;
  /** Fin d'un grind ou d'un manual : durée (s) et distance parcourue (m), pour les combos. */
  balanceEnd?(move: BalanceMoveId, time: number, distance: number, reason: BalanceEndReason): void;
  land?(info: LandingInfo): void;
  /** Chute : le skateur passe en ragdoll. */
  bail?(info: BailInfo): void;
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
  manualAxis: 0,
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

  // Chutes.
  /** Vrai pendant une chute : la simulation du skateur est suspendue, le ragdoll a la main. */
  bailing = false;
  /** Chute demandée pendant le pas (choc contre un mur), traitée à la fin du pas. */
  private pendingBail: BailCause | null = null;
  /** Vitesse juste avant le choc qui a déclenché la chute, et normale du mur. */
  private readonly pendingBailVelocity = new THREE.Vector3();
  private readonly pendingBailNormal = new THREE.Vector3();
  readonly bailInfo: BailInfo = { cause: 'landing', velocity: new THREE.Vector3(), position: new THREE.Vector3(), forward: new THREE.Vector3() };
  /** Dernière position sûre au sol (plat, hors grind), repli pour la relève. */
  readonly lastSafePosition = new THREE.Vector3();
  /** Source de pose de remplacement pendant une chute (la planche lâchée). */
  poseOverride: PoseSource | null = null;

  // Grinds et manuals.
  /** Lignes de grind du niveau, fournies par Game. */
  grinds: GrindNetwork | null = null;
  grinding = false;
  /** Grind en cours : segment, abscisse (m depuis a), vitesse signée le long du segment. */
  readonly grind = {
    segment: null as GrindSegment | null,
    t: 0,
    speed: 0,
    type: 'fiftyFifty' as GrindTypeId,
    time: 0,
    distance: 0,
    /** Charge d'ollie en cours pendant le grind, -1 sinon. */
    charge: -1,
  };
  /** Grind ou manual en cours (type d'équilibre), null sinon. */
  balanceMove: BalanceMoveId | null = null;
  /** Jauge d'équilibre : 0 au centre, ±BALANCE.limit au bord de la zone sûre. */
  balance = 0;
  private balanceTime = 0;
  private balanceSeed = 0;
  private manualDistance = 0;
  private readonly grindOffset = new THREE.Vector3();
  private lastGrindSegment: GrindSegment | null = null;
  private lastGrindExit = -Infinity;
  private grindOnGround = false;
  private readonly prevPosition = new THREE.Vector3();
  private readonly boardA = new THREE.Vector3();
  private readonly boardB = new THREE.Vector3();
  private readonly grindTarget = new THREE.Vector3();
  private readonly grindQuery: GrindQuery = {
    segment: null as unknown as GrindSegment,
    t: 0,
    railPoint: new THREE.Vector3(),
    boardPoint: new THREE.Vector3(),
    distance: 0,
  };

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
    this.grinding = false;
    this.balanceMove = null;
    this.lastGrindSegment = null;
    this.bailing = false;
    this.pendingBail = null;
    this.poseOverride = null;
    this.collider.setEnabled(true);
    this.trick.landedProgress = 1;
    this.trick.flips = this.trick.shove = 0;
    this.prediction.valid = false;
    this.grounded = this.probeGround(GROUND.probeHeight + 2) !== null;
    if (this.grounded) this.applyContact(this.contact);
    this.syncCollider();
    if (this.grounded) this.lastSafePosition.copy(this.position);
    this.fsm.start(this.grounded ? 'idle' : 'air');
  }

  // ---------------------------------------------------------------------------
  // Chutes.

  /**
   * Déclenche une chute : la simulation du skateur se fige, le corps part en ragdoll avec la vitesse
   * actuelle (Game reçoit l'événement), la machine à états passe en `bail`.
   */
  triggerBail(cause: BailCause): void {
    if (this.bailing) return;
    if (this.balanceMove && this.isManual()) this.endManual('bail');
    if (this.grinding) {
      const g = this.grind;
      this.events.balanceEnd?.(g.type, g.time, g.distance, 'bail');
      this.grinding = false;
      this.balanceMove = null;
    }
    this.bailing = true;
    this.grounded = false;
    this.pushAccel = 0;
    this.brake = 0;
    this.grabAmount = 0;
    this.grabId = null;
    this.collider.setEnabled(false);
    const info = this.bailInfo;
    info.cause = cause;
    info.velocity.copy(this.velocity);
    info.position.copy(this.position);
    info.forward.copy(this.forward);
    this.events.bail?.(info);
    if (this.fsm.current !== 'bail') this.fsm.start('bail');
  }

  /** Relève : le skateur reprend debout, à l'arrêt, sur `position`, tourné vers `forward`. */
  recover(position: THREE.Vector3, forward: THREE.Vector3): void {
    this.reset(position, forward);
    this.recovery = BAIL.recoveryTime;
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
    if (this.bailing) {
      this.fsm.update(dt);
      return;
    }
    if (input.pressed.has('ollie')) this.lastOllieTap = this.time;
    if (this.popTime >= 0) this.popTime = this.popTime > 2 ? -1 : this.popTime + dt;
    if (this.landTime >= 0) this.landTime = this.landTime > 2 ? -1 : this.landTime + dt;
    if (this.recovery > 0) this.recovery = Math.max(0, this.recovery - dt);
    this.tuck = input.move.y > INPUT.tuckThreshold;
    this.fsm.update(dt);

    if (this.grinding) this.grindStep(dt);
    else if (this.grounded) this.groundStep(dt);
    else this.airStep(dt);

    const k = 1 - Math.exp(-GROUND.upSmoothing * dt);
    this.visualUp.lerp(this.up, k).normalize();
    this.syncCollider();
    if (this.grounded && !this.grinding && this.up.y > SAFE_GROUND_COS) this.lastSafePosition.copy(this.position);
    if (this.pendingBail) {
      const cause = this.pendingBail;
      this.pendingBail = null;
      this.velocity.copy(this.pendingBailVelocity);
      this.triggerBail(cause);
    }
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
    const rolling = mat.rollingResistance * (this.isManual() ? MANUAL.rollingMultiplier : 1);
    let decel = rolling * normalLoad + drag * s * s + this.brake * SKATING.brakeDecel;
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
    // Au sol, seul un coping (bord de transition) s'accroche, quand on arrive en haut de la rampe.
    if (this.grounded) this.tryStartGrind(true);
  }

  /**
   * En l'air : la vitesse horizontale est conservée exactement, seule la gravité agit.
   * Le corps tourne légèrement (avec inertie) et la planche s'aligne sur la surface de réception prévue.
   */
  private airStep(dt: number): void {
    const v = this.velocity;
    this.prevPosition.copy(this.position);
    this.airTime += dt;
    if (this.trick.landedProgress < 0) this.trick.time += dt;
    v.addScaledVector(GRAVITY, dt);

    if (--this.predictionCountdown <= 0) {
      this.updatePrediction();
      this.predictionCountdown = POP.predictionInterval;
    }
    this.updateGrab(dt);
    this.updateSpin(dt, this.railBelow());

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
    if (this.tryStartGrind(false)) return;
    this.tryLand(dt);
  }

  // ---------------------------------------------------------------------------
  // Grinds.

  /**
   * Cherche une ligne de grind sous l'axe du board (capsule queue-nez) et accroche si tout concorde.
   * Filtres contre les accrochages fantômes : hauteur et distance, arrivée par le dessus, pas par un bout,
   * vitesse le long de la ligne, et rayon de visibilité libre entre le board et la ligne.
   */
  private tryStartGrind(onGround: boolean): boolean {
    if (!this.grinds || this.recovery > 0) return false;
    // Board pas rattrapé après un flip, ou main encore sur le board : pas d'accrochage.
    if (this.trick.landedProgress < 0 && this.boardResidual() > TRICKS.landFlipTolerance) return false;
    if (this.grabAmount > GRAB.landSloppyAmount) return false;
    this.boardA.copy(this.position).addScaledVector(this.forward, -HALF_BOARD);
    this.boardB.copy(this.position).addScaledVector(this.forward, HALF_BOARD);
    this.grindOnGround = onGround;
    const reach = onGround ? GRIND.groundSnapRadius : Math.max(GRIND.snapRadius, GRIND.snapAbove);
    if (!this.grinds.closest(this.boardA, this.boardB, reach, this.grindQuery, this.acceptGrind)) return false;
    this.startGrind(this.grindQuery);
    return true;
  }

  private readonly acceptGrind = (q: GrindQuery): boolean => {
    const seg = q.segment;
    if (seg === this.lastGrindSegment && this.time - this.lastGrindExit < GRIND.reentryDelay) return this.rejectGrind('reentry');
    // Board dans l'axe : il doit recouvrir le segment. Board en travers (slide) : son centre doit être
    // au-dessus du segment. Le point de grind est ensuite recalé dans les marges.
    if (seg.length < 2 * GRIND.endMargin) return this.rejectGrind('end');
    const ta = this.tmpA.subVectors(this.boardA, seg.a).dot(seg.dir);
    const tb = this.tmpA.subVectors(this.boardB, seg.a).dot(seg.dir);
    const alongRail = Math.abs(ta - tb) / (2 * HALF_BOARD) >= Math.cos(GRIND.truckMaxAngle);
    if (alongRail) {
      const overlap = Math.min(seg.length, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb));
      if (overlap < GRIND.minOverlap) return this.rejectGrind('end');
    } else {
      const tc = (ta + tb) / 2;
      if (tc < GRIND.endMargin || tc > seg.length - GRIND.endMargin) return this.rejectGrind('end');
    }
    q.t = THREE.MathUtils.clamp(q.t, GRIND.endMargin, seg.length - GRIND.endMargin);
    q.railPoint.copy(seg.a).addScaledVector(seg.dir, q.t);
    const dy = q.boardPoint.y - q.railPoint.y;
    if (dy > GRIND.snapAbove || dy < -GRIND.snapBelow) return this.rejectGrind('height');
    const dh = Math.hypot(q.boardPoint.x - q.railPoint.x, q.boardPoint.z - q.railPoint.z);
    if (this.grindOnGround) {
      if (seg.kind !== 'coping' || this.up.dot(WORLD_UP) > GRIND.groundMaxUpCos || dh > GRIND.groundSnapRadius) return this.rejectGrind('ground');
    } else {
      if (dh > GRIND.snapRadius) return this.rejectGrind('radius');
      // Le même point du board était au-dessus de la ligne au pas précédent : on arrive par le dessus.
      const prevDy = this.prevPosition.y + (q.boardPoint.y - this.position.y) - q.railPoint.y;
      if (prevDy < GRIND.fromAboveMargin) return this.rejectGrind('below');
    }
    // La vitesse horizontale suit la ligne : on ne la traverse pas.
    const v = this.velocity;
    const dirH = Math.hypot(seg.dir.x, seg.dir.z);
    const vH = Math.hypot(v.x, v.z);
    if (dirH < 1e-3 || vH < 1e-3) return this.rejectGrind('degenerate');
    const along = (v.x * seg.dir.x + v.z * seg.dir.z) / dirH;
    if (Math.abs(along) < GRIND.minEntrySpeed || Math.abs(along) < vH * Math.cos(GRIND.maxApproachAngle)) return this.rejectGrind('approach');
    // Rien entre le board et la ligne (mur, autre module).
    setVec(this.rayOrigin, this.position.x, this.position.y + 0.15, this.position.z);
    const tx = q.railPoint.x - this.rayOrigin.x;
    const ty = q.railPoint.y + 0.03 - this.rayOrigin.y;
    const tz = q.railPoint.z - this.rayOrigin.z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > 1e-3) {
      setVec(this.rayDir, tx / dist, ty / dist, tz / dist);
      const hit = this.physics.castRay(this.rayOrigin, this.rayDir, dist, this.collider);
      if (hit && hit.collider !== seg.collider && hit.toi < dist - 0.02) return this.rejectGrind('los');
    }
    return true;
  };

  /** Dernière raison de refus d'accrochage, pour le debug. */
  grindReject = '';
  private rejectGrind(reason: string): false {
    this.grindReject = reason;
    return false;
  }

  /** Accrochage : choix du grind, orientation du board, écart initial gardé puis résorbé (pas de téléportation). */
  private startGrind(q: GrindQuery): void {
    const seg = q.segment;
    const g = this.grind;
    const s = this.velocity.dot(seg.dir);
    const dirH = this.tmpA.set(seg.dir.x, 0, seg.dir.z).normalize();
    const fH = this.tmpB.set(this.forward.x, 0, this.forward.z);
    if (fH.lengthSq() < 1e-8) fH.copy(dirH);
    fH.normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(Math.abs(fH.dot(dirH)), 0, 1));
    const type = chooseGrind(angle <= GRIND.truckMaxAngle, this.input.move.y);
    g.segment = seg;
    g.t = q.t;
    g.speed = s;
    g.type = type;
    g.time = 0;
    g.distance = 0;
    g.charge = -1;
    this.orientOnSegment(seg, Math.sign(s) || 1);
    this.computeGrindTarget(this.grindTarget);
    this.grindOffset.subVectors(this.position, this.grindTarget);
    this.grinding = true;
    this.grounded = false;
    this.velocity.copy(seg.dir).multiplyScalar(s);
    this.pushAccel = 0;
    this.brake = 0;
    this.grabAmount = 0;
    this.grabId = null;
    this.startBalance(type);
    this.events.balanceStart?.(type);
  }

  /**
   * Oriente le board sur le segment. Trucks : dans l'axe, sens le plus proche du cap actuel, incliné avec
   * la pente. Slides : en travers ; boardslide = côté orteils vers l'avant de la marche, lipslide = côté talons.
   */
  private orientOnSegment(seg: GrindSegment, travel: number): void {
    const def = BALANCE_MOVES[this.grind.type];
    if (def.onTrucks) {
      const sign = this.forward.dot(seg.dir) >= 0 ? 1 : -1;
      this.forward.copy(seg.dir).multiplyScalar(sign);
      this.up.copy(WORLD_UP).addScaledVector(seg.dir, -WORLD_UP.dot(seg.dir)).normalize();
    } else {
      const perp = this.tmpC.crossVectors(seg.dir, WORLD_UP).normalize();
      this.forward.copy(perp);
      this.up.copy(WORLD_UP);
      // Côté orteils = forward × up ; il doit regarder vers la marche pour un boardslide.
      const toe = this.right.crossVectors(this.forward, this.up);
      const facing = toe.x * seg.dir.x * travel + toe.y * seg.dir.y * travel + toe.z * seg.dir.z * travel;
      const wantFacing = this.grind.type === 'boardslide' ? 1 : -1;
      if (facing * wantFacing < 0) this.forward.negate();
    }
  }

  /** Position du board sur la ligne : point de grind, descendu de la hauteur de contact, décalé le long du board. */
  private computeGrindTarget(out: THREE.Vector3): THREE.Vector3 {
    const g = this.grind;
    const seg = g.segment!;
    const def = BALANCE_MOVES[g.type];
    return out
      .copy(seg.a)
      .addScaledVector(seg.dir, g.t)
      .addScaledVector(this.up, -def.drop)
      .addScaledVector(this.forward, def.alongShift);
  }

  /**
   * Pas de grind : la pente accélère, la friction du matériau (pondérée par le type) freine,
   * on suit la ligne et ses segments chaînés, la jauge d'équilibre évolue.
   */
  private grindStep(dt: number): void {
    const g = this.grind;
    let seg = g.segment!;
    const fr = MATERIALS[seg.material].grindFriction * GRIND.typeFriction[g.type];
    let s = g.speed + GRAVITY.dot(seg.dir) * dt;
    const sign = s >= 0 ? 1 : -1;
    s -= sign * Math.min(Math.abs(s), (fr + GRIND.airDrag * s * s) * dt);
    g.speed = s;
    if (Math.abs(s) < GRIND.minSpeed) {
      this.velocity.copy(seg.dir).multiplyScalar(s);
      this.exitGrind('slow');
      return;
    }

    // Obstacle devant (mur, module) : on sort du grind en butant.
    const step = s * dt;
    setVec(this.rayOrigin, this.position.x + this.up.x * 0.15, this.position.y + this.up.y * 0.15, this.position.z + this.up.z * 0.15);
    setVec(this.rayDir, seg.dir.x * sign, seg.dir.y * sign, seg.dir.z * sign);
    const block = this.physics.castRay(this.rayOrigin, this.rayDir, Math.abs(step) + HALF_BOARD, this.collider);
    if (block && block.collider !== seg.collider) {
      this.velocity.copy(seg.dir).multiplyScalar(s * 0.3);
      this.exitGrind('blocked');
      return;
    }

    let t = g.t + step;
    while (t > seg.length) {
      if (!seg.next) {
        this.computeExitPosition(seg, seg.length);
        this.velocity.copy(seg.dir).multiplyScalar(s);
        this.exitGrind('end');
        return;
      }
      t -= seg.length;
      seg = seg.next;
    }
    while (t < 0) {
      if (!seg.prev) {
        this.computeExitPosition(seg, 0);
        this.velocity.copy(seg.dir).multiplyScalar(s);
        this.exitGrind('end');
        return;
      }
      seg = seg.prev;
      t += seg.length;
    }
    if (seg !== g.segment) {
      g.segment = seg;
      this.orientOnSegment(seg, sign);
    }
    g.t = t;
    g.time += dt;
    g.distance += Math.abs(step);

    this.computeGrindTarget(this.grindTarget);
    this.grindOffset.multiplyScalar(Math.exp(-GRIND.snapResponse * dt));
    this.position.copy(this.grindTarget).add(this.grindOffset);
    this.velocity.copy(seg.dir).multiplyScalar(s);
    // L'inclinaison visuelle suit la jauge.
    this.lean = this.balance * SKATING.leanMax;

    if (this.updateBalance(dt, this.input.move.x)) this.exitGrind('bail');
  }

  /** Position de sortie au bout d'un segment : le board quitte la ligne là où il est. */
  private computeExitPosition(seg: GrindSegment, t: number): void {
    const def = BALANCE_MOVES[this.grind.type];
    this.position.copy(seg.a).addScaledVector(seg.dir, t).addScaledVector(this.up, -def.drop).addScaledVector(this.forward, def.alongShift);
  }

  /**
   * Fin de grind : le board repart en l'air avec sa vitesse. Une chute pousse le skateur du côté
   * du déséquilibre et force une réception en chute.
   */
  private exitGrind(reason: BalanceEndReason): void {
    const g = this.grind;
    const seg = g.segment!;
    this.events.balanceEnd?.(g.type, g.time, g.distance, reason);
    this.lastGrindSegment = seg;
    this.lastGrindExit = this.time;
    this.grinding = false;
    this.balanceMove = null;
    g.charge = -1;
    // Le board quitte la ligne à plat : sur un rail en pente, il ne garde pas l'inclinaison du rail
    // (le lissage visuel de l'orientation évite le saut à l'écran).
    this.up.copy(WORLD_UP);
    orthonormalize(this.forward, this.up);
    // Sortie de slide : le board se remet dans l'axe de la marche, nose devant.
    if (!BALANCE_MOVES[g.type].onTrucks) {
      const travel = Math.sign(g.speed) || 1;
      this.forward.copy(seg.dir).multiplyScalar(travel);
      orthonormalize(this.forward, this.up);
    }
    if (reason === 'bail') {
      const side = this.tmpA.crossVectors(seg.dir, WORLD_UP).normalize();
      this.velocity.addScaledVector(side, -Math.sign(this.balance || 1) * GRIND.bailSideSpeed);
      this.leaveGround();
      this.triggerBail('grind');
      return;
    }
    this.leaveGround();
  }

  /**
   * Ollie pendant un grind : charge puis pop, avec le trick du geste s'il y en a un (flip de sortie).
   * Renvoie vrai si le skateur a quitté le rail.
   */
  updateGrindPop(dt: number): boolean {
    const g = this.grind;
    if (g.charge < 0) {
      const source = this.ollieStartRequested();
      if (source === 'buffered') {
        this.startBufferedPop();
        this.popFromGrind();
        return true;
      }
      if (source) {
        this.startCharge(source);
        g.charge = 0;
      }
      return false;
    }
    this.updateCharge(dt);
    const release = this.ollieReleaseRequested();
    if (release === 'pop') {
      this.popFromGrind();
      return true;
    }
    if (release === 'cancel') {
      this.cancelCharge();
      g.charge = -1;
    }
    return false;
  }

  private popFromGrind(): void {
    const charge = this.charge;
    this.exitGrind('pop');
    this.up.copy(WORLD_UP);
    this.performPop(charge);
  }

  // ---------------------------------------------------------------------------
  // Jauge d'équilibre (grinds et manuals).

  private startBalance(move: BalanceMoveId): void {
    this.balanceMove = move;
    this.balanceTime = 0;
    this.balanceSeed = (this.time * 7.31) % (2 * Math.PI);
    // Léger décentrage initial, d'un côté qui varie d'une fois sur l'autre.
    this.balance = BALANCE.startOffset * (Math.sin(this.time * 13.7) >= 0 ? 1 : -1);
  }

  /** Fait évoluer la jauge ; renvoie vrai si elle sort de la zone sûre. */
  private updateBalance(dt: number, axis: number): boolean {
    const move = this.balanceMove;
    if (!move) return false;
    this.balanceTime += dt;
    const drift = BALANCE.drift * BALANCE.difficulty[move] * (1 + BALANCE.driftGrowth * this.balanceTime) * this.balance;
    const w = 2 * Math.PI * BALANCE.perturbFrequency * this.balanceTime + this.balanceSeed;
    const perturb = BALANCE.perturbAmplitude * (Math.sin(w) + 0.5 * Math.sin(2.3 * w + 1.7));
    this.balance += (drift + perturb + axis * BALANCE.correction) * dt;
    return Math.abs(this.balance) > BALANCE.limit;
  }

  // ---------------------------------------------------------------------------
  // Manuals.

  isManual(): boolean {
    return this.balanceMove === 'manual' || this.balanceMove === 'noseManual';
  }

  manualRequested(): boolean {
    return this.input.held.has('manual') && this.speed >= MANUAL.minSpeed;
  }

  /** Entrée en manual : nose manual si l'équilibre est poussé vers l'avant à l'entrée. */
  startManual(): void {
    const type: ManualTypeId = this.input.manualAxis > 0.5 ? 'noseManual' : 'manual';
    this.manualDistance = 0;
    this.recovery = 0;
    this.startBalance(type);
    this.events.balanceStart?.(type);
  }

  /** Pas de manual : renvoie vrai si la jauge sort de la zone sûre. */
  updateManual(dt: number): boolean {
    this.manualDistance += this.speed * dt;
    return this.updateBalance(dt, this.input.manualAxis);
  }

  endManual(reason: BalanceEndReason): void {
    const move = this.balanceMove;
    if (!move) return;
    this.events.balanceEnd?.(move, this.balanceTime, this.manualDistance, reason);
    this.balanceMove = null;
  }

  /** Manual raté : chute. */
  manualBail(): void {
    this.endManual('bail');
    this.triggerBail('manual');
  }

  /**
   * Rotation du corps : le stick gauche fait monter la vitesse de rotation, relâché elle continue
   * sur son élan en ralentissant. Dans les SPIN.snapLead dernières secondes avant la réception prévue,
   * l'angle est aimanté vers le multiple de 180° que la rotation atteindrait sur son élan, s'il en est assez près.
   * L'aimantation est suspendue au-dessus d'une ligne de grind, pour pouvoir arriver en travers (slides).
   */
  /** Vrai si une ligne de grind passe sous le board, à portée : un slide peut se préparer. */
  private railBelow(): boolean {
    if (!this.grinds) return false;
    this.boardA.copy(this.position).addScaledVector(this.forward, -HALF_BOARD);
    this.boardB.copy(this.position).addScaledVector(this.forward, HALF_BOARD);
    return this.grinds.closest(this.boardA, this.boardB, RAIL_BELOW_SEARCH, this.nearQuery, this.acceptBelow);
  }

  private readonly nearQuery: GrindQuery = {
    segment: null as unknown as GrindSegment,
    t: 0,
    railPoint: new THREE.Vector3(),
    boardPoint: new THREE.Vector3(),
    distance: 0,
  };
  /** Ligne sous le board : le board est au-dessus, à moins de spinMagnetSuspendRadius à l'horizontale. */
  private readonly acceptBelow = (q: GrindQuery): boolean =>
    q.boardPoint.y - q.railPoint.y > -GRIND.snapBelow &&
    Math.hypot(q.boardPoint.x - q.railPoint.x, q.boardPoint.z - q.railPoint.z) <= GRIND.spinMagnetSuspendRadius;

  private updateSpin(dt: number, suspendMagnet: boolean): void {
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
    if (remaining < SPIN.snapLead && !suspendMagnet) {
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
        this.wallResponse(hn, 'trip');
        const penetration = HALF_BOARD + BODY.collisionSkin - hit.toi;
        if (penetration > 0) this.position.addScaledVector(hn, penetration * Math.abs(dir.dot(hn)));
      }
    }
  }

  /**
   * Supprime la composante de vitesse entrant dans le mur, avec un léger rebond et du frottement.
   * Un choc trop violent fait tomber : contre un mur (corps), ou en trébuchant (planche contre un obstacle bas).
   */
  private wallResponse(wallNormal: THREE.Vector3, kind: 'wall' | 'trip' = 'wall'): void {
    const v = this.velocity;
    const vn = v.dot(wallNormal);
    if (vn >= 0) return;
    const threshold = kind === 'trip' ? BAIL.tripImpactSpeed : BAIL.wallImpactSpeed;
    if (-vn > threshold && !this.pendingBail) {
      // Obstacle bas (seule la planche bute) ou mur (le corps bute aussi, rayon à hauteur du torse).
      const tall = kind === 'wall' || this.obstacleAtBodyHeight(wallNormal);
      this.pendingBail = tall ? 'wall' : 'trip';
      // Trébucher : le corps garde son élan et passe par-dessus. Mur : il garde peu de sa vitesse entrante.
      this.pendingBailVelocity.copy(v);
      if (tall) this.pendingBailVelocity.addScaledVector(wallNormal, -vn * (1 - BAIL.wallImpactKeep));
      this.pendingBailNormal.copy(wallNormal);
    }
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

  /** Vrai si l'obstacle touché par la planche continue à hauteur du torse (mur et non curb). */
  private obstacleAtBodyHeight(wallNormal: THREE.Vector3): boolean {
    setVec(this.rayOrigin, this.position.x, this.position.y + BODY_CHECK_HEIGHT, this.position.z);
    setVec(this.rayDir, -wallNormal.x, -wallNormal.y, -wallNormal.z);
    return this.physics.castRay(this.rayOrigin, this.rayDir, HALF_BOARD + BODY_CHECK_REACH, this.collider) !== null;
  }

  /** Déplace la capsule du corps avec le contrôleur cinématique et applique les chocs contre les murs. */
  private moveBody(dt: number): void {
    const v = this.velocity;
    setVec(this.desired, v.x * dt, v.y * dt, v.z * dt);
    const classifyUp = this.grounded ? this.up : WORLD_UP;
    this.controller.setUp(classifyUp);
    // Les rails ne bloquent pas le corps : posé sur un tube, il resterait suspendu en l'air.
    // Les montants arrêtent quand même la planche (rayons au ras du board).
    this.controller.computeColliderMovement(this.collider, this.desired, undefined, undefined, this.physics.notGrindOnly);
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
    if (quality === 'bail') this.triggerBail('landing');
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
        const hit = this.physics.castRay(this.rayOrigin, this.rayDir, len, this.collider, true);
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
    const hit = this.physics.castRay(this.rayOrigin, this.rayDir, maxToi, this.collider, true);
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
    if (this.poseOverride) {
      this.poseOverride.readPose(position, rotation);
      return;
    }
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
    out.balanceIndex = this.balanceMove ? BALANCE_ORDER.indexOf(this.balanceMove) : -1;
    if (this.bailing) {
      // Pendant la chute, la planche est libre et le corps suit le ragdoll : pose neutre.
      out.lean = out.brake = out.crouch = out.charge = out.feetLift = out.trickFlip = out.trickShove = out.grabAmount = out.spinRate = 0;
      out.pushPhase = out.popTime = out.landTime = -1;
      out.grabIndex = out.balanceIndex = -1;
      out.airborne = true;
      out.speed = 0;
    }
    out.balance = this.balance;
    if (this.grinding) out.airborne = false;
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
