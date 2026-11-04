import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Nombre minimal de meshes identiques (même géométrie, même matériau) pour en faire un InstancedMesh. */
const MIN_INSTANCES = 3;

/** Résultat du regroupement : les meshes produits et leurs géométries, à libérer avec le niveau. */
export interface StaticBatch {
  /** Meshes fusionnés (un par matériau) et instanciés (un par géométrie répétée). */
  readonly meshes: readonly THREE.Mesh[];
  /** Avant / après, pour le debug. */
  readonly before: number;
  dispose(): void;
}

/**
 * Regroupe le décor statique pour réduire les draw calls (et ceux de la passe d'ombre) :
 * - les meshes qui partagent géométrie et matériau (montants, tronçons de rail) deviennent un InstancedMesh ;
 * - les autres sont fusionnés en un seul mesh par matériau, géométries ramenées dans le repère de `root`.
 * Seuls les enfants directs de `root` marqués statiques (`userData.batch !== false`) sont concernés ;
 * les originaux sont retirés de la scène. Les géométries d'origine restent à leur propriétaire (AssetProvider).
 */
export function batchStatic(root: THREE.Object3D): StaticBatch {
  root.updateMatrixWorld(true);
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const candidates: THREE.Mesh[] = [];
  for (const child of root.children) {
    const m = child as THREE.Mesh;
    if (!m.isMesh || m.userData.batch === false || Array.isArray(m.material)) continue;
    candidates.push(m);
  }

  // Groupes de géométries répétées.
  const byGeometry = new Map<string, THREE.Mesh[]>();
  for (const m of candidates) {
    const key = `${m.geometry.uuid}|${(m.material as THREE.Material).uuid}`;
    let list = byGeometry.get(key);
    if (!list) byGeometry.set(key, (list = []));
    list.push(m);
  }

  const out: THREE.Mesh[] = [];
  const ownGeometries: THREE.BufferGeometry[] = [];
  const local = new THREE.Matrix4();
  const toMerge = new Map<THREE.Material, THREE.Mesh[]>();

  for (const list of byGeometry.values()) {
    const first = list[0]!;
    if (list.length >= MIN_INSTANCES) {
      const inst = new THREE.InstancedMesh(first.geometry, first.material, list.length);
      list.forEach((m, i) => inst.setMatrixAt(i, local.multiplyMatrices(inverseRoot, m.matrixWorld)));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.castShadow = first.castShadow;
      inst.receiveShadow = first.receiveShadow;
      inst.name = `instanced:${first.name}`;
      out.push(inst);
    } else {
      for (const m of list) {
        const mat = m.material as THREE.Material;
        let group = toMerge.get(mat);
        if (!group) toMerge.set(mat, (group = []));
        group.push(m);
      }
    }
  }

  for (const [material, list] of toMerge) {
    if (list.length === 1) {
      // Rien à fusionner : le mesh reste tel quel.
      out.push(list[0]!);
      continue;
    }
    // Géométries sans index et aux mêmes attributs, ramenées dans le repère de root.
    const parts = list.map((m) => {
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(local.multiplyMatrices(inverseRoot, m.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      g.clearGroups();
      return g;
    });
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) {
      // Attributs incompatibles : on garde les originaux plutôt que de perdre du décor.
      out.push(...list);
      continue;
    }
    merged.computeBoundingSphere();
    ownGeometries.push(merged);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = list.some((m) => m.castShadow);
    mesh.receiveShadow = list.some((m) => m.receiveShadow);
    mesh.name = `merged:${list[0]!.name}`;
    out.push(mesh);
  }

  const kept = new Set(out);
  for (const m of candidates) if (!kept.has(m)) root.remove(m);
  for (const m of out) if (m.parent !== root) root.add(m);

  return {
    meshes: out,
    before: candidates.length,
    dispose() {
      for (const g of ownGeometries) g.dispose();
      for (const m of out) if (m instanceof THREE.InstancedMesh) m.dispose();
    },
  };
}
