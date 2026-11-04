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

/** HUD et menus. */
export const HUD = {
  /** Durée d'affichage d'un combo validé ou perdu (s). */
  comboResultTime: 2.2,
  /** Nombre d'éléments du combo affichés (les plus récents). */
  comboVisibleElements: 4,
  /** Durée d'affichage du nom d'un trick avant qu'il s'efface (s). */
  trickNameTime: 1.3,
  /** Durée d'une notification (défi réussi, niveau, déblocage) (s). */
  toastTime: 3.2,
  /** Rotation de la caméra autour du skateur sur l'écran d'accueil (rad/s). */
  homeOrbitSpeed: 0.18,
  /** Caméra de l'écran d'accueil : distance et hauteur (m). */
  homeOrbitDistance: 4.2,
  homeOrbitHeight: 1.6,
  /** Caméra de la personnalisation : devant et à droite du skateur, hauteur (m). */
  showcaseFront: 2.4,
  showcaseSide: 1.1,
  showcaseHeight: 1.15,
  /** Répétition de la navigation au stick ou à la croix tenus, dans les menus (ms). */
  menuRepeatMs: 220,
  /** Seuil du stick pour naviguer dans les menus (0 à 1). */
  menuStickThreshold: 0.6,
} as const;

/** Boutons tactiles. */
export type TouchButtonId = 'push' | 'grab' | 'manual' | 'grind' | 'reset' | 'pause';

/** Position (centre, fraction de la zone sûre de l'écran, 0 à 1) et taille relative d'un bouton tactile. */
export interface TouchButtonLayout {
  x: number;
  y: number;
  size: number;
}

/** Contrôles tactiles : tailles, disposition par défaut, retour haptique. */
export const TOUCH = {
  /** Diamètre d'un bouton à taille 1 sur l'écran de référence (px CSS). */
  buttonSize: 60,
  /** Petit côté d'écran de référence (px CSS) : les boutons suivent ce rapport, borné ci-dessous. */
  referenceShortSide: 400,
  minScale: 0.8,
  maxScale: 1.3,
  /** Bornes de la taille relative réglable d'un bouton. */
  sizeMin: 0.6,
  sizeMax: 1.8,
  /** Disposition par défaut, pensée pour un téléphone en paysage : colonne à droite, hors du pouce gauche. */
  defaultLayout: {
    pause: { x: 0.95, y: 0.1, size: 0.75 },
    reset: { x: 0.84, y: 0.1, size: 0.75 },
    grind: { x: 0.94, y: 0.38, size: 1 },
    grab: { x: 0.94, y: 0.62, size: 1 },
    push: { x: 0.94, y: 0.86, size: 1.1 },
    manual: { x: 0.8, y: 0.88, size: 1 },
  } satisfies Record<TouchButtonId, TouchButtonLayout>,
  /** Vibration à la réception (ms), selon la violence de l'impact. */
  landVibrateMinMs: 8,
  landVibrateMaxMs: 30,
  /** Motif de vibration d'un combo validé (ms : vibre, pause, vibre...). */
  bankVibratePattern: [20, 40, 35] as readonly number[],
  /** Vibration d'une chute (ms). */
  bailVibrateMs: 60,
  /** Durée d'affichage des indications « Diriger » et « Flicks » au premier lancement (s). */
  hintTime: 6,
} as const;

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Plafond du devicePixelRatio. */
  maxPixelRatio: number;
  /** Échelle de résolution appliquée au pixel ratio (0 à 1). */
  resolutionScale: number;
  shadows: boolean;
  /** Taille de la shadow map (px). */
  shadowMapSize: number;
  /** Brouillard linéaire (m) ; la caméra ne dessine pas au-delà de fogFar. */
  fogNear: number;
  fogFar: number;
}

/** Préréglages de qualité graphique (réglages > Graphismes). L'antialiasing reste celui du démarrage. */
export const QUALITY_PRESETS: Readonly<Record<GraphicsQuality, QualityPreset>> = {
  low: { maxPixelRatio: 1, resolutionScale: 0.7, shadows: false, shadowMapSize: 512, fogNear: 25, fogFar: 85 },
  medium: { maxPixelRatio: 1.5, resolutionScale: 1, shadows: true, shadowMapSize: 1024, fogNear: 45, fogFar: 150 },
  high: { maxPixelRatio: 2, resolutionScale: 1, shadows: true, shadowMapSize: 2048, fogNear: 60, fogFar: 220 },
};

export const DEBUG = {
  /** Intervalle de rafraîchissement du compteur FPS (s). */
  statsRefresh: 0.5,
} as const;
