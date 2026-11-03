import type * as THREE from 'three';
import type { LoopStats } from '@/core/GameLoop';
import { SIMULATION } from '@/config/physics';

/** Panneau de debug : FPS, temps de frame, pas physiques, stats de rendu. */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private visible: boolean;

  constructor(parent: HTMLElement, visible: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    Object.assign(this.el.style, {
      position: 'fixed',
      top: 'max(8px, env(safe-area-inset-top))',
      left: 'max(8px, env(safe-area-inset-left))',
      padding: '6px 8px',
      font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      color: '#e8f0e8',
      background: 'rgba(0,0,0,0.55)',
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(stats: LoopStats, renderer: THREE.WebGLRenderer, extra: Record<string, string> = {}): void {
    if (!this.visible) return;
    const info = renderer.info.render;
    const lines = [
      `FPS    ${stats.fps.toFixed(0).padStart(4)}`,
      `frame  ${stats.frameMs.toFixed(2).padStart(6)} ms`,
      `phys   ${SIMULATION.stepHz} Hz, ${stats.stepsPerFrame.toFixed(2)} pas/frame`,
      `drop   ${stats.droppedSteps}`,
      `draws  ${info.calls}  tris ${info.triangles}`,
      `dpr    ${renderer.getPixelRatio().toFixed(2)}`,
    ];
    for (const [k, v] of Object.entries(extra)) lines.push(`${k.padEnd(6)} ${v}`);
    this.el.textContent = lines.join('\n');
  }
}
