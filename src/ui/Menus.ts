import { SETTINGS_LIMITS } from '@/config/physics';
import { HUD, QUALITY_PRESETS, type GraphicsQuality } from '@/config/render';
import type { PadFamily } from '@/core/Input';
import type { ChallengeSystem } from '@/progress/ChallengeSystem';
import type { Profile } from '@/progress/Profile';
import { BOARDS, COLORS, isUnlocked, type BoardDef, type Customization } from '@/progress/unlocks';
import type { PadLayout } from '@/save/SaveData';
import type { ScoreSystem } from '@/score/ScoreSystem';
import { CHALLENGES, type ChallengeDef } from '@/world/challenges';
import { GESTURES, KEYBOARD_BINDINGS, PAD_LABELS, gestureSvg, padBindings, type Binding } from './helpContent';
import { fmt } from './Hud';

export type ScreenId = 'home' | 'pause' | 'settings' | 'custom' | 'objectives' | 'help';

/** Ce que les menus demandent au jeu. */
export interface MenuHost {
  readonly profile: Profile;
  readonly challenges: ChallengeSystem;
  readonly score: ScoreSystem;
  /** Accueil → jeu. */
  play(): void;
  /** Ferme la pause. */
  resume(): void;
  /** Retour au départ et reprise. */
  restart(): void;
  /** Abandonne la partie en cours et revient à l'accueil. */
  quitToHome(): void;
  /** Disposition de manette à afficher. */
  padFamily(): PadFamily;
  /** Son d'interface. */
  click(): void;
}

/** Délai pour confirmer l'effacement de la progression (ms). */
const CONFIRM_RESET_MS = 4000;

/**
 * Menus en DOM : accueil, pause, réglages, personnalisation, objectifs, aide.
 * Pile d'écrans : `back()` remonte d'un cran ; à la racine de la pause, il reprend la partie.
 * Navigation : souris et tactile, clavier (flèches, Entrée, Espace ; Échap passe par l'action pause du jeu),
 * manette (croix ou stick gauche, A / Croix pour valider, B / Rond pour revenir).
 */
export class Menus {
  private readonly layer: HTMLDivElement;
  private readonly stack: ScreenId[] = [];
  private panel: HTMLDivElement | null = null;
  private confirmResetUntil = 0;
  /** Navigation manette : état précédent des boutons et répétition. */
  private readonly padPrev = { up: false, down: false, left: false, right: false, a: false, b: false };
  private repeatTimer = 0;
  /** Appelé à chaque changement d'écran (caméra, HUD). */
  onChange: (screen: ScreenId | null) => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly host: MenuHost,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'menu-layer';
    this.layer.addEventListener('pointerdown', () => this.layer.removeAttribute('data-pad'));
    parent.appendChild(this.layer);
    window.addEventListener('keydown', this.onKey);
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  get current(): ScreenId | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  get root(): ScreenId | null {
    return this.stack[0] ?? null;
  }

  /** Ouvre un écran racine (accueil ou pause), en vidant la pile. */
  openRoot(id: 'home' | 'pause'): void {
    this.stack.length = 0;
    this.stack.push(id);
    this.render(true);
  }

  push(id: ScreenId): void {
    this.host.click();
    this.stack.push(id);
    this.render(true);
  }

  /** Retour : écran précédent ; à la racine de la pause, reprise du jeu. */
  back(): void {
    if (this.stack.length > 1) {
      this.host.click();
      this.stack.pop();
      this.render(true);
    } else if (this.current === 'pause') {
      this.host.click();
      this.host.resume();
    }
  }

  close(): void {
    this.stack.length = 0;
    this.layer.classList.remove('on');
    this.layer.replaceChildren();
    this.panel = null;
    this.onChange(null);
  }

  /** Reconstruit l'écran courant (après un changement de réglage ou de profil). */
  refresh(): void {
    if (this.isOpen) this.render(false);
  }

  /** À chaque rendu : navigation à la manette. */
  update(frameDt: number): void {
    if (!this.isOpen || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const now = { up: false, down: false, left: false, right: false, a: false, b: false };
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const t = HUD.menuStickThreshold;
      now.up ||= !!pad.buttons[12]?.pressed || ay < -t;
      now.down ||= !!pad.buttons[13]?.pressed || ay > t;
      now.left ||= !!pad.buttons[14]?.pressed || ax < -t;
      now.right ||= !!pad.buttons[15]?.pressed || ax > t;
      now.a ||= !!pad.buttons[0]?.pressed;
      now.b ||= !!pad.buttons[1]?.pressed;
    }
    const p = this.padPrev;
    const dir = now.up ? 'up' : now.down ? 'down' : now.left ? 'left' : now.right ? 'right' : null;
    const prevDir = p.up ? 'up' : p.down ? 'down' : p.left ? 'left' : p.right ? 'right' : null;
    if (dir && dir !== prevDir) {
      this.repeatTimer = (HUD.menuRepeatMs * 1.6) / 1000;
      this.navigate(dir, true);
    } else if (dir) {
      this.repeatTimer -= frameDt;
      if (this.repeatTimer <= 0) {
        this.repeatTimer = HUD.menuRepeatMs / 1000;
        this.navigate(dir, true);
      }
    }
    if (now.a && !p.a) {
      this.layer.setAttribute('data-pad', '');
      const f = this.focused();
      if (f) f.click();
      else this.focusables()[0]?.focus();
    }
    if (now.b && !p.b) this.back();
    Object.assign(p, now);
  }

  // ---------------------------------------------------------------------------

  private render(resetFocus: boolean): void {
    const id = this.current;
    if (!id) return;
    const focusKey = resetFocus ? null : (this.focused()?.dataset.key ?? null);
    const scroll = resetFocus ? 0 : (this.panel?.scrollTop ?? 0);
    this.layer.className = `menu-layer on ${id === 'home' ? 'home' : id === 'custom' ? 'side' : 'backdrop'}`;
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.setAttribute('role', 'dialog');
    this.build(id, panel);
    this.layer.replaceChildren(panel);
    this.panel = panel;
    panel.scrollTop = scroll;
    const target = focusKey ? panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) : null;
    (target ?? this.focusables()[0])?.focus({ preventScroll: !resetFocus });
    this.onChange(id);
  }

  private build(id: ScreenId, p: HTMLDivElement): void {
    switch (id) {
      case 'home':
        return this.buildHome(p);
      case 'pause':
        return this.buildPause(p);
      case 'settings':
        return this.buildSettings(p);
      case 'custom':
        return this.buildCustom(p);
      case 'objectives':
        return this.buildObjectives(p);
      case 'help':
        return this.buildHelp(p);
    }
  }

  private buildHome(p: HTMLElement): void {
    const h1 = add(p, 'h1');
    h1.innerHTML = 'Ska<span>te</span>';
    add(p, 'div', 'menu-sub').textContent = 'Flicks au stick, grinds, manuals et combos dans un skatepark ouvert.';
    this.stats(p);
    const b = add(p, 'div', 'menu-buttons');
    this.button(b, 'Jouer', () => this.host.play(), 'primary', 'play');
    this.button(b, 'Objectifs', () => this.push('objectives'), '', 'objectives');
    this.button(b, 'Personnaliser', () => this.push('custom'), '', 'custom');
    this.button(b, 'Réglages', () => this.push('settings'), '', 'settings');
    this.button(b, 'Aide et gestes', () => this.push('help'), '', 'help');
    const pad = PAD_LABELS[this.host.padFamily()];
    add(p, 'p').textContent = `Échap ou ${pad.start} : menu en jeu. Manette : croix pour naviguer, ${pad.a} valider, ${pad.b} retour.`;
  }

  private buildPause(p: HTMLElement): void {
    add(p, 'h2').textContent = 'Pause';
    this.stats(p);
    const b = add(p, 'div', 'menu-buttons');
    this.button(b, 'Reprendre', () => this.host.resume(), 'primary', 'resume');
    this.button(b, 'Retour au départ', () => this.host.restart(), '', 'restart');
    this.button(b, 'Objectifs', () => this.push('objectives'), '', 'objectives');
    this.button(b, 'Personnaliser', () => this.push('custom'), '', 'custom');
    this.button(b, 'Réglages', () => this.push('settings'), '', 'settings');
    this.button(b, 'Aide et gestes', () => this.push('help'), '', 'help');
    this.button(b, 'Menu principal', () => this.host.quitToHome(), 'danger', 'quit');
  }

  private stats(p: HTMLElement): void {
    const prof = this.host.profile;
    const lp = prof.levelProgress();
    const done = prof.completedChallenges().size;
    const s = add(p, 'div', 'menu-stats');
    const stat = (label: string, value: string) => {
      const d = add(s, 'div');
      add(d, 'b').textContent = value;
      d.append(label);
    };
    stat(lp.nextXp > 0 ? `${fmt(lp.levelXp)} / ${fmt(lp.nextXp)} XP` : 'niveau max', `Niveau ${lp.level}`);
    stat('meilleur combo', fmt(this.host.score.records.bestCombo));
    stat('défis réussis', `${done} / ${CHALLENGES.length}`);
    if (this.host.score.sessionScore > 0) stat('session', fmt(this.host.score.sessionScore));
  }

  private header(p: HTMLElement, title: string): void {
    const h = add(p, 'div', 'menu-head');
    add(h, 'h2').textContent = title;
    this.button(h, 'Retour', () => this.back(), 'small', 'back');
  }

  // ---------------------------------------------------------------------------
  // Réglages.

  private buildSettings(p: HTMLElement): void {
    this.header(p, 'Réglages');
    const prof = this.host.profile;
    const s = prof.settings;

    add(p, 'h3').textContent = 'Graphismes';
    const q = row(p, 'Qualité');
    this.segmented<GraphicsQuality>(q, 'quality', [['low', 'Bas'], ['medium', 'Moyen'], ['high', 'Haut']], s.quality, (v) => prof.updateSettings({ quality: v }));
    const preset = QUALITY_PRESETS[s.quality];
    add(p, 'p').textContent =
      `Ombres ${preset.shadows ? `activées (${preset.shadowMapSize} px)` : 'désactivées'}, résolution ${Math.round(preset.resolutionScale * 100)} % ` +
      `(pixel ratio ≤ ${preset.maxPixelRatio}), brouillard de ${preset.fogNear} à ${preset.fogFar} m.`;

    add(p, 'h3').textContent = 'Son';
    this.range(row(p, 'Volume'), 'volume', 0, 1, 0.05, s.volume, (v) => `${Math.round(v * 100)} %`, (v) => prof.updateSettings({ volume: v }));
    this.toggle(row(p, 'Couper le son'), 'muted', s.muted, (v) => prof.updateSettings({ muted: v }));

    add(p, 'h3').textContent = 'Contrôles';
    this.range(
      row(p, 'Sensibilité des flicks'),
      'flick',
      SETTINGS_LIMITS.flickSensitivityMin,
      SETTINGS_LIMITS.flickSensitivityMax,
      0.05,
      s.flickSensitivity,
      (v) => `${v.toFixed(2)}`,
      (v) => prof.updateSettings({ flickSensitivity: v }),
    );
    add(p, 'p').textContent = 'Plus haut : gestes reconnus plus facilement, au risque de confondre deux tricks voisins.';
    this.range(
      row(p, 'Sensibilité de la souris'),
      'mouse',
      SETTINGS_LIMITS.mouseSensitivityMin,
      SETTINGS_LIMITS.mouseSensitivityMax,
      0.1,
      s.mouseSensitivity,
      (v) => `${v.toFixed(1)}`,
      (v) => prof.updateSettings({ mouseSensitivity: v }),
    );
    this.segmented<PadLayout>(row(p, 'Manette'), 'pad', [['auto', 'Auto'], ['xbox', 'Xbox'], ['playstation', 'PlayStation']], s.padLayout, (v) =>
      prof.updateSettings({ padLayout: v }),
    );
    add(p, 'h3').textContent = 'Clavier et souris';
    bindingsTable(p, KEYBOARD_BINDINGS);
    add(p, 'h3').textContent = `Manette (${this.host.padFamily() === 'playstation' ? 'PlayStation' : 'Xbox'})`;
    bindingsTable(p, padBindings(PAD_LABELS[this.host.padFamily()]));

    add(p, 'h3').textContent = 'Données';
    add(p, 'p').textContent = `Sauvegarde : ${backendLabel(prof.backend)}.`;
    const confirming = performance.now() < this.confirmResetUntil;
    this.button(
      p,
      confirming ? 'Confirmer : tout effacer' : 'Effacer la progression et les réglages',
      () => {
        if (performance.now() < this.confirmResetUntil) {
          this.confirmResetUntil = 0;
          prof.resetAll();
          this.host.score.reloadRecords();
        } else {
          this.confirmResetUntil = performance.now() + CONFIRM_RESET_MS;
        }
        this.refresh();
      },
      'danger small',
      'reset',
    );
  }

  // ---------------------------------------------------------------------------
  // Personnalisation.

  private buildCustom(p: HTMLElement): void {
    this.header(p, 'Personnaliser');
    const prof = this.host.profile;
    const level = prof.level;
    const completed = prof.completedChallenges();
    const c = prof.custom;

    add(p, 'h3').textContent = 'Board';
    const grid = add(p, 'div', 'grid');
    for (const b of BOARDS) {
      const unlocked = isUnlocked(b, level, completed);
      const card = add(grid, 'button', 'card') as HTMLButtonElement;
      card.type = 'button';
      card.dataset.key = `board-${b.id}`;
      card.setAttribute('aria-pressed', String(c.board === b.id));
      card.disabled = !unlocked;
      const deck = add(card, 'div', 'deck');
      deck.style.background = deckPreview(b);
      card.append(b.name);
      if (!unlocked) add(card, 'span', 'lock').textContent = lockText(b, level);
      card.addEventListener('click', () => this.choose({ board: b.id }));
    }
    const parts: ReadonlyArray<readonly [keyof Omit<Customization, 'board'>, string]> = [
      ['shirt', 'Haut'],
      ['pants', 'Pantalon'],
      ['cap', 'Casquette'],
    ];
    for (const [part, label] of parts) {
      add(p, 'h3').textContent = label;
      const sw = add(p, 'div', 'swatches');
      for (const col of COLORS) {
        const unlocked = level >= col.level;
        const s = add(sw, 'button', 'swatch') as HTMLButtonElement;
        s.type = 'button';
        s.dataset.key = `${part}-${col.id}`;
        s.dataset.level = `${col.level}`;
        s.title = unlocked ? col.name : `${col.name} : niveau ${col.level}`;
        s.setAttribute('aria-label', s.title);
        s.setAttribute('aria-pressed', String(c[part] === col.id));
        s.style.background = `#${col.hex.toString(16).padStart(6, '0')}`;
        s.disabled = !unlocked;
        s.addEventListener('click', () => this.choose({ [part]: col.id }));
      }
    }
    add(p, 'p').textContent = `Niveau ${level} : les boards et couleurs se débloquent en montant de niveau et en réussissant des défis.`;
  }

  private choose(patch: Partial<Customization>): void {
    this.host.click();
    this.host.profile.updateCustom(patch);
    this.refresh();
  }

  // ---------------------------------------------------------------------------
  // Objectifs.

  private buildObjectives(p: HTMLElement): void {
    this.header(p, 'Objectifs');
    const prof = this.host.profile;
    const lp = prof.levelProgress();
    add(p, 'p').textContent =
      lp.nextXp > 0 ? `Niveau ${lp.level} : ${fmt(lp.levelXp)} / ${fmt(lp.nextXp)} XP pour le niveau suivant.` : `Niveau ${lp.level}, le maximum.`;
    const bar = add(p, 'div', 'progress');
    add(bar, 'div').style.width = `${lp.nextXp > 0 ? Math.round((lp.levelXp / lp.nextXp) * 100) : 100}%`;
    add(p, 'p').textContent = 'Chaque zone du parc est marquée au sol (jaune : à faire, vert : réussi). Les combos validés rapportent aussi de l’XP.';
    for (const zone of this.host.challenges.zones) {
      const defs = this.host.challenges.challengesIn(zone.id);
      if (defs.length === 0) continue;
      add(p, 'h3').textContent = zone.name;
      for (const d of defs) challengeItem(p, d, prof);
    }
  }

  // ---------------------------------------------------------------------------
  // Aide.

  private buildHelp(p: HTMLElement): void {
    this.header(p, 'Aide et gestes');
    add(p, 'h3').textContent = 'Flicks au stick droit (souris glissée ou flèches)';
    add(p, 'p').textContent = 'Tout geste commence stick en bas (zone jaune) : le skateur charge, la durée règle la hauteur. Le trait ou l’arc qui suit choisit le trick.';
    const g = add(p, 'div', 'gestures');
    for (const ge of GESTURES) {
      const card = add(g, 'div', 'gesture');
      card.innerHTML = gestureSvg(ge);
      card.append(ge.name);
      add(card, 'small').textContent = ge.hint;
    }
    add(p, 'h3').textContent = 'Grinds, manuals, grabs';
    const ul = add(p, 'ul', 'help-list');
    for (const [b, t] of [
      ['Grind', 'arrive en l’air au-dessus d’un rail ou d’une arête, dans son axe, en redescendant. En travers : slide.'],
      ['Équilibre', 'la jauge en bas de l’écran dérive ; corrige à gauche et à droite. Hors de la zone sûre : chute.'],
      ['Manual', 'touche de manual tenue au sol ; équilibre à l’avant et à l’arrière.'],
      ['Grab', 'tenu en l’air, la direction choisit indy, melon, nosegrab ou tailgrab. Lâche avant la réception.'],
      ['Rotation', 'gauche ou droite en l’air : 180, 360, 540.'],
    ] as const) {
      const li = add(ul, 'li');
      add(li, 'b').textContent = `${b} : `;
      li.append(t);
    }
    add(p, 'h3').textContent = 'Score';
    const ul2 = add(p, 'ul', 'help-list');
    for (const t of [
      'Le combo dure tant que tu ne restes pas plus d’une seconde au sol ; grinds et manuals le prolongent.',
      'Plus de tricks différents : multiplicateur plus haut. Répéter le même trick rapporte de moins en moins.',
      'Le combo est validé à la fin sur une réception propre (à moitié sur une réception sale). Une chute l’annule entièrement.',
    ]) add(ul2, 'li').textContent = t;
    add(p, 'h3').textContent = 'Clavier et souris';
    bindingsTable(p, KEYBOARD_BINDINGS);
    add(p, 'h3').textContent = `Manette (${this.host.padFamily() === 'playstation' ? 'PlayStation' : 'Xbox'})`;
    bindingsTable(p, padBindings(PAD_LABELS[this.host.padFamily()]));
  }

  // ---------------------------------------------------------------------------
  // Contrôles de formulaire.

  private button(parent: HTMLElement, label: string, onClick: () => void, variant: string, key: string): HTMLButtonElement {
    const b = add(parent, 'button', `menu-btn ${variant}`) as HTMLButtonElement;
    b.type = 'button';
    b.textContent = label;
    b.dataset.key = key;
    b.addEventListener('click', onClick);
    return b;
  }

  private segmented<T extends string>(parent: HTMLElement, key: string, options: ReadonlyArray<readonly [T, string]>, value: T, onPick: (v: T) => void): void {
    const seg = add(parent, 'div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    for (const [v, label] of options) {
      const b = add(seg, 'button') as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === value));
      b.dataset.key = `${key}-${v}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        this.host.click();
        onPick(v);
        this.refresh();
      });
    }
  }

  private range(parent: HTMLElement, key: string, min: number, max: number, step: number, value: number, format: (v: number) => string, onInput: (v: number) => void): void {
    const input = add(parent, 'input') as HTMLInputElement;
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.dataset.key = key;
    const out = add(parent, 'output');
    out.textContent = format(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = format(v);
      onInput(v);
    });
  }

  private toggle(parent: HTMLElement, key: string, value: boolean, onChange: (v: boolean) => void): void {
    const b = add(parent, 'button', 'toggle') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(value));
    b.dataset.key = key;
    b.addEventListener('click', () => {
      this.host.click();
      onChange(b.getAttribute('aria-checked') !== 'true');
      this.refresh();
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation clavier et manette.

  private focusables(): HTMLElement[] {
    if (!this.panel) return [];
    return [...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
  }

  private focused(): HTMLElement | null {
    const a = document.activeElement;
    return a instanceof HTMLElement && this.panel?.contains(a) ? a : null;
  }

  private navigate(dir: 'up' | 'down' | 'left' | 'right', fromPad: boolean): void {
    if (fromPad) this.layer.setAttribute('data-pad', '');
    const list = this.focusables();
    if (list.length === 0) return;
    const f = this.focused();
    if (dir === 'left' || dir === 'right') {
      const step = dir === 'right' ? 1 : -1;
      if (f instanceof HTMLInputElement && f.type === 'range') {
        const v = Number(f.value) + step * Number(f.step);
        f.value = String(Math.min(Number(f.max), Math.max(Number(f.min), v)));
        f.dispatchEvent(new Event('input'));
        return;
      }
      // Dans un groupe (segments, grille, nuancier), gauche et droite passent au voisin.
      const group = f?.parentElement;
      if (f && group && (group.classList.contains('seg') || group.classList.contains('grid') || group.classList.contains('swatches'))) {
        const items = [...group.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        const next = items[items.indexOf(f) + step];
        next?.focus();
        if (next && group.classList.contains('seg')) next.click();
        return;
      }
      if (!f) list[0]?.focus();
      return;
    }
    const i = f ? list.indexOf(f) : -1;
    const next = list[(i + (dir === 'down' ? 1 : -1) + list.length) % list.length];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const map: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = map[e.code];
    if (dir) {
      e.preventDefault();
      this.layer.removeAttribute('data-pad');
      this.navigate(dir, false);
      return;
    }
    // Le jeu bloque l'action par défaut d'Espace (ollie) : on active nous-mêmes l'élément.
    if (e.code === 'Space' && !e.repeat) {
      const f = this.focused();
      if (f && !(f instanceof HTMLInputElement)) {
        e.preventDefault();
        f.click();
      }
    }
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.layer.remove();
  }
}

function add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent.appendChild(e);
  return e;
}

function row(parent: HTMLElement, label: string): HTMLDivElement {
  const r = add(parent, 'div', 'row');
  add(r, 'label').textContent = label;
  return r;
}

function bindingsTable(parent: HTMLElement, bindings: readonly Binding[]): void {
  const t = add(parent, 'table', 'keys');
  for (const b of bindings) {
    const tr = add(t, 'tr');
    add(tr, 'td').textContent = b.action;
    const td = add(tr, 'td');
    for (const k of b.keys) add(td, 'kbd').textContent = k;
  }
}

function challengeItem(parent: HTMLElement, d: ChallengeDef, prof: Profile): void {
  const pr = prof.progress(d.id);
  const item = add(parent, 'div', `challenge${pr.done ? ' done' : ''}`);
  const t = add(item, 'div', 't');
  t.append(`${pr.done ? '✓ ' : ''}${d.title}`);
  add(t, 'span').textContent = pr.done ? 'Réussi' : `+${fmt(d.rewardXp)} XP${d.rewardText ? ` · ${d.rewardText}` : ''}`;
  add(item, 'div', 'd').textContent = d.description;
  const bar = add(item, 'div', `progress${pr.done ? ' done' : ''}`);
  add(bar, 'div').style.width = `${Math.round((pr.done ? 1 : pr.best) * 100)}%`;
}

function lockText(b: BoardDef, level: number): string {
  if (b.challenge) {
    const def = CHALLENGES.find((c) => c.id === b.challenge);
    return `Défi : ${def?.title ?? b.challenge}`;
  }
  return level < b.level ? `Niveau ${b.level}` : '';
}

/** Aperçu CSS du motif d'un board. */
function deckPreview(b: BoardDef): string {
  const base = `#${b.deck.toString(16).padStart(6, '0')}`;
  const acc = `#${b.accent.toString(16).padStart(6, '0')}`;
  switch (b.pattern) {
    case 'plain':
      return base;
    case 'stripes':
      return `repeating-linear-gradient(90deg, ${base} 0 14px, ${acc} 14px 20px)`;
    case 'split':
      return `linear-gradient(100deg, ${base} 0 50%, ${acc} 50% 100%)`;
    case 'dots':
      return `radial-gradient(circle, ${acc} 0 3px, transparent 3.5px) 0 0 / 11px 11px, ${base}`;
    case 'chevron':
      return `repeating-linear-gradient(60deg, ${base} 0 8px, ${acc} 8px 12px)`;
    case 'checker':
      return `repeating-conic-gradient(${base} 0 25%, ${acc} 0 50%) 0 0 / 12px 12px`;
  }
}

function backendLabel(name: string): string {
  return name === 'indexeddb' ? 'IndexedDB' : name === 'localstorage' ? 'localStorage (repli)' : 'indisponible (rien n’est conservé)';
}
