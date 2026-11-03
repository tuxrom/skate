/**
 * Réglages techniques du rendu et de la caméra.
 * Les réglages de ressenti du gameplay vivent dans ./physics.ts.
 */

export const RENDER = {
  /** Plafond du devicePixelRatio, pour tenir 60 fps sur mobile milieu de gamme. */
  maxPixelRatio: 2,
  /** Antialiasing matériel (coûteux sur mobile à ratio 2). */
  antialias: true,
  /** Couleur de fond et du brouillard. */
  clearColor: 0x9fb4c7,
  /** Distances du brouillard linéaire (m). */
  fogNear: 60,
  fogFar: 220,
  /** Taille de la shadow map du soleil (px). */
  shadowMapSize: 1024,
  /** Demi-étendue de la caméra d'ombre du soleil (m). */
  shadowExtent: 30,
} as const;

export const CAMERA = {
  /** Champ de vision vertical à l'arrêt (degrés). */
  fovMin: 62,
  /** Champ de vision vertical à vitesse max (degrés). */
  fovMax: 76,
  /** Lissage du FOV (1/s). */
  fovStiffness: 3,
  near: 0.05,
  far: 400,
  /** Distance derrière la cible (m). */
  followDistance: 3.6,
  /** Hauteur au-dessus de la cible (m). */
  followHeight: 1.7,
  /** Hauteur du point visé au-dessus de la cible (m). */
  lookHeight: 1.0,
  /** Avance du point visé dans la direction du cap (m). */
  lookAhead: 1.2,
  /** Raideur du suivi horizontal (1/s). Plus haut = plus collé. */
  positionStiffness: 7,
  /** Raideur du suivi vertical (1/s), plus souple pour absorber les reliefs. */
  heightStiffness: 5,
  /** Raideur du suivi de cap (1/s). */
  yawStiffness: 3.5,
  /** Composante horizontale minimale du cap pour que la caméra le suive (évite les sauts en vert). */
  minYawProjection: 0.35,
  /** Rayon de la sphère de collision de la caméra (m). */
  collisionRadius: 0.22,
  /** Distance minimale caméra-cible quand le décor bouche la vue (m). */
  minDistance: 0.6,
  /** Vitesse de recul quand le décor ne gêne plus (1/s). Le rapprochement, lui, est immédiat. */
  releaseStiffness: 2.5,
  /** Raideur du suivi vertical en l'air (1/s) : la caméra ne suit pas tout l'apex. */
  airHeightStiffness: 3.5,
  /**
   * Anticipation de la réception (s) : dans cette fenêtre avant l'impact, l'ancre verticale
   * glisse vers l'altitude du point d'atterrissage prévu.
   */
  landingLead: 1.0,
  /** Part maximale du chemin vers l'altitude de réception parcourue par anticipation (0 à 1). */
  landingAnticipation: 0.85,
  /** Le regard se porte vers le point de réception, part maximale (0 à 1). */
  landingLookBlend: 0.35,
  /** Affaissement de la caméra à l'impact, par m/s de vitesse d'impact (m). */
  impactDipPerSpeed: 0.035,
  /** Affaissement maximal (m). */
  impactDipMax: 0.25,
  /** Retour après l'affaissement (1/s). */
  impactDipRecovery: 7,
} as const;

/** Effets visuels. */
export const FX = {
  /** Nombre maximal de particules de poussière vivantes. */
  dustPoolSize: 160,
  /** Durée de vie d'une particule (s). */
  dustLifetime: 0.75,
  /** Taille d'une particule à la naissance (m). */
  dustSize: 0.16,
  /** Grossissement d'une particule au cours de sa vie (multiplicateur final). */
  dustGrowth: 2.6,
  /** Vitesse d'éjection horizontale (m/s). */
  dustSpeed: 1.4,
  /** Particules émises par m/s de vitesse d'impact. */
  dustPerImpactSpeed: 5,
  /** Particules émises au pop. */
  dustOnPop: 6,
  /** Plafond d'une seule bouffée. */
  dustMaxBurst: 40,
  dustColor: 0xc9c2b4,
  /** Opacité à la naissance. */
  dustOpacity: 0.55,
} as const;

export const DEBUG = {
  /** Intervalle de rafraîchissement du compteur FPS (s). */
  statsRefresh: 0.5,
} as const;
