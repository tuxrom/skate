import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { Renderer } from './Renderer';
import { Input, KeyboardSource, type InputSnapshot } from './Input';
import { CameraRig, type CameraTarget } from './CameraRig';
import { PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { Level, SPAWN } from '@/world/Level';
import type { AssetProvider } from '@/world/assets';
import { Skater } from '@/skater/Skater';
import { SkaterVisual } from '@/skater/SkaterVisual';
import { AudioEngine } from '@/audio/AudioEngine';
import { DebugOverlay } from '@/ui/DebugOverlay';
import { PauseOverlay } from '@/ui/PauseOverlay';
import { DEBUG } from '@/config/render';
import { WORLD } from '@/config/physics';

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
  private readonly cameraRig: CameraRig;
  private readonly input = new Input();
  private readonly physics: PhysicsWorld;
  private readonly level: Level;
  private readonly skater: Skater;
  private readonly skaterVisual: SkaterVisual;
  private readonly audio = new AudioEngine();
  private readonly debug: DebugOverlay;
  private readonly pauseOverlay: PauseOverlay;
  private readonly loop: GameLoop;

  private paused = false;
  private readonly cameraTarget: CameraTarget = { position: new THREE.Vector3(), forward: new THREE.Vector3(), speed: 0 };
  private readonly forwardView = new THREE.Vector3();

  constructor(opts: GameOptions) {
    this.renderer = new Renderer(opts.container);
    this.input.addSource(new KeyboardSource());

    this.physics = new PhysicsWorld(opts.rapier);
    this.level = new Level(this.scene, this.physics, opts.assets);

    this.skater = new Skater(this.physics);
    this.skaterVisual = new SkaterVisual(this.skater, opts.assets.createSkater());
    this.scene.add(this.skaterVisual.object);

    const exclude = this.skater.bodyCollider;
    this.cameraRig = new CameraRig((from, dir, maxDist, radius) =>
      this.physics.sphereClearance(from, dir, maxDist, radius, exclude),
    );
    this.renderer.onResize((w, h) => this.cameraRig.setAspect(w, h));

    this.debug = new DebugOverlay(opts.container, opts.debug);
    this.pauseOverlay = new PauseOverlay(opts.container);
    this.loop = new GameLoop(
      {
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        render: (alpha, frameDt) => this.render(alpha, frameDt),
      },
      DEBUG.statsRefresh,
    );

    // Les colliders statiques doivent être indexés avant les premières requêtes.
    this.physics.step();
    this.respawn();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    this.loop.start();
  }

  /** Téléporte le skateur à l'arrêt (debug et tests). yaw = 0 regarde vers -Z. */
  debugTeleport(x: number, z: number, yaw: number): void {
    this.skater.reset(new THREE.Vector3(x, 0, z), new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)));
    this.skaterVisual.teleportSync();
    this.skaterVisual.render(1, 0);
    this.updateCameraTarget();
    this.cameraRig.snap(this.cameraTarget);
  }

  /** Instantané lisible pour le debug et les tests automatisés. */
  debugState(): Record<string, number | string | boolean> {
    const sk = this.skater;
    const cam = this.cameraRig.camera;
    return {
      state: sk.state ?? '',
      grounded: sk.grounded,
      speed: sk.speed,
      lean: sk.lean,
      x: sk.position.x,
      y: sk.position.y,
      z: sk.position.z,
      fx: sk.forward.x,
      fz: sk.forward.z,
      upY: sk.up.y,
      camX: cam.position.x,
      camY: cam.position.y,
      camZ: cam.position.z,
      fov: cam.fov,
      paused: this.paused,
      fps: this.loop.stats.fps,
    };
  }

  private respawn(): void {
    this.skater.reset(SPAWN.position, SPAWN.forward);
    this.skaterVisual.teleportSync();
    this.skaterVisual.render(1, 0);
    this.updateCameraTarget();
    this.cameraRig.snap(this.cameraTarget);
  }

  private fixedUpdate(dt: number): void {
    const input = this.input.poll();
    this.handleGlobalActions(input);
    if (this.paused) return;

    this.skater.step(dt, input);
    this.physics.step();
    this.skaterVisual.capture();
    if (this.skater.position.y < WORLD.killPlaneY) this.respawn();
  }

  private handleGlobalActions(input: InputSnapshot): void {
    if (input.pressed.has('debug')) this.debug.toggle();
    if (input.pressed.has('pause')) this.setPaused(!this.paused);
    if (input.pressed.has('reset')) {
      this.respawn();
      this.setPaused(false);
    }
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseOverlay.setVisible(paused);
    this.audio.setMuted(paused);
  }

  private updateCameraTarget(): void {
    const t = this.cameraTarget;
    t.position.copy(this.skaterVisual.object.position);
    // Le cap affiché suit la pose interpolée, pas l'état brut du pas fixe.
    t.forward.copy(this.forwardView.set(0, 0, -1).applyQuaternion(this.skaterVisual.object.quaternion));
    t.speed = this.skater.speed;
  }

  private render(alpha: number, frameDt: number): void {
    // En pause, on fige sur le dernier état simulé pour ne pas osciller entre deux poses.
    const a = this.paused ? 1 : alpha;
    const dt = this.paused ? 0 : frameDt;
    this.skaterVisual.render(a, dt);
    this.updateCameraTarget();
    if (!this.paused) this.cameraRig.update(this.cameraTarget, frameDt);
    this.level.followShadow(this.cameraTarget.position);
    this.renderer.render(this.scene, this.cameraRig.camera);

    const sk = this.skater;
    this.debug.update(this.loop.stats, this.renderer.three, {
      state: `${sk.state ?? '-'}${sk.grounded ? '' : ' (air)'}`,
      speed: `${sk.speed.toFixed(2)} m/s  ${(sk.speed * 3.6).toFixed(1)} km/h`,
      lean: `${sk.lean.toFixed(2)} rad`,
      surf: sk.surface,
      pos: `${sk.position.x.toFixed(1)} ${sk.position.y.toFixed(2)} ${sk.position.z.toFixed(1)}`,
    });
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.loop.stop();
      this.setPaused(true);
    } else {
      this.loop.start();
    }
  };
}
