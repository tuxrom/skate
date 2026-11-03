/**
 * Identifiants des états du skateur, implémentés au fil des étapes :
 * riding/pushing/braking (1), popCharge/pop/air/landing (2), grind/manual (5), bail (6).
 * Les flips (3), grabs et rotations (4) ne sont pas des états : ce sont des couches du vol gérées
 * par Skater pendant l'état air.
 */
export type SkaterStateId =
  | 'idle'
  | 'riding'
  | 'pushing'
  | 'braking'
  | 'popCharge'
  | 'pop'
  | 'air'
  | 'grind'
  | 'manual'
  | 'landing'
  | 'bail';
