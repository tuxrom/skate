import * as THREE from 'three';
import { RENDER } from '@/config/render';

/** Enveloppe du WebGLRenderer : création, pixel ratio plafonné, redimensionnement. */
export class Renderer {
  readonly three: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private readonly listeners = new Set<(w: number, h: number) => void>();

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

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.three.render(scene, camera);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
    this.three.setSize(w, h, false);
    for (const l of this.listeners) l(w, h);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.three.dispose();
  }
}
