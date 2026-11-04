import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetProvider } from './assets';
import type { ZoneDef } from './challenges';

/** Couleurs des repères : défi à faire, tous les défis de la zone réussis, chrono en cours. */
const COLOR_OPEN = 0xf4d35e;
const COLOR_DONE = 0x6fcf7f;
const COLOR_ACTIVE = 0xff8a5c;

export type ZoneMarkerState = 'open' | 'done' | 'active';

/**
 * Repères visuels des zones d'objectifs, posés au sol. L'apparence vient de l'AssetProvider
 * (asset 'marker' : un anneau et une colonne) ; ici, tous les repères sont regroupés en deux draw calls :
 * les anneaux fusionnés avec une couleur par sommet, les colonnes en InstancedMesh avec une couleur par instance.
 */
export class ZoneMarkers {
  readonly root = new THREE.Group();
  private readonly index = new Map<string, number>();
  private readonly states: (ZoneMarkerState | null)[] = [];
  /** Plage de sommets de chaque anneau dans la géométrie fusionnée. */
  private readonly ringRanges: Array<{ start: number; count: number }> = [];
  private readonly rings: THREE.Mesh;
  private readonly pillars: THREE.InstancedMesh;
  private readonly ringColors: THREE.BufferAttribute;
  private readonly owned: { dispose(): void }[] = [];
  private readonly tmpColor = new THREE.Color();

  constructor(zones: readonly ZoneDef[], assets: AssetProvider) {
    this.root.name = 'zone-markers';
    const ringParts: THREE.BufferGeometry[] = [];
    let pillarGeo: THREE.BufferGeometry | null = null;
    let pillarMat: THREE.MeshBasicMaterial | null = null;
    let ringMat: THREE.MeshBasicMaterial | null = null;
    const pillarMatrices: THREE.Matrix4[] = [];
    let vertex = 0;
    zones.forEach((z, i) => {
      this.index.set(z.id, i);
      this.states.push(null);
      const marker = assets.create('marker', { radius: z.radius, color: 0xffffff });
      marker.position.set(z.x, 0, z.z);
      marker.updateMatrixWorld(true);
      for (const child of marker.children) {
        const m = child as THREE.Mesh;
        if (!m.isMesh) continue;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (m.geometry.type === 'RingGeometry') {
          const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
          const count = g.attributes.position!.count;
          this.ringRanges.push({ start: vertex, count });
          vertex += count;
          ringParts.push(g.index ? g.toNonIndexed() : g);
          ringMat ??= mat;
        } else {
          pillarGeo ??= m.geometry;
          pillarMat ??= mat;
          pillarMatrices.push(m.matrixWorld.clone());
        }
      }
    });

    const merged = mergeGeometries(ringParts, false)!;
    for (const g of ringParts) g.dispose();
    this.ringColors = new THREE.BufferAttribute(new Float32Array(vertex * 3).fill(1), 3);
    merged.setAttribute('color', this.ringColors);
    const rMat = ringMat!.clone();
    rMat.vertexColors = true;
    this.rings = new THREE.Mesh(merged, rMat);
    this.rings.renderOrder = 1;
    this.owned.push(merged, rMat);

    const pMat = pillarMat!.clone();
    this.pillars = new THREE.InstancedMesh(pillarGeo!, pMat, pillarMatrices.length);
    pillarMatrices.forEach((m, i) => this.pillars.setMatrixAt(i, m));
    this.pillars.renderOrder = 1;
    this.pillars.computeBoundingSphere();
    this.owned.push(pMat, this.pillars);
    this.root.add(this.rings, this.pillars);
    for (const z of zones) this.setState(z.id, 'open');
  }

  setState(zoneId: string, state: ZoneMarkerState): void {
    const i = this.index.get(zoneId);
    if (i === undefined || this.states[i] === state) return;
    this.states[i] = state;
    const c = this.tmpColor.setHex(state === 'done' ? COLOR_DONE : state === 'active' ? COLOR_ACTIVE : COLOR_OPEN);
    const r = this.ringRanges[i]!;
    for (let v = r.start; v < r.start + r.count; v++) this.ringColors.setXYZ(v, c.r, c.g, c.b);
    this.ringColors.needsUpdate = true;
    this.pillars.setColorAt(i, c);
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.owned) d.dispose();
    this.root.removeFromParent();
  }
}
