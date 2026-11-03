import { POP, SCORING, type BalanceMoveId } from '@/config/physics';
import { EventBus } from '@/core/EventBus';
import type { AirMoveInfo, LandingInfo, BalanceEndReason } from '@/skater/Skater';
import { TRICK_DEFS } from '@/skater/tricks';
import { BALANCE_MOVES } from '@/skater/grinds';

export type ScoreElementKind = 'air' | 'grind' | 'manual';

/** Records conservés d'une session à l'autre. */
export interface ScoreRecords {
  /** Meilleur combo validé (points). */
  bestCombo: number;
  /** Nom du meilleur combo. */
  bestComboLabel: string;
  /** Meilleur total de session (points). */
  bestSession: number;
}

/** Lecture et écriture des records (le profil du joueur). */
export interface RecordsStore {
  load(): ScoreRecords;
  save(records: ScoreRecords): boolean;
}

/** Familles de mouvements, pour le bonus de variété (masque de bits). */
export const SCORE_FAMILY = {
  flip: 1,
  shove: 2,
  spin: 4,
  grab: 8,
  grind: 16,
  slide: 32,
  manual: 64,
} as const;

/** Élément d'un combo : un saut, un grind ou un manual. */
export interface ScoreElement {
  kind: ScoreElementKind;
  /** Identité pour la pénalité de répétition : deux éléments de même clé sont « le même trick ». */
  key: string;
  label: string;
  /** Valeur de base (points). */
  base: number;
  /** Bonus de hauteur, de distance et de transition (points). */
  bonus: number;
  /** Grind ou manual enchaîné après l'autre type (grind → manual, manual → grind). */
  transition: boolean;
  /** Facteur de répétition appliqué (1 pour un élément neuf). */
  repeatFactor: number;
  /** Points de l'élément : (base + bonus) × repeatFactor. */
  points: number;
  /** Familles couvertes (masque de SCORE_FAMILY). */
  families: number;
  /** Grind et manual : durée (s) et distance (m). */
  time: number;
  distance: number;
}

/** État du combo en cours, mis à jour à chaque pas ; l'UI le lit directement. */
export interface ComboState {
  active: boolean;
  /** Éléments validés dans le combo, dans l'ordre. */
  readonly elements: ScoreElement[];
  /** Grind ou manual en cours, compté dans les totaux projetés, null sinon. */
  live: ScoreElement | null;
  /** Somme des points des éléments, élément en cours compris. */
  elementPoints: number;
  /** Nombre d'éléments distincts (par clé), élément en cours compris. */
  distinct: number;
  /** Familles couvertes (masque de SCORE_FAMILY). */
  families: number;
  varietyBonus: number;
  multiplier: number;
  /** Score si le combo était validé maintenant sur une réception propre. */
  projected: number;
  /** Temps passé au sol depuis le dernier élément (s). */
  groundTime: number;
}

export type ComboEndQuality = 'clean' | 'sloppy';
export type ComboLossReason = 'bail' | 'reset';

export interface ElementEvent {
  readonly element: ScoreElement;
  readonly combo: ComboState;
}

/** Combo validé. */
export interface ComboResult {
  score: number;
  elementPoints: number;
  varietyBonus: number;
  multiplier: number;
  /** Facteur de la réception finale (1 propre, SCORING.sloppyLandingFactor sale). */
  landingFactor: number;
  quality: ComboEndQuality;
  elementCount: number;
  /** Noms des éléments joints, par exemple « Kickflip + 50-50 + Manual ». */
  label: string;
  readonly combo: ComboState;
  sessionScore: number;
  sessionBestCombo: number;
}

/** Combo perdu : tout est annulé. */
export interface ComboLoss {
  reason: ComboLossReason;
  /** Score qu'aurait rapporté le combo. */
  lost: number;
  elementCount: number;
  readonly combo: ComboState;
}

export interface RecordEvent {
  kind: 'combo' | 'session';
  score: number;
  previous: number;
}

/** Événements du score, pour l'UI et les objectifs. Les charges sont réutilisées : les copier pour les garder. */
export interface ScoreEvents {
  /** Premier élément d'un nouveau combo (avant l'événement `element` ou `liveStart`). */
  comboStart: ComboState;
  /** Élément ajouté au combo (saut reçu, grind ou manual terminé). */
  element: ElementEvent;
  /** Grind ou manual commencé ; ses points grandissent jusqu'à `element`. */
  liveStart: ElementEvent;
  /** Combo terminé et validé. */
  comboBanked: ComboResult;
  /** Combo annulé (chute ou retour au départ) : aucun point. */
  comboLost: ComboLoss;
  /** Nouveau record enregistré. */
  record: RecordEvent;
}

/**
 * Score et combos. Reçoit les événements du skateur, avance à pas fixe, publie sur `events`.
 *
 * - Un combo commence au premier élément et dure tant que le skateur ne reste pas au sol plus de
 *   `SCORING.comboGroundTime` (hors manual) ; chaque élément remet ce compteur à zéro.
 * - Rien n'est acquis avant la fin du combo : validation à l'échéance après une réception propre,
 *   immédiate (et réduite) sur une réception sale, annulation totale sur une chute.
 * - Multiplicateur selon le nombre d'éléments distincts, bonus de variété par famille,
 *   répétition pénalisée dans le combo et sur les combos validés récents.
 */
export class ScoreSystem {
  readonly events = new EventBus<ScoreEvents>();
  readonly combo: ComboState = {
    active: false,
    elements: [],
    live: null,
    elementPoints: 0,
    distinct: 0,
    families: 0,
    varietyBonus: 0,
    multiplier: 1,
    projected: 0,
    groundTime: 0,
  };
  /** Total des combos validés pendant la session (points). */
  sessionScore = 0;
  /** Meilleur combo de la session (points) et son nom. */
  sessionBestCombo = 0;
  sessionBestLabel = '';
  /** Records sauvegardés. */
  readonly records: ScoreRecords;
  /** Compteurs de session, pour le debug et les tests. */
  combosBanked = 0;
  combosLost = 0;
  /** Dernier combo validé, null avant le premier. */
  lastResult: Readonly<ComboResult> | null = null;
  lastLoss: Readonly<ComboLoss> | null = null;

  /** Occurrences de chaque clé dans le combo en cours. */
  private readonly comboCounts = new Map<string, number>();
  /** Clés des éléments des derniers combos validés, du plus ancien au plus récent. */
  private readonly history: string[] = [];
  private readonly pool: ScoreElement[] = [];
  private poolUsed = 0;
  /** Dernier grind ou manual validé dans le combo, et sauts validés depuis (transitions). */
  private lastBalanceKind: 'grind' | 'manual' | null = null;
  private airSinceBalance = 0;
  private sessionRecordAnnounced = false;

  private readonly elementEvent: { element: ScoreElement; combo: ComboState };
  private readonly result: ComboResult;
  private readonly loss: ComboLoss;
  private readonly recordEvent: RecordEvent = { kind: 'combo', score: 0, previous: 0 };

  constructor(private readonly store: RecordsStore) {
    this.records = store.load();
    this.elementEvent = { element: this.acquire(), combo: this.combo };
    this.poolUsed = 0;
    this.result = {
      score: 0,
      elementPoints: 0,
      varietyBonus: 0,
      multiplier: 1,
      landingFactor: 1,
      quality: 'clean',
      elementCount: 0,
      label: '',
      combo: this.combo,
      sessionScore: 0,
      sessionBestCombo: 0,
    };
    this.loss = { reason: 'bail', lost: 0, elementCount: 0, combo: this.combo };
  }

  /** Relit les records depuis le stockage (après un effacement de la progression). */
  reloadRecords(): void {
    Object.assign(this.records, this.store.load());
    this.sessionRecordAnnounced = false;
  }

  // ---------------------------------------------------------------------------
  // Entrées, branchées sur les événements du skateur.

  /** Réception : le saut entre dans le combo ; une réception sale clôt le combo, une chute est traitée par onBail. */
  onLand(info: LandingInfo): void {
    // La chute qui suit (événement bail) annule tout ; rien n'est ajouté avant.
    if (info.quality === 'bail') return;
    this.addAir(info);
    if (info.quality === 'sloppy') this.bank('sloppy');
  }

  /** Vol terminé sur une ligne de grind : le saut entre dans le combo, le grind suit. */
  onGrindEntry(air: AirMoveInfo): void {
    this.addAir(air);
  }

  onBalanceStart(move: BalanceMoveId): void {
    if (this.combo.live) this.finishLive(this.combo.live.time, this.combo.live.distance);
    const kind: ScoreElementKind = move === 'manual' || move === 'noseManual' ? 'manual' : 'grind';
    const def = BALANCE_MOVES[move];
    const el = this.acquire();
    el.kind = kind;
    el.key = move;
    el.label = def.name;
    el.base = SCORING.balancePoints[move];
    el.bonus = 0;
    el.families = kind === 'manual' ? SCORE_FAMILY.manual : def.onTrucks ? SCORE_FAMILY.grind : SCORE_FAMILY.slide;
    el.transition =
      this.airSinceBalance <= 1 &&
      ((kind === 'manual' && this.lastBalanceKind === 'grind') || (kind === 'grind' && this.lastBalanceKind === 'manual'));
    el.repeatFactor = this.repeatFactor(move);
    el.time = 0;
    el.distance = 0;
    el.points = 0;
    this.ensureActive();
    this.combo.live = el;
    this.combo.groundTime = 0;
    this.updateLivePoints(el);
    this.recompute();
    this.elementEvent.element = el;
    this.events.emit('liveStart', this.elementEvent);
  }

  onBalanceEnd(_move: BalanceMoveId, time: number, distance: number, reason: BalanceEndReason): void {
    const live = this.combo.live;
    if (!live) return;
    // Chute de grind ou de manual : l'élément reste en cours, la chute annule le combo qui le contient.
    if (reason === 'bail') return;
    this.finishLive(time, distance);
  }

  /** Chute : le combo en cours est perdu, sans exception. */
  onBail(): void {
    this.cancel('bail');
  }

  /** Retour au départ, téléportation : le combo en cours est abandonné. */
  reset(): void {
    this.cancel('reset');
  }

  /**
   * Pas fixe. `onGround` : roues au sol hors grind, manual et chute. `speed` sert à faire grandir
   * la distance de l'élément en cours (valeur exacte remplacée à sa fin).
   */
  fixedUpdate(dt: number, onGround: boolean, speed: number): void {
    const c = this.combo;
    if (!c.active) return;
    const live = c.live;
    if (live) {
      live.time += dt;
      live.distance += speed * dt;
      this.updateLivePoints(live);
      this.recompute();
      c.groundTime = 0;
      return;
    }
    if (!onGround) return;
    c.groundTime += dt;
    if (c.groundTime >= SCORING.comboGroundTime) this.bank('clean');
  }

  // ---------------------------------------------------------------------------
  // Éléments.

  private addAir(air: AirMoveInfo): void {
    const spinHalfTurns = Math.round(air.spinDegrees / 180);
    const popped = air.popped && air.airTime >= POP.minAirTime;
    if (!popped && spinHalfTurns === 0 && air.grabs.length === 0) return;
    const def = TRICK_DEFS[air.trick];
    const el = this.acquire();
    el.kind = 'air';
    el.label = air.label;
    let families = 0;
    if (popped && def.flips !== 0) families |= SCORE_FAMILY.flip;
    if (popped && def.shove !== 0) families |= SCORE_FAMILY.shove;
    if (spinHalfTurns > 0) families |= SCORE_FAMILY.spin;
    if (air.grabs.length > 0) families |= SCORE_FAMILY.grab;
    el.families = families;
    const spinPoints = SCORING.spinPointsPer180 * spinHalfTurns * (1 + SCORING.spinExtraPer180 * Math.max(0, spinHalfTurns - 1));
    el.base = (popped ? SCORING.trickPoints[air.trick] : 0) + spinPoints + SCORING.grabPoints * air.grabs.length;
    el.bonus = SCORING.heightPointsPerMeter * Math.max(0, air.peakHeight - SCORING.heightBonusFrom);
    el.transition = false;
    el.time = air.airTime;
    el.distance = 0;
    const sideTag = popped && def.shoveFollowsGesture ? (air.trickSide < 0 ? '-fs' : '-bs') : '';
    el.key = `air:${air.spinDegrees}:${popped ? air.trick : ''}${sideTag}:${air.grabs.join('+')}`;
    el.repeatFactor = this.repeatFactor(el.key);
    el.points = (el.base + el.bonus) * el.repeatFactor;
    this.ensureActive();
    this.airSinceBalance++;
    this.commit(el);
  }

  /** Fin du grind ou du manual en cours : compté s'il a duré assez longtemps. */
  private finishLive(time: number, distance: number): void {
    const el = this.combo.live;
    if (!el) return;
    this.combo.live = null;
    this.combo.groundTime = 0;
    el.time = time;
    el.distance = distance;
    const minTime = el.kind === 'manual' ? SCORING.minManualTime : SCORING.minGrindTime;
    if (time < minTime) {
      // Trop court : ignoré, mais il a quand même prolongé le combo.
      this.release(el);
      this.recompute();
      return;
    }
    this.updateLivePoints(el);
    this.lastBalanceKind = el.kind === 'manual' ? 'manual' : 'grind';
    this.airSinceBalance = 0;
    this.commit(el);
  }

  private updateLivePoints(el: ScoreElement): void {
    const perMeter = el.kind === 'manual' ? SCORING.manualPointsPerMeter : SCORING.grindPointsPerMeter;
    const transition = el.transition ? (el.kind === 'manual' ? SCORING.grindToManualBonus : SCORING.manualToGrindBonus) : 0;
    el.bonus = el.distance * perMeter + transition;
    el.points = (el.base + el.bonus) * el.repeatFactor;
  }

  private commit(el: ScoreElement): void {
    const c = this.combo;
    c.elements.push(el);
    this.comboCounts.set(el.key, (this.comboCounts.get(el.key) ?? 0) + 1);
    c.groundTime = 0;
    this.recompute();
    this.elementEvent.element = el;
    this.events.emit('element', this.elementEvent);
  }

  /**
   * Facteur de répétition d'une clé : repeatDecay par occurrence dans le combo,
   * recentRepeatFactor par occurrence dans les combos validés récents, plancher minRepeatFactor.
   */
  private repeatFactor(key: string): number {
    const inCombo = this.comboCounts.get(key) ?? 0;
    let recent = 0;
    for (const k of this.history) if (k === key) recent++;
    const f = SCORING.repeatDecay ** inCombo * SCORING.recentRepeatFactor ** recent;
    return Math.max(SCORING.minRepeatFactor, f);
  }

  private recompute(): void {
    const c = this.combo;
    let points = 0;
    let families = 0;
    for (const el of c.elements) {
      points += el.points;
      families |= el.families;
    }
    let distinct = this.comboCounts.size;
    if (c.live) {
      points += c.live.points;
      families |= c.live.families;
      if (!this.comboCounts.has(c.live.key)) distinct++;
    }
    c.elementPoints = points;
    c.families = families;
    c.distinct = distinct;
    c.varietyBonus = SCORING.varietyPointsPerFamily * Math.max(0, popCount(families) - 1);
    c.multiplier = Math.min(SCORING.maxMultiplier, 1 + SCORING.multiplierStep * Math.max(0, distinct - 1));
    c.projected = Math.round((points + c.varietyBonus) * c.multiplier);
  }

  // ---------------------------------------------------------------------------
  // Fin de combo.

  private ensureActive(): void {
    if (this.combo.active) return;
    this.combo.active = true;
    this.combo.groundTime = 0;
    this.events.emit('comboStart', this.combo);
  }

  /** Validation : le score du combo est acquis. */
  private bank(quality: ComboEndQuality): void {
    const c = this.combo;
    if (!c.active) return;
    if (c.live) {
      this.release(c.live);
      c.live = null;
      this.recompute();
    }
    if (c.elements.length === 0) {
      this.endCombo();
      return;
    }
    const factor = quality === 'clean' ? 1 : SCORING.sloppyLandingFactor;
    const score = Math.round((c.elementPoints + c.varietyBonus) * c.multiplier * factor);
    const r = this.result;
    r.score = score;
    r.elementPoints = c.elementPoints;
    r.varietyBonus = c.varietyBonus;
    r.multiplier = c.multiplier;
    r.landingFactor = factor;
    r.quality = quality;
    r.elementCount = c.elements.length;
    r.label = c.elements.map((e) => e.label).join(' + ');

    this.sessionScore += score;
    if (score > this.sessionBestCombo) {
      this.sessionBestCombo = score;
      this.sessionBestLabel = r.label;
    }
    r.sessionScore = this.sessionScore;
    r.sessionBestCombo = this.sessionBestCombo;
    this.combosBanked++;
    this.lastResult = r;

    for (const el of c.elements) {
      this.history.push(el.key);
      if (this.history.length > SCORING.recentHistorySize) this.history.shift();
    }

    const recordCombo = score > this.records.bestCombo;
    const previousCombo = this.records.bestCombo;
    const recordSession = this.sessionScore > this.records.bestSession;
    const previousSession = this.records.bestSession;
    if (recordCombo) {
      this.records.bestCombo = score;
      this.records.bestComboLabel = r.label;
    }
    if (recordSession) this.records.bestSession = this.sessionScore;
    if (recordCombo || recordSession) this.store.save(this.records);

    this.events.emit('comboBanked', r);
    if (recordCombo) this.emitRecord('combo', score, previousCombo);
    // Le record de session n'est annoncé qu'au moment où il est battu ; il continue de monter ensuite.
    if (recordSession && !this.sessionRecordAnnounced) {
      this.sessionRecordAnnounced = true;
      this.emitRecord('session', this.sessionScore, previousSession);
    }
    this.endCombo();
  }

  /** Annulation : aucun point du combo n'est acquis. */
  private cancel(reason: ComboLossReason): void {
    const c = this.combo;
    if (!c.active) return;
    const l = this.loss;
    l.reason = reason;
    l.lost = c.projected;
    l.elementCount = c.elements.length + (c.live ? 1 : 0);
    this.combosLost++;
    this.lastLoss = l;
    this.events.emit('comboLost', l);
    this.endCombo();
  }

  private emitRecord(kind: RecordEvent['kind'], score: number, previous: number): void {
    const e = this.recordEvent;
    e.kind = kind;
    e.score = score;
    e.previous = previous;
    this.events.emit('record', e);
  }

  private endCombo(): void {
    const c = this.combo;
    c.active = false;
    c.elements.length = 0;
    c.live = null;
    c.groundTime = 0;
    this.comboCounts.clear();
    this.lastBalanceKind = null;
    this.airSinceBalance = 0;
    this.poolUsed = 0;
    this.recompute();
  }

  // ---------------------------------------------------------------------------
  // Réserve d'éléments : pas d'allocation une fois la réserve à la taille des plus longs combos.

  private acquire(): ScoreElement {
    let el = this.pool[this.poolUsed];
    if (!el) {
      el = { kind: 'air', key: '', label: '', base: 0, bonus: 0, transition: false, repeatFactor: 1, points: 0, families: 0, time: 0, distance: 0 };
      this.pool.push(el);
    }
    this.poolUsed++;
    return el;
  }

  /** Rend le dernier élément pris (élément en cours abandonné). */
  private release(el: ScoreElement): void {
    if (this.poolUsed > 0 && this.pool[this.poolUsed - 1] === el) this.poolUsed--;
  }
}

function popCount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}
