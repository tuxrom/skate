/**
 * Réglages de ressenti du gameplay.
 *
 * Tout nombre magique qui influence la sensation de jeu vit ici, et nulle part
 * ailleurs. Unités SI sauf mention contraire : mètres, secondes, kilogrammes,
 * radians. Les vitesses sont en m/s, les durées d'input en millisecondes.
 *
 * Les valeurs actuelles sont des points de départ à affiner étape par étape.
 */

/** Pas de simulation et garde-fous de la boucle fixe. */
export const SIMULATION = {
  /** Fréquence de la physique (Hz). */
  stepHz: 120,
  /** Nombre maximum de pas rattrapés par frame avant d'abandonner le retard. */
  maxStepsPerFrame: 8,
  /** Delta de frame maximal pris en compte (s), évite la spirale de la mort après un onglet en pause. */
  maxFrameDelta: 0.25,
} as const;

/** Durée d'un pas fixe (s), dérivée de stepHz. */
export const FIXED_DT = 1 / SIMULATION.stepHz;

/** Monde. */
export const WORLD = {
  /** Gravité verticale (m/s²). Un peu plus forte que le réel pour un air plus nerveux. */
  gravity: -11.5,
  /** Hauteur sous laquelle le skateur est considéré tombé hors du niveau (m). */
  killPlaneY: -30,
} as const;

/** Identifiants de matériaux de surface. */
export type SurfaceMaterial = 'concrete' | 'asphalt' | 'wood' | 'metal' | 'grass';

/** Comportement de roulage et de glisse par matériau. */
export interface MaterialFeel {
  /** Friction de Coulomb transmise à Rapier. */
  friction: number;
  /** Restitution transmise à Rapier. */
  restitution: number;
  /**
   * Coefficient de résistance au roulement (sans unité).
   * Décélération = coefficient × composante normale de la gravité.
   * Ordre de grandeur réel pour des roues de skate : 0,01 à 0,03 sur surface dure.
   */
  rollingResistance: number;
  /** Multiplicateur appliqué à la vitesse max sur cette surface. */
  speedMultiplier: number;
  /** Friction de glisse en grind ou slide (m/s² de freinage). */
  grindFriction: number;
}

export const MATERIALS: Readonly<Record<SurfaceMaterial, MaterialFeel>> = {
  concrete: { friction: 0.9, restitution: 0.0, rollingResistance: 0.018, speedMultiplier: 1.0, grindFriction: 1.2 },
  asphalt: { friction: 1.0, restitution: 0.0, rollingResistance: 0.03, speedMultiplier: 0.9, grindFriction: 1.6 },
  wood: { friction: 0.8, restitution: 0.05, rollingResistance: 0.012, speedMultiplier: 1.05, grindFriction: 1.0 },
  metal: { friction: 0.5, restitution: 0.02, rollingResistance: 0.01, speedMultiplier: 1.05, grindFriction: 0.5 },
  grass: { friction: 1.2, restitution: 0.0, rollingResistance: 0.45, speedMultiplier: 0.3, grindFriction: 4.0 },
};

/** Gabarit physique du skateur et de la planche. */
export const BODY = {
  /** Longueur de la planche (m). */
  boardLength: 0.8,
  /** Largeur de la planche (m). */
  boardWidth: 0.21,
  /** Entraxe des trucks, distance entre les deux sondes de sol (m). */
  wheelbase: 0.38,
  /** Rayon de la capsule du corps, utilisée contre les obstacles hauts (m). */
  capsuleRadius: 0.24,
  /** Demi-hauteur du segment cylindrique de la capsule (m). */
  capsuleHalfHeight: 0.5,
  /**
   * Espace entre le point de contact des roues et le bas de la capsule (m).
   * Les obstacles plus bas sont gérés par les rayons de la planche.
   */
  capsuleClearance: 0.3,
  /** Marge de contact du contrôleur cinématique Rapier (m). */
  collisionSkin: 0.015,
} as const;

/** Suivi du sol, transitions et collisions de la planche. */
export const GROUND = {
  /** Hauteur de départ des sondes de sol au-dessus du contact (m). */
  probeHeight: 0.35,
  /** Distance sous le contact où le sol est encore « rattrapé » (m). Absorbe les joints, pas plus. */
  snapDistance: 0.05,
  /**
   * Vitesse d'éloignement du nouveau plan tolérée sur une arête convexe (m/s).
   * Au-delà, la planche décolle au lieu d'être collée à la pente.
   */
  convexLaunchSpeed: 0.45,
  /** Écart d'angle max entre deux normales de sol successives pour une transition roulable (rad). */
  maxTransitionAngle: 0.9,
  /** Perte de vitesse sur une transition, proportionnelle à (1 - cos Δangle). */
  transitionSpeedLoss: 0.5,
  /** Angle à partir duquel une surface touchée est un mur et non une pente (rad, relatif à la normale du sol). */
  wallAngle: 1.0,
  /** Hauteur des rayons d'obstacle de la planche au-dessus du contact (m). Plus bas, l'obstacle est enjambé. */
  wallRayHeight: 0.035,
  /** Part de la vitesse tangentielle conservée en frottant un mur. */
  wallSpeedRetention: 0.92,
  /** Rebond sur un mur (part de la vitesse normale renvoyée). */
  wallBounce: 0.15,
  /**
   * Angle d'incidence max pour lequel un mur redresse la planche le long de sa surface (rad).
   * Au-delà, le choc est frontal et la planche garde son cap.
   */
  wallDeflectAngle: 0.6,
  /** Lissage de l'orientation visuelle vers la normale du sol (1/s). */
  upSmoothing: 22,
  /** Retour de la planche vers la verticale en l'air (1/s). */
  airUprightRate: 1.5,
  /** Angle max entre la planche et la surface pour se réceptionner (rad). */
  maxLandingAngle: 1.0,
} as const;

/** Poussée, vitesse, virage et freinage. */
export const SKATING = {
  /** Vitesse gagnée par une poussée complète à l'arrêt (m/s). */
  pushImpulse: 1.9,
  /** Durée du contact du pied avec le sol pendant une poussée (s). L'accélération y suit une courbe en cloche. */
  pushDuration: 0.42,
  /** Temps de retour du pied sur la planche avant la poussée suivante (s). */
  pushRecovery: 0.28,
  /** Vitesse au-delà de laquelle une poussée n'apporte plus rien (m/s). Son efficacité décroît linéairement jusque-là. */
  pushSpeedCap: 7.5,
  /** Multiplicateur d'impulsion avec Shift (accélérer). */
  boostImpulseMultiplier: 1.35,
  /** Multiplicateur de cadence avec Shift (durées divisées par ce facteur). */
  boostCadenceMultiplier: 1.3,
  /** Plafond de poussée avec Shift (m/s). */
  boostSpeedCap: 9.5,
  /** Vitesse maximale au sol (m/s), atteignable en descente. */
  maxSpeed: 15,
  /** Décélération supplémentaire au-delà de maxSpeed (m/s²). */
  overSpeedDecel: 5,
  /** Coefficient de traînée aérodynamique (1/m). Décélération = coeff × v². */
  airDrag: 0.0045,
  /** Multiplicateur de traînée en position groupée (avant). */
  tuckDragMultiplier: 0.55,
  /** Décélération du frein au pied à pleine force (m/s²). */
  brakeDecel: 5.5,
  /** Temps pour atteindre la pleine force de freinage (s). */
  brakeRampTime: 0.18,
  /** Vitesse sous laquelle la planche s'immobilise si la pente ne l'entraîne pas (m/s). */
  stopSpeed: 0.12,
  /** Inclinaison max de la planche (rad). */
  leanMax: 0.3,
  /** Vitesse de réponse de l'inclinaison (1/s). */
  leanResponse: 9,
  /** Rayon de braquage à pleine inclinaison, à basse vitesse (m). */
  minTurnRadius: 1.4,
  /** Rayon de braquage à pleine inclinaison, à maxSpeed (m). */
  highSpeedTurnRadius: 6,
  /** Rotation sur place à l'arrêt, pleine inclinaison (rad/s). */
  stationaryTurnRate: 1.6,
  /** Vitesse sous laquelle la rotation sur place prend le relais du carve (m/s). */
  stationaryTurnBlendSpeed: 1.2,
  /** Accélération latérale max avant dérapage (m/s²). */
  maxLateralGrip: 14,
  /** Rotation de cap en l'air à pleine inclinaison (rad/s). */
  airTurnRate: 1.2,
} as const;

/** Ollie, nollie et contrôle aérien. */
export const POP = {
  /** Vitesse verticale donnée par un ollie à charge complète (m/s). */
  ollieVelocity: 5.2,
  /** Fraction de ollieVelocity obtenue avec une charge minimale. */
  minChargeRatio: 0.55,
  /** Durée de charge pour atteindre la puissance maximale (s). */
  chargeTime: 0.35,
  /** Facteur appliqué au pop pour un nollie. */
  nollieMultiplier: 0.92,
  /** Part de la vitesse horizontale conservée au décollage. */
  takeoffSpeedRetention: 0.98,
  /** Vitesse angulaire de rotation en l'air, axe vertical (rad/s). */
  airSpinRate: 6.5,
  /** Contrôle de direction en l'air (m/s² latéraux). */
  airSteer: 1.5,
  /** Durée minimale de vol pour qu'un trick soit validé (s). */
  minAirTime: 0.18,
} as const;

/** Flips et grabs. */
export const TRICKS = {
  /** Vitesse de rotation d'un kickflip / heelflip (tours/s). */
  flipRate: 2.6,
  /** Vitesse de rotation d'un shove-it (tours/s). */
  shoveRate: 1.8,
  /** Temps pour qu'un grab soit tenu et compté (s). */
  grabMinHold: 0.15,
  /** Ralentissement de la rotation pendant un grab (multiplicateur). */
  grabSpinDamping: 0.6,
  /** Tolérance d'angle de rotation de planche résiduelle à la réception (rad). */
  landFlipTolerance: 0.45,
} as const;

/** Grinds et manuals. */
export const BALANCE = {
  /** Distance max de capture d'un rail ou d'un rebord (m). */
  grindSnapDistance: 0.35,
  /** Angle max entre la planche et le rail pour accrocher (rad). */
  grindSnapAngle: 0.9,
  /** Vitesse minimale pour tenir un grind (m/s). */
  grindMinSpeed: 1.5,
  /** Vitesse de dérive naturelle de l'équilibre (unités normalisées/s). */
  balanceDrift: 0.6,
  /** Effet d'une correction du joueur sur l'équilibre (unités normalisées/s). */
  balanceCorrection: 1.8,
  /** Seuil d'équilibre normalisé au-delà duquel on tombe (|x| > seuil). */
  balanceLimit: 1.0,
  /** Accélération de la dérive avec la durée tenue (multiplicateur par seconde). */
  balanceDriftGrowth: 0.15,
} as const;

/** Seuils de chute. */
export const BAIL = {
  /** Angle max entre la planche et la normale du sol à la réception (rad). */
  maxLandingTilt: 0.6,
  /** Écart max de cap entre la planche et la vitesse à la réception (rad). */
  maxLandingYawError: 0.7,
  /** Vitesse verticale d'impact au-delà de laquelle on chute (m/s, valeur positive). */
  maxImpactSpeed: 11.0,
  /** Vitesse horizontale contre un mur qui provoque la chute (m/s). */
  wallImpactSpeed: 5.0,
  /** Durée de la chute avant de pouvoir reprendre la main (s). */
  ragdollDuration: 1.8,
  /** Délai avant la réapparition automatique (s). */
  respawnDelay: 2.5,
} as const;

/** Fenêtres et délais d'input. */
export const INPUT = {
  /** Mémorisation d'un pop pressé juste avant de toucher le sol (ms). */
  popBufferMs: 120,
  /** Pop toléré juste après avoir quitté une arête (coyote time, ms). */
  coyoteMs: 90,
  /** Fenêtre pour enchaîner un flick après le pop (ms). */
  flickWindowMs: 180,
  /** Amplitude minimale du stick pour qu'un flick soit reconnu (0 à 1). */
  flickThreshold: 0.6,
  /** Zone morte des sticks (0 à 1). */
  stickDeadzone: 0.15,
  /** Fenêtre de réception pour enchaîner un manual (ms). */
  manualWindowMs: 150,
  /** Délai entre deux appuis pour un double tap de poussée (ms). */
  doubleTapMs: 250,
  /** Seuil du stick vers l'arrière pour freiner (0 à 1). */
  brakeThreshold: 0.5,
  /** Seuil du stick vers l'avant pour se grouper (0 à 1). */
  tuckThreshold: 0.5,
  /** Mémorisation d'une poussée demandée pendant la récupération du pied (ms). */
  pushBufferMs: 200,
  /** Vitesse de lissage du stick virtuel tactile (1/s). */
  touchStickSmoothing: 18,
} as const;

/** Score et combos. */
export const SCORING = {
  /** Délai sans trick après lequel un combo est validé (s). */
  comboTimeout: 1.2,
  /** Multiplicateur ajouté par trick dans un combo. */
  comboMultiplierStep: 1,
  /** Points par seconde de grind. */
  grindPointsPerSecond: 120,
  /** Points par seconde de manual. */
  manualPointsPerSecond: 80,
} as const;
