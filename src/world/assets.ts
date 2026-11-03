import * as THREE from 'three';
import { createCheckerTexture, createConcreteTexture } from './textures';

/**
 * Point d'entrée unique des visuels. Le gameplay demande un asset par identifiant
 * et reçoit un Object3D, sans savoir s'il est procédural ou chargé depuis un glTF.
 *
 * Pour passer aux modèles : écrire une GltfAssets qui implémente AssetProvider
 * (GLTFLoader + preload()), puis la passer à Game à la place de ProceduralAssets.
 */
export type AssetId = 'ground' | 'debugCrate';

export interface AssetProvider {
  /** Charge ce qui doit l'être avant la première frame. */
  preload(): Promise<void>;
  /** Retourne une nouvelle instance de l'asset. */
  create(id: AssetId, params?: AssetParams): THREE.Object3D;
  dispose(): void;
}

export interface AssetParams {
  /** Dimensions en mètres (x, y, z) pour les assets paramétriques. */
  size?: THREE.Vector3Like;
}

export class ProceduralAssets implements AssetProvider {
  private readonly disposables: { dispose(): void }[] = [];
  private concrete: THREE.CanvasTexture | null = null;
  private checker: THREE.CanvasTexture | null = null;

  async preload(): Promise<void> {
    this.concrete = this.track(createConcreteTexture({ seed: 7 }));
    this.checker = this.track(createCheckerTexture());
  }

  create(id: AssetId, params: AssetParams = {}): THREE.Object3D {
    switch (id) {
      case 'ground':
        return this.ground(params.size ?? { x: 200, y: 0, z: 200 });
      case 'debugCrate':
        return this.crate(params.size ?? { x: 0.5, y: 0.5, z: 0.5 });
    }
  }

  private ground(size: THREE.Vector3Like): THREE.Object3D {
    const tex = this.concrete!.clone();
    tex.repeat.set(size.x / 4, size.z / 4);
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(size.x, size.z).rotateX(-Math.PI / 2)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(tex), roughness: 0.95 })),
    );
    mesh.receiveShadow = true;
    mesh.name = 'ground';
    return mesh;
  }

  private crate(size: THREE.Vector3Like): THREE.Object3D {
    const mesh = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(size.x, size.y, size.z)),
      this.track(new THREE.MeshStandardMaterial({ map: this.checker, roughness: 0.6 })),
    );
    mesh.castShadow = true;
    mesh.name = 'debugCrate';
    return mesh;
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
