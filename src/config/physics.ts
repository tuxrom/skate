/**
 * Réglages de ressenti du gameplay.
 *
 * Tout nombre magique qui influence la sensation de jeu vit ici, et nulle part
 * ailleurs. Unités SI sauf mention contraire : mètres, secondes, kilogrammes,
 * radians. Les vitesses sont en m/s, les durées d'input en millisecondes.
 *
 * Les valeurs actuelles sont des points de départ à affiner étape par étape.
 */

import type { FlickTrickId } from '@/core/FlickRecognizer';

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
  /** Angle max entre la planche et la surface pour se réceptionner (rad). */
  maxLandingAngle: 1.0,
  /**
   * Angle max entre une surface de réception et la verticale du monde (rad).
   * Assez pour revenir dans une transition de quarter pipe, jamais sur un mur.
   */
  maxLandingSurfaceAngle: 1.3,
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
  /** Multiplicateur d'impulsion des poussées enchaînées en maintenant la touche (accélérer). */
  boostImpulseMultiplier: 1.35,
  /** Multiplicateur de cadence des poussées enchaînées (durées divisées par ce facteur). */
  boostCadenceMultiplier: 1.3,
  /** Plafond des poussées enchaînées (m/s). */
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
} as const;

/** Ollie et contrôle aérien. */
export const POP = {
  /** Hauteur de vol du contact au-dessus du point de pop, charge minimale (m). */
  minHeight: 0.22,
  /** Hauteur de vol à pleine charge (m). La vitesse de pop vaut √(2·g·h). */
  maxHeight: 0.85,
  /** Durée de charge pour atteindre la pleine hauteur (s). La hauteur est linéaire en charge. */
  chargeTime: 0.4,
  /** Délai entre le relâchement et le décollage, le temps du claquement du tail (s). */
  popDelay: 0.07,
  /** Facteur appliqué au pop pour un nollie (étape 3). */
  nollieMultiplier: 0.92,
  /** Part de la vitesse tangentielle conservée au décollage. */
  takeoffSpeedRetention: 1.0,
  /** Alignement automatique de la planche sur la surface de réception prévue (1/s). */
  airAlignRate: 3,
  /** Durée minimale de vol pour qu'un trick soit validé (s). */
  minAirTime: 0.18,
  /** Horizon de prédiction de la trajectoire (s). */
  predictionHorizon: 2.5,
  /** Pas de la prédiction de trajectoire (s). */
  predictionStep: 0.04,
  /** La prédiction est recalculée tous les N pas fixes. */
  predictionInterval: 3,
} as const;

/** Évaluation de la réception. Au-delà des seuils BAIL, la réception est une chute (étape 6). */
export const LANDING = {
  /** Angle planche / surface max pour une réception propre (rad). */
  cleanMaxTilt: 0.2,
  /** Écart max entre l'axe de la planche et la vitesse pour une réception propre (rad). */
  cleanMaxYawError: 0.22,
  /**
   * Vitesse d'impact minimale pour évaluer une réception sans pop (m/s).
   * En dessous (petite arête, joint), on reste en roue libre sans effet ni récupération.
   */
  minImpactForRecovery: 0.9,
  /** Vitesse sous laquelle l'écart de cap n'est pas évalué (m/s). */
  yawCheckMinSpeed: 1.0,
  /** Part de la vitesse tangentielle conservée, réception propre. */
  cleanSpeedRetention: 0.98,
  /** Part de la vitesse tangentielle conservée, réception sale. */
  sloppySpeedRetention: 0.78,
  /** Part de la vitesse conservée sur une réception hors limites, en attendant les bails. */
  bailSpeedRetention: 0.5,
  /** Temps de récupération après une réception propre, sans pop ni poussée (s). */
  cleanRecovery: 0.08,
  /** Temps de récupération après une réception sale (s). */
  sloppyRecovery: 0.35,
  /** Temps de récupération après une réception hors limites (s). */
  bailRecovery: 0.7,
} as const;

/** Flips et grabs. */
export const TRICKS = {
  /**
   * Part du temps de vol prévu consacrée à la rotation du board. Un saut plus haut donne
   * donc une rotation plus lente et plus lisible.
   */
  rotationAirFraction: 0.8,
  /** Durée de rotation minimale (s), pour qu'un flip sur un petit pop reste rattrapable. */
  minRotationTime: 0.26,
  /** Durée de rotation maximale (s). */
  maxRotationTime: 0.6,
  /** Dernière fraction de la rotation pendant laquelle les pieds reviennent sur le board (0 à 1). */
  catchFraction: 0.3,
  /**
   * Rotation de board restant à faire à la réception tolérée sans pénalité (rad).
   * Jusqu'au double, la réception est sale ; au-delà, le board n'est pas sous les pieds.
   */
  landFlipTolerance: 0.45,
} as const;

/** Grabs. */
export const GRAB = {
  /** Temps pour que la main atteigne le board (s). */
  reachTime: 0.12,
  /** Temps pour que la main lâche le board et que le corps se redéplie (s). */
  releaseTime: 0.1,
  /** Durée de maintien, main sur le board, pour que le grab compte (s). */
  minHold: 0.1,
  /**
   * Progression de la rotation d'un flip à partir de laquelle la main part vers le board (0 à 1).
   * Avec la rotation adoucie, le board est presque à plat quand la main arrive : le flip reste
   * visuellement en premier, le grab enchaîne.
   */
  startAfterFlip: 0.55,
  /** Amplitude du stick de grab au-delà de laquelle sa direction choisit le grab (0 à 1). */
  directionThreshold: 0.45,
  /** Multiplicateur de la vitesse de rotation max pendant un grab (corps ramassé). */
  spinRateMultiplier: 0.6,
  /** Prise encore présente à la réception au-delà de laquelle la réception est sale (0 à 1). */
  landSloppyAmount: 0.05,
  /** Prise encore présente à la réception au-delà de laquelle c'est une chute (0 à 1). */
  landBailAmount: 0.35,
} as const;

/** Rotations du corps en l'air (180, 360, 540...). */
export const SPIN = {
  /** Vitesse de rotation max, stick gauche en butée (rad/s). Un 360 tient dans un ollie haut, un 540 dans un saut d'escalier. */
  maxRate: 14,
  /** Montée en vitesse quand le stick est tenu (1/s). */
  response: 8,
  /** Perte de vitesse de rotation stick relâché (1/s) : la rotation continue sur son élan. */
  coastDamping: 3,
  /** Zone morte du stick gauche pour la rotation (0 à 1). */
  inputDeadzone: 0.2,
  /** Fenêtre avant la réception prévue pendant laquelle l'angle est aimanté vers un multiple de 180° (s). */
  snapLead: 0.35,
  /** Écart max entre l'angle projeté sur l'élan et le multiple de 180° visé pour que l'aimantation agisse (rad). */
  snapMaxError: (75 * Math.PI) / 180,
  /** Réponse de l'aimantation (1/s). */
  snapResponse: 30,
  /**
   * Avance du contact réel sur le point de réception prévu (s) : les sondes touchent le sol
   * un peu avant. L'aimantation vise ce contact anticipé pour ne pas finir court.
   */
  snapContactLead: 0.05,
  /** Rotation minimale pour être comptée et nommée (rad, 150°). */
  minCountedAngle: (150 * Math.PI) / 180,
  /**
   * À l'accrochage d'un grind, la rotation est comptée par demi-tours entiers (arrondi inférieur)
   * avec cette tolérance (rad) : le quart de tour d'un boardslide ne compte pas comme un 180.
   */
  grindEntryTolerance: (25 * Math.PI) / 180,
} as const;

/** Types de grind et de manual. Leurs réglages par type sont indexés par ces identifiants. */
export type BalanceMoveId = 'fiftyFifty' | 'fiveO' | 'nosegrind' | 'boardslide' | 'lipslide' | 'manual' | 'noseManual';

/** Grinds sur rails, ledges et bords. */
export const GRIND = {
  /** Distance max entre l'axe du board et la ligne de grind pour accrocher, en l'air (m). */
  snapRadius: 0.22,
  /** Hauteur max du board au-dessus de la ligne pour accrocher (m). */
  snapAbove: 0.12,
  /** Le board peut être jusqu'à cette distance sous la ligne et accrocher quand même (m). */
  snapBelow: 0.08,
  /**
   * Au pas précédent, le board devait être au moins à cette hauteur relative à la ligne (m, négatif = dessous).
   * Empêche d'accrocher un rail par en dessous.
   */
  fromAboveMargin: -0.03,
  /** Distance d'accrochage au sol, seulement sur un bord de transition (coping) (m). */
  groundSnapRadius: 0.12,
  /** Inclinaison minimale du board au sol pour accrocher un coping (cos de l'angle avec la verticale). */
  groundMaxUpCos: 0.7,
  /** Vitesse le long de la ligne minimale pour accrocher (m/s). */
  minEntrySpeed: 1.2,
  /** Sous cette vitesse, le grind s'arrête et le board tombe du rail (m/s). */
  minSpeed: 0.5,
  /** La vitesse horizontale doit suivre la ligne à moins de cet angle (rad). Au-delà, on la traverse. */
  maxApproachAngle: (60 * Math.PI) / 180,
  /** Board à moins de cet angle de la ligne : grind sur les trucks ; au-delà : slide (rad). */
  truckMaxAngle: (45 * Math.PI) / 180,
  /** Marge aux extrémités d'un segment pour le point de grind (m) : on n'accroche pas un rail par son bout. */
  endMargin: 0.08,
  /**
   * Recouvrement minimal entre le board et le segment pour accrocher (m). Le centre du board peut
   * encore être avant le début du rail : c'est le cas normal quand on arrive dans l'axe.
   */
  minOverlap: 0.25,
  /** Accrochage progressif : l'écart initial au rail se résorbe à ce rythme (1/s). */
  snapResponse: 25,
  /**
   * Distance horizontale à une ligne de grind sous le board en dessous de laquelle l'aimantation des
   * rotations est suspendue (m) : on doit pouvoir arriver en travers pour un slide.
   */
  spinMagnetSuspendRadius: 0.6,
  /** Après une sortie, le même segment est ignoré pendant ce délai (s). */
  reentryDelay: 0.35,
  /** Multiplicateur de la friction du matériau selon le type de grind. */
  typeFriction: {
    fiftyFifty: 1,
    fiveO: 1.35,
    nosegrind: 1.25,
    boardslide: 1.5,
    lipslide: 1.5,
    manual: 1,
    noseManual: 1,
  } satisfies Record<BalanceMoveId, number>,
  /** Traînée aérodynamique pendant un grind (1/m), comme au sol. */
  airDrag: 0.0045,
  /** Vitesse de sortie latérale d'une chute de grind, du côté du déséquilibre (m/s). */
  bailSideSpeed: 1.2,
} as const;

/** Manuals. */
export const MANUAL = {
  /** Vitesse minimale pour entrer en manual (m/s). */
  minSpeed: 1.0,
  /** Résistance au roulement supplémentaire sur deux roues (multiplicateur). */
  rollingMultiplier: 1.4,
} as const;

/**
 * Jauge d'équilibre commune aux grinds et aux manuals, normalisée : 0 au centre, ±limit au bord.
 * Dynamique instable : b' = drift·(1 + driftGrowth·t)·b + perturbation(t) + correction·stick.
 * Sans correction, la jauge sort de la zone sûre en 1 à 2 s.
 */
export const BALANCE = {
  /** Divergence de la jauge (1/s) : plus elle est décentrée, plus elle part vite. */
  drift: 1.4,
  /** Croissance de la divergence avec la durée tenue (par seconde). */
  driftGrowth: 0.25,
  /** Effet du stick à fond sur la jauge (unités/s). */
  correction: 2.4,
  /** Bord de la zone sûre ; au-delà, chute. */
  limit: 1.0,
  /** Début de la zone d'alerte, pour l'affichage. */
  warnZone: 0.7,
  /** Amplitude de la perturbation pseudo-aléatoire (unités/s). */
  perturbAmplitude: 0.5,
  /** Fréquence de base de la perturbation (Hz). */
  perturbFrequency: 0.9,
  /** Décentrage initial à l'entrée, du côté de l'approche (unités). */
  startOffset: 0.08,
  /** Difficulté par type : multiplie la divergence. */
  difficulty: {
    fiftyFifty: 1,
    fiveO: 1.2,
    nosegrind: 1.3,
    boardslide: 0.9,
    lipslide: 1.0,
    manual: 1.1,
    noseManual: 1.25,
  } satisfies Record<BalanceMoveId, number>,
} as const;

/** Seuils de chute. */
export const BAIL = {
  // Déclencheurs.
  /** Angle max entre la planche et la normale du sol à la réception (rad). Au-delà : chute. */
  maxLandingTilt: 0.6,
  /** Écart max de cap entre la planche et la vitesse à la réception (rad). Au-delà : chute. */
  maxLandingYawError: 0.7,
  /** Vitesse verticale d'impact au-delà de laquelle on chute (m/s, valeur positive). */
  maxImpactSpeed: 11.0,
  /** Vitesse d'impact contre un mur (composante normale) qui provoque la chute (m/s). */
  wallImpactSpeed: 5.0,
  /** Vitesse d'impact de la planche contre un obstacle bas (curb, ledge) qui fait trébucher (m/s). */
  tripImpactSpeed: 3.5,
  /** Part de la vitesse entrant dans le mur gardée par le corps à l'impact (le reste est absorbé). */
  wallImpactKeep: 0.3,

  // Ragdoll.
  /** Part de la vitesse du skateur transmise au corps et à la planche. */
  inheritVelocity: 0.9,
  /** Plafond de la vitesse héritée (m/s), contre les envolées. */
  maxInheritedSpeed: 14,
  /** Impulsion verticale ajoutée en trébuchant sur un obstacle bas (m/s) : le corps bascule par-dessus. */
  tripLift: 1.8,
  /** Rotation donnée au torse en trébuchant (rad/s), le corps plonge vers l'avant. */
  tripTumble: 5,
  /** Rotation aléatoire de départ des membres (rad/s), pour une chute moins mécanique. */
  limbTumble: 2.5,
  /** Rotation donnée à la planche lâchée (rad/s). */
  boardTumble: 7,
  /** Amortissement linéaire des membres (1/s). */
  linearDamping: 0.15,
  /** Amortissement angulaire des membres (1/s). Assez fort pour éviter les tourbillons. */
  angularDamping: 1.2,
  /** Densité des membres (kg/m³) : environ 75 kg pour le corps entier. */
  bodyDensity: 1000,
  /** Friction des membres sur le décor. */
  bodyFriction: 0.9,
  /** Restitution des membres : on rebondit peu. */
  bodyRestitution: 0.05,
  /** Vitesse linéaire max d'un membre (m/s), garde-fou contre une explosion numérique. */
  maxPartSpeed: 22,
  /** Vitesse angulaire max d'un membre (rad/s). */
  maxPartAngularSpeed: 30,

  // Relève.
  /** Durée minimale de la chute avant de pouvoir se relever (s). */
  minRagdollTime: 0.6,
  /** Le corps est stabilisé quand le bassin et le torse vont moins vite que cette vitesse (m/s)... */
  settleSpeed: 0.35,
  /** ...pendant cette durée (s). */
  settleTime: 0.35,
  /** Durée max de la chute avant de se relever quoi qu'il arrive (s). */
  ragdollDuration: 2.2,
  /** Fondu entre la pose au sol et la pose debout (s). */
  getUpTime: 0.45,
  /** Fondu raccourci quand on se relève avec R (s). */
  quickGetUpTime: 0.2,
  /** Temps de récupération après la relève, sans pop ni poussée (s). */
  recoveryTime: 0.25,
  /** Rayon max de recherche d'un point de relève dégagé autour du bassin (m). */
  respawnSearchRadius: 2.5,
  /** Pente max d'un point de relève (rad). */
  respawnMaxSlope: 0.45,
  /**
   * Hauteur max d'un point de relève au-dessus du bassin au sol (m) : on ne se relève jamais
   * sur un module ou un mur plus haut que l'endroit où l'on est tombé.
   */
  respawnMaxRise: 0.3,

  // Sons.
  /** Variation de vitesse d'un membre en un pas au-delà de laquelle un impact s'entend (m/s). */
  impactSoundSpeed: 2.2,
  /** Délai minimal entre deux sons d'impact d'un même membre (s). */
  impactSoundCooldown: 0.12,
} as const;

/** Fenêtres et délais d'input. */
export const INPUT = {
  /** Un tap d'ollie fait juste avant la réception déclenche un pop à la réception (ms). */
  popBufferMs: 120,
  /** Relâcher la charge juste après avoir quitté une arête déclenche encore le pop (coyote time, ms). */
  coyoteMs: 90,
  /** Fenêtre pour finir le flick une fois le stick revenu au centre sans l'avoir terminé, sinon la charge est annulée (ms). */
  flickWindowMs: 180,
  /** Zone morte des sticks (0 à 1). */
  stickDeadzone: 0.15,
  /** Fenêtre de réception pour enchaîner un manual (ms). */
  manualWindowMs: 150,
  /** Délai entre deux appuis pour un double tap de poussée (ms). */
  doubleTapMs: 250,
  /** Rayon du stick virtuel de la souris (px) : un glissé de cette longueur met le stick en butée. */
  mouseStickRadiusPx: 70,
  /** Au-delà de ce multiple du rayon, l'origine du glissé suit la souris (pas de course morte). */
  mouseOriginFollow: 1.5,
  /** Réponse du stick virtuel des flèches (1/s). Assez haut pour un flick, assez bas pour tracer des arcs. */
  keyStickResponse: 40,
  /**
   * Entre deux flèches voisines (écart de direction sous cet angle, rad), le stick virtuel déjà
   * près du bord tourne le long du bord au lieu de couper : une suite de flèches trace un vrai arc.
   * Sinon (bas puis haut, bas puis diagonale), il va en ligne droite et trace un trait.
   */
  keyStickArcMaxAngle: (50 * Math.PI) / 180,
  /** Rayon du stick virtuel au-delà duquel le suivi du bord s'applique (0 à 1). */
  keyStickArcMinRadius: 0.75,
  /** Seuil du stick vers l'arrière pour freiner (0 à 1). */
  brakeThreshold: 0.5,
  /** Seuil du stick vers l'avant pour se grouper (0 à 1). */
  tuckThreshold: 0.5,
  /** Mémorisation d'une poussée demandée pendant la récupération du pied (ms). */
  pushBufferMs: 200,
  /** Vitesse de lissage du joystick tactile (1/s). */
  touchStickSmoothing: 18,
  /** Rayon du joystick tactile (px CSS) : un déplacement du pouce de cette longueur le met en butée. */
  touchJoystickRadiusPx: 56,
  /** Au-delà de ce multiple du rayon, la base du joystick suit le pouce. */
  touchJoystickFollow: 1.35,
  /** Rayon du stick de flick au glissé tactile (px CSS), avant la sensibilité du glissé. */
  touchSwipeRadiusPx: 60,
  /** Joystick tactile poussé vers l'avant au-delà de ce seuil (0 à 1) : poussée, comme le bouton Pousser. */
  touchPushThreshold: 0.8,
} as const;

const DEG = Math.PI / 180;

/**
 * Reconnaissance des gestes de flick au stick droit (souris, flèches, manette).
 * Angles en radians, mesurés comme sur un cercle trigonométrique : 0 à droite, π/2 en haut.
 */
export const FLICK = {
  /**
   * Sensibilité de la reconnaissance : multiplie toutes les tolérances.
   * 1 par défaut, 1,5 plus permissif, 0,7 plus exigeant.
   */
  sensitivity: 1,
  /** Rayon du stick qui démarre un geste (0 à 1). */
  startRadius: 0.3,
  /** Zone de charge : stick en bas, au-delà de ce rayon (0 à 1). */
  chargeRadius: 0.55,
  /** Zone de charge : écart angulaire max avec la verticale basse (rad). */
  chargeHalfAngle: 50 * DEG,
  /** Rayon sous lequel le stick est relâché (0 à 1). */
  releaseRadius: 0.22,
  /** Rayon à atteindre hors de la zone de charge pour que le geste compte (0 à 1). */
  reachRadius: 0.5,
  /** Fin du geste si le stick reste immobile hors du centre pendant cette durée (ms). */
  holdEndMs: 110,
  /** Déplacement du stick par pas sous lequel il est considéré immobile. */
  holdEndMotion: 0.012,
  /** Durée maximale de la partie flick du geste (ms). Un cercle complet tracé posément prend 400 à 700 ms. */
  maxFlickMs: 900,
  /** Rayon minimal pour qu'un segment compte dans l'angle balayé (0 à 1). */
  sweepMinRadius: 0.3,
  /**
   * Frontière entre trait droit et arc : rayon minimal atteint par le chemin après la charge.
   * Un trait coupe le disque intérieur, un arc reste sur le bord.
   */
  arcRadius: 0.5,
  /** Largeur de la transition trait / arc autour de arcRadius. */
  arcRadiusWidth: 0.12,
  /** Tolérance sur l'angle de départ, attendu en bas (rad). */
  startTolerance: 55 * DEG,
  /** Tolérance sur l'angle de sortie (rad). */
  endTolerance: 28 * DEG,
  /** Tolérance sur l'angle balayé (rad). */
  sweepTolerance: 40 * DEG,
  /** Score minimal pour retenir un trick ; en dessous, un geste vers le haut donne un ollie. */
  minScore: 0.3,
} as const;

/** Niveau du joueur : XP gagnée par les combos validés et les défis. */
export const PROGRESSION = {
  /** XP gagnée par point de combo validé. */
  xpPerPoint: 1,
  /** XP pour passer du niveau 1 au niveau 2. */
  levelBaseXp: 1500,
  /** Facteur appliqué à l'XP requise à chaque niveau. */
  levelGrowth: 1.3,
  /** Niveau maximal. */
  maxLevel: 20,
} as const;

/** Réglages modifiables dans le menu : bornes et valeurs par défaut. */
export const SETTINGS_LIMITS = {
  /** Sensibilité des flicks (multiplie toutes les tolérances de reconnaissance, voir FLICK.sensitivity). */
  flickSensitivityMin: 0.6,
  flickSensitivityMax: 1.6,
  /** Sensibilité de la souris : divise INPUT.mouseStickRadiusPx (plus haut = glissé plus court). */
  mouseSensitivityMin: 0.5,
  mouseSensitivityMax: 2,
} as const;

/**
 * Score et combos (points entiers, arrondis à la validation).
 *
 * Score d'un combo = (Σ points des éléments + bonus de variété) × multiplicateur × facteur de réception.
 * Points d'un élément = (valeur de base + bonus de hauteur, de distance, de transition) × facteur de répétition.
 */
export const SCORING = {
  // Enchaînement.
  /**
   * Temps passé au sol (hors manual) qui clôt le combo (s). Le compteur repart à zéro à chaque élément ;
   * il est suspendu en l'air, en grind et en manual. À l'échéance, le combo est validé.
   */
  comboGroundTime: 1.0,

  // Valeurs de base.
  /** Valeur de base de chaque trick du board (points). Un ollie ne compte que s'il y a eu un pop. */
  trickPoints: {
    ollie: 100,
    kickflip: 300,
    heelflip: 300,
    popShoveIt: 250,
    treFlip: 650,
    varialFlip: 450,
    hardflip: 500,
  } satisfies Record<FlickTrickId, number>,
  /** Points par demi-tour de rotation du corps (points / 180°). */
  spinPointsPer180: 200,
  /** Supplément par demi-tour au-delà du premier (fraction) : un 540 vaut plus que trois 180. */
  spinExtraPer180: 0.25,
  /** Points par grab compté. */
  grabPoints: 150,
  /** Bonus de hauteur : seuil au-dessus du point de décollage (m)... */
  heightBonusFrom: 0.4,
  /** ...et points par mètre au-delà. */
  heightPointsPerMeter: 400,
  /** Valeur de base de chaque grind et manual, à l'accrochage (points). */
  balancePoints: {
    fiftyFifty: 150,
    fiveO: 200,
    nosegrind: 225,
    boardslide: 200,
    lipslide: 250,
    manual: 100,
    noseManual: 150,
  } satisfies Record<BalanceMoveId, number>,
  /** Bonus de distance de grind (points / m). */
  grindPointsPerMeter: 60,
  /** Bonus de distance de manual (points / m). */
  manualPointsPerMeter: 40,
  /** Durée minimale d'un grind pour compter (s). */
  minGrindTime: 0.1,
  /** Durée minimale d'un manual pour compter (s) : un tap de la touche ne gonfle pas le combo. */
  minManualTime: 0.3,
  /** Bonus d'un manual enchaîné après un grind, avec au plus un saut entre les deux (points). */
  grindToManualBonus: 300,
  /** Bonus d'un grind enchaîné après un manual, avec au plus un saut entre les deux (points). */
  manualToGrindBonus: 200,

  // Multiplicateur et variété.
  /** Multiplicateur ajouté par élément distinct au-delà du premier. */
  multiplierStep: 0.5,
  /** Plafond du multiplicateur. */
  maxMultiplier: 8,
  /**
   * Bonus de variété par famille distincte au-delà de la première (points) ; familles :
   * flip, shove, rotation, grab, grind sur trucks, slide, manual.
   */
  varietyPointsPerFamily: 150,

  // Répétition.
  /** Facteur appliqué à chaque répétition d'un même élément dans le combo (puissance du nombre de répétitions). */
  repeatDecay: 0.5,
  /** Facteur appliqué par occurrence du même élément dans les combos validés récents. */
  recentRepeatFactor: 0.8,
  /** Nombre d'éléments validés récents mémorisés pour la pénalité de répétition entre combos. */
  recentHistorySize: 10,
  /** Plancher du facteur de répétition. */
  minRepeatFactor: 0.1,

  // Validation.
  /** Facteur appliqué au combo quand il se termine sur une réception sale (0 : rien n'est validé). */
  sloppyLandingFactor: 0.5,
} as const;
