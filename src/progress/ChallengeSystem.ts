import { EventBus } from '@/core/EventBus';
import { SCORE_FAMILY, type ScoreSystem } from '@/score/ScoreSystem';
import type { ChallengeDef, ZoneDef } from '@/world/challenges';
import type { ChallengeStore } from './Profile';

/** Chrono d'un défi en cours. */
export interface TimedRun {
  def: ChallengeDef;
  timeLeft: number;
  duration: number;
  /** Points validés ou éléments comptés depuis le départ. */
  value: number;
  target: number;
}

export interface ChallengeEvents {
  zoneEnter: ZoneDef;
  zoneExit: ZoneDef;
  /** Meilleure progression améliorée (0 à 1), sans réussite. */
  progress: { def: ChallengeDef; value: number };
  timedStart: TimedRun;
  timedEnd: { def: ChallengeDef; success: boolean };
  /** Défi réussi pour la première fois. */
  complete: ChallengeDef;
}

/**
 * Objectifs de zone. Suit la présence du skateur dans les zones, écoute les événements du score
 * et mesure la progression de chaque défi. Les zones sont repérées par un masque de bits (32 au plus).
 */
export class ChallengeSystem {
  readonly events = new EventBus<ChallengeEvents>();
  /** Zones où se trouve le skateur (masque d'indices de `zones`). */
  zoneMask = 0;
  timed: TimedRun | null = null;

  /** Zones touchées par le combo en cours, et zones au début du grind ou manual en cours. */
  private comboZones = 0;
  private liveZones = 0;
  private readonly zoneIndex = new Map<string, number>();
  private readonly run: TimedRun;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    readonly challenges: readonly ChallengeDef[],
    readonly zones: readonly ZoneDef[],
    private readonly store: ChallengeStore,
    score: ScoreSystem,
    private readonly position: { readonly x: number; readonly z: number },
  ) {
    if (zones.length > 31) throw new Error('32 zones au plus');
    zones.forEach((z, i) => this.zoneIndex.set(z.id, i));
    this.run = { def: challenges[0]!, timeLeft: 0, duration: 0, value: 0, target: 0 };
    const ev = score.events;
    this.unsubscribe.push(
      ev.on('comboStart', () => {
        this.comboZones = this.zoneMask;
      }),
      ev.on('liveStart', () => {
        this.liveZones = this.zoneMask;
        this.comboZones |= this.zoneMask;
      }),
      ev.on('element', ({ element }) => {
        const here = this.zoneMask | (element.kind === 'air' ? 0 : this.liveZones);
        this.comboZones |= here;
        for (const def of this.challenges) {
          const g = def.goal;
          if (!this.inZone(def, here)) continue;
          if (g.type === 'balance' && g.kind === element.kind) {
            const byMeters = g.meters ? element.distance / g.meters : 0;
            const bySeconds = g.seconds ? element.time / g.seconds : 0;
            this.record(def, Math.max(byMeters, bySeconds));
          } else if (g.type === 'air' && element.kind === 'air' && (element.families & SCORE_FAMILY[g.family]) !== 0) {
            this.record(def, 1);
          }
        }
        const t = this.timed;
        if (t && t.def.goal.type === 'timedCount' && t.def.goal.kind === element.kind) this.advanceTimed(1);
      }),
      ev.on('comboBanked', (r) => {
        for (const def of this.challenges) {
          if (def.goal.type === 'combo' && this.inZone(def, this.comboZones)) this.record(def, r.score / def.goal.points);
        }
        const t = this.timed;
        if (t && t.def.goal.type === 'timedScore') this.advanceTimed(r.score);
        this.comboZones = 0;
      }),
      ev.on('comboLost', () => {
        this.comboZones = 0;
      }),
    );
  }

  /** Pas fixe : zones, entrée dans une zone de chrono, décompte. */
  fixedUpdate(dt: number): void {
    let mask = 0;
    const p = this.position;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      if (Math.hypot(p.x - z.x, p.z - z.z) <= z.radius) mask |= 1 << i;
    }
    const entered = mask & ~this.zoneMask;
    const left = this.zoneMask & ~mask;
    this.zoneMask = mask;
    if (left) for (let i = 0; i < this.zones.length; i++) if (left & (1 << i)) this.events.emit('zoneExit', this.zones[i]!);
    if (entered) {
      for (let i = 0; i < this.zones.length; i++) {
        if (!(entered & (1 << i))) continue;
        this.events.emit('zoneEnter', this.zones[i]!);
        this.tryStartTimed(this.zones[i]!.id);
      }
    }
    const t = this.timed;
    if (t) {
      t.timeLeft -= dt;
      if (t.timeLeft <= 0) this.endTimed(false);
    }
  }

  /** Défis de la zone, dans l'ordre de déclaration. */
  challengesIn(zoneId: string): ChallengeDef[] {
    return this.challenges.filter((c) => c.zone === zoneId);
  }

  /** Abandonne le chrono en cours (retour au menu, réinitialisation). */
  cancelTimed(): void {
    if (this.timed) this.endTimed(false);
  }

  private tryStartTimed(zoneId: string): void {
    if (this.timed) return;
    for (const def of this.challenges) {
      const g = def.goal;
      if (def.zone !== zoneId || (g.type !== 'timedScore' && g.type !== 'timedCount')) continue;
      if (this.store.progress(def.id).done) continue;
      const r = this.run;
      r.def = def;
      r.duration = r.timeLeft = g.seconds;
      r.value = 0;
      r.target = g.type === 'timedScore' ? g.points : g.count;
      this.timed = r;
      this.events.emit('timedStart', r);
      return;
    }
  }

  private advanceTimed(amount: number): void {
    const t = this.timed;
    if (!t) return;
    t.value += amount;
    if (t.value >= t.target) this.endTimed(true);
  }

  private endTimed(success: boolean): void {
    const t = this.timed;
    if (!t) return;
    this.timed = null;
    this.record(t.def, success ? 1 : t.value / t.target);
    this.events.emit('timedEnd', { def: t.def, success });
  }

  private inZone(def: ChallengeDef, mask: number): boolean {
    const i = this.zoneIndex.get(def.zone);
    return i !== undefined && (mask & (1 << i)) !== 0;
  }

  private record(def: ChallengeDef, value: number): void {
    const before = this.store.progress(def.id);
    if (before.done) return;
    const prevBest = before.best;
    if (this.store.record(def.id, value)) {
      this.events.emit('complete', def);
    } else if (value > prevBest) {
      this.events.emit('progress', { def, value: Math.min(1, value) });
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.events.clear();
  }
}
