import * as THREE from 'three';
import { createConcreteTexture } from './textures';
import type { SkaterRig } from '@/skater/SkaterRig';
import { ProceduralSkaterRig } from '@/skater/ProceduralSkaterRig';

/**
 * Point d'entrée unique des visuels. Le gameplay demande un asset par identifiant
 * et reçoit un Object3D, sans savoir s'il est procédural ou chargé depuis un glTF.
 *
 * Pour passer aux modèles : écrire une GltfAssets qui implémente AssetProvider
 * (GLTFLoader + preload()), puis la passer à Game à la place de ProceduralAssets.
 */
export type AssetId = 'ground' | 'box' | 'prism' | 'rail' | 'marker';

/** Aspect de surface d'un élément de décor. */
export type Finish = 'ground' | 'park' | 'wall' | 'metal';

/** Profil 2D (z, y) d'un module extrudé sur sa largeur (axe X local). */
export type Profile = ReadonlyArray<readonly [number, number]>;

export interface AssetParams {
  /** Dimensions en mètres (x, y, z). */
  size?: THREE.Vector3Like;
  /** Contour du module pour 'prism'. */
  profile?: Profile;
  /** Largeur d'extrusion du profil (m). */
  width?: number;
  /** Longueur et rayon d'un tube 'rail', centré, le long de Y (m). La longueur est une mise à l'échelle :
   * tous les tubes de même rayon partagent une géométrie, ce qui permet de les instancier. */
  length?: number;
  radius?: number;
  finish?: Finish;
  /** Couleur d'un repère 'marker' (0xRRGGBB). */
  color?: number;
}

export interface AssetProvider {
  /** Charge ce qui doit l'être avant la première frame. */
  preload(): Promise<void>;
  /** Retourne une nouvelle instance de l'asset. */
  create(id: AssetId, params?: AssetParams): THREE.Object3D;
  /** Retourne un skateur animable. */
  createSkater(): SkaterRig;
  dispose(): void;
}

/** Mètres par répétition de texture : les UV des géométries sont exprimées en mètres. */
const TEXTURE_METERS = 4;

export class ProceduralAssets implements AssetProvider {
  private readonly disposables: { dispose(): void }[] = [];
  private readonly materials = new Map<Finish, THREE.MeshStandardMaterial>();
  /** Géométries déjà construites, par paramètres : deux demandes identiques partagent la même géométrie. */
  private readonly geometries = new Map<string, THREE.BufferGeometry>();

  async preload(): Promise<void> {
    const make = (finish: Finish, tex: THREE.CanvasTexture, roughness: number) => {
      tex.repeat.set(1 / TEXTURE_METERS, 1 / TEXTURE_METERS);
      this.materials.set(finish, this.track(new THREE.MeshStandardMaterial({ map: this.track(tex), roughness })));
    };
    make('ground', createConcreteTexture({ seed: 7, slab: 128 }), 0.95);
    make('park', createConcreteTexture({ seed: 21, base: '#b3aea5', slab: 512 }), 0.85);
    make('wall', createConcreteTexture({ seed: 4, base: '#5f6b75', slab: 256 }), 0.9);
    this.materials.set('metal', this.track(new THREE.MeshStandardMaterial({ color: 0xa9b1b8, roughness: 0.35, metalness: 0.85 })));
  }

  create(id: AssetId, params: AssetParams = {}): THREE.Object3D {
    if (id === 'marker') return this.createMarker(params.radius ?? 3, params.color ?? 0xf4d35e);
    const fallback: Finish = id === 'ground' ? 'ground' : id === 'rail' ? 'metal' : 'park';
    const material = this.materials.get(params.finish ?? fallback)!;
    const key = geometryKey(id, params);
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = this.buildGeometry(id, params);
      this.geometries.set(key, this.track(geometry));
    }
    const mesh = new THREE.Mesh(geometry, material);
    if (id === 'rail') mesh.scale.y = params.length ?? 1;
    mesh.receiveShadow = true;
    mesh.castShadow = id !== 'ground';
    mesh.name = id;
    return mesh;
  }

  private buildGeometry(id: Exclude<AssetId, 'marker'>, params: AssetParams): THREE.BufferGeometry {
    let geometry: THREE.BufferGeometry;
    switch (id) {
      case 'ground': {
        const s = params.size ?? { x: 200, y: 0, z: 200 };
        geometry = new THREE.PlaneGeometry(s.x, s.z).rotateX(-Math.PI / 2);
        scaleUv(geometry, 0, 4, s.x, s.z);
        break;
      }
      case 'box': {
        const s = params.size ?? { x: 1, y: 1, z: 1 };
        geometry = new THREE.BoxGeometry(s.x, s.y, s.z);
        // Faces dans l'ordre px, nx, py, ny, pz, nz ; 4 sommets chacune.
        scaleUv(geometry, 0, 8, s.z, s.y);
        scaleUv(geometry, 8, 16, s.x, s.z);
        scaleUv(geometry, 16, 24, s.x, s.y);
        break;
      }
      case 'prism':
        geometry = extrudeProfile(params.profile ?? [], params.width ?? 1);
        break;
      case 'rail': {
        // Longueur 1 : la longueur demandée est appliquée par l'échelle du mesh.
        const r = params.radius ?? 0.025;
        geometry = new THREE.CylinderGeometry(r, r, 1, 12);
        break;
      }
    }
    return geometry;
  }

  /**
   * Repère de zone : anneau au sol et colonne lumineuse au centre, visibles de loin, sans ombre.
   * Chaque repère a ses matériaux, pour changer sa couleur seul (MeshBasicMaterial.color).
   */
  private createMarker(radius: number, color: number): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'marker';
    const ringMat = this.track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(radius - 0.18, radius, 72).rotateX(-Math.PI / 2)), ringMat);
    ring.position.y = 0.03;
    ring.renderOrder = 1;
    const pillarMat = this.track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
    const pillar = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.12, 0.12, 5, 12, 1, true)), pillarMat);
    pillar.position.y = 2.5;
    pillar.renderOrder = 1;
    group.add(ring, pillar);
    return group;
  }

  createSkater(): SkaterRig {
    return new ProceduralSkaterRig();
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.materials.clear();
    this.geometries.clear();
  }
}

/** Clé de cache d'une géométrie : seuls les paramètres qui changent sa forme comptent. */
function geometryKey(id: AssetId, p: AssetParams): string {
  const s = p.size;
  switch (id) {
    case 'ground':
    case 'box':
      return `${id}:${s ? `${s.x},${s.y},${s.z}` : ''}`;
    case 'rail':
      return `rail:${p.radius ?? 0.025}`;
    case 'prism':
      return `prism:${p.width ?? 1}:${(p.profile ?? []).map(([z, y]) => `${z},${y}`).join(';')}`;
    case 'marker':
      return 'marker';
  }
}

/** Multiplie les UV des sommets [from, to[ pour qu'une unité d'UV vaille un mètre. */
function scaleUv(geo: THREE.BufferGeometry, from: number, to: number, su: number, sv: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = from; i < to && i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

/**
 * Extrude un profil (z, y) sur la largeur, centrée sur X.
 * Les UV d'ExtrudeGeometry sont déjà en unités du profil, donc en mètres.
 */
function extrudeProfile(profile: Profile, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  // Repère du profil : X = z local, Y = y, extrusion le long de Z. On tourne pour extruder le long de X.
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}
