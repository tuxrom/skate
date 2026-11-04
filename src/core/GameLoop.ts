import { FIXED_DT, SIMULATION } from '@/config/physics';

export interface LoopCallbacks {
  /** Appelé à pas fixe (FIXED_DT secondes). */
  fixedUpdate(dt: number): void;
  /**
   * Appelé une fois par frame affichée.
   * @param alpha facteur d'interpolation entre l'avant-dernier et le dernier pas, dans [0, 1[.
   * @param frameDt durée réelle de la frame (s), bornée.
   */
  render(alpha: number, frameDt: number): void;
  /** Exception pendant une frame : la boucle s'arrête (plutôt que de relancer l'erreur à chaque frame). */
  onError?(error: unknown): void;
}

export interface LoopStats {
  fps: number;
  frameMs: number;
  stepsPerFrame: number;
  droppedSteps: number;
  /** Temps CPU moyen par frame passé dans la simulation (ms), sur la dernière fenêtre de stats. */
  fixedMs: number;
  /** Temps CPU moyen par frame passé dans le rendu (ms) : JS et envoi des commandes WebGL. */
  renderMs: number;
}

/**
 * Boucle à pas fixe avec accumulateur (« Fix your timestep »).
 * La simulation avance par pas de FIXED_DT, le rendu interpole avec alpha.
 */
export class GameLoop {
  readonly stats: LoopStats = { fps: 0, frameMs: 0, stepsPerFrame: 0, droppedSteps: 0, fixedMs: 0, renderMs: 0 };

  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;
  private running = false;

  private statFrames = 0;
  private statTime = 0;
  private statSteps = 0;
  private statFixed = 0;
  private statRender = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly statsRefresh = 0.5,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    try {
      this.frame(now);
    } catch (e) {
      this.stop();
      if (this.callbacks.onError) this.callbacks.onError(e);
      else throw e;
    }
  };

  private frame(now: number): void {
    if (this.lastTime < 0) this.lastTime = now;
    const frameDt = Math.min((now - this.lastTime) / 1000, SIMULATION.maxFrameDelta);
    this.lastTime = now;

    this.accumulator += frameDt;
    let steps = 0;
    const t0 = performance.now();
    while (this.accumulator >= FIXED_DT) {
      if (steps >= SIMULATION.maxStepsPerFrame) {
        // Trop de retard : on jette le reste plutôt que de geler.
        this.stats.droppedSteps += Math.floor(this.accumulator / FIXED_DT);
        this.accumulator %= FIXED_DT;
        break;
      }
      this.callbacks.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }

    const t1 = performance.now();
    this.callbacks.render(this.accumulator / FIXED_DT, frameDt);
    this.statFixed += t1 - t0;
    this.statRender += performance.now() - t1;
    this.updateStats(frameDt, steps);
  }

  private updateStats(frameDt: number, steps: number): void {
    this.statFrames++;
    this.statSteps += steps;
    this.statTime += frameDt;
    if (this.statTime >= this.statsRefresh) {
      this.stats.fps = this.statFrames / this.statTime;
      this.stats.frameMs = (this.statTime / this.statFrames) * 1000;
      this.stats.stepsPerFrame = this.statSteps / this.statFrames;
      this.stats.fixedMs = this.statFixed / this.statFrames;
      this.stats.renderMs = this.statRender / this.statFrames;
      this.statFixed = this.statRender = 0;
      this.statFrames = 0;
      this.statSteps = 0;
      this.statTime = 0;
    }
  }
}
