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
  /** Décélération de roulement (m/s² opposée à la vitesse). */
  rollingResistance: number;
  /** Multiplicateur appliqué à la vitesse max sur cette surface. */
  speedMultiplier: number;
  /** Friction de glisse en grind ou slide (m/s² de freinage). */
  grindFriction: number;
}

export const MATERIALS: Readonly<Record<SurfaceMaterial, MaterialFeel>> = {
  concrete: { friction: 0.9, restitution: 0.0, rollingResistance: 0.35, speedMultiplier: 1.0, grindFriction: 1.2 },
  asphalt: { friction: 1.0, restitution: 0.0, rollingResistance: 0.6, speedMultiplier: 0.9, grindFriction: 1.6 },
  wood: { friction: 0.8, restitution: 0.05, rollingResistance: 0.25, speedMultiplier: 1.05, grindFriction: 1.0 },
  metal: { friction: 0.5, restitution: 0.02, rollingResistance: 0.2, speedMultiplier: 1.05, grindFriction: 0.5 },
  grass: { friction: 1.2, restitution: 0.0, rollingResistance: 6.0, speedMultiplier: 0.3, grindFriction: 4.0 },
};

/** Gabarit physique du skateur et de la planche. */
export const BODY = {
  /** Masse totale skateur + planche (kg). */
  mass: 75,
  /** Rayon de la capsule du corps (m). */
  capsuleRadius: 0.25,
  /** Demi-hauteur du segment cylindrique de la capsule (m). */
  capsuleHalfHeight: 0.6,
  /** Longueur de la planche (m). */
  boardLength: 0.8,
  /** Largeur de la planche (m). */
  boardWidth: 0.21,
  /** Distance du raycast de détection du sol sous les roues (m). */
  groundProbeDistance: 0.15,
  /** Pente maximale considérée comme roulable (rad). */
  maxRollableSlope: 1.2,
} as const;

/** Poussée, vitesse et freinage. */
export const SKATING = {
  /** Impulsion de vitesse ajoutée par poussée (m/s). */
  pushImpulse: 2.2,
  /** Durée d'une poussée, pendant laquelle une nouvelle poussée est ignorée (s). */
  pushDuration: 0.55,
  /** Vitesse au-delà de laquelle la poussée n'ajoute plus rien (m/s). */
  pushSpeedCap: 9.0,
  /** Vitesse maximale absolue au sol (m/s). */
  maxSpeed: 16.0,
  /** Décélération du frein au pied (m/s²). */
  brakeDecel: 6.0,
  /** Décélération du powerslide (m/s²). */
  powerslideDecel: 9.0,
  /** Vitesse angulaire de virage à basse vitesse (rad/s). */
  turnRateLow: 2.6,
  /** Vitesse angulaire de virage à vitesse max (rad/s). */
  turnRateHigh: 1.1,
  /** Accélération latérale max avant dérapage (m/s²). */
  maxLateralGrip: 14.0,
  /** Vitesse sous laquelle le skateur est considéré à l'arrêt (m/s). */
  stopSpeed: 0.15,
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
