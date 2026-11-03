import type { FlickTrickId } from '@/core/FlickRecognizer';

export type TrickId = FlickTrickId;

/**
 * Définition d'un trick : rotations du board, en tours.
 * - flips : autour de l'axe long du board, positif dans le sens du kickflip ;
 * - shove : autour de l'axe vertical du board, positif en backside.
 * Pour le pop shove-it et le 360 flip, le sens du geste (FlickEvent.side) multiplie le shove.
 */
export interface TrickDef {
  readonly id: TrickId;
  readonly name: string;
  readonly flips: number;
  readonly shove: number;
  /** Le sens du shove suit le sens du geste. */
  readonly shoveFollowsGesture: boolean;
}

export const TRICK_DEFS: Readonly<Record<TrickId, TrickDef>> = {
  ollie: { id: 'ollie', name: 'Ollie', flips: 0, shove: 0, shoveFollowsGesture: false },
  kickflip: { id: 'kickflip', name: 'Kickflip', flips: 1, shove: 0, shoveFollowsGesture: false },
  heelflip: { id: 'heelflip', name: 'Heelflip', flips: -1, shove: 0, shoveFollowsGesture: false },
  popShoveIt: { id: 'popShoveIt', name: 'Pop shove-it', flips: 0, shove: 0.5, shoveFollowsGesture: true },
  treFlip: { id: 'treFlip', name: '360 flip', flips: 1, shove: 1, shoveFollowsGesture: true },
  varialFlip: { id: 'varialFlip', name: 'Varial flip', flips: 1, shove: 0.5, shoveFollowsGesture: false },
  hardflip: { id: 'hardflip', name: 'Hardflip', flips: 1, shove: -0.5, shoveFollowsGesture: false },
};

/** Nom affiché, avec le sens du shove quand il dépend du geste. */
export function trickName(id: TrickId, side: number): string {
  const def = TRICK_DEFS[id];
  if (!def.shoveFollowsGesture) return def.name;
  return `${def.name} ${side < 0 ? 'frontside' : 'backside'}`;
}

/** Grabs, choisis par la direction du stick de grab dans le repère du board. */
export type GrabId = 'indy' | 'melon' | 'nosegrab' | 'tailgrab';

export interface GrabDef {
  readonly id: GrabId;
  readonly name: string;
  /** Main qui attrape : -1 main avant (côté nose), +1 main arrière (côté tail). */
  readonly hand: -1 | 1;
}

export const GRAB_DEFS: Readonly<Record<GrabId, GrabDef>> = {
  indy: { id: 'indy', name: 'Indy', hand: 1 },
  melon: { id: 'melon', name: 'Melon', hand: -1 },
  nosegrab: { id: 'nosegrab', name: 'Nosegrab', hand: -1 },
  tailgrab: { id: 'tailgrab', name: 'Tailgrab', hand: 1 },
};

/** Ordre stable des grabs, pour transmettre l'identifiant au rig par un indice. */
export const GRAB_ORDER: readonly GrabId[] = ['indy', 'melon', 'nosegrab', 'tailgrab'];

/**
 * Grab désigné par une direction (repère du board, vue de derrière) :
 * haut = nose, bas = tail, droite = bord côté orteils (indy), gauche = bord côté talons (melon).
 * Sous le seuil d'amplitude, null : le grab courant est gardé (indy par défaut).
 */
export function grabFromDirection(x: number, y: number, threshold: number): GrabId | null {
  if (Math.hypot(x, y) < threshold) return null;
  if (Math.abs(y) > Math.abs(x)) return y > 0 ? 'nosegrab' : 'tailgrab';
  return x > 0 ? 'indy' : 'melon';
}

/** Nom d'un saut complet : rotation du corps, trick du board, puis grabs, par exemple « 360 Kickflip Indy ». */
export function comboName(spinDegrees: number, trick: TrickId, trickSide: number, grabs: readonly GrabId[]): string {
  const parts: string[] = [];
  if (spinDegrees > 0) parts.push(String(spinDegrees));
  if (trick !== 'ollie' || (spinDegrees === 0 && grabs.length === 0)) parts.push(trickName(trick, trickSide));
  for (const g of grabs) parts.push(GRAB_DEFS[g].name);
  return parts.join(' ');
}
