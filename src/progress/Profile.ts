import { EventBus } from '@/core/EventBus';
import type { RecordsStore, ScoreRecords } from '@/score/ScoreSystem';
import { levelFromXp, sanitizeSave, type ChallengeProgress, type SaveData, type Settings } from '@/save/SaveData';
import type { SaveStore } from '@/save/SaveStore';
import { unlockedBetween, type Customization } from './unlocks';

/** Délai entre une modification et son écriture (ms) : plusieurs changements rapprochés font une écriture. */
const SAVE_DEBOUNCE_MS = 400;

export interface LevelUpEvent {
  from: number;
  to: number;
  /** Noms des éléments débloqués. */
  unlocks: readonly string[];
}

export interface ProfileEvents {
  levelUp: LevelUpEvent;
  /** XP gagnée (montant, total). */
  xp: { gained: number; total: number };
  settings: Settings;
  custom: Customization;
  /** Écriture terminée (succès ou échec), pour le debug et les tests. */
  saved: { ok: boolean };
}

/** Accès aux défis réussis, utilisé par le système de défis. */
export interface ChallengeStore {
  progress(id: string): Readonly<ChallengeProgress>;
  /** Enregistre une progression (gardée si meilleure). Renvoie vrai si le défi vient d'être réussi. */
  record(id: string, value: number): boolean;
}

/**
 * Profil du joueur : sauvegarde en mémoire, niveau, défis, réglages, personnalisation.
 * Toute modification est écrite après SAVE_DEBOUNCE_MS, et immédiatement quand la page se cache.
 */
export class Profile implements RecordsStore, ChallengeStore {
  readonly events = new EventBus<ProfileEvents>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;
  /** Nombre d'écritures réussies (debug et tests). */
  saves = 0;

  private constructor(
    private readonly store: SaveStore,
    private readonly data: SaveData,
  ) {
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onHide);
  }

  static async load(store: SaveStore): Promise<Profile> {
    const raw = await store.load();
    return new Profile(store, sanitizeSave(raw));
  }

  get backend(): string {
    return this.store.backendName;
  }

  /** Copie des données, pour le debug et les tests. */
  snapshot(): SaveData {
    return JSON.parse(JSON.stringify(this.data)) as SaveData;
  }

  // ---------------------------------------------------------------------------
  // Niveau.

  get xp(): number {
    return this.data.xp;
  }

  get level(): number {
    return levelFromXp(this.data.xp).level;
  }

  /** XP dans le niveau courant et XP pour passer au suivant (0 au niveau max). */
  levelProgress(): { level: number; levelXp: number; nextXp: number } {
    return levelFromXp(this.data.xp);
  }

  addXp(amount: number): void {
    const gained = Math.max(0, Math.round(amount));
    if (gained === 0) return;
    const before = this.level;
    this.data.xp += gained;
    const after = this.level;
    this.events.emit('xp', { gained, total: this.data.xp });
    if (after > before) this.events.emit('levelUp', { from: before, to: after, unlocks: unlockedBetween(before, after) });
    this.markDirty();
  }

  // ---------------------------------------------------------------------------
  // Records (ScoreSystem).

  load(): ScoreRecords {
    return { ...this.data.records };
  }

  save(records: ScoreRecords): boolean {
    this.data.records = { ...records };
    this.markDirty();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Défis.

  progress(id: string): Readonly<ChallengeProgress> {
    return this.data.challenges[id] ?? NO_PROGRESS;
  }

  record(id: string, value: number): boolean {
    const p = this.data.challenges[id] ?? { done: false, best: 0 };
    const v = Math.min(1, Math.max(0, value));
    const justDone = !p.done && v >= 1;
    if (v <= p.best && !justDone) return false;
    p.best = Math.max(p.best, v);
    if (justDone) p.done = true;
    this.data.challenges[id] = p;
    this.markDirty();
    return justDone;
  }

  /** Identifiants des défis réussis. */
  completedChallenges(): Set<string> {
    const s = new Set<string>();
    for (const [id, p] of Object.entries(this.data.challenges)) if (p.done) s.add(id);
    return s;
  }

  // ---------------------------------------------------------------------------
  // Réglages et personnalisation.

  get settings(): Readonly<Settings> {
    return this.data.settings;
  }

  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.data.settings, patch);
    this.events.emit('settings', this.data.settings);
    this.markDirty();
  }

  get custom(): Readonly<Customization> {
    return this.data.custom;
  }

  updateCustom(patch: Partial<Customization>): void {
    Object.assign(this.data.custom, patch);
    this.events.emit('custom', this.data.custom);
    this.markDirty();
  }

  /** Efface toute la progression et les réglages (bouton des réglages). */
  resetAll(): void {
    const fresh = sanitizeSave(null);
    Object.assign(this.data, fresh);
    this.events.emit('settings', this.data.settings);
    this.events.emit('custom', this.data.custom);
    this.markDirty();
  }

  // ---------------------------------------------------------------------------
  // Écriture.

  /** Écrit tout de suite ce qui est en attente. */
  flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const copy = this.snapshot();
    this.saving = this.saving.then(async () => {
      const ok = await this.store.save(copy);
      if (ok) this.saves++;
      this.events.emit('saved', { ok });
    });
    return this.saving;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Page cachée ou quittée : on écrit sans attendre le délai (sans effet s'il n'y a rien en attente). */
  private readonly onHide = (): void => {
    void this.flush();
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onHide);
    void this.flush();
    this.events.clear();
  }
}

const NO_PROGRESS: Readonly<ChallengeProgress> = { done: false, best: 0 };
