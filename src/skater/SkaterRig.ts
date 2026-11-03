import type * as THREE from 'three';

/** Pose d'animation de haut niveau, indépendante de la façon dont le skateur est dessiné. */
export interface SkaterPose {
  /** Inclinaison de la planche (rad), positive vers la droite. */
  lean: number;
  /** Phase de poussée : [0, 1[ contact, [1, 2[ retour du pied, -1 sinon. */
  pushPhase: number;
  /** Force de freinage (0 à 1). */
  brake: number;
  /** Flexion des jambes (0 à 1). */
  crouch: number;
  /** Vitesse signée le long du cap (m/s), pour la rotation des roues. */
  speed: number;
  airborne: boolean;
  /** Charge d'ollie en cours (0 à 1), 0 hors charge. */
  charge: number;
  /** Temps depuis le début du pop (s), -1 sinon. Le décollage a lieu à POP.popDelay. */
  popTime: number;
  /** Temps passé en l'air (s), 0 au sol. */
  airTime: number;
  /** Temps depuis la dernière réception évaluée (s), -1 sinon. */
  landTime: number;
  /** Violence de cette réception (0 à 1). */
  landImpact: number;
  /** Qualité de cette réception : 0 propre, 1 sale, 2 hors limites. */
  landQuality: number;
  /** Rotation du board autour de son axe long (rad), positive dans le sens du kickflip. */
  trickFlip: number;
  /** Rotation du board autour de son axe vertical (rad), positive en backside. */
  trickShove: number;
  /** Pieds décollés du board pendant la rotation (0 sur le board, 1 au plus loin). */
  feetLift: number;
  /** Progression de la rotation (0 à 1), 1 hors trick. */
  trickProgress: number;
  /** Grab en cours : indice dans GRAB_ORDER, -1 sans grab. */
  grabIndex: number;
  /** Prise de la main sur le board (0 à 1). */
  grabAmount: number;
  /** Vitesse de rotation du corps en l'air (rad/s), positive vers la droite. */
  spinRate: number;
  /** Grind ou manual en cours : indice dans BALANCE_ORDER, -1 sinon. */
  balanceIndex: number;
  /** Jauge d'équilibre (0 au centre, ±1 au bord de la zone sûre). */
  balance: number;
}

export function createPose(): SkaterPose {
  return {
    lean: 0,
    pushPhase: -1,
    brake: 0,
    crouch: 0,
    speed: 0,
    airborne: false,
    charge: 0,
    popTime: -1,
    airTime: 0,
    landTime: -1,
    landImpact: 0,
    landQuality: 0,
    trickFlip: 0,
    trickShove: 0,
    feetLift: 0,
    trickProgress: 1,
    grabIndex: -1,
    grabAmount: 0,
    spinRate: 0,
    balanceIndex: -1,
    balance: 0,
  };
}

export function copyPose(out: SkaterPose, src: SkaterPose): void {
  out.lean = src.lean;
  out.pushPhase = src.pushPhase;
  out.brake = src.brake;
  out.crouch = src.crouch;
  out.speed = src.speed;
  out.airborne = src.airborne;
  out.charge = src.charge;
  out.popTime = src.popTime;
  out.airTime = src.airTime;
  out.landTime = src.landTime;
  out.landImpact = src.landImpact;
  out.landQuality = src.landQuality;
  out.trickFlip = src.trickFlip;
  out.trickShove = src.trickShove;
  out.feetLift = src.feetLift;
  out.trickProgress = src.trickProgress;
  out.grabIndex = src.grabIndex;
  out.grabAmount = src.grabAmount;
  out.spinRate = src.spinRate;
  out.balanceIndex = src.balanceIndex;
  out.balance = src.balance;
}

/**
 * Représentation visuelle animable du skateur.
 * Repère local : X à droite, Y en haut, -Z vers l'avant ; origine au contact du sol, entre les trucks.
 * Une version glTF implémentera la même interface avec un AnimationMixer.
 */
export interface SkaterRig {
  readonly root: THREE.Object3D;
  /** Appelé à chaque frame rendue avec la pose interpolée. */
  update(pose: SkaterPose, dt: number): void;
  dispose(): void;
}
