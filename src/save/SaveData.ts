import { PROGRESSION, SETTINGS_LIMITS } from '@/config/physics';
import type { GraphicsQuality } from '@/config/render';
import type { ScoreRecords } from '@/score/ScoreSystem';
import { BOARDS, COLORS, DEFAULT_CUSTOMIZATION, type Customization } from '@/progress/unlocks';

export type PadLayout = 'auto' | 'xbox' | 'playstation';

/** Réglages du joueur. */
export interface Settings {
  quality: GraphicsQuality;
  /** Volume général (0 à 1). */
  volume: number;
  muted: boolean;
  /** Multiplie les tolérances de reconnaissance des flicks. */
  flickSensitivity: number;
  /** Sensibilité du glissé à la souris. */
  mouseSensitivity: number;
  /** Libellés des boutons de manette. */
  padLayout: PadLayout;
}

export interface ChallengeProgress {
  done: boolean;
  /** Meilleure progression atteinte (0 à 1). */
  best: number;
}

/** Tout ce qui est sauvegardé. */
export interface SaveData {
  version: 1;
  records: ScoreRecords;
  /** XP cumulée ; le niveau s'en déduit. */
  xp: number;
  challenges: Record<string, ChallengeProgress>;
  settings: Settings;
  custom: Customization;
}

export const SAVE_VERSION = 1;

/** Qualité par défaut : moyenne sur un appareil tactile, haute sinon. */
function defaultQuality(): GraphicsQuality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'medium' : 'high';
}

export function defaultSettings(): Settings {
  return { quality: defaultQuality(), volume: 0.8, muted: false, flickSensitivity: 1, mouseSensitivity: 1, padLayout: 'auto' };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    records: { bestCombo: 0, bestComboLabel: '', bestSession: 0 },
    xp: 0,
    challenges: {},
    settings: defaultSettings(),
    custom: { ...DEFAULT_CUSTOMIZATION },
  };
}

/**
 * Reconstruit une sauvegarde valide à partir de données lues (format inconnu, ancienne version,
 * valeurs corrompues) : chaque champ invalide reprend sa valeur par défaut.
 */
export function sanitizeSave(raw: unknown): SaveData {
  const out = defaultSave();
  if (!isObject(raw)) return out;
  if (isObject(raw.records)) {
    out.records.bestCombo = score(raw.records.bestCombo);
    out.records.bestSession = score(raw.records.bestSession);
    if (typeof raw.records.bestComboLabel === 'string') out.records.bestComboLabel = raw.records.bestComboLabel.slice(0, 200);
  }
  out.xp = score(raw.xp);
  if (isObject(raw.challenges)) {
    for (const [id, p] of Object.entries(raw.challenges)) {
      if (!isObject(p) || id.length > 64) continue;
      out.challenges[id] = { done: p.done === true, best: clamp(num(p.best, 0), 0, 1) };
    }
  }
  if (isObject(raw.settings)) {
    const s = raw.settings;
    const d = out.settings;
    if (s.quality === 'low' || s.quality === 'medium' || s.quality === 'high') d.quality = s.quality;
    d.volume = clamp(num(s.volume, d.volume), 0, 1);
    d.muted = s.muted === true;
    d.flickSensitivity = clamp(num(s.flickSensitivity, 1), SETTINGS_LIMITS.flickSensitivityMin, SETTINGS_LIMITS.flickSensitivityMax);
    d.mouseSensitivity = clamp(num(s.mouseSensitivity, 1), SETTINGS_LIMITS.mouseSensitivityMin, SETTINGS_LIMITS.mouseSensitivityMax);
    if (s.padLayout === 'xbox' || s.padLayout === 'playstation' || s.padLayout === 'auto') d.padLayout = s.padLayout;
  }
  if (isObject(raw.custom)) {
    const c = raw.custom;
    if (typeof c.board === 'string' && BOARDS.some((b) => b.id === c.board)) out.custom.board = c.board;
    for (const part of ['shirt', 'pants', 'cap'] as const) {
      const v = c[part];
      if (typeof v === 'string' && COLORS.some((col) => col.id === v)) out.custom[part] = v;
    }
  }
  return out;
}

/** Niveau atteint avec une XP donnée, et XP du niveau courant et du suivant. */
export function levelFromXp(xp: number): { level: number; levelXp: number; nextXp: number } {
  let level = 1;
  let need: number = PROGRESSION.levelBaseXp;
  let floor = 0;
  while (level < PROGRESSION.maxLevel && xp >= floor + need) {
    floor += need;
    level++;
    need = Math.round(need * PROGRESSION.levelGrowth);
  }
  return { level, levelXp: xp - floor, nextXp: level >= PROGRESSION.maxLevel ? 0 : need };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function score(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
