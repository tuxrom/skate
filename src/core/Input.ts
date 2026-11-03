import { INPUT } from '@/config/physics';

/**
 * Actions de jeu abstraites. Le gameplay ne lit jamais une touche directement :
 * il lit des actions, quelle que soit la source (clavier, manette, tactile).
 */
export type ButtonAction = 'push' | 'brake' | 'grabLeft' | 'grabRight' | 'reset' | 'debug' | 'pause';

export interface InputSnapshot {
  /** Stick gauche : direction / équilibre. x vers la droite, y vers l'avant, dans [-1, 1]. */
  move: { x: number; y: number };
  /** Stick droit : flick de la planche (style Skate). */
  flick: { x: number; y: number };
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
  held: Set<ButtonAction>;
}

const KEY_BINDINGS: Readonly<Record<string, ButtonAction>> = {
  Space: 'push',
  ShiftLeft: 'brake',
  KeyQ: 'grabLeft',
  KeyE: 'grabRight',
  KeyR: 'reset',
  F3: 'debug',
  Backquote: 'debug',
  Escape: 'pause',
};

/** Clavier : WASD pour le stick gauche, flèches pour le stick droit. */
export class KeyboardSource implements InputSource {
  private readonly down = new Set<string>();
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
    s.flick.x += axis('ArrowLeft', 'ArrowRight');
    s.flick.y += axis('ArrowDown', 'ArrowUp');
    for (const code of this.down) this.addAction(s, code);
    for (const code of this.tapped) this.addAction(s, code);
    this.tapped.clear();
  }

  private addAction(s: MutableSnapshot, code: string): void {
    const action = KEY_BINDINGS[code];
    if (action) s.held.add(action);
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'F3') e.preventDefault();
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
  };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

/** Agrège les sources et produit un snapshot par pas fixe. */
export class Input {
  private readonly sources: InputSource[] = [];
  private previousHeld = new Set<ButtonAction>();
  private readonly building: MutableSnapshot = { move: { x: 0, y: 0 }, flick: { x: 0, y: 0 }, held: new Set() };
  private readonly snapshot: InputSnapshot = {
    move: { x: 0, y: 0 },
    flick: { x: 0, y: 0 },
    held: new Set(),
    pressed: new Set(),
  };

  addSource(source: InputSource): void {
    this.sources.push(source);
  }

  /** À appeler une fois au début de chaque pas fixe. */
  poll(): InputSnapshot {
    const b = this.building;
    b.move.x = b.move.y = b.flick.x = b.flick.y = 0;
    b.held.clear();
    for (const src of this.sources) src.sample(b);

    const pressed = this.snapshot.pressed as Set<ButtonAction>;
    pressed.clear();
    for (const a of b.held) if (!this.previousHeld.has(a)) pressed.add(a);

    applyStick(b.move, this.snapshot.move);
    applyStick(b.flick, this.snapshot.flick);
    const held = this.snapshot.held as Set<ButtonAction>;
    held.clear();
    for (const a of b.held) held.add(a);

    this.previousHeld = new Set(b.held);
    return this.snapshot;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
  }
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
