/**
 * Identifiants des états du skateur, implémentés au fil des étapes :
 * riding/pushing/braking (1), air (2), flip (3), grab (4), grind/manual (5), bail (6).
 */
export type SkaterStateId =
  | 'idle'
  | 'riding'
  | 'pushing'
  | 'braking'
  | 'popCharge'
  | 'air'
  | 'flip'
  | 'grab'
  | 'grind'
  | 'manual'
  | 'landing'
  | 'bail';
