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
  /** Vitesse de rotation max du corps en l'air, axe vertical (rad/s). Contrôle volontairement léger. */
  airSpinRate: 3.2,
  /** Réponse de la rotation aérienne à l'input (1/s). Plus bas = plus d'inertie. */
  airSpinResponse: 6,
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
  /** Temps pour qu'un grab soit tenu et compté (s). */
  grabMinHold: 0.15,
  /** Ralentissement de la rotation pendant un grab (multiplicateur). */
  grabSpinDamping: 0.6,
  /**
   * Rotation de board restant à faire à la réception tolérée sans pénalité (rad).
   * Jusqu'au double, la réception est sale ; au-delà, le board n'est pas sous les pieds.
   */
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
  /** Vitesse de lissage du stick virtuel tactile (1/s). */
  touchStickSmoothing: 18,
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
