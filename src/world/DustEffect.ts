import * as THREE from 'three';
import { FX } from '@/config/render';
import { seededRandom } from './textures';

const VERTEX = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(0.001, -mv.z);
    vAlpha = aAlpha;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(uColor, vAlpha * (1.0 - r) * (1.0 - r));
  }
`;

/**
 * Poussière soulevée aux impacts : un pool fixe de points, sans allocation après la construction.
 * Les particules partent à plat le long de la surface, montent un peu, ralentissent et s'estompent.
 */
export class DustEffect {
  readonly object: THREE.Points;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly rand = seededRandom(99);
  private cursor = 0;
  private alive = 0;
  private readonly tangent = new THREE.Vector3();
  private readonly bitangent = new THREE.Vector3();

  constructor() {
    const n = FX.dustPoolSize;
    this.positions = new Float32Array(n * 3);
    this.alphas = new Float32Array(n);
    this.sizes = new Float32Array(n);
    this.velocities = new Float32Array(n * 3);
    this.ages = new Float32Array(n).fill(Infinity);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(FX.dustColor) }, uScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.name = 'dust';
  }

  /** Hauteur du viewport en pixels physiques, pour la taille des points. */
  setViewportHeight(pixels: number): void {
    this.material.uniforms['uScale']!.value = pixels * 0.5;
  }

  /** Émet une bouffée de `count` particules au point donné, à plat sur la surface de normale `normal`. */
  burst(position: THREE.Vector3, normal: THREE.Vector3, count: number, speedScale = 1): void {
    const total = Math.min(FX.dustMaxBurst, Math.round(count));
    this.tangent.set(1, 0, 0);
    if (Math.abs(normal.x) > 0.9) this.tangent.set(0, 0, 1);
    this.tangent.addScaledVector(normal, -this.tangent.dot(normal)).normalize();
    this.bitangent.crossVectors(normal, this.tangent);
    for (let k = 0; k < total; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % FX.dustPoolSize;
      const a = this.rand() * Math.PI * 2;
      const sp = FX.dustSpeed * speedScale * (0.4 + this.rand() * 0.8);
      const ca = Math.cos(a) * sp;
      const sa = Math.sin(a) * sp;
      const lift = sp * (0.15 + this.rand() * 0.35);
      const i3 = i * 3;
      this.positions[i3] = position.x + normal.x * 0.03;
      this.positions[i3 + 1] = position.y + normal.y * 0.03;
      this.positions[i3 + 2] = position.z + normal.z * 0.03;
      this.velocities[i3] = this.tangent.x * ca + this.bitangent.x * sa + normal.x * lift;
      this.velocities[i3 + 1] = this.tangent.y * ca + this.bitangent.y * sa + normal.y * lift;
      this.velocities[i3 + 2] = this.tangent.z * ca + this.bitangent.z * sa + normal.z * lift;
      this.ages[i] = this.rand() * 0.1;
    }
    this.alive = FX.dustPoolSize;
  }

  /** Avance les particules (temps de rendu). */
  update(dt: number): void {
    if (this.alive === 0 || dt <= 0) return;
    const drag = Math.exp(-4 * dt);
    let alive = 0;
    for (let i = 0; i < FX.dustPoolSize; i++) {
      const age = (this.ages[i]! += dt);
      if (age >= FX.dustLifetime) {
        this.alphas[i] = 0;
        continue;
      }
      alive++;
      const i3 = i * 3;
      this.velocities[i3]! *= drag;
      this.velocities[i3 + 1]! *= drag;
      this.velocities[i3 + 2]! *= drag;
      this.positions[i3]! += this.velocities[i3]! * dt;
      this.positions[i3 + 1]! += this.velocities[i3 + 1]! * dt;
      this.positions[i3 + 2]! += this.velocities[i3 + 2]! * dt;
      const life = age / FX.dustLifetime;
      this.alphas[i] = FX.dustOpacity * (1 - life) * Math.min(1, age * 20);
      this.sizes[i] = FX.dustSize * (1 + (FX.dustGrowth - 1) * life);
    }
    this.alive = alive;
    this.geometry.attributes['position']!.needsUpdate = true;
    this.geometry.attributes['aAlpha']!.needsUpdate = true;
    this.geometry.attributes['aSize']!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
