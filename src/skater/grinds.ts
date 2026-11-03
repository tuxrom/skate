import { BODY, type BalanceMoveId } from '@/config/physics';

export type GrindTypeId = 'fiftyFifty' | 'fiveO' | 'nosegrind' | 'boardslide' | 'lipslide';
export type ManualTypeId = 'manual' | 'noseManual';

/**
 * Géométrie du board vue par les grinds (m) ; doit rester cohérente avec le rig procédural.
 * - truckDrop : du dessous des hangers au plan de contact des roues (les hangers posent sur le rail) ;
 * - deckDrop : du dessous du deck au plan de contact des roues (le deck glisse sur le rail).
 */
const TRUCK_DROP = 0.02;
const DECK_DROP = 0.084;

export interface BalanceMoveDef {
  readonly id: BalanceMoveId;
  readonly name: string;
  /** Grind sur les trucks (board dans l'axe du rail) plutôt qu'un slide (board en travers). */
  readonly onTrucks: boolean;
  /** Hauteur du plan de contact des roues sous la ligne de grind (m). */
  readonly drop: number;
  /** Décalage du centre du board le long de son axe par rapport au point de grind (m, vers le nose). */
  readonly alongShift: number;
}

export const BALANCE_MOVES: Readonly<Record<BalanceMoveId, BalanceMoveDef>> = {
  fiftyFifty: { id: 'fiftyFifty', name: '50-50', onTrucks: true, drop: TRUCK_DROP, alongShift: 0 },
  // Truck arrière seul : le centre du board est devant le rail.
  fiveO: { id: 'fiveO', name: '5-0', onTrucks: true, drop: TRUCK_DROP, alongShift: BODY.wheelbase / 2 },
  // Truck avant seul : le centre du board est derrière le rail.
  nosegrind: { id: 'nosegrind', name: 'Nosegrind', onTrucks: true, drop: TRUCK_DROP, alongShift: -BODY.wheelbase / 2 },
  boardslide: { id: 'boardslide', name: 'Boardslide', onTrucks: false, drop: DECK_DROP, alongShift: 0 },
  lipslide: { id: 'lipslide', name: 'Lipslide', onTrucks: false, drop: DECK_DROP, alongShift: 0 },
  manual: { id: 'manual', name: 'Manual', onTrucks: true, drop: 0, alongShift: 0 },
  noseManual: { id: 'noseManual', name: 'Nose manual', onTrucks: true, drop: 0, alongShift: 0 },
};

/** Ordre stable, pour transmettre le type au rig par un indice. */
export const BALANCE_ORDER: readonly BalanceMoveId[] = ['fiftyFifty', 'fiveO', 'nosegrind', 'boardslide', 'lipslide', 'manual', 'noseManual'];

/**
 * Choix du grind à l'accrochage.
 * - Angle d'approche : board dans l'axe du rail (sous GRIND.truckMaxAngle) → trucks, sinon slide.
 * - Direction tenue (stick gauche avant/arrière) : avant = nosegrind / lipslide, arrière = 5-0, neutre = 50-50 / boardslide.
 */
export function chooseGrind(onTrucks: boolean, stickY: number): GrindTypeId {
  if (onTrucks) return stickY > 0.5 ? 'nosegrind' : stickY < -0.5 ? 'fiveO' : 'fiftyFifty';
  return stickY > 0.5 ? 'lipslide' : 'boardslide';
}
