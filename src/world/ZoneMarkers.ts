import * as THREE from 'three';
import type { AssetProvider } from './assets';
import type { ZoneDef } from './challenges';

/** Couleurs des repères : défi à faire, tous les défis de la zone réussis, chrono en cours. */
const COLOR_OPEN = 0xf4d35e;
const COLOR_DONE = 0x6fcf7f;
const COLOR_ACTIVE = 0xff8a5c;

export type ZoneMarkerState = 'open' | 'done' | 'active';

/** Repères visuels des zones d'objectifs, posés au sol. */
export class ZoneMarkers {
  readonly root = new THREE.Group();
  private readonly markers = new Map<string, { object: THREE.Object3D; state: ZoneMarkerState | null }>();

  constructor(zones: readonly ZoneDef[], assets: AssetProvider) {
    this.root.name = 'zone-markers';
    for (const z of zones) {
      const object = assets.create('marker', { radius: z.radius, color: COLOR_OPEN });
      object.position.set(z.x, 0, z.z);
      this.root.add(object);
      this.markers.set(z.id, { object, state: null });
    }
  }

  setState(zoneId: string, state: ZoneMarkerState): void {
    const m = this.markers.get(zoneId);
    if (!m || m.state === state) return;
    m.state = state;
    const color = state === 'done' ? COLOR_DONE : state === 'active' ? COLOR_ACTIVE : COLOR_OPEN;
    m.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (mat instanceof THREE.MeshBasicMaterial) mat.color.setHex(color);
    });
  }

  /** Les géométries et matériaux appartiennent à l'AssetProvider, qui les libère. */
  dispose(): void {
    this.root.removeFromParent();
  }
}
