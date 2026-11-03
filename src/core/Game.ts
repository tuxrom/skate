import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { Renderer } from './Renderer';
import { GamepadSource, Input, KeyboardSource, MouseFlickSource, detectPadFamily, type InputSnapshot, type PadFamily } from './Input';
import { CameraRig, type CameraTarget } from './CameraRig';
import { PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { Level, SPAWN } from '@/world/Level';
import type { AssetProvider } from '@/world/assets';
import { Skater, type ActiveTrick, type BailInfo, type LandingInfo } from '@/skater/Skater';
import { BailController } from '@/skater/BailController';
import { createJoints } from '@/skater/SkaterRig';
import { trickName } from '@/skater/tricks';
import { FlickDebugPanel } from '@/ui/FlickDebugPanel';
import { BALANCE_MOVES } from '@/skater/grinds';
import { SkaterVisual } from '@/skater/SkaterVisual';
import { AudioEngine } from '@/audio/AudioEngine';
import { DebugOverlay } from '@/ui/DebugOverlay';
import { DEBUG, FX, HUD, QUALITY_PRESETS } from '@/config/render';
import { BAIL, PROGRESSION, WORLD } from '@/config/physics';
import { DustEffect } from '@/world/DustEffect';
import { ScoreSystem } from '@/score/ScoreSystem';
import type { Profile } from '@/progress/Profile';
import { ChallengeSystem } from '@/progress/ChallengeSystem';
import { appearanceOf } from '@/progress/unlocks';
import { CHALLENGES, ZONES } from '@/world/challenges';
import { ZoneMarkers } from '@/world/ZoneMarkers';
import type { Settings } from '@/save/SaveData';
import { Hud } from '@/ui/Hud';
import { Menus, type MenuHost } from '@/ui/Menus';
import { installStyles } from '@/ui/styles';
import { PAD_LABELS } from '@/ui/helpContent';

/** Vitesse au-dessus de laquelle le sens de marche oriente la caméra (m/s). */
const CAMERA_TRAVEL_MIN_SPEED = 0.6;
/** Pendant une chute, la caméra vise le bassin abaissé de cette hauteur (m), pour cadrer le corps au sol. */
const BAIL_CAMERA_DROP = 0.5;

export interface GameOptions {
  container: HTMLElement;
  rapier: Rapier;
  assets: AssetProvider;
  debug: boolean;
  /** Profil chargé (sauvegarde) : records, niveau, défis, réglages, personnalisation. */
  profile: Profile;
}

/** Accueil (menu, caméra en orbite, simulation figée) ou partie en cours. */
export type GameMode = 'home' | 'play';

/** Assemble les sous-systèmes et les cadence via la boucle à pas fixe. */
export class Game implements MenuHost {
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
  private readonly flickPanel: FlickDebugPanel;
  private readonly bail: BailController;
  private readonly bailPose = createJoints();
  private readonly bailBoardPos = new THREE.Vector3();
  private readonly bailBoardQuat = new THREE.Quaternion();
  private readonly cameraFocus = new THREE.Vector3();
  private renderAlpha = 1;
  /** Dernier grind ou manual terminé, pour le debug (les combos de l'étape 7 s'en serviront). */
  private lastBalanceText = '-';
  private balanceMoves = 0;
  /** Dernières fins de grind et de manual (debug). */
  private readonly balanceLog: string[] = [];
  private readonly loop: GameLoop;
  private readonly dust = new DustEffect();
  /** Score et combos ; ses événements (`score.events`) alimentent l'UI et les objectifs. */
  readonly score: ScoreSystem;
  readonly profile: Profile;
  readonly challenges: ChallengeSystem;
  readonly menus: Menus;
  private readonly hud: Hud;
  private readonly zoneMarkers: ZoneMarkers;
  private readonly gamepad = new GamepadSource();
  private readonly mouse: MouseFlickSource;
  mode: GameMode = 'home';
  private orbitAngle = 0;
  private readonly camLook = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();

  private paused = false;
  private readonly cameraTarget: CameraTarget = {
    position: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    speed: 0,
    airborne: false,
    landingValid: false,
    landingPoint: new THREE.Vector3(),
    landingTime: 0,
    lookAheadScale: 1,
  };
  /** Impact en attente pour la caméra, appliqué au prochain rendu (m/s). */
  private pendingImpact = 0;
  private readonly tailPoint = new THREE.Vector3();
  /** Dernière réception, pour le debug et les tests. */
  private landings = 0;
  private lastLandingText = '-';
  private lastBailText = '-';
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
    installStyles();
    this.profile = opts.profile;
    this.score = new ScoreSystem(this.profile);
    this.renderer = new Renderer(opts.container);
    this.mouse = new MouseFlickSource(this.renderer.canvas);
    this.input.addSource(new KeyboardSource());
    this.input.addSource(this.gamepad);
    this.input.addSource(this.mouse);

    this.physics = new PhysicsWorld(opts.rapier);
    this.level = new Level(this.scene, this.physics, opts.assets);

    this.skater = new Skater(this.physics);
    this.skater.grinds = this.level.grinds;
    this.bail = new BailController(this.physics, this.skater);
    this.skaterVisual = new SkaterVisual(this.skater, opts.assets.createSkater());
    this.scene.add(this.skaterVisual.object);
    this.scene.add(this.dust.object);
    this.zoneMarkers = new ZoneMarkers(ZONES, opts.assets);
    this.scene.add(this.zoneMarkers.root);
    this.challenges = new ChallengeSystem(CHALLENGES, ZONES, this.profile, this.score, this.skater.position);
    this.skater.events = {
      pop: (charge, position, trick) => this.onPop(charge, position, trick),
      land: (info) => {
        this.onLand(info);
        this.score.onLand(info);
      },
      bail: (info) => {
        this.score.onBail();
        this.onBail(info);
      },
      grindEntry: (air) => this.score.onGrindEntry(air),
      balanceStart: (move) => {
        this.balanceMoves++;
        this.score.onBalanceStart(move);
      },
      balanceEnd: (move, time, distance, reason) => {
        this.lastBalanceText = `${BALANCE_MOVES[move].name} ${time.toFixed(2)} s, ${distance.toFixed(1)} m, ${reason}`;
        this.balanceLog.push(this.lastBalanceText);
        if (this.balanceLog.length > 8) this.balanceLog.shift();
        this.score.onBalanceEnd(move, time, distance, reason);
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
    this.flickPanel = new FlickDebugPanel(opts.container, opts.debug);
    this.hud = new Hud(opts.container, this.score, this.challenges, this.profile, () => {
      const pad = PAD_LABELS[this.padFamily()];
      return `Échap ou ${pad.start} : menu`;
    });
    this.menus = new Menus(opts.container, this);
    this.menus.onChange = () => this.onMenuChange();
    this.wireProgress();
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
    this.applySettings(this.profile.settings);
    this.applyAppearance();
    this.refreshMarkers();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.goHome();
  }

  // ---------------------------------------------------------------------------
  // Modes et menus (MenuHost).

  play(): void {
    this.mode = 'play';
    this.menus.close();
    this.setPaused(false);
    this.input.suppressHeld();
  }

  resume(): void {
    if (this.mode !== 'play') return;
    this.menus.close();
    this.setPaused(false);
    this.input.suppressHeld();
  }

  restart(): void {
    this.challenges.cancelTimed();
    this.respawn();
    this.resume();
  }

  quitToHome(): void {
    this.challenges.cancelTimed();
    this.respawn();
    this.goHome();
  }

  padFamily(): PadFamily {
    const layout = this.profile.settings.padLayout;
    if (layout !== 'auto') return layout;
    return this.gamepad.lastPadId ? detectPadFamily(this.gamepad.lastPadId) : 'xbox';
  }

  click(): void {
    this.audio.uiClick();
  }

  private goHome(): void {
    this.mode = 'home';
    this.setPaused(true);
    this.menus.openRoot('home');
  }

  private openPause(): void {
    this.setPaused(true);
    this.menus.openRoot('pause');
  }

  /** Écran de menu changé : le HUD se cache, la caméra reprend sa place derrière le skateur hors accueil et personnalisation. */
  private onMenuChange(): void {
    this.hud.setVisible(this.mode === 'play' && !this.menus.isOpen);
    if (this.cameraView() === 'follow') {
      this.updateCameraTarget();
      this.cameraRig.snap(this.cameraTarget);
    }
  }

  /** Caméra à utiliser : orbite sur l'accueil, vue de face en personnalisation, suivi sinon. */
  private cameraView(): 'follow' | 'orbit' | 'showcase' {
    if (this.menus.current === 'custom') return 'showcase';
    if (this.mode === 'home') return 'orbit';
    return 'follow';
  }

  /** Branche le score, les défis et le profil : XP, repères de zone, réglages, apparence. */
  private wireProgress(): void {
    this.score.events.on('comboBanked', (r) => this.profile.addXp(r.score * PROGRESSION.xpPerPoint));
    const ce = this.challenges.events;
    ce.on('complete', (def) => {
      this.profile.addXp(def.rewardXp);
      this.refreshMarkers();
    });
    ce.on('timedStart', () => this.refreshMarkers());
    ce.on('timedEnd', () => this.refreshMarkers());
    const pe = this.profile.events;
    pe.on('settings', (s) => this.applySettings(s));
    pe.on('custom', () => {
      this.applyAppearance();
      this.refreshMarkers();
    });
  }

  private refreshMarkers(): void {
    const timedZone = this.challenges.timed?.def.zone;
    for (const z of ZONES) {
      const defs = this.challenges.challengesIn(z.id);
      const done = defs.every((d) => this.profile.progress(d.id).done);
      this.zoneMarkers.setState(z.id, z.id === timedZone ? 'active' : done ? 'done' : 'open');
    }
  }

  /** Réglages : qualité graphique (résolution, ombres, brouillard, distance de rendu), son, sensibilités. */
  private applySettings(s: Readonly<Settings>): void {
    const q = QUALITY_PRESETS[s.quality];
    this.renderer.setQuality(q, this.scene);
    this.level.setQuality(q, this.scene);
    const cam = this.cameraRig.camera;
    cam.far = q.fogFar + 10;
    cam.updateProjectionMatrix();
    this.dust.setViewportHeight(this.renderer.canvas.height);
    this.audio.setVolume(s.volume, s.muted);
    this.input.flickRecognizer.sensitivity = s.flickSensitivity;
    this.mouse.sensitivity = s.mouseSensitivity;
  }

  private applyAppearance(): void {
    this.skaterVisual.rig.setAppearance(appearanceOf(this.profile.custom));
  }

  start(): void {
    this.loop.start();
  }

  /** Téléporte le skateur à l'arrêt (debug et tests). yaw = 0 regarde vers -Z. */
  debugTeleport(x: number, z: number, yaw: number): void {
    this.score.reset();
    this.bail.end();
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
      bailing: sk.bailing,
      bailPhase: this.bail.phase,
      bailCause: this.bail.cause,
      bails: this.bail.count,
      ragdollLowest: Number.isFinite(this.bail.lowestPoint) ? this.bail.lowestPoint : 0,
      ragdollMaxSpeed: this.bail.maxPartSpeed,
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
      mode: this.mode,
      menu: this.menus.current ?? '',
      level: this.profile.level,
      xp: this.profile.xp,
      saveBackend: this.profile.backend,
      saves: this.profile.saves,
      quality: this.profile.settings.quality,
      pixelRatio: this.renderer.pixelRatio,
      shadows: this.renderer.three.shadowMap.enabled,
      shadowMap: this.level.sun.shadow.mapSize.x,
      fogFar: this.scene.fog instanceof THREE.Fog ? this.scene.fog.far : 0,
      cameraFar: cam.far,
      challengesDone: this.profile.completedChallenges().size,
      timed: this.challenges.timed ? `${this.challenges.timed.def.id} ${this.challenges.timed.timeLeft.toFixed(1)}` : '',
      zones: this.challenges.zoneMask,
      comboActive: this.score.combo.active,
      comboElements: this.score.combo.elements.length,
      comboLive: this.score.combo.live?.label ?? '',
      comboPoints: this.score.combo.elementPoints,
      comboMultiplier: this.score.combo.multiplier,
      comboProjected: this.score.combo.projected,
      comboGroundTime: this.score.combo.groundTime,
      comboLabels: this.score.combo.elements.map((e) => `${e.label}=${Math.round(e.points)}`).join(' | '),
      sessionScore: this.score.sessionScore,
      sessionBestCombo: this.score.sessionBestCombo,
      recordCombo: this.score.records.bestCombo,
      recordSession: this.score.records.bestSession,
      combosBanked: this.score.combosBanked,
      combosLost: this.score.combosLost,
      lastComboScore: this.score.lastResult?.score ?? 0,
      lastComboLabel: this.score.lastResult?.label ?? '',
      lastComboQuality: this.score.lastResult?.quality ?? '',
      lastLossReason: this.score.lastLoss?.reason ?? '',
      lastLost: this.score.lastLoss?.lost ?? 0,
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

  /** Chute : le ragdoll part de la pose affichée, la planche de sa pose affichée. */
  private onBail(info: BailInfo): void {
    this.skaterVisual.rig.captureJoints(this.bailPose);
    this.bailBoardPos.copy(this.skaterVisual.object.position);
    this.bailBoardQuat.copy(this.skaterVisual.object.quaternion);
    this.bail.start(info, this.bailPose, this.bailBoardPos, this.bailBoardQuat);
    this.skater.poseOverride = this.bail;
    this.skaterVisual.teleportSync();
    this.lastBailText = info.cause;
  }

  private respawn(): void {
    this.score.reset();
    this.bail.end();
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
    this.challenges.fixedUpdate(dt);

    this.skater.step(dt, input);
    this.physics.step();
    if (this.bail.phase !== 'none') {
      const wasRagdoll = this.bail.phase === 'ragdoll';
      this.bail.fixedStep(dt, (strength, board) => (board ? this.audio.boardClatter(strength) : this.audio.bodyImpact(strength)));
      if (wasRagdoll && this.bail.phase !== 'ragdoll') {
        // Relève : le skateur est replacé debout ; la planche glisse de sa position au sol jusqu'aux pieds.
        this.skater.poseOverride = null;
        this.skaterVisual.blendFromCurrent(BAIL.getUpTime);
        this.skaterVisual.teleportSync();
      }
    }
    const sk = this.skater;
    // Au sol au sens du combo : roues sur le sol, ni grind, ni manual, ni chute.
    const onGround = sk.grounded && !sk.grinding && !sk.isManual() && !sk.bailing;
    this.score.fixedUpdate(dt, onGround, sk.speed);
    this.skaterVisual.capture();
    if (sk.position.y < WORLD.killPlaneY) this.respawn();
  }

  private handleGlobalActions(input: InputSnapshot): void {
    if (input.pressed.has('debug')) {
      this.debug.toggle();
      this.flickPanel.setVisible(this.debug.isVisible);
    }
    if (input.pressed.has('pause')) {
      // Échap ou Start : ouvre la pause, ou remonte d'un écran dans les menus.
      if (this.menus.isOpen) this.menus.back();
      else this.openPause();
    }
    if (input.pressed.has('reset') && !this.menus.isOpen) {
      // Pendant une chute, R relève le skateur sur place ; sinon retour au départ.
      if (this.bail.phase === 'ragdoll') this.bail.requestGetUp();
      else this.respawn();
    }
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
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
    if (this.bail.phase === 'ragdoll') {
      // Pendant la chute, la caméra suit le bassin sans changer de cap.
      this.bail.cameraFocus(this.renderAlpha, this.cameraFocus);
      t.position.set(this.cameraFocus.x, this.cameraFocus.y - BAIL_CAMERA_DROP, this.cameraFocus.z);
      t.airborne = false;
      t.landingValid = false;
      t.speed = 0;
      t.lookAheadScale = 0;
      return;
    }
    t.lookAheadScale = 1;
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
    this.renderAlpha = a;
    const rag = this.bail.renderJoints(a);
    this.skaterVisual.rig.applyRagdoll(rag ? rag.joints : null, rag ? rag.weight : 0);
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
    const view = this.cameraView();
    if (view !== 'follow') this.menuCamera(view, frameDt);
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
      bail: this.bail.phase === 'none' ? this.lastBailText : `${this.bail.phase} (${this.bail.cause})`,
    });
    this.flickPanel.update(this.input.flickRecognizer, this.lastFlickX, this.lastFlickY);
    this.hudView.speed = sk.bailing ? 0 : sk.speed;
    this.hudView.balanceName = sk.balanceMove && this.mode === 'play' && !this.menus.isOpen ? BALANCE_MOVES[sk.balanceMove].name : null;
    this.hudView.balance = sk.balance;
    this.hud.update(this.hudView);
    this.menus.update(frameDt);
  }

  private readonly hudView = { speed: 0, balanceName: null as string | null, balance: 0 };

  /** Caméras des menus : orbite lente sur l'accueil, vue de face du skateur en personnalisation. */
  private menuCamera(view: 'orbit' | 'showcase', frameDt: number): void {
    const cam = this.cameraRig.camera;
    const target = this.skaterVisual.object.position;
    if (view === 'orbit') {
      this.orbitAngle += HUD.homeOrbitSpeed * frameDt;
      cam.position.set(
        target.x + Math.sin(this.orbitAngle) * HUD.homeOrbitDistance,
        target.y + HUD.homeOrbitHeight,
        target.z + Math.cos(this.orbitAngle) * HUD.homeOrbitDistance,
      );
    } else {
      // Devant le skateur (repère du rig : -Z vers l'avant, +X vers la droite), un peu de côté.
      this.forwardView.set(0, 0, -1).applyQuaternion(this.skaterVisual.object.quaternion).setY(0).normalize();
      this.camRight.set(1, 0, 0).applyQuaternion(this.skaterVisual.object.quaternion).setY(0).normalize();
      cam.position
        .copy(target)
        .addScaledVector(this.forwardView, HUD.showcaseFront)
        .addScaledVector(this.camRight, HUD.showcaseSide)
        .setY(target.y + HUD.showcaseHeight);
    }
    this.camLook.set(target.x, target.y + 0.75, target.z);
    cam.lookAt(this.camLook);
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.loop.stop();
      // Onglet caché en pleine partie : la pause s'ouvre, le joueur la retrouve en revenant.
      if (this.mode === 'play' && !this.menus.isOpen) this.openPause();
      else this.setPaused(true);
    } else {
      this.loop.start();
    }
  };
}
