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
}

export interface LoopStats {
  fps: number;
  frameMs: number;
  stepsPerFrame: number;
  droppedSteps: number;
}

/**
 * Boucle à pas fixe avec accumulateur (« Fix your timestep »).
 * La simulation avance par pas de FIXED_DT, le rendu interpole avec alpha.
 */
export class GameLoop {
  readonly stats: LoopStats = { fps: 0, frameMs: 0, stepsPerFrame: 0, droppedSteps: 0 };

  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;
  private running = false;

  private statFrames = 0;
  private statTime = 0;
  private statSteps = 0;

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

    if (this.lastTime < 0) this.lastTime = now;
    const frameDt = Math.min((now - this.lastTime) / 1000, SIMULATION.maxFrameDelta);
    this.lastTime = now;

    this.accumulator += frameDt;
    let steps = 0;
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

    this.callbacks.render(this.accumulator / FIXED_DT, frameDt);
    this.updateStats(frameDt, steps);
  };

  private updateStats(frameDt: number, steps: number): void {
    this.statFrames++;
    this.statSteps += steps;
    this.statTime += frameDt;
    if (this.statTime >= this.statsRefresh) {
      this.stats.fps = this.statFrames / this.statTime;
      this.stats.frameMs = (this.statTime / this.statFrames) * 1000;
      this.stats.stepsPerFrame = this.statSteps / this.statFrames;
      this.statFrames = 0;
      this.statSteps = 0;
      this.statTime = 0;
    }
  }
}
