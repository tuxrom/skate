import { FIXED_DT, INPUT } from '@/config/physics';
import { FlickRecognizer, type GestureSnapshot } from './FlickRecognizer';

/**
 * Actions de jeu abstraites. Le gameplay ne lit jamais une touche directement :
 * il lit des actions, quelle que soit la source (clavier, manette, tactile).
 */
export type ButtonAction = 'push' | 'ollie' | 'grab' | 'reset' | 'debug' | 'pause';

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
  /** Boutons maintenus. */
  held: ReadonlySet<ButtonAction>;
  /** Boutons pressés depuis le pas fixe précédent. */
  pressed: ReadonlySet<ButtonAction>;
}

/** Source d'input enfichable (clavier, manette, contrôles tactiles à l'étape 9). */
export interface InputSource {
  /** Écrit son état dans le snapshot en cours de construction. */
  sample(target: MutableSnapshot): void;
  dispose(): void;
}

export interface MutableSnapshot {
  move: { x: number; y: number };
  flick: { x: number; y: number };
  grab: { x: number; y: number };
  held: Set<ButtonAction>;
}

/**
 * Liaisons par code physique (KeyboardEvent.code) : la même touche fonctionne en AZERTY
 * et en QWERTY. KeyW/KeyA/KeyS/KeyD correspondent à Z/Q/S/D sur un clavier AZERTY.
 */
const KEY_BINDINGS: Readonly<Record<string, ButtonAction>> = {
  Space: 'ollie',
  KeyE: 'grab',
  ShiftLeft: 'push',
  ShiftRight: 'push',
  KeyR: 'reset',
  F3: 'debug',
  Backquote: 'debug',
  Escape: 'pause',
};

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
 * Souris : glisser bouton gauche maintenu déplace le stick droit autour du point d'appui.
 * Un glissé de INPUT.mouseStickRadiusPx met le stick en butée ; au-delà de mouseOriginFollow fois
 * ce rayon, l'origine suit la souris pour qu'un retour en arrière réponde sans course morte.
 * Relâcher le bouton ramène le stick au centre.
 */
export class MouseFlickSource implements InputSource {
  private active = false;
  private originX = 0;
  private originY = 0;
  private readonly stick = { x: 0, y: 0 };
  /** Bouton droit : grab, la direction du glissé choisit le grab. */
  private grabbing = false;
  private grabOriginX = 0;
  private grabOriginY = 0;
  private readonly grabStick = { x: 0, y: 0 };

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  sample(s: MutableSnapshot): void {
    if (this.grabbing) {
      s.held.add('grab');
      s.grab.x = clampUnit(s.grab.x + this.grabStick.x);
      s.grab.y = clampUnit(s.grab.y + this.grabStick.y);
    }
    if (!this.active) return;
    s.flick.x = clampUnit(s.flick.x + this.stick.x);
    s.flick.y = clampUnit(s.flick.y + this.stick.y);
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
    if (this.grabbing) {
      const gx = e.clientX - this.grabOriginX;
      const gy = e.clientY - this.grabOriginY;
      const gl = Math.hypot(gx, gy) || 1;
      const gr = Math.min(1, gl / INPUT.mouseStickRadiusPx);
      this.grabStick.x = (gx / gl) * gr;
      this.grabStick.y = (-gy / gl) * gr;
    }
    if (!this.active) return;
    const radius = INPUT.mouseStickRadiusPx;
    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const len = Math.hypot(dx, dy);
    const follow = radius * INPUT.mouseOriginFollow;
    if (len > follow) {
      // L'origine glisse vers la souris : la course au-delà de la butée reste bornée.
      this.originX += (dx * (len - follow)) / len;
      this.originY += (dy * (len - follow)) / len;
      dx = e.clientX - this.originX;
      dy = e.clientY - this.originY;
    }
    const r = Math.min(1, Math.hypot(dx, dy) / radius);
    const d = Math.hypot(dx, dy) || 1;
    this.stick.x = (dx / d) * r;
    this.stick.y = (-dy / d) * r;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    this.syncButtons(e);
  };

  /** Démarre ou arrête flick (bouton gauche) et grab (bouton droit) selon les boutons tenus. */
  private syncButtons(e: PointerEvent): void {
    const left = (e.buttons & 1) !== 0;
    const right = (e.buttons & 2) !== 0;
    if (left && !this.active) {
      this.active = true;
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stick.x = this.stick.y = 0;
    } else if (!left && this.active) {
      this.active = false;
      this.stick.x = this.stick.y = 0;
    }
    if (right && !this.grabbing) {
      this.grabbing = true;
      this.grabOriginX = e.clientX;
      this.grabOriginY = e.clientY;
      this.grabStick.x = this.grabStick.y = 0;
    } else if (!right && this.grabbing) {
      this.grabbing = false;
      this.grabStick.x = this.grabStick.y = 0;
    }
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
  [8, 'reset'], // Select / Share
  [9, 'pause'], // Start / Options
];

/**
 * Manette : stick gauche pour la direction, stick droit pour le flick (ollie : bas puis haut).
 * Lit toutes les manettes branchées ; la zone morte est appliquée par Input.
 */
export class GamepadSource implements InputSource {
  sample(s: MutableSnapshot): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected || pad.axes.length < 4) continue;
      s.move.x = clampUnit(s.move.x + (pad.axes[0] ?? 0));
      s.move.y = clampUnit(s.move.y - (pad.axes[1] ?? 0));
      // Gâchette de grab tenue : le stick droit choisit le grab au lieu de flicker.
      const grabbing = !!(pad.buttons[6]?.pressed || pad.buttons[7]?.pressed);
      const target = grabbing ? s.grab : s.flick;
      target.x = clampUnit(target.x + (pad.axes[2] ?? 0));
      target.y = clampUnit(target.y - (pad.axes[3] ?? 0));
      for (const [index, action] of PAD_BUTTONS) if (pad.buttons[index]?.pressed) s.held.add(action);
    }
  }

  dispose(): void {}
}

/** Agrège les sources, analyse le geste du stick droit et produit un snapshot par pas fixe. */
export class Input {
  readonly flickRecognizer = new FlickRecognizer();
  private readonly sources: InputSource[] = [];
  private readonly previousHeld = new Set<ButtonAction>();
  private readonly building: MutableSnapshot = { move: { x: 0, y: 0 }, flick: { x: 0, y: 0 }, grab: { x: 0, y: 0 }, held: new Set() };
  private readonly snapshot: InputSnapshot = {
    move: { x: 0, y: 0 },
    flick: { x: 0, y: 0 },
    gesture: this.flickRecognizer.snapshot,
    grab: { x: 0, y: 0 },
    held: new Set(),
    pressed: new Set(),
  };

  addSource(source: InputSource): void {
    this.sources.push(source);
  }

  /** À appeler une fois au début de chaque pas fixe. */
  poll(): InputSnapshot {
    const b = this.building;
    b.move.x = b.move.y = b.flick.x = b.flick.y = b.grab.x = b.grab.y = 0;
    b.held.clear();
    for (const src of this.sources) src.sample(b);

    const pressed = this.snapshot.pressed as Set<ButtonAction>;
    pressed.clear();
    for (const a of b.held) if (!this.previousHeld.has(a)) pressed.add(a);

    applyStick(b.move, this.snapshot.move);
    applyStick(b.flick, this.snapshot.flick);
    applyStick(b.grab, this.snapshot.grab);
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
