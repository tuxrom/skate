import * as THREE from 'three';
import { RENDER, type QualityPreset } from '@/config/render';

/** Enveloppe du WebGLRenderer : création, pixel ratio plafonné, redimensionnement. */
export class Renderer {
  readonly three: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private readonly listeners = new Set<(w: number, h: number) => void>();
  /** Plafond du pixel ratio et échelle de résolution, réglés par la qualité graphique. */
  private maxPixelRatio: number = RENDER.maxPixelRatio;
  private resolutionScale = 1;

  constructor(private readonly container: HTMLElement) {
    this.three = new THREE.WebGLRenderer({
      antialias: RENDER.antialias,
      powerPreference: 'high-performance',
    });
    this.three.setClearColor(RENDER.clearColor);
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.three.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.three.domElement;
  }

  onResize(listener: (w: number, h: number) => void): void {
    this.listeners.add(listener);
    listener(this.container.clientWidth, this.container.clientHeight);
  }

  /**
   * Qualité graphique : résolution (pixel ratio plafonné puis mis à l'échelle) et ombres.
   * Changer l'activation des ombres demande de recompiler les matériaux : `scene` est parcourue pour ça.
   */
  setQuality(q: QualityPreset, scene: THREE.Scene): void {
    this.maxPixelRatio = q.maxPixelRatio;
    this.resolutionScale = q.resolutionScale;
    if (this.three.shadowMap.enabled !== q.shadows) {
      this.three.shadowMap.enabled = q.shadows;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
    this.resize();
  }

  /** Pixel ratio effectif (debug). */
  get pixelRatio(): number {
    return this.three.getPixelRatio();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.three.render(scene, camera);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.resolutionScale);
    this.three.setSize(w, h, false);
    for (const l of this.listeners) l(w, h);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.three.dispose();
  }
}
