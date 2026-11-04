/**
 * Objectifs de zone du skatepark de test : zones (cercles au sol) et défis associés.
 * Ce sont des données de niveau, comme la mise en page de Level.ts : positions et cibles
 * restent ici, en constantes nommées. Un défi se réussit une fois ; sa récompense est versée à ce moment.
 */

export interface ZoneDef {
  readonly id: string;
  readonly name: string;
  /** Centre au sol (m) et rayon (m). */
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Famille de mouvement visée par un défi de saut (voir SCORE_FAMILY). */
export type AirFamily = 'flip' | 'shove' | 'spin' | 'grab';

export type ChallengeGoal =
  /** Valider un combo d'au moins `points`, dont un élément a été fait dans la zone. */
  | { readonly type: 'combo'; readonly points: number }
  /** Un seul grind ou manual commencé ou fini dans la zone, d'au moins `meters` ou `seconds`. */
  | { readonly type: 'balance'; readonly kind: 'grind' | 'manual'; readonly meters?: number; readonly seconds?: number }
  /** Un saut reçu dans la zone, de la famille demandée. */
  | { readonly type: 'air'; readonly family: AirFamily }
  /** Chrono lancé en entrant dans la zone : valider `points` en `seconds` secondes, n'importe où. */
  | { readonly type: 'timedScore'; readonly points: number; readonly seconds: number }
  /** Chrono lancé en entrant dans la zone : `count` éléments du type demandé en `seconds` secondes. */
  | { readonly type: 'timedCount'; readonly kind: 'grind' | 'manual' | 'air'; readonly count: number; readonly seconds: number };

export interface ChallengeDef {
  readonly id: string;
  readonly zone: string;
  readonly title: string;
  readonly description: string;
  readonly goal: ChallengeGoal;
  /** XP versée à la réussite. */
  readonly rewardXp: number;
  /** Récompense supplémentaire affichée (déblocage lié au défi, voir unlocks.ts). */
  readonly rewardText?: string;
}

export const ZONES: readonly ZoneDef[] = [
  { id: 'start', name: 'Départ', x: 0, z: 12, radius: 9 },
  { id: 'manualBox', name: 'Boîte de manual', x: 12, z: 12, radius: 4.5 },
  { id: 'rails', name: 'Les rails', x: 11.5, z: 26, radius: 9.5 },
  { id: 'gap', name: 'Le gap', x: -20, z: 11, radius: 6 },
  { id: 'stairs', name: "L'escalier", x: 28, z: -2, radius: 8 },
  { id: 'ledge', name: 'Le long ledge', x: -28, z: 33, radius: 9 },
  { id: 'quarter', name: 'Le quarter', x: 0, z: -30, radius: 10 },
  { id: 'funbox', name: 'La funbox', x: -10, z: -8, radius: 6 },
];

export const CHALLENGES: readonly ChallengeDef[] = [
  {
    id: 'firstCombo',
    zone: 'start',
    title: 'Premiers pas',
    description: 'Valide un combo de 300 points près du départ.',
    goal: { type: 'combo', points: 300 },
    rewardXp: 300,
  },
  {
    id: 'manualBox',
    zone: 'manualBox',
    title: 'Équilibriste',
    description: 'Tiens un manual 2 secondes sur la boîte de manual.',
    goal: { type: 'balance', kind: 'manual', seconds: 2 },
    rewardXp: 500,
  },
  {
    id: 'railGrind',
    zone: 'rails',
    title: 'Métal',
    description: 'Grinde 4 mètres d’un seul tenant sur un rail.',
    goal: { type: 'balance', kind: 'grind', meters: 4 },
    rewardXp: 600,
  },
  {
    id: 'railsTimed',
    zone: 'rails',
    title: 'Tournée des rails',
    description: 'Enchaîne 3 grinds en 40 secondes. Le chrono part en entrant dans la zone.',
    goal: { type: 'timedCount', kind: 'grind', count: 3, seconds: 40 },
    rewardXp: 1200,
    rewardText: 'Board Acier',
  },
  {
    id: 'gapFlip',
    zone: 'gap',
    title: 'Par-dessus',
    description: 'Reçois un flip (kickflip, heelflip...) au gap.',
    goal: { type: 'air', family: 'flip' },
    rewardXp: 600,
  },
  {
    id: 'stairsCombo',
    zone: 'stairs',
    title: 'Les marches',
    description: 'Valide un combo de 2 500 points à l’escalier.',
    goal: { type: 'combo', points: 2500 },
    rewardXp: 1200,
    rewardText: 'Board Escalier',
  },
  {
    id: 'ledgeGrind',
    zone: 'ledge',
    title: 'Ledge infini',
    description: 'Grinde 6 mètres d’un seul tenant sur le long ledge.',
    goal: { type: 'balance', kind: 'grind', meters: 6 },
    rewardXp: 800,
  },
  {
    id: 'quarterSpin',
    zone: 'quarter',
    title: 'Demi-tour',
    description: 'Reçois une rotation (180 ou plus) près du quarter.',
    goal: { type: 'air', family: 'spin' },
    rewardXp: 600,
  },
  {
    id: 'funboxTimed',
    zone: 'funbox',
    title: 'Contre la montre',
    description: 'Valide 4 000 points en 45 secondes. Le chrono part en entrant dans la zone.',
    goal: { type: 'timedScore', points: 4000, seconds: 45 },
    rewardXp: 1000,
  },
];

export function zoneById(id: string): ZoneDef | undefined {
  return ZONES.find((z) => z.id === id);
}
