import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { AssetProvider } from './assets';
import { RENDER } from '@/config/render';

/** Taille du sol de la scène de base (m). */
const GROUND_SIZE = 200;
/** Épaisseur du collider de sol (m). */
const GROUND_THICKNESS = 0.5;
/** Position du soleil relative au point suivi par l'ombre (m). */
const SUN_OFFSET = new THREE.Vector3(12, 20, 8);

/**
 * Niveau : visuels + colliders statiques. Pour l'instant un sol plat et l'éclairage.
 * Les modules (rampes, rails, curbs) seront ajoutés ici à partir de l'étape 5.
 */
export class Level {
  readonly root = new THREE.Group();
  readonly sun: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, assets: AssetProvider) {
    this.root.name = 'level';
    scene.add(this.root);

    scene.background = new THREE.Color(RENDER.clearColor);
    scene.fog = new THREE.Fog(RENDER.clearColor, RENDER.fogNear, RENDER.fogFar);

    this.root.add(new THREE.HemisphereLight(0xdfe9f3, 0x4a4036, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const s = RENDER.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
    this.root.add(this.sun, this.sun.target);

    this.root.add(assets.create('ground', { size: { x: GROUND_SIZE, y: 0, z: GROUND_SIZE } }));
    const R = physics.rapier;
    const groundBody = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -GROUND_THICKNESS / 2, 0));
    physics.world.createCollider(
      physics.withMaterial(R.ColliderDesc.cuboid(GROUND_SIZE / 2, GROUND_THICKNESS / 2, GROUND_SIZE / 2), 'concrete'),
      groundBody,
    );
  }

  /** Fait suivre la shadow map du soleil autour d'un point d'intérêt. */
  followShadow(focus: THREE.Vector3): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(SUN_OFFSET);
  }
}
