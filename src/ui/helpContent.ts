import type { PadFamily } from '@/core/Input';
import type { TrickId } from '@/skater/tricks';

/** Libellés des boutons selon la disposition de la manette. */
export interface PadLabels {
  a: string;
  b: string;
  lb: string;
  rb: string;
  lt: string;
  rt: string;
  select: string;
  start: string;
}

export const PAD_LABELS: Readonly<Record<PadFamily, PadLabels>> = {
  xbox: { a: 'A', b: 'B', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'View', start: 'Menu' },
  playstation: { a: 'Croix', b: 'Rond', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', select: 'Share', start: 'Options' },
};

export interface Binding {
  action: string;
  keys: string[];
}

export const KEYBOARD_BINDINGS: readonly Binding[] = [
  { action: 'Direction, frein, groupé', keys: ['Z Q S D', 'W A S D'] },
  { action: 'Flicks (pieds)', keys: ['Glisser clic gauche', 'Flèches'] },
  { action: 'Ollie', keys: ['Espace tenu puis relâché'] },
  { action: 'Pousser, accélérer', keys: ['Shift'] },
  { action: 'Grab', keys: ['E tenu + flèche', 'Clic droit + glisser'] },
  { action: 'Manual, nose manual', keys: ['Ctrl ou C tenu', '↑ / ↓ pour l’équilibre'] },
  { action: 'Choix du grind', keys: ['S tenu : 5-0', 'Z / W tenu : nosegrind, lipslide'] },
  { action: 'Se relever, retour au départ', keys: ['R'] },
  { action: 'Menu, retour', keys: ['Échap'] },
];

export function padBindings(l: PadLabels): Binding[] {
  return [
    { action: 'Direction, frein, groupé', keys: ['Stick gauche'] },
    { action: 'Flicks (pieds)', keys: ['Stick droit'] },
    { action: 'Ollie', keys: ['Stick droit : bas puis haut'] },
    { action: 'Pousser, accélérer', keys: [l.a] },
    { action: 'Grab', keys: [`${l.lt} / ${l.rt} tenue + stick droit`] },
    { action: 'Manual', keys: [`${l.lb} / ${l.rb} tenue`, 'équilibre au stick gauche'] },
    { action: 'Choix du grind', keys: [`${l.lb} tenue : 5-0`, `${l.rb} tenue : nosegrind, lipslide`] },
    { action: 'Se relever, retour au départ', keys: [l.select] },
    { action: 'Menu, retour', keys: [l.start, `${l.b} dans les menus`] },
  ];
}

/** Geste du stick droit : suite d'angles (degrés, 0 à droite, 90 en haut) parcourue après la charge en bas. */
interface GestureDef {
  trick: TrickId;
  name: string;
  hint: string;
  /** Points du chemin : angle et rayon (0 au centre, 1 au bord). */
  path: ReadonlyArray<readonly [number, number]>;
}

const arc = (from: number, to: number, steps = 16): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) pts.push([from + ((to - from) * i) / steps, 1]);
  return pts;
};

export const GESTURES: readonly GestureDef[] = [
  { trick: 'ollie', name: 'Ollie', hint: 'trait vers le haut', path: [[-90, 1], [-90, 0], [90, 1]] },
  { trick: 'kickflip', name: 'Kickflip', hint: 'trait haut-gauche', path: [[-90, 1], [-90, 0], [135, 1]] },
  { trick: 'heelflip', name: 'Heelflip', hint: 'trait haut-droite', path: [[-90, 1], [-90, 0], [45, 1]] },
  { trick: 'popShoveIt', name: 'Pop shove-it', hint: 'demi-cercle par un côté', path: arc(-90, 90) },
  { trick: 'treFlip', name: '360 flip', hint: 'cercle complet', path: arc(-90, 262, 28) },
  { trick: 'varialFlip', name: 'Varial flip', hint: '225° par la droite', path: arc(-90, 135, 20) },
  { trick: 'hardflip', name: 'Hardflip', hint: '225° par la gauche', path: arc(-90, -315, 20) },
];

/** Schéma SVG d'un geste : cercle du stick, zone de charge en bas, chemin fléché. */
export function gestureSvg(g: GestureDef): string {
  const c = 50;
  const r = 36;
  const pt = ([a, rad]: readonly [number, number]) => {
    const t = (a * Math.PI) / 180;
    return `${(c + Math.cos(t) * r * rad).toFixed(1)},${(c - Math.sin(t) * r * rad).toFixed(1)}`;
  };
  const d = g.path.map((p, i) => `${i === 0 ? 'M' : 'L'}${pt(p)}`).join(' ');
  const id = `ah-${g.trick}`;
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${g.name} : ${g.hint}">
  <defs><marker id="${id}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#f4d35e"/></marker></defs>
  <circle cx="${c}" cy="${c}" r="${r}" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.5}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-dasharray="3 3"/>
  <path d="M${pt([-130, 1])} A${r},${r} 0 0,0 ${pt([-50, 1])}" fill="none" stroke="rgba(244,211,94,0.35)" stroke-width="9" stroke-linecap="round"/>
  <path d="${d}" fill="none" stroke="#f4d35e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${id})"/>
  <circle cx="${pt([-90, 1]).split(',')[0]}" cy="${pt([-90, 1]).split(',')[1]}" r="5" fill="#fff"/>
</svg>`;
}
