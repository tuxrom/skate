/**
 * Moteur audio Web Audio. Tous les sons sont synthétisés ; une future
 * implémentation pourra charger des samples derrière la même interface.
 * Le contexte n'est créé qu'au premier geste utilisateur (politique d'autoplay).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  constructor(private readonly volume = 0.8) {
    const unlock = () => {
      this.ensureContext();
      void this.ctx?.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Nœud auquel brancher les voix synthétisées. */
  get output(): AudioNode | null {
    return this.master;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  /** Bip court de test (debug). */
  blip(freq = 660, duration = 0.08): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.3, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private ensureContext(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
