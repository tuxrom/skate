import { FIXED_DT, INPUT } from '@/config/physics';
import { TOUCH, type TouchButtonId, type TouchButtonLayout } from '@/config/render';
import { DragStick, type ButtonAction, type InputSource, type MutableSnapshot } from '@/core/Input';
import { TOUCH_BUTTON_IDS, defaultTouchLayout, type TouchMode } from '@/save/SaveData';
import { detectTouchDevice } from '@/platform/device';

/** Libellés courts des boutons. */
const LABELS: Readonly<Record<TouchButtonId, string>> = {
  push: 'Pousser',
  grab: 'Grab',
  manual: 'Manual',
  grind: 'Grind',
  reset: '↺',
  pause: '❚❚',
};
const NAMES: Readonly<Record<TouchButtonId, string>> = {
  push: 'Pousser',
  grab: 'Grab',
  manual: 'Manual',
  grind: 'Grind (nosegrind, lipslide)',
  reset: 'Se relever, retour au départ',
  pause: 'Pause',
};
/** Action tenue par chaque bouton (grind et les autres sont traités à part). */
const HELD_ACTION: Partial<Record<TouchButtonId, ButtonAction>> = { push: 'push', grab: 'grab', manual: 'manual' };
/** Pas de taille de l'éditeur. */
const SIZE_STEP = 0.1;

type Role = 'joystick' | 'swipe' | TouchButtonId | 'drag';

interface Button {
  readonly id: TouchButtonId;
  readonly el: HTMLDivElement;
  /** Nombre de doigts posés dessus. */
  pressedBy: number;
  /** Appui vu depuis le dernier pas, conservé même si déjà relâché (tap court). */
  tapped: boolean;
}

/**
 * Contrôles tactiles, une InputSource de plus :
 * - moitié gauche : joystick flottant, qui apparaît sous le pouce et le suit (direction ; poussé à fond vers
 *   l'avant, il pousse) ;
 * - moitié droite : zone de swipe, un DragStick (le même que la souris) qui alimente le stick de flick, donc
 *   la même reconnaissance des gestes ; avec Grab tenu, il choisit le grab ;
 * - boutons : pousser, grab, manual, grind, reset, pause, placés et dimensionnés selon les réglages.
 * Chaque doigt est suivi par son identifiant de pointeur, capturé à l'appui : joystick, swipe et boutons
 * fonctionnent ensemble ; pointercancel et la perte de capture relâchent proprement.
 */
export class TouchControls implements InputSource {
  /** Contrôles tactiles affichés (détection automatique ou réglage). */
  touchMode = false;
  /** Appelé quand le mode tactile change. */
  onModeChange: (on: boolean) => void = () => {};
  /** Sensibilité du glissé (réglage commun avec la souris). */
  sensitivity = 1;

  private readonly layer: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly swipeRing: HTMLDivElement;
  private readonly swipeKnob: HTMLDivElement;
  private readonly hints: HTMLDivElement[] = [];
  private readonly buttons = new Map<TouchButtonId, Button>();
  private readonly roles = new Map<number, Role>();
  private readonly joystick = new DragStick(() => INPUT.touchJoystickRadiusPx, INPUT.touchJoystickFollow);
  private readonly swipe = new DragStick(() => INPUT.touchSwipeRadiusPx / this.sensitivity, INPUT.mouseOriginFollow);
  private readonly smoothed = { x: 0, y: 0 };
  private layout: Record<TouchButtonId, TouchButtonLayout> = defaultTouchLayout();
  private mode: TouchMode = 'auto';
  /** En jeu, aucun menu ouvert. */
  private active = false;
  private hintTimer: number = TOUCH.hintTime;
  private readonly safe = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly probe: HTMLDivElement;

  // Édition de la disposition.
  private editing = false;
  private selected: TouchButtonId = 'push';
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private readonly toolbar: HTMLDivElement;
  private readonly sizeLabel: HTMLSpanElement;
  private onLayoutChange: (layout: Record<TouchButtonId, TouchButtonLayout>) => void = () => {};
  private onEditDone: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.layer = div('touch-layer', parent);
    this.joyBase = div('touch-stick', this.layer);
    this.joyKnob = div('touch-knob', this.joyBase);
    this.swipeRing = div('touch-stick swipe', this.layer);
    this.swipeKnob = div('touch-knob', this.swipeRing);
    const hl = div('touch-hint left', this.layer);
    hl.textContent = 'Glisse ici : diriger';
    const hr = div('touch-hint right', this.layer);
    hr.textContent = 'Glisse ici : flicks (bas puis haut = ollie)';
    this.hints.push(hl, hr);
    for (const id of TOUCH_BUTTON_IDS) {
      const el = div(`touch-btn ${id}`, this.layer);
      el.dataset.touchBtn = id;
      el.textContent = LABELS[id];
      el.setAttribute('aria-label', NAMES[id]);
      this.buttons.set(id, { id, el, pressedBy: 0, tapped: false });
    }

    this.toolbar = div('touch-toolbar', this.layer);
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Fais glisser un bouton pour le déplacer. Touche-le pour régler sa taille.';
    this.sizeLabel = document.createElement('span');
    const minus = toolButton('−', () => this.resizeSelected(-SIZE_STEP));
    const plus = toolButton('+', () => this.resizeSelected(SIZE_STEP));
    const reset = toolButton('Réinitialiser', () => {
      this.layout = defaultTouchLayout();
      this.positionButtons();
      this.onLayoutChange(this.layout);
    });
    const done = toolButton('Terminé', () => this.stopEditing());
    done.classList.add('primary');
    const row = document.createElement('div');
    row.className = 'row';
    row.append(minus, this.sizeLabel, plus, reset, done);
    this.toolbar.append(title, row);

    // Lecture des safe areas (encoches, barre d'accueil) : marges env() d'un élément sonde.
    this.probe = div('touch-safe-probe', parent);

    this.layer.addEventListener('pointerdown', this.onDown);
    this.layer.addEventListener('pointermove', this.onMove);
    this.layer.addEventListener('pointerup', this.onUp);
    this.layer.addEventListener('pointercancel', this.onUp);
    this.layer.addEventListener('lostpointercapture', this.onUp);
    this.layer.addEventListener('contextmenu', prevent);
    window.addEventListener('pointerdown', this.onAnyPointer, true);
    window.addEventListener('pointermove', this.onAnyMouseMove, true);
    window.addEventListener('keydown', this.onAnyKey, true);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('blur', this.releaseAll);
    // Gestes du navigateur : pincer (Safari), double-tap, défilement élastique, appui long.
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('dblclick', prevent);
    document.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.onResize();
  }

  // ---------------------------------------------------------------------------
  // Réglages et état.

  /** Applique le mode (auto, toujours, jamais) et la disposition des réglages. */
  configure(mode: TouchMode, layout: Readonly<Record<TouchButtonId, TouchButtonLayout>>, sensitivity: number): void {
    this.mode = mode;
    this.sensitivity = sensitivity;
    for (const id of TOUCH_BUTTON_IDS) this.layout[id] = { ...layout[id] };
    this.positionButtons();
    if (mode === 'on') this.setTouchMode(true);
    else if (mode === 'off') this.setTouchMode(false);
    else if (!this.touchModeDecided) this.setTouchMode(detectTouchDevice());
  }

  /** En jeu sans menu : contrôles affichés et actifs. Sinon masqués, tous les doigts relâchés. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) this.releaseAll();
    this.refreshVisibility();
  }

  /** Une autre entrée (clavier, souris, manette) a servi : en mode auto, on repasse à l'interface PC. */
  noteOtherInput(): void {
    if (this.mode === 'auto' && !this.editing) this.setTouchMode(false);
  }

  /** Avance les indications au premier lancement (rendu). */
  update(frameDt: number): void {
    if (!this.active || !this.touchMode || this.hintTimer <= 0) return;
    this.hintTimer -= frameDt;
    if (this.hintTimer <= 0) for (const h of this.hints) h.classList.add('gone');
  }

  // ---------------------------------------------------------------------------
  // InputSource.

  sample(s: MutableSnapshot): void {
    const k = 1 - Math.exp(-INPUT.touchStickSmoothing * FIXED_DT);
    const joyDown = this.joystick.isDown;
    const target = this.joystick.read();
    this.smoothed.x += (target.x - this.smoothed.x) * k;
    this.smoothed.y += (target.y - this.smoothed.y) * k;
    if (!joyDown && Math.hypot(this.smoothed.x, this.smoothed.y) < 0.01) this.smoothed.x = this.smoothed.y = 0;
    s.move.x = clampUnit(s.move.x + this.smoothed.x);
    s.move.y = clampUnit(s.move.y + this.smoothed.y);
    if (joyDown && this.smoothed.y > INPUT.touchPushThreshold) s.held.add('push');

    const grab = this.buttons.get('grab')!;
    const grabbing = grab.pressedBy > 0 || grab.tapped;
    this.swipe.addTo(grabbing ? s.grab : s.flick);
    for (const b of this.buttons.values()) {
      const down = b.pressedBy > 0 || b.tapped;
      b.tapped = false;
      if (!down) continue;
      const action = HELD_ACTION[b.id];
      if (action) s.held.add(action);
      else if (b.id === 'grind') s.grindSelect = clampUnit(s.grindSelect + 1);
      else if (b.id === 'reset') s.held.add('reset');
      else if (b.id === 'pause') s.held.add('pause');
      if (b.id === 'manual') s.manualAxis = clampUnit(s.manualAxis + this.smoothed.y);
    }
  }

  // ---------------------------------------------------------------------------
  // Édition de la disposition.

  /** Mode édition : les boutons se déplacent au doigt (ou à la souris) ; Terminé rend la main. */
  startEditing(onChange: (layout: Record<TouchButtonId, TouchButtonLayout>) => void, onDone: () => void): void {
    this.releaseAll();
    this.editing = true;
    this.onLayoutChange = onChange;
    this.onEditDone = onDone;
    this.select(this.selected);
    this.refreshVisibility();
  }

  get isEditing(): boolean {
    return this.editing;
  }

  stopEditing(): void {
    if (!this.editing) return;
    this.editing = false;
    this.releaseAll();
    this.refreshVisibility();
    this.onEditDone();
  }

  private select(id: TouchButtonId): void {
    this.selected = id;
    for (const b of this.buttons.values()) b.el.classList.toggle('selected', b.id === id);
    this.sizeLabel.textContent = `${NAMES[id]} : ${Math.round(this.layout[id].size * 100)} %`;
  }

  private resizeSelected(delta: number): void {
    const l = this.layout[this.selected];
    l.size = Math.round(Math.min(TOUCH.sizeMax, Math.max(TOUCH.sizeMin, l.size + delta)) * 100) / 100;
    this.positionButtons();
    this.select(this.selected);
    this.onLayoutChange(this.layout);
  }

  // ---------------------------------------------------------------------------
  // Pointeurs.

  private readonly onDown = (e: PointerEvent): void => {
    if (this.editing) {
      this.editDown(e);
      return;
    }
    if (!this.active) return;
    e.preventDefault();
    const btnEl = (e.target as HTMLElement).closest<HTMLElement>('[data-touch-btn]');
    let role: Role | null = null;
    if (btnEl) {
      const b = this.buttons.get(btnEl.dataset.touchBtn as TouchButtonId);
      if (b) {
        b.pressedBy++;
        b.tapped = true;
        b.el.classList.add('held');
        role = b.id;
      }
    } else if (e.clientX < window.innerWidth / 2) {
      if (!this.joystick.isDown) {
        role = 'joystick';
        this.joystick.start(e.clientX, e.clientY);
        this.showStick(this.joyBase, this.joyKnob, this.joystick, INPUT.touchJoystickRadiusPx);
        this.hints[0]?.classList.add('gone');
      }
    } else if (!this.swipe.isDown) {
      role = 'swipe';
      this.swipe.start(e.clientX, e.clientY);
      this.showStick(this.swipeRing, this.swipeKnob, this.swipe, INPUT.touchSwipeRadiusPx / this.sensitivity);
      this.hints[1]?.classList.add('gone');
    }
    if (role === null) return;
    this.roles.set(e.pointerId, role);
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur déjà relâché : rien à capturer.
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const role = this.roles.get(e.pointerId);
    if (!role) return;
    e.preventDefault();
    if (role === 'drag') {
      this.editMove(e);
    } else if (role === 'joystick') {
      this.joystick.move(e.clientX, e.clientY);
      this.showStick(this.joyBase, this.joyKnob, this.joystick, INPUT.touchJoystickRadiusPx);
    } else if (role === 'swipe') {
      this.swipe.move(e.clientX, e.clientY);
      this.showStick(this.swipeRing, this.swipeKnob, this.swipe, INPUT.touchSwipeRadiusPx / this.sensitivity);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const role = this.roles.get(e.pointerId);
    if (!role) return;
    this.roles.delete(e.pointerId);
    this.release(role);
  };

  private release(role: Role): void {
    if (role === 'joystick') {
      this.joystick.end();
      this.joyBase.style.display = 'none';
    } else if (role === 'swipe') {
      this.swipe.end();
      this.swipeRing.style.display = 'none';
    } else if (role === 'drag') {
      this.onLayoutChange(this.layout);
    } else {
      const b = this.buttons.get(role);
      if (b) {
        b.pressedBy = Math.max(0, b.pressedBy - 1);
        if (b.pressedBy === 0) b.el.classList.remove('held');
      }
    }
  }

  /** Relâche tous les doigts (perte de focus, menu ouvert, changement de mode). */
  private readonly releaseAll = (): void => {
    for (const [id, role] of this.roles) {
      this.release(role);
      try {
        if (this.layer.hasPointerCapture(id)) this.layer.releasePointerCapture(id);
      } catch {
        // Pointeur inconnu du navigateur : déjà relâché.
      }
    }
    this.roles.clear();
    for (const b of this.buttons.values()) {
      b.pressedBy = 0;
      b.el.classList.remove('held');
    }
    this.joystick.reset();
    this.swipe.reset();
    this.joyBase.style.display = this.swipeRing.style.display = 'none';
  };

  private editDown(e: PointerEvent): void {
    const btnEl = (e.target as HTMLElement).closest<HTMLElement>('[data-touch-btn]');
    if (!btnEl) return;
    e.preventDefault();
    const id = btnEl.dataset.touchBtn as TouchButtonId;
    this.select(id);
    const r = btnEl.getBoundingClientRect();
    this.dragOffsetX = e.clientX - (r.left + r.width / 2);
    this.dragOffsetY = e.clientY - (r.top + r.height / 2);
    this.roles.set(e.pointerId, 'drag');
    this.layer.setPointerCapture(e.pointerId);
  }

  private editMove(e: PointerEvent): void {
    const area = this.area();
    const l = this.layout[this.selected];
    l.x = clamp01((e.clientX - this.dragOffsetX - area.left) / area.width);
    l.y = clamp01((e.clientY - this.dragOffsetY - area.top) / area.height);
    this.positionButtons();
  }

  // ---------------------------------------------------------------------------
  // Détection du mode tactile.

  /** Vrai dès qu'un doigt ou une autre entrée a tranché (le mode auto ne revient plus à la détection initiale). */
  private touchModeDecided = false;

  private readonly onAnyPointer = (e: PointerEvent): void => {
    if (this.mode !== 'auto') return;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.touchModeDecided = true;
      this.setTouchMode(true);
    } else if (e.pointerType === 'mouse') {
      this.touchModeDecided = true;
      this.noteOtherInput();
    }
  };

  /** Un vrai mouvement de souris (pas un événement émulé après un toucher) repasse en interface PC. */
  private readonly onAnyMouseMove = (e: PointerEvent): void => {
    if (this.mode !== 'auto' || e.pointerType !== 'mouse' || !this.touchMode) return;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
      this.touchModeDecided = true;
      this.noteOtherInput();
    }
  };

  private readonly onAnyKey = (e: KeyboardEvent): void => {
    if (this.mode !== 'auto' || !this.touchMode || e.repeat) return;
    // Touches de jeu ou de navigation : un clavier est utilisé.
    if (/^(Key|Arrow|Space|Shift|Control|Escape|Enter|F3|Backquote)/.test(e.code)) {
      this.touchModeDecided = true;
      this.noteOtherInput();
    }
  };

  private setTouchMode(on: boolean): void {
    if (on === this.touchMode) return;
    this.touchMode = on;
    if (!on) this.releaseAll();
    this.refreshVisibility();
    this.onModeChange(on);
  }

  private refreshVisibility(): void {
    const show = this.editing || (this.touchMode && this.active);
    this.layer.classList.toggle('on', show);
    this.layer.classList.toggle('editing', this.editing);
  }

  // ---------------------------------------------------------------------------
  // Mise en page.

  private readonly onResize = (): void => {
    const cs = getComputedStyle(this.probe);
    this.safe.top = parseFloat(cs.paddingTop) || 0;
    this.safe.right = parseFloat(cs.paddingRight) || 0;
    this.safe.bottom = parseFloat(cs.paddingBottom) || 0;
    this.safe.left = parseFloat(cs.paddingLeft) || 0;
    this.positionButtons();
  };

  /** Zone où se placent les centres des boutons : l'écran moins les safe areas et une demi-taille de bouton. */
  private area(): { left: number; top: number; width: number; height: number } {
    const margin = (TOUCH.buttonSize * this.scale()) / 2;
    const left = this.safe.left + margin;
    const top = this.safe.top + margin;
    return {
      left,
      top,
      width: Math.max(1, window.innerWidth - this.safe.right - margin - left),
      height: Math.max(1, window.innerHeight - this.safe.bottom - margin - top),
    };
  }

  /** Échelle des boutons selon le petit côté de l'écran. */
  private scale(): number {
    const short = Math.min(window.innerWidth, window.innerHeight);
    return Math.min(TOUCH.maxScale, Math.max(TOUCH.minScale, short / TOUCH.referenceShortSide));
  }

  private positionButtons(): void {
    const area = this.area();
    const scale = this.scale();
    for (const b of this.buttons.values()) {
      const l = this.layout[b.id];
      const d = Math.round(TOUCH.buttonSize * scale * l.size);
      const st = b.el.style;
      st.width = st.height = `${d}px`;
      st.left = `${Math.round(area.left + l.x * area.width)}px`;
      st.top = `${Math.round(area.top + l.y * area.height)}px`;
      st.fontSize = `${Math.round(Math.max(10, d * 0.22))}px`;
    }
    const r = INPUT.touchJoystickRadiusPx;
    this.joyBase.style.width = this.joyBase.style.height = `${r * 2}px`;
  }

  private showStick(base: HTMLDivElement, knob: HTMLDivElement, stick: DragStick, radius: number): void {
    base.style.display = 'block';
    base.style.width = base.style.height = `${Math.round(radius * 2)}px`;
    base.style.left = `${stick.originX}px`;
    base.style.top = `${stick.originY}px`;
    knob.style.transform = `translate(calc(-50% + ${stick.value.x * radius}px), calc(-50% + ${-stick.value.y * radius}px))`;
  }

  /** Bloque le défilement et le zoom au doigt, sauf dans un panneau de menu qui défile. */
  private readonly onTouchMove = (e: TouchEvent): void => {
    const t = e.target;
    if (t instanceof Element && t.closest('.menu-panel')) return;
    if (e.cancelable) e.preventDefault();
  };

  dispose(): void {
    this.releaseAll();
    this.layer.removeEventListener('pointerdown', this.onDown);
    this.layer.removeEventListener('pointermove', this.onMove);
    this.layer.removeEventListener('pointerup', this.onUp);
    this.layer.removeEventListener('pointercancel', this.onUp);
    this.layer.removeEventListener('lostpointercapture', this.onUp);
    this.layer.removeEventListener('contextmenu', prevent);
    window.removeEventListener('pointerdown', this.onAnyPointer, true);
    window.removeEventListener('pointermove', this.onAnyMouseMove, true);
    window.removeEventListener('keydown', this.onAnyKey, true);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('gesturestart', prevent);
    document.removeEventListener('dblclick', prevent);
    document.removeEventListener('touchmove', this.onTouchMove);
    this.layer.remove();
    this.probe.remove();
  }
}

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent.appendChild(d);
  return d;
}

function toolButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menu-btn small';
  b.textContent = label;
  b.addEventListener('click', onClick);
  // Les boutons de la barre d'outils ne doivent pas lancer un déplacement de bouton.
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

function prevent(e: Event): void {
  e.preventDefault();
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
