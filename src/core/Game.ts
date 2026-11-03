import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { Renderer } from './Renderer';
import { Input, KeyboardSource, type InputSnapshot } from './Input';
import { CameraRig } from './CameraRig';
import { PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { InterpolatedBody } from '@/physics/InterpolatedBody';
import { Level } from '@/world/Level';
import type { AssetProvider } from '@/world/assets';
import { AudioEngine } from '@/audio/AudioEngine';
import { DebugOverlay } from '@/ui/DebugOverlay';
import { DEBUG } from '@/config/render';
import { WORLD } from '@/config/physics';

/** Point d'apparition de la caisse de debug (m). Remplacée par le skateur à l'étape 1. */
const PROBE_SPAWN = new THREE.Vector3(0, 3, 0);

export interface GameOptions {
  container: HTMLElement;
  rapier: Rapier;
  assets: AssetProvider;
  debug: boolean;
}

/** Assemble les sous-systèmes et les cadence via la boucle à pas fixe. */
export class Game {
  private readonly renderer: Renderer;
  private readonly scene = new THREE.Scene();
  private readonly cameraRig = new CameraRig();
  private readonly input = new Input();
  private readonly physics: PhysicsWorld;
  private readonly level: Level;
  private readonly audio = new AudioEngine();
  private readonly debug: DebugOverlay;
  private readonly loop: GameLoop;

  private readonly probe: InterpolatedBody;
  private readonly focus = new THREE.Vector3();
  private simTime = 0;
  private stepCount = 0;

  constructor(opts: GameOptions) {
    this.renderer = new Renderer(opts.container);
    this.renderer.onResize((w, h) => this.cameraRig.setAspect(w, h));
    this.input.addSource(new KeyboardSource());

    this.physics = new PhysicsWorld(opts.rapier);
    this.level = new Level(this.scene, this.physics, opts.assets);
    this.probe = this.createProbe(opts.assets);

    this.debug = new DebugOverlay(opts.container, opts.debug);
    this.loop = new GameLoop(
      {
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        render: (alpha, frameDt) => this.render(alpha, frameDt),
      },
      DEBUG.statsRefresh,
    );

    this.cameraRig.snap(PROBE_SPAWN, 0);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    this.loop.start();
  }

  private createProbe(assets: AssetProvider): InterpolatedBody {
    const R = this.physics.rapier;
    const mesh = assets.create('debugCrate');
    this.scene.add(mesh);
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(PROBE_SPAWN.x, PROBE_SPAWN.y, PROBE_SPAWN.z).setAngvel({ x: 2, y: 1, z: 0 }),
    );
    this.physics.world.createCollider(this.physics.withMaterial(R.ColliderDesc.cuboid(0.25, 0.25, 0.25), 'wood'), body);
    return new InterpolatedBody(body, mesh);
  }

  private resetProbe(): void {
    const b = this.probe.body;
    b.setTranslation(PROBE_SPAWN, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 2, y: 1, z: 0 }, true);
    this.probe.teleportSync();
  }

  private fixedUpdate(dt: number): void {
    const input = this.input.poll();
    this.handleGlobalActions(input);

    this.physics.step();
    this.probe.capture();
    if (this.probe.body.translation().y < WORLD.killPlaneY) this.resetProbe();

    this.simTime += dt;
    this.stepCount++;
  }

  private handleGlobalActions(input: InputSnapshot): void {
    if (input.pressed.has('debug')) this.debug.toggle();
    if (input.pressed.has('reset')) {
      this.resetProbe();
      this.audio.blip();
    }
  }

  private render(alpha: number, frameDt: number): void {
    this.probe.apply(alpha);
    this.focus.copy(this.probe.object.position);
    this.cameraRig.update(this.focus, 0, frameDt);
    this.level.followShadow(this.focus);
    this.renderer.render(this.scene, this.cameraRig.camera);

    this.debug.update(this.loop.stats, this.renderer.three, {
      sim: `${this.simTime.toFixed(2)} s (${this.stepCount} pas)`,
      alpha: alpha.toFixed(3),
    });
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.loop.stop();
    else this.loop.start();
  };
}
