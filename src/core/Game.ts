import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { Renderer } from './Renderer';
import { GamepadSource, Input, KeyboardSource, MouseFlickSource, type InputSnapshot } from './Input';
import { CameraRig, type CameraTarget } from './CameraRig';
import { PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { Level, SPAWN } from '@/world/Level';
import type { AssetProvider } from '@/world/assets';
import { Skater, type ActiveTrick, type LandingInfo } from '@/skater/Skater';
import { trickName } from '@/skater/tricks';
import { FlickDebugPanel } from '@/ui/FlickDebugPanel';
import { BalanceMeter } from '@/ui/BalanceMeter';
import { BALANCE_MOVES } from '@/skater/grinds';
import { SkaterVisual } from '@/skater/SkaterVisual';
import { AudioEngine } from '@/audio/AudioEngine';
import { DebugOverlay } from '@/ui/DebugOverlay';
import { PauseOverlay } from '@/ui/PauseOverlay';
import { DEBUG, FX } from '@/config/render';
import { BAIL, WORLD } from '@/config/physics';
import { DustEffect } from '@/world/DustEffect';

/** Vitesse au-dessus de laquelle le sens de marche oriente la caméra (m/s). */
const CAMERA_TRAVEL_MIN_SPEED = 0.6;

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
  private readonly flickPanel: FlickDebugPanel;
  private readonly balanceMeter: BalanceMeter;
  /** Dernier grind ou manual terminé, pour le debug (les combos de l'étape 7 s'en serviront). */
  private lastBalanceText = '-';
  private balanceMoves = 0;
  /** Dernières fins de grind et de manual (debug). */
  private readonly balanceLog: string[] = [];
  private readonly loop: GameLoop;
  private readonly dust = new DustEffect();

  private paused = false;
  private readonly cameraTarget: CameraTarget = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    speed: 0,
    airborne: false,
    landingValid: false,
    landingPoint: new THREE.Vector3(),
    landingTime: 0,
  };
  /** Impact en attente pour la caméra, appliqué au prochain rendu (m/s). */
  private pendingImpact = 0;
  private readonly tailPoint = new THREE.Vector3();
  /** Dernière réception, pour le debug et les tests. */
  private landings = 0;
  private lastLandingText = '-';
  private lastTrickText = '-';
  private lastTrick = '';
  private lastTrickScore = 0;
  private cameraOverride: THREE.Vector3 | null = null;
  /** Sens de marche retenu pour la caméra : +1 nose devant, -1 fakie. */
  private travelSign = 1;
  private lastFlickX = 0;
  private lastFlickY = 0;
  private readonly forwardView = new THREE.Vector3();

  constructor(opts: GameOptions) {
    this.renderer = new Renderer(opts.container);
    this.input.addSource(new KeyboardSource());
    this.input.addSource(new GamepadSource());
    this.input.addSource(new MouseFlickSource(this.renderer.canvas));

    this.physics = new PhysicsWorld(opts.rapier);
    this.level = new Level(this.scene, this.physics, opts.assets);

    this.skater = new Skater(this.physics);
    this.skater.grinds = this.level.grinds;
    this.skaterVisual = new SkaterVisual(this.skater, opts.assets.createSkater());
    this.scene.add(this.skaterVisual.object);
    this.scene.add(this.dust.object);
    this.skater.events = {
      pop: (charge, position, trick) => this.onPop(charge, position, trick),
      land: (info) => this.onLand(info),
      balanceStart: () => {
        this.balanceMoves++;
      },
      balanceEnd: (move, time, distance, reason) => {
        this.lastBalanceText = `${BALANCE_MOVES[move].name} ${time.toFixed(2)} s, ${distance.toFixed(1)} m, ${reason}`;
        this.balanceLog.push(this.lastBalanceText);
        if (this.balanceLog.length > 8) this.balanceLog.shift();
      },
    };

    const exclude = this.skater.bodyCollider;
    this.cameraRig = new CameraRig((from, dir, maxDist, radius) =>
      this.physics.sphereClearance(from, dir, maxDist, radius, exclude),
    );
    this.renderer.onResize((w, h) => {
      this.cameraRig.setAspect(w, h);
      this.dust.setViewportHeight(h * this.renderer.three.getPixelRatio());
    });

    this.debug = new DebugOverlay(opts.container, opts.debug);
    this.pauseOverlay = new PauseOverlay(opts.container);
    this.flickPanel = new FlickDebugPanel(opts.container, opts.debug);
    this.balanceMeter = new BalanceMeter(opts.container);
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
    this.travelSign = 1;
    this.updateCameraTarget();
    this.cameraRig.snap(this.cameraTarget);
  }

  /** Force la caméra à un point de vue fixe, relatif au skateur (debug, captures). null rend la main. */
  debugCameraOverride(offset: { x: number; y: number; z: number } | null): void {
    this.cameraOverride = offset ? new THREE.Vector3(offset.x, offset.y, offset.z) : null;
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
      charge: sk.charge,
      airTime: sk.airTime,
      landings: this.landings,
      landQuality: sk.lastLanding.quality,
      landImpact: sk.lastLanding.impactSpeed,
      landTilt: sk.lastLanding.tilt,
      landYaw: sk.lastLanding.yawError,
      peak: sk.lastLanding.peakHeight,
      predValid: sk.prediction.valid,
      predY: sk.prediction.point.y,
      predT: sk.prediction.time,
      trick: this.lastTrick,
      trickScore: this.lastTrickScore,
      trickProgress: Math.min(1, sk.trick.time / sk.trick.duration),
      landTrick: sk.lastLanding.trick,
      landResidual: sk.lastLanding.boardResidual,
      gesturePhase: this.input.flickRecognizer.currentPhase,
      gestureTrick: this.input.flickRecognizer.lastEvent?.trick ?? '',
      gestureScore: this.input.flickRecognizer.lastEvent?.score ?? 0,
      gestureSweep: this.input.flickRecognizer.lastEvent?.features.sweep ?? 0,
      gestureEnd: this.input.flickRecognizer.lastEvent?.features.endAngle ?? 0,
      gestureMinR: this.input.flickRecognizer.lastEvent?.features.minRadius ?? 0,
      gestureDuration: this.input.flickRecognizer.lastEvent?.features.duration ?? 0,
      grinding: sk.grinding,
      grindReject: sk.grindReject,
      balanceMove: sk.balanceMove ?? '',
      balance: sk.balance,
      grindSpeed: sk.grind.speed,
      grindSegment: sk.grinding ? sk.grind.segment!.index : -1,
      grindKind: sk.grinding ? sk.grind.segment!.kind : '',
      balanceMoves: this.balanceMoves,
      lastBalance: this.lastBalanceText,
      balanceLog: this.balanceLog.join(' | '),
      spinAngle: sk.spinAngle,
      spinRate: sk.spinRate,
      grab: sk.grabId ?? '',
      grabAmount: sk.grabAmount,
      landLabel: sk.lastLanding.label,
      landSpin: sk.lastLanding.spinDegrees,
      landSpinError: sk.lastLanding.spinError,
      landGrabs: sk.lastLanding.grabs.join(','),
      landGrabContact: sk.lastLanding.grabAtContact,
      camX: cam.position.x,
      camY: cam.position.y,
      camZ: cam.position.z,
      fov: cam.fov,
      paused: this.paused,
      fps: this.loop.stats.fps,
    };
  }

  private onPop(charge: number, position: THREE.Vector3, trick: ActiveTrick): void {
    this.audio.pop(charge);
    this.lastTrick = trick.id;
    this.lastTrickScore = trick.score;
    this.lastTrickText = `${trickName(trick.id, trick.side)} ${(trick.score * 100).toFixed(0)} %, rot ${trick.duration.toFixed(2)} s`;
    // Poussière sous le tail, qui vient de frapper le sol.
    this.tailPoint.copy(this.skater.forward).multiplyScalar(-0.3).add(position);
    this.dust.burst(this.tailPoint, this.skater.up, FX.dustOnPop, 0.6);
  }

  private onLand(info: LandingInfo): void {
    const strength = Math.min(1, info.impactSpeed / (BAIL.maxImpactSpeed * 0.6));
    this.audio.land(strength, info.quality !== 'clean');
    this.dust.burst(info.position, info.normal, info.impactSpeed * FX.dustPerImpactSpeed, 0.6 + strength);
    this.pendingImpact = Math.max(this.pendingImpact, info.impactSpeed);
    this.landings++;
    this.lastLandingText = `${info.label} : ${info.quality}, ${info.impactSpeed.toFixed(1)} m/s, écart ${((info.spinError * 180) / Math.PI).toFixed(0)}°`;
  }

  private respawn(): void {
    this.skater.reset(SPAWN.position, SPAWN.forward);
    this.skaterVisual.teleportSync();
    this.skaterVisual.render(1, 0);
    this.travelSign = 1;
    this.updateCameraTarget();
    this.cameraRig.snap(this.cameraTarget);
  }

  private fixedUpdate(dt: number): void {
    const input = this.input.poll();
    this.lastFlickX = input.flick.x;
    this.lastFlickY = input.flick.y;
    this.handleGlobalActions(input);
    if (this.paused) return;

    this.skater.step(dt, input);
    this.physics.step();
    this.skaterVisual.capture();
    if (this.skater.position.y < WORLD.killPlaneY) this.respawn();
  }

  private handleGlobalActions(input: InputSnapshot): void {
    if (input.pressed.has('debug')) {
      this.debug.toggle();
      this.flickPanel.setVisible(this.debug.isVisible);
    }
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

  /**
   * Cap de la caméra : le sens de la marche, pas celui du board. Au sol, l'axe du board orienté
   * dans le sens où il roule (fakie compris) ; en l'air, la vitesse horizontale, pour que la caméra
   * ne tourne pas avec le skateur pendant un 180 ou un 360.
   */
  private updateCameraTarget(): void {
    const t = this.cameraTarget;
    const sk = this.skater;
    t.position.copy(this.skaterVisual.object.position);
    const along = sk.velocity.dot(sk.forward);
    if (Math.abs(along) > CAMERA_TRAVEL_MIN_SPEED) this.travelSign = along < 0 ? -1 : 1;
    if (sk.grounded) {
      // Le cap affiché suit la pose interpolée, pas l'état brut du pas fixe.
      this.forwardView.set(0, 0, -1).applyQuaternion(this.skaterVisual.object.quaternion).multiplyScalar(this.travelSign);
      t.forward.copy(this.forwardView);
    } else if (Math.hypot(sk.velocity.x, sk.velocity.z) > CAMERA_TRAVEL_MIN_SPEED) {
      t.forward.set(sk.velocity.x, 0, sk.velocity.z).normalize();
    }
    t.speed = this.skater.speed;
    const p = this.skater.prediction;
    t.airborne = !this.skater.grounded;
    t.landingValid = t.airborne && p.valid;
    t.landingPoint.copy(p.point);
    t.landingTime = p.time;
  }

  private render(alpha: number, frameDt: number): void {
    // En pause, on fige sur le dernier état simulé pour ne pas osciller entre deux poses.
    const a = this.paused ? 1 : alpha;
    const dt = this.paused ? 0 : frameDt;
    this.skaterVisual.render(a, dt);
    this.updateCameraTarget();
    if (!this.paused) {
      if (this.pendingImpact > 0) {
        this.cameraRig.impact(this.pendingImpact);
        this.pendingImpact = 0;
      }
      this.cameraRig.update(this.cameraTarget, frameDt);
      this.dust.update(frameDt);
    }
    if (this.cameraOverride) {
      const cam = this.cameraRig.camera;
      cam.position.copy(this.cameraTarget.position).add(this.cameraOverride);
      cam.lookAt(this.cameraTarget.position.x, this.cameraTarget.position.y + 0.6, this.cameraTarget.position.z);
    }
    this.level.followShadow(this.cameraTarget.position);
    this.renderer.render(this.scene, this.cameraRig.camera);

    const sk = this.skater;
    this.debug.update(this.loop.stats, this.renderer.three, {
      state: `${sk.state ?? '-'}${sk.grounded ? '' : ' (air)'}`,
      speed: `${sk.speed.toFixed(2)} m/s  ${(sk.speed * 3.6).toFixed(1)} km/h`,
      lean: `${sk.lean.toFixed(2)} rad`,
      surf: sk.surface,
      pos: `${sk.position.x.toFixed(1)} ${sk.position.y.toFixed(2)} ${sk.position.z.toFixed(1)}`,
      charge: sk.charge > 0 ? `${(sk.charge * 100).toFixed(0)} %` : '-',
      trick: this.lastTrickText,
      grind: sk.balanceMove ? `${BALANCE_MOVES[sk.balanceMove].name} jauge ${sk.balance.toFixed(2)}` : this.lastBalanceText,
      air: sk.grounded ? '-' : `rot ${((sk.spinAngle * 180) / Math.PI).toFixed(0)}°  grab ${sk.grabId ?? '-'} ${(sk.grabAmount * 100).toFixed(0)} %`,
      land: this.lastLandingText,
    });
    this.flickPanel.update(this.input.flickRecognizer, this.lastFlickX, this.lastFlickY);
    this.balanceMeter.update(sk.balanceMove ? BALANCE_MOVES[sk.balanceMove].name : null, sk.balance);
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
