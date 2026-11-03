import type { DeckPattern, SkaterAppearance } from '@/skater/SkaterRig';

/**
 * Catalogue de la personnalisation : boards et couleurs de vêtements.
 * `level` : niveau du joueur qui débloque l'élément (1 = dès le départ).
 * `challenge` : défi dont la réussite débloque l'élément, en plus du niveau.
 */
export interface BoardDef {
  readonly id: string;
  readonly name: string;
  readonly deck: number;
  readonly accent: number;
  readonly pattern: DeckPattern;
  readonly wheel: number;
  readonly level: number;
  readonly challenge?: string;
}

export interface ColorDef {
  readonly id: string;
  readonly name: string;
  readonly hex: number;
  readonly level: number;
}

export const BOARDS: readonly BoardDef[] = [
  { id: 'maple', name: 'Érable', deck: 0xb5835a, accent: 0x8a5c38, pattern: 'plain', wheel: 0xefe9dc, level: 1 },
  { id: 'brick', name: 'Brique', deck: 0xc8553d, accent: 0xf2e2c4, pattern: 'stripes', wheel: 0xefe9dc, level: 1 },
  { id: 'lagoon', name: 'Lagon', deck: 0x1f8a9e, accent: 0xf4d35e, pattern: 'split', wheel: 0xf4d35e, level: 2 },
  { id: 'night', name: 'Nuit', deck: 0x1d2433, accent: 0x7fd1ff, pattern: 'dots', wheel: 0x7fd1ff, level: 3 },
  { id: 'citrus', name: 'Agrume', deck: 0xf2a541, accent: 0x2b2d31, pattern: 'chevron', wheel: 0x2b2d31, level: 5 },
  { id: 'checker', name: 'Damier', deck: 0xf2f2f2, accent: 0x202020, pattern: 'checker', wheel: 0xc8553d, level: 7 },
  { id: 'gold', name: 'Or', deck: 0x9c7a1e, accent: 0xf6d36b, pattern: 'stripes', wheel: 0xf6d36b, level: 10 },
  { id: 'stairs', name: 'Escalier', deck: 0x5a3e85, accent: 0xff8fab, pattern: 'chevron', wheel: 0xff8fab, level: 1, challenge: 'stairsCombo' },
  { id: 'rails', name: 'Acier', deck: 0x7d8790, accent: 0xd8dde2, pattern: 'split', wheel: 0x3a3f44, level: 1, challenge: 'railsTimed' },
];

export const COLORS: readonly ColorDef[] = [
  { id: 'red', name: 'Brique', hex: 0xc8553d, level: 1 },
  { id: 'slate', name: 'Ardoise', hex: 0x33414a, level: 1 },
  { id: 'blue', name: 'Bleu', hex: 0x2c6e91, level: 1 },
  { id: 'white', name: 'Blanc', hex: 0xe8e6e1, level: 1 },
  { id: 'black', name: 'Noir', hex: 0x1f1f22, level: 1 },
  { id: 'olive', name: 'Olive', hex: 0x6b7a3a, level: 2 },
  { id: 'sand', name: 'Sable', hex: 0xc9b38a, level: 2 },
  { id: 'teal', name: 'Canard', hex: 0x1f8a9e, level: 3 },
  { id: 'mustard', name: 'Moutarde', hex: 0xd9a21b, level: 4 },
  { id: 'purple', name: 'Violet', hex: 0x5a3e85, level: 5 },
  { id: 'pink', name: 'Rose', hex: 0xe0709a, level: 6 },
  { id: 'lime', name: 'Citron vert', hex: 0x8cc43c, level: 8 },
  { id: 'orange', name: 'Orange vif', hex: 0xf26b1d, level: 9 },
];

/** Choix de personnalisation sauvegardé (identifiants du catalogue). */
export interface Customization {
  board: string;
  shirt: string;
  pants: string;
  cap: string;
}

export const DEFAULT_CUSTOMIZATION: Readonly<Customization> = { board: 'maple', shirt: 'red', pants: 'slate', cap: 'blue' };

export function boardById(id: string): BoardDef {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]!;
}

export function colorById(id: string): ColorDef {
  return COLORS.find((c) => c.id === id) ?? COLORS[0]!;
}

/** Vrai si l'élément est débloqué au niveau donné et avec les défis réussis. */
export function isUnlocked(item: { level: number; challenge?: string }, level: number, completed: ReadonlySet<string>): boolean {
  return level >= item.level && (item.challenge === undefined || completed.has(item.challenge));
}

export function appearanceOf(c: Customization): SkaterAppearance {
  const b = boardById(c.board);
  return {
    deck: b.deck,
    accent: b.accent,
    pattern: b.pattern,
    wheel: b.wheel,
    shirt: colorById(c.shirt).hex,
    pants: colorById(c.pants).hex,
    cap: colorById(c.cap).hex,
  };
}

/** Éléments débloqués en passant du niveau `from` au niveau `to` (noms, pour l'annonce). */
export function unlockedBetween(from: number, to: number): string[] {
  const names: string[] = [];
  for (const b of BOARDS) if (!b.challenge && b.level > from && b.level <= to) names.push(`board ${b.name}`);
  for (const c of COLORS) if (c.level > from && c.level <= to) names.push(`couleur ${c.name}`);
  return names;
}
