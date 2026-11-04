import { FIXED_DT, INPUT } from '@/config/physics';
import { FlickRecognizer, type GestureSnapshot } from './FlickRecognizer';

/**
 * Actions de jeu abstraites. Le gameplay ne lit jamais une touche directement :
 * il lit des actions, quelle que soit la source (clavier, manette, tactile).
 */
export type ButtonAction = 'push' | 'ollie' | 'grab' | 'manual' | 'reset' | 'debug' | 'pause';

export interface InputSnapshot {
  /**
   * Stick gauche : direction. x vers la droite (inclinaison), y vers l'avant (groupé)
   * ou l'arrière (frein), dans [-1, 1].
   */
  move: { x: number; y: number };
  /** Stick droit : les pieds du skateur. x vers la droite, y vers le haut, dans [-1, 1]. */
  flick: { x: number; y: number };
  /** Geste du stick droit analysé par FlickRecognizer, quel que soit le périphérique. */
  gesture: GestureSnapshot;
  /**
   * Direction de grab, tenue avec le bouton de grab : haut = nose, bas = tail,
   * droite = côté orteils, gauche = côté talons. Distincte du stick de flick pour qu'un
   * tailgrab ne lance jamais une charge d'ollie.
   */
  grab: { x: number; y: number };
  /** Équilibre du manual, -1 à 1 (vers l'avant positif) : flèches haut/bas avec la touche de manual, stick gauche avec LB/RB. */
  manualAxis: number;
  /**
   * Choix du grind à l'accrochage, ajouté au stick gauche avant/arrière : -1 = 5-0 (LB / L1),
   * +1 = nosegrind ou lipslide (RB / R1), 0 = 50-50 ou boardslide.
   */
  grindSelect: number;
  /** Boutons maintenus. */
  held: ReadonlySet<ButtonAction>;
  /** Boutons pressés depuis le pas fixe précédent. */
  pressed: ReadonlySet<ButtonAction>;
}

/** Source d'input enfichable (clavier, souris, manette, contrôles tactiles). */
export interface InputSource {
  /** Écrit son état dans le snapshot en cours de construction. */
  sample(target: MutableSnapshot): void;
  dispose(): void;
}

export interface MutableSnapshot {
  move: { x: number; y: number };
  flick: { x: number; y: number };
  grab: { x: number; y: number };
  manualAxis: number;
  grindSelect: number;
  held: Set<ButtonAction>;
}

/**
 * Liaisons par code physique (KeyboardEvent.code) : la même touche fonctionne en AZERTY
 * et en QWERTY. KeyW/KeyA/KeyS/KeyD correspondent à Z/Q/S/D sur un clavier AZERTY.
 */
const KEY_BINDINGS: Readonly<Record<string, ButtonAction>> = {
  Space: 'ollie',
  KeyE: 'grab',
  // Manual : Ctrl demandé ; C en alternative, car Ctrl+W ferme l'onglet sans que la page puisse l'empêcher.
  ControlLeft: 'manual',
  ControlRight: 'manual',
  KeyC: 'manual',
  ShiftLeft: 'push',
  ShiftRight: 'push',
  KeyR: 'reset',
  F3: 'debug',
  Backquote: 'debug',
  Escape: 'pause',
};

/** Codes utilisés en jeu, pour neutraliser les raccourcis Ctrl+touche que le navigateur laisse bloquer. */
const GAME_KEYS: Readonly<Record<string, true>> = { KeyW: true, KeyA: true, KeyS: true, KeyD: true, KeyE: true, KeyR: true, Space: true };

/**
 * Clavier : ZQSD/WASD pour le stick gauche, flèches pour le stick droit en repli.
 * E tenu fait passer les flèches en direction de grab.
 * Les flèches donnent une cible ; le stick y glisse avec INPUT.keyStickResponse, ce qui
 * transforme une suite de flèches en trajectoire continue (trait ou arc).
 */
export class KeyboardSource implements InputSource {
  private readonly down = new Set<string>();
  private readonly stick = { x: 0, y: 0 };
  /** Touches enfoncées depuis le dernier sample, conservées même si déjà relâchées (tap court). */
  private readonly tapped = new Set<string>();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  sample(s: MutableSnapshot): void {
    const axis = (neg: string, pos: string) => (this.down.has(pos) ? 1 : 0) - (this.down.has(neg) ? 1 : 0);
    s.move.x += axis('KeyA', 'KeyD');
    s.move.y += axis('KeyS', 'KeyW');
    let tx = axis('ArrowLeft', 'ArrowRight');
    let ty = axis('ArrowDown', 'ArrowUp');
    const len = Math.hypot(tx, ty);
    if (len > 1) {
      tx /= len;
      ty /= len;
    }
    if (this.down.has('KeyE')) {
      s.grab.x = clampUnit(s.grab.x + tx);
      s.grab.y = clampUnit(s.grab.y + ty);
      tx = ty = 0;
    } else if (this.down.has('ControlLeft') || this.down.has('ControlRight') || this.down.has('KeyC')) {
      // Touche de manual tenue : haut/bas règlent l'équilibre au lieu de flicker.
      s.manualAxis = clampUnit(s.manualAxis + ty);
      tx = ty = 0;
    }
    const k = 1 - Math.exp(-INPUT.keyStickResponse * FIXED_DT);
    const cr = Math.hypot(this.stick.x, this.stick.y);
    const tr = Math.hypot(tx, ty);
    let turn = Infinity;
    if (cr > INPUT.keyStickArcMinRadius && tr > 0.5) {
      turn = Math.atan2(ty, tx) - Math.atan2(this.stick.y, this.stick.x);
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    }
    if (Math.abs(turn) <= INPUT.keyStickArcMaxAngle) {
      // Directions voisines : on tourne le long du bord (arc).
      const a = Math.atan2(this.stick.y, this.stick.x) + turn * k;
      const r = cr + (tr - cr) * k;
      this.stick.x = Math.cos(a) * r;
      this.stick.y = Math.sin(a) * r;
    } else {
      this.stick.x += (tx - this.stick.x) * k;
      this.stick.y += (ty - this.stick.y) * k;
    }
    s.flick.x = clampUnit(s.flick.x + this.stick.x);
    s.flick.y = clampUnit(s.flick.y + this.stick.y);
    for (const code of this.down) this.addAction(s, code);
    for (const code of this.tapped) this.addAction(s, code);
    this.tapped.clear();
  }

  private addAction(s: MutableSnapshot, code: string): void {
    const action = KEY_BINDINGS[code];
    if (action) s.held.add(action);
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'F3' || e.code === 'Tab') e.preventDefault();
    // Raccourcis navigateur qu'une page peut bloquer (Ctrl+S, Ctrl+D, Ctrl+R...) pendant un manual.
    if (e.ctrlKey && e.code in GAME_KEYS) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.tapped.add(e.code);
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
    this.tapped.clear();
    this.stick.x = this.stick.y = 0;
  };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

/**
 * Stick virtuel au glissé, commun à la souris et au tactile : le déplacement depuis le point d'appui
 * donne la direction et l'amplitude. Un glissé de `radius` met le stick en butée ; au-delà de
 * `follow` fois ce rayon, l'origine suit le doigt ou la souris, pour qu'un retour en arrière réponde
 * sans course morte. Coordonnées écran (px CSS, y vers le bas), stick en repère y vers le haut.
 */
export class DragStick {
  /** Vrai du premier appui jusqu'à la dernière lecture après le relâchement. */
  active = false;
  originX = 0;
  originY = 0;
  /** Position du stick, dans le disque unité. */
  readonly value = { x: 0, y: 0 };
  /**
   * Relâché, mais la dernière position n'a pas encore été lue. Un flick vif peut finir dans la même image
   * que le relâchement : sans ce délai d'une lecture, la reconnaissance verrait le stick sauter au centre
   * sans jamais atteindre la sortie du geste.
   */
  private releasing = false;

  constructor(
    /** Rayon de butée (px CSS), relu à chaque déplacement (sensibilité réglable). */
    private readonly radius: () => number,
    private readonly follow: number,
  ) {}

  /** Doigt ou bouton encore posé (faux dès le relâchement, même avant la dernière lecture). */
  get isDown(): boolean {
    return this.active && !this.releasing;
  }

  start(x: number, y: number): void {
    this.active = true;
    this.releasing = false;
    this.originX = x;
    this.originY = y;
    this.value.x = this.value.y = 0;
  }

  move(x: number, y: number): void {
    if (!this.isDown) return;
    const radius = Math.max(1, this.radius());
    let dx = x - this.originX;
    let dy = y - this.originY;
    const len = Math.hypot(dx, dy);
    const follow = radius * this.follow;
    if (len > follow) {
      // L'origine glisse vers le point : la course au-delà de la butée reste bornée.
      this.originX += (dx * (len - follow)) / len;
      this.originY += (dy * (len - follow)) / len;
      dx = x - this.originX;
      dy = y - this.originY;
    }
    const d = Math.hypot(dx, dy) || 1;
    const r = Math.min(1, d / radius);
    this.value.x = (dx / d) * r;
    this.value.y = (-dy / d) * r;
  }

  /** Relâchement : la position reste lisible une fois, puis le stick revient au centre. */
  end(): void {
    if (this.active) this.releasing = true;
  }

  /** Relâchement immédiat, sans dernière lecture (menu ouvert, perte de focus). */
  reset(): void {
    this.active = this.releasing = false;
    this.value.x = this.value.y = 0;
  }

  /** Lit la position (à chaque pas fixe) ; après un relâchement, cette lecture est la dernière. */
  read(): { readonly x: number; readonly y: number } {
    if (this.releasing) {
      this.releasing = false;
      this.active = false;
      this.readout.x = this.value.x;
      this.readout.y = this.value.y;
      this.value.x = this.value.y = 0;
      return this.readout;
    }
    return this.value;
  }
  private readonly readout = { x: 0, y: 0 };

  /** Ajoute la position du stick à `target` (si actif), borné à [-1, 1]. */
  addTo(target: { x: number; y: number }): void {
    if (!this.active) return;
    const v = this.read();
    target.x = clampUnit(target.x + v.x);
    target.y = clampUnit(target.y + v.y);
  }
}

/**
 * Souris : glisser bouton gauche maintenu déplace le stick droit autour du point d'appui (DragStick,
 * rayon INPUT.mouseStickRadiusPx / sensibilité). Bouton droit tenu : grab, le glissé choisit le grab.
 * Relâcher le bouton ramène le stick au centre.
 */
export class MouseFlickSource implements InputSource {
  /** Sensibilité (réglages) : un glissé de mouseStickRadiusPx / sensitivity met le stick en butée. */
  sensitivity = 1;
  private readonly flick = new DragStick(() => INPUT.mouseStickRadiusPx / this.sensitivity, INPUT.mouseOriginFollow);
  private readonly grab = new DragStick(() => INPUT.mouseStickRadiusPx / this.sensitivity, INPUT.mouseOriginFollow);

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  sample(s: MutableSnapshot): void {
    if (this.grab.active) {
      s.held.add('grab');
      this.grab.addTo(s.grab);
    }
    this.flick.addTo(s.flick);
  }

  /**
   * Avec les Pointer Events, un deuxième bouton pressé ou relâché pendant qu'un autre est tenu
   * arrive en pointermove : on suit donc l'état des boutons (e.buttons) à chaque événement.
   */
  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    this.element.setPointerCapture(e.pointerId);
    this.syncButtons(e);
    e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    this.syncButtons(e);
    this.grab.move(e.clientX, e.clientY);
    this.flick.move(e.clientX, e.clientY);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    this.syncButtons(e);
  };

  /** Démarre ou arrête flick (bouton gauche) et grab (bouton droit) selon les boutons tenus. */
  private syncButtons(e: PointerEvent): void {
    const left = (e.buttons & 1) !== 0;
    const right = (e.buttons & 2) !== 0;
    if (left && !this.flick.isDown) this.flick.start(e.clientX, e.clientY);
    else if (!left && this.flick.isDown) this.flick.end();
    if (right && !this.grab.isDown) this.grab.start(e.clientX, e.clientY);
    else if (!right && this.grab.isDown) this.grab.end();
  }

  private readonly onContextMenu = (e: Event): void => e.preventDefault();

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup', this.onUp);
    this.element.removeEventListener('pointercancel', this.onUp);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }
}

/** Boutons de la disposition standard des manettes (Gamepad API, mapping « standard »). */
const PAD_BUTTONS: ReadonlyArray<readonly [number, ButtonAction]> = [
  [0, 'push'], // A / Croix
  [6, 'grab'], // LT / L2
  [7, 'grab'], // RT / R2
  [4, 'manual'], // LB / L1
  [5, 'manual'], // RB / R1
  [8, 'reset'], // Select / Share
  [9, 'pause'], // Start / Options
];

/** Disposition des boutons, pour les libellés (les indices du mapping standard sont les mêmes). */
export type PadFamily = 'xbox' | 'playstation';

/** Reconnaît une manette PlayStation à son identifiant (nom ou identifiant de fabricant Sony 054c). */
export function detectPadFamily(id: string): PadFamily {
  return /054c|playstation|dualshock|dualsense|sony/i.test(id) ? 'playstation' : 'xbox';
}

/**
 * Manette (Gamepad API, mapping standard, dispositions Xbox et PlayStation) : stick gauche pour la direction,
 * stick droit pour le flick (ollie : bas puis haut), gâchettes LT/RT (L2/R2) pour les grabs (le stick droit
 * choisit le grab), gâchettes hautes LB/RB (L1/R1) pour le manual et le choix du grind (LB 5-0, RB nosegrind).
 * Lit toutes les manettes branchées ; la zone morte est appliquée par Input.
 */
export class GamepadSource implements InputSource {
  /** Identifiant de la dernière manette active, pour adapter les libellés. */
  lastPadId = '';
  /** Vrai si une manette a servi pendant le dernier pas (bouton ou stick franchement poussé). */
  activeThisStep = false;

  sample(s: MutableSnapshot): void {
    this.activeThisStep = false;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected || pad.axes.length < 4) continue;
      const used = pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.5);
      if (used) {
        this.activeThisStep = true;
        if (pad.id !== this.lastPadId) this.lastPadId = pad.id;
      }
      s.move.x = clampUnit(s.move.x + (pad.axes[0] ?? 0));
      s.move.y = clampUnit(s.move.y - (pad.axes[1] ?? 0));
      // Gâchette de grab tenue : le stick droit choisit le grab au lieu de flicker.
      const grabbing = !!(pad.buttons[6]?.pressed || pad.buttons[7]?.pressed);
      const target = grabbing ? s.grab : s.flick;
      target.x = clampUnit(target.x + (pad.axes[2] ?? 0));
      target.y = clampUnit(target.y - (pad.axes[3] ?? 0));
      for (const [index, action] of PAD_BUTTONS) if (pad.buttons[index]?.pressed) s.held.add(action);
      // Gâchette haute de manual tenue : le stick gauche avant/arrière règle l'équilibre.
      if (pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) s.manualAxis = clampUnit(s.manualAxis - (pad.axes[1] ?? 0));
      s.grindSelect = clampUnit(s.grindSelect + (pad.buttons[5]?.pressed ? 1 : 0) - (pad.buttons[4]?.pressed ? 1 : 0));
    }
  }

  dispose(): void {}
}

/** Agrège les sources, analyse le geste du stick droit et produit un snapshot par pas fixe. */
export class Input {
  readonly flickRecognizer = new FlickRecognizer();
  private readonly sources: InputSource[] = [];
  private readonly previousHeld = new Set<ButtonAction>();
  private readonly building: MutableSnapshot = { move: { x: 0, y: 0 }, flick: { x: 0, y: 0 }, grab: { x: 0, y: 0 }, manualAxis: 0, grindSelect: 0, held: new Set() };
  /** Boutons ignorés jusqu'à leur relâchement (tenus à la fermeture d'un menu). */
  private readonly masked = new Set<ButtonAction>();
  private maskNext = false;
  private readonly snapshot: InputSnapshot = {
    move: { x: 0, y: 0 },
    flick: { x: 0, y: 0 },
    gesture: this.flickRecognizer.snapshot,
    grab: { x: 0, y: 0 },
    manualAxis: 0,
    grindSelect: 0,
    held: new Set(),
    pressed: new Set(),
  };

  /**
   * Ignore les boutons tenus au prochain pas jusqu'à ce qu'ils soient relâchés : la touche ou le bouton
   * qui ferme un menu (Espace, A) ne déclenche pas d'action en jeu.
   */
  suppressHeld(): void {
    this.maskNext = true;
  }

  addSource(source: InputSource): void {
    this.sources.push(source);
  }

  /** À appeler une fois au début de chaque pas fixe. */
  poll(): InputSnapshot {
    const b = this.building;
    b.move.x = b.move.y = b.flick.x = b.flick.y = b.grab.x = b.grab.y = b.manualAxis = b.grindSelect = 0;
    b.held.clear();
    for (const src of this.sources) src.sample(b);
    if (this.maskNext) {
      this.maskNext = false;
      for (const a of b.held) if (a !== 'pause' && a !== 'debug') this.masked.add(a);
    }
    for (const a of this.masked) {
      if (b.held.has(a)) b.held.delete(a);
      else this.masked.delete(a);
    }

    const pressed = this.snapshot.pressed as Set<ButtonAction>;
    pressed.clear();
    for (const a of b.held) if (!this.previousHeld.has(a)) pressed.add(a);

    applyStick(b.move, this.snapshot.move);
    applyStick(b.flick, this.snapshot.flick);
    applyStick(b.grab, this.snapshot.grab);
    this.snapshot.manualAxis = b.manualAxis;
    this.snapshot.grindSelect = b.grindSelect;
    this.flickRecognizer.update(this.snapshot.flick.x, this.snapshot.flick.y);
    const held = this.snapshot.held as Set<ButtonAction>;
    held.clear();
    for (const a of b.held) held.add(a);

    this.previousHeld.clear();
    for (const a of b.held) this.previousHeld.add(a);
    return this.snapshot;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
  }
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Borne le stick au disque unité et applique une zone morte radiale rééchelonnée. */
function applyStick(src: { x: number; y: number }, out: { x: number; y: number }): void {
  const len = Math.hypot(src.x, src.y);
  const dz = INPUT.stickDeadzone;
  if (len <= dz) {
    out.x = out.y = 0;
    return;
  }
  const scaled = Math.min(1, (len - dz) / (1 - dz)) / len;
  out.x = src.x * scaled;
  out.y = src.y * scaled;
}
