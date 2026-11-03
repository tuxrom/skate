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
  /** Champ de vision vertical (degrés). */
  fov: 65,
  near: 0.05,
  far: 400,
  /** Distance derrière la cible (m). */
  followDistance: 4.2,
  /** Hauteur au-dessus de la cible (m). */
  followHeight: 1.8,
  /** Hauteur du point visé au-dessus de la cible (m). */
  lookHeight: 0.9,
  /** Raideur du suivi en position (1/s). Plus haut = plus collé. */
  positionStiffness: 6,
  /** Raideur du suivi de cap (1/s). */
  yawStiffness: 4,
} as const;

export const DEBUG = {
  /** Intervalle de rafraîchissement du compteur FPS (s). */
  statsRefresh: 0.5,
} as const;
