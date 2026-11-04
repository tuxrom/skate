import { SCORING } from '@/config/physics';
import { HUD } from '@/config/render';
import type { ScoreSystem } from '@/score/ScoreSystem';
import type { ChallengeSystem } from '@/progress/ChallengeSystem';
import type { Profile } from '@/progress/Profile';
import type { ChallengeDef } from '@/world/challenges';
import { BalanceMeter } from './BalanceMeter';

/** État du skateur affiché, fourni à chaque rendu. */
export interface HudView {
  /** Vitesse (m/s). */
  speed: number;
  /** Nom du grind ou manual en cours, null sinon. */
  balanceName: string | null;
  balance: number;
}

/**
 * HUD en DOM et CSS : combo en cours, nom du trick qui apparaît puis s'efface, validation et annulation
 * animées, vitesse, niveau, objectifs de la zone, notifications, jauge d'équilibre.
 * Les écritures DOM n'ont lieu que sur changement ; les animations sont en CSS.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly combo: HTMLDivElement;
  private readonly comboPoints: HTMLDivElement;
  private readonly comboList: HTMLDivElement;
  private readonly comboTimer: HTMLDivElement;
  private readonly result: HTMLDivElement;
  private readonly trick: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly level: HTMLDivElement;
  private readonly levelBar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly session: HTMLDivElement;
  private readonly challenge: HTMLDivElement;
  private readonly challengeTimer: HTMLDivElement;
  private readonly challengeBody: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  private readonly balanceMeter: BalanceMeter;
  private readonly unsubscribe: (() => void)[] = [];
  private visible = true;
  private challengeDirty = true;
  private comboOn = false;
  private last = { points: '', list: '', timer: '', speed: '', timed: '' };

  constructor(
    parent: HTMLElement,
    private readonly score: ScoreSystem,
    private readonly challenges: ChallengeSystem,
    private readonly profile: Profile,
    private readonly menuHint: () => string,
  ) {
    this.root = el('div', 'hud');
    const top = el('div', 'hud-top', this.root);
    this.combo = el('div', 'hud-combo', top);
    this.comboPoints = el('div', 'hud-combo-points', this.combo);
    this.comboList = el('div', 'hud-combo-list', this.combo);
    this.comboTimer = el('div', '', el('div', 'hud-combo-timer', this.combo));
    this.result = el('div', 'hud-result', top);
    this.trick = el('div', 'hud-trick', this.root);
    this.speed = el('div', 'hud-speed', this.root);
    this.level = el('div', 'hud-level', this.root);
    const levelText = el('div', '', this.level);
    levelText.className = 'lvl';
    this.levelBar = el('div', '', el('div', 'bar', this.level));
    this.hint = el('div', 'hint', this.level);
    this.session = el('div', 'hud-session', this.root);
    this.challenge = el('div', 'hud-challenge', this.root);
    this.challengeTimer = el('div', 'timer', this.challenge);
    this.challengeBody = el('div', '', this.challenge);
    this.toasts = el('div', 'hud-toasts', this.root);
    parent.appendChild(this.root);
    this.balanceMeter = new BalanceMeter(parent);

    const sev = score.events;
    this.unsubscribe.push(
      sev.on('element', ({ element }) => this.showTrick(element.label, `+${fmt(element.points)}`)),
      sev.on('liveStart', ({ element }) => this.showTrick(element.label, element.transition ? 'Transition !' : '')),
      sev.on('comboBanked', (r) => {
        const quality = r.quality === 'sloppy' ? ' · réception sale' : '';
        this.showResult('banked', `+${fmt(r.score)}`, `${r.label}${quality}`);
        this.refreshSession();
      }),
      sev.on('comboLost', (l) => {
        if (l.reason === 'bail' && l.lost > 0) this.showResult('lost', `${fmt(l.lost)}`, 'Chute ! Combo perdu');
      }),
      sev.on('record', (e) => {
        // Le tout premier combo bat forcément les records à 0 : rien à annoncer.
        if (e.previous <= 0) return;
        if (e.kind === 'combo') this.toast(`Nouveau record : ${fmt(e.score)} points`, 'gold');
        else this.toast(`Record de session battu : ${fmt(e.score)}`, 'gold');
      }),
    );
    const cev = challenges.events;
    const dirty = () => {
      this.challengeDirty = true;
    };
    this.unsubscribe.push(
      cev.on('zoneEnter', dirty),
      cev.on('zoneExit', dirty),
      cev.on('progress', dirty),
      cev.on('timedStart', (r) => {
        dirty();
        this.toast(`Chrono : ${r.def.title}`, '');
      }),
      cev.on('timedEnd', ({ def, success }) => {
        dirty();
        if (!success) this.toast(`Temps écoulé : ${def.title}`, '');
      }),
      cev.on('complete', (def) => {
        dirty();
        this.toast(`Défi réussi : ${def.title} · +${fmt(def.rewardXp)} XP${def.rewardText ? ` · ${def.rewardText}` : ''}`, 'good');
      }),
    );
    const pev = profile.events;
    this.unsubscribe.push(
      pev.on('xp', () => this.refreshLevel()),
      pev.on('levelUp', (e) => {
        this.toast(`Niveau ${e.to} !${e.unlocks.length ? ` Débloqué : ${e.unlocks.join(', ')}` : ''}`, 'gold');
        this.challengeDirty = true;
      }),
    );
    this.refreshLevel();
    this.refreshSession();
  }

  /** Relit l'indication de menu (clavier, manette ou tactile). */
  refreshHints(): void {
    this.hint.textContent = this.menuHint();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    if (visible) {
      this.refreshLevel();
      this.challengeDirty = true;
    }
  }

  /** Appelé à chaque rendu. */
  update(view: HudView): void {
    const c = this.score.combo;
    const on = c.active && (c.elements.length > 0 || c.live !== null);
    if (on !== this.comboOn) {
      this.comboOn = on;
      this.combo.classList.toggle('on', on);
    }
    if (on) {
      const points = `${fmt(c.elementPoints + c.varietyBonus)} <span class="hud-combo-mult">× ${c.multiplier.toFixed(1)}</span>`;
      if (points !== this.last.points) this.comboPoints.innerHTML = this.last.points = points;
      const n = c.elements.length;
      const from = Math.max(0, n - HUD.comboVisibleElements + (c.live ? 1 : 0));
      let list = from > 0 ? '… + ' : '';
      for (let i = from; i < n; i++) list += (i > from ? ' + ' : '') + c.elements[i]!.label;
      if (c.live) list += `${n > from ? ' + ' : ''}${c.live.label}…`;
      if (list !== this.last.list) this.comboList.textContent = this.last.list = list;
      const left = c.live ? 1 : Math.max(0, 1 - c.groundTime / SCORING.comboGroundTime);
      const w = `${Math.round(left * 100)}%`;
      if (w !== this.last.timer) this.comboTimer.style.width = this.last.timer = w;
    }
    const speed = `${Math.round(view.speed * 3.6)}<small>km/h</small>`;
    if (speed !== this.last.speed) this.speed.innerHTML = this.last.speed = speed;

    if (this.challengeDirty) this.rebuildChallenge();
    const t = this.challenges.timed;
    const timed = t ? `⏱ ${t.timeLeft.toFixed(1)} s · ${fmt(t.value)} / ${fmt(t.target)}` : '';
    if (timed !== this.last.timed) {
      this.challengeTimer.textContent = this.last.timed = timed;
      this.challengeTimer.style.display = t ? 'block' : 'none';
    }
    this.balanceMeter.update(view.balanceName, view.balance);
  }

  /** Notification courte. */
  toast(text: string, kind: '' | 'good' | 'gold'): void {
    const t = el('div', `toast ${kind}`, this.toasts);
    t.textContent = text;
    t.style.animationDuration = `${HUD.toastTime}s`;
    t.addEventListener('animationend', () => t.remove());
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
  }

  private showTrick(name: string, detail: string): void {
    this.trick.replaceChildren(document.createTextNode(name));
    if (detail) el('small', '', this.trick).textContent = detail;
    restartAnimation(this.trick, 'show', HUD.trickNameTime);
  }

  private showResult(kind: 'banked' | 'lost', points: string, detail: string): void {
    this.result.className = 'hud-result';
    this.result.replaceChildren();
    el('span', 'pts', this.result).textContent = points;
    el('small', '', this.result).textContent = detail;
    restartAnimation(this.result, kind, HUD.comboResultTime);
  }

  private refreshLevel(): void {
    const p = this.profile.levelProgress();
    const text = this.level.firstElementChild as HTMLElement;
    text.textContent = p.nextXp > 0 ? `Niv. ${p.level} · ${fmt(p.levelXp)} / ${fmt(p.nextXp)} XP` : `Niv. ${p.level} (max)`;
    this.levelBar.style.width = `${p.nextXp > 0 ? Math.round((p.levelXp / p.nextXp) * 100) : 100}%`;
    this.hint.textContent = this.menuHint();
  }

  private refreshSession(): void {
    const s = this.score;
    this.session.innerHTML = `Session <b>${fmt(s.sessionScore)}</b><br>Meilleur combo ${fmt(s.sessionBestCombo)} · Record ${fmt(s.records.bestCombo)}`;
  }

  /** Carte des objectifs : zones où se trouve le skateur, et le défi chronométré en cours. */
  private rebuildChallenge(): void {
    this.challengeDirty = false;
    const sys = this.challenges;
    const body = this.challengeBody;
    body.replaceChildren();
    let any = false;
    const shown = new Set<ChallengeDef>();
    if (sys.timed) {
      shown.add(sys.timed.def);
      this.addChallenge(body, sys.timed.def, 'Défi chronométré');
      any = true;
    }
    sys.zones.forEach((z, i) => {
      if (!(sys.zoneMask & (1 << i))) return;
      const defs = sys.challengesIn(z.id).filter((d) => !shown.has(d));
      if (defs.length === 0) return;
      el('h4', '', body).textContent = z.name;
      for (const d of defs) this.addChallenge(body, d, null);
      any = true;
    });
    this.challenge.classList.toggle('on', any);
  }

  private addChallenge(parent: HTMLElement, def: ChallengeDef, heading: string | null): void {
    if (heading) el('h4', '', parent).textContent = heading;
    const p = this.profile.progress(def.id);
    const item = el('div', `item${p.done ? ' done' : ''}`, parent);
    el('b', '', item).textContent = `${p.done ? '✓ ' : ''}${def.title}`;
    el('div', '', item).textContent = def.description;
    const reward = el('div', '', item);
    reward.textContent = p.done ? 'Réussi' : `Récompense : ${fmt(def.rewardXp)} XP${def.rewardText ? ` · ${def.rewardText}` : ''}`;
    reward.style.opacity = '0.75';
    const bar = el('div', `progress${p.done ? ' done' : ''}`, item);
    el('div', '', bar).style.width = `${Math.round((p.done ? 1 : p.best) * 100)}%`;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.root.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
}

/** Relance une animation CSS de classe `cls` avec la durée donnée. */
function restartAnimation(e: HTMLElement, cls: string, seconds: number): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.style.animationDuration = `${seconds}s`;
  e.classList.add(cls);
}

/** Entier avec séparateur de milliers français. */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}
