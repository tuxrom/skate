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
