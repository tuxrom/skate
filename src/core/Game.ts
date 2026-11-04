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
import { DEBUG, FX, HUD, QUALITY_PRESETS, TOUCH } from '@/config/render';
import { BAIL, BODY, FIXED_DT, PROGRESSION, SAFETY, WORLD } from '@/config/physics';
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
import { hideErrorScreen, showErrorScreen } from '@/ui/ErrorScreen';
import { ReplayRecorder, createFrame } from '@/replay/ReplayRecorder';
import { ReplayView } from '@/ui/ReplayView';
import { TouchControls } from '@/ui/TouchControls';
import { DisplayMode } from '@/platform/DisplayMode';
import type { InstallPrompt, InstallState } from '@/platform/InstallPrompt';
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
  /** Invite d'installation, créée au démarrage pour ne pas manquer beforeinstallprompt. */
  install: InstallPrompt;
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
  readonly touch: TouchControls;
  readonly display: DisplayMode;
  /** Replay : enregistrement continu des dernières secondes, et lecteur. */
  readonly replay = new ReplayRecorder();
  private readonly replayView: ReplayView;
  private readonly replayFrame = createFrame();
  replayActive = false;
  private recordTick = 0;
  private readonly recPos = new THREE.Vector3();
  private readonly recQuat = new THREE.Quaternion();
  private readonly install: InstallPrompt;
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
    this.touch = new TouchControls(opts.container);
    this.input.addSource(this.touch);

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
    this.touch.onModeChange = (on) => this.onTouchMode(on);
    this.display = new DisplayMode(opts.container);
    // Appareil tourné en portrait en pleine partie : pause, l'écran de rotation recouvre tout.
    this.display.onRotateChange = (blocked) => {
      if (blocked && this.mode === 'play' && !this.menus.isOpen) this.openPause();
    };
    this.install = opts.install;
    this.replayView = new ReplayView(opts.container);
    this.replayView.onExit = () => this.stopReplay();
    this.install.onChange = () => this.menus.refresh();
    this.wireProgress();
    this.renderer.onContextLost = () => {
      if (this.mode === 'play' && !this.menus.isOpen) this.openPause();
      showErrorScreen({
        title: 'Affichage interrompu',
        message: 'Le navigateur a perdu le contexte graphique (pilote réinitialisé ou mémoire graphique saturée). Restauration en cours…',
        action: { label: 'Recharger', run: () => location.reload() },
      });
    };
    this.renderer.onContextRestored = () => {
      hideErrorScreen();
      // Three.js recrée programmes et tampons ; les ombres de la scène se recompilent avec.
      this.applySettings(this.profile.settings);
    };
    this.loop = new GameLoop(
      {
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        render: (alpha, frameDt) => this.render(alpha, frameDt),
        onError: (e) => this.onFatalError(e),
      },
      DEBUG.statsRefresh,
    );

    // Les colliders statiques doivent être indexés avant les premières requêtes.
    this.physics.step();
    this.respawn();
    this.applySettings(this.profile.settings);
    this.onTouchMode(this.touch.touchMode);
    this.applyAppearance();
    this.refreshMarkers();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    this.goHome();
  }

  // ---------------------------------------------------------------------------
  // Modes et menus (MenuHost).

  play(): void {
    // Dans le gestionnaire du clic : le plein écran exige un geste du joueur.
    void this.display.enterGame(this.profile.settings.fullscreen);
    this.mode = 'play';
    this.menus.close();
    this.setPaused(false);
    this.input.suppressHeld();
  }

  resume(): void {
    if (this.mode !== 'play') return;
    void this.display.enterGame(this.profile.settings.fullscreen);
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

  get replayDuration(): number {
    return this.replay.duration;
  }

  /** Replay des dernières secondes : simulation figée, menus masqués, lecture avec caméra de jeu ou libre. */
  startReplay(): void {
    if (this.replay.duration < 0.5) return;
    this.replayActive = true;
    this.menus.setHidden(true);
    this.dust.object.visible = false;
    // La caméra libre part de derrière le skateur, dans l'axe de la caméra de jeu.
    const cam = this.cameraRig.camera.position;
    const sk = this.skaterVisual.object.position;
    this.replayView.open(this.replay.duration, Math.atan2(cam.x - sk.x, cam.z - sk.z));
  }

  stopReplay(): void {
    if (!this.replayActive) return;
    this.replayActive = false;
    this.replayView.close();
    this.dust.object.visible = true;
    this.menus.setHidden(false);
    // Le rendu normal reprend la pose simulée ; la caméra revient derrière le skateur.
    this.updateCameraTarget();
    this.cameraRig.snap(this.cameraTarget);
  }

  get installState(): InstallState {
    return this.install.state;
  }

  installApp(): void {
    void this.install.prompt();
  }

  get touchMode(): boolean {
    return this.touch.touchMode;
  }

  /** Éditeur de disposition des boutons tactiles, par-dessus le jeu ; les menus reviennent à la fin. */
  editTouchLayout(): void {
    this.menus.setHidden(true);
    this.touch.startEditing(
      (layout) => this.profile.updateSettings({ touchLayout: layout }),
      () => {
        this.menus.setHidden(false);
        this.menus.refresh();
      },
    );
  }

  /** Bascule entre l'interface PC et l'interface tactile. */
  private onTouchMode(on: boolean): void {
    document.documentElement.classList.toggle('touch-ui', on);
    this.display.setTouchUi(on);
    this.hud.refreshHints();
    this.menus.refresh();
  }

  /** Retour haptique, en mode tactile et si le réglage l'autorise. */
  private vibrate(pattern: number | readonly number[]): void {
    if (!this.touch.touchMode || !this.profile.settings.haptics) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
    } catch {
      // Vibration refusée par le navigateur : sans effet.
    }
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
    this.touch.setActive(this.mode === 'play' && !this.menus.isOpen);
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
    this.score.events.on('comboBanked', (r) => {
      this.profile.addXp(r.score * PROGRESSION.xpPerPoint);
      this.vibrate(TOUCH.bankVibratePattern);
    });
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
    this.dust.setDensity(q.particleDensity);
    this.audio.setVolume(s.volume, s.muted);
    this.input.flickRecognizer.sensitivity = s.flickSensitivity;
    this.mouse.sensitivity = s.mouseSensitivity;
    this.touch.configure(s.touchMode, s.touchLayout, s.mouseSensitivity);
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
      touchMode: this.touch.touchMode,
      touchEditing: this.touch.isEditing,
      installState: this.install.state,
      fullscreen: this.display.isFullscreen,
      rotateBlocked: this.display.rotateBlocked,
      relocations: this.relocations,
      lastRelocation: this.lastRelocation,
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
      replayActive: this.replayActive,
      replayDuration: this.replay.duration,
      replayTime: this.replayView.time,
      replayCamera: this.replayView.camera,
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
      fixedMs: this.loop.stats.fixedMs,
      renderMs: this.loop.stats.renderMs,
      drawCalls: this.renderer.three.info.render.calls,
      triangles: this.renderer.three.info.render.triangles,
      geometries: this.renderer.three.info.memory.geometries,
      textures: this.renderer.three.info.memory.textures,
      programs: this.renderer.three.info.programs?.length ?? 0,
      meshes: this.countMeshes().meshes,
      shadowCasters: this.countMeshes().casters,
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
    if (info.quality !== 'bail') this.vibrate(Math.round(TOUCH.landVibrateMinMs + (TOUCH.landVibrateMaxMs - TOUCH.landVibrateMinMs) * strength));
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
    this.vibrate(TOUCH.bailVibrateMs);
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
    if (this.gamepad.activeThisStep) this.touch.noteOtherInput();
    this.lastFlickX = input.flick.x;
    this.lastFlickY = input.flick.y;
    this.handleGlobalActions(input);
    if (this.paused) return;
    this.challenges.fixedUpdate(dt);

    this.skater.step(dt, input);
    // Rapier n'a de travail que s'il y a des corps dynamiques (ragdoll, planche lâchée) : le skateur est
    // cinématique et ses requêtes lisent directement les colliders statiques, indexés au démarrage.
    // Un pas de plus après le retrait des derniers corps : Rapier purge alors son index.
    const bodies = this.physics.world.bodies.len();
    if (bodies > 0 || this.physicsHadBodies) this.physics.step();
    this.physicsHadBodies = bodies > 0;
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
    this.checkSafety(dt);
    // Au sol au sens du combo : roues sur le sol, ni grind, ni manual, ni chute.
    const onGround = sk.grounded && !sk.grinding && !sk.isManual() && !sk.bailing;
    this.score.fixedUpdate(dt, onGround, sk.speed);
    this.skaterVisual.capture();
    this.recordReplay();
  }

  private handleGlobalActions(input: InputSnapshot): void {
    if (input.pressed.has('debug')) {
      this.debug.toggle();
      this.flickPanel.setVisible(this.debug.isVisible);
    }
    if (input.pressed.has('pause')) {
      // Échap ou Start : quitte le replay, ouvre la pause, ou remonte d'un écran dans les menus.
      if (this.replayActive) this.stopReplay();
      else if (this.menus.isOpen) this.menus.back();
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
    if (this.replayActive) {
      this.renderReplay(frameDt);
      return;
    }
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
    this.touch.update(frameDt);
  }

  /** Meshes de la scène et ceux qui projettent une ombre (debug, profilage). */
  private countMeshes(): { meshes: number; casters: number } {
    let meshes = 0;
    let casters = 0;
    this.scene.traverseVisible((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      meshes++;
      if (o.castShadow) casters++;
    });
    return { meshes, casters };
  }

  private physicsHadBodies = false;

  /** Enregistre l'état affiché, un pas fixe sur deux (REPLAY.sampleHz). */
  private recordReplay(): void {
    if (++this.recordTick < Math.round(1 / (FIXED_DT * this.replay.hz))) return;
    this.recordTick = 0;
    this.skater.readPose(this.recPos, this.recQuat);
    const cam = this.cameraRig.camera;
    this.replay.record(this.recPos, this.recQuat, this.skaterVisual.currentPose, this.bail.renderJoints(1), cam.position, cam.quaternion);
  }

  /** Rendu du replay : pose enregistrée appliquée au rig, caméra de jeu enregistrée ou caméra libre. */
  private renderReplay(frameDt: number): void {
    const v = this.replayView;
    v.update(frameDt);
    const f = this.replayFrame;
    this.replay.sample(v.time, f);
    const rig = this.skaterVisual.rig;
    rig.root.position.copy(f.position);
    rig.root.quaternion.copy(f.quaternion);
    rig.applyRagdoll(f.weight > 0.001 ? f.joints : null, f.weight);
    rig.update(f.pose, v.playing ? frameDt * v.speed : 0);
    const cam = this.cameraRig.camera;
    if (v.camera === 'game') {
      cam.position.copy(f.cameraPosition);
      cam.quaternion.copy(f.cameraQuaternion);
    } else {
      // Orbite autour du corps (le bassin pendant une chute), hauteur des yeux.
      const target = f.weight > 0.5 ? f.joints.pelvis : this.camLook.copy(f.position).setY(f.position.y + 0.8);
      const o = v.orbit;
      cam.position.set(
        target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.distance,
        target.y + Math.sin(o.pitch) * o.distance,
        target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.distance,
      );
      cam.lookAt(target);
    }
    this.level.followShadow(f.position);
    this.renderer.render(this.scene, cam);
  }

  // Garde-fous.
  private stuckTimer = 0;
  private overlapTimer = 0;
  private readonly stuckFrom = new THREE.Vector3();
  /** Nombre de remises en place et dernière raison (debug, tests). */
  private relocations = 0;
  private lastRelocation = '';

  /**
   * Garde-fous, à chaque pas : position invalide, sortie du parc ou sous le plan de chute, capsule
   * enfoncée dans le décor, skateur figé en l'air (posé sur une arête sans contact de sol).
   * Le skateur est alors ramené à son dernier point sûr, et le combo en cours est abandonné.
   */
  private checkSafety(dt: number): void {
    const sk = this.skater;
    if (sk.bailing) {
      this.stuckTimer = this.overlapTimer = 0;
      return;
    }
    const p = sk.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || !Number.isFinite(sk.velocity.x)) {
      this.relocate('invalid', true);
      return;
    }
    const limit = this.level.halfExtent + SAFETY.outOfBoundsMargin;
    if (p.y < WORLD.killPlaneY || Math.abs(p.x) > limit || Math.abs(p.z) > limit) {
      this.relocate('bounds');
      return;
    }
    // Enfoncé dans le décor : test d'une capsule un peu plus fine que le corps, sur sol plat seulement.
    if (sk.up.y >= SAFETY.overlapMinUpY && !sk.grinding) {
      const free = this.physics.isStandingSpaceFree(p, BODY.capsuleHalfHeight, BODY.capsuleRadius * SAFETY.overlapRadiusScale, BODY.capsuleClearance);
      this.overlapTimer = free ? 0 : this.overlapTimer + dt;
      if (this.overlapTimer >= SAFETY.overlapTime) {
        this.relocate('overlap');
        return;
      }
    } else {
      this.overlapTimer = 0;
    }
    // Figé en l'air : la gravité doit faire bouger le skateur.
    if (!sk.grounded && !sk.grinding) {
      if (this.stuckTimer === 0) this.stuckFrom.copy(p);
      this.stuckTimer += dt;
      if (this.stuckTimer >= SAFETY.stuckTime) {
        if (p.distanceTo(this.stuckFrom) < SAFETY.stuckMinMove) {
          this.relocate('stuck');
          return;
        }
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
  }

  /** Ramène le skateur à son dernier point sûr (ou au départ si `toSpawn`). */
  private relocate(reason: string, toSpawn = false): void {
    this.relocations++;
    this.lastRelocation = reason;
    this.stuckTimer = this.overlapTimer = 0;
    // Le dernier point sûr est l'endroit même du problème, ou hors du parc : retour au départ, sans boucle.
    const safe = this.skater.lastSafePosition;
    const inside = Math.abs(safe.x) < this.level.halfExtent && Math.abs(safe.z) < this.level.halfExtent;
    // Point sûr hors des murs (le sol déborde) : il ne ramènerait pas dans le parc.
    if (!inside || (reason !== 'bounds' && this.skater.position.distanceTo(safe) < 0.5)) toSpawn = true;
    if (toSpawn) {
      this.respawn();
      return;
    }
    this.score.reset();
    this.bail.end();
    this.forwardView.copy(this.skater.forward).setY(0);
    if (this.forwardView.lengthSq() < 1e-6 || !Number.isFinite(this.forwardView.x)) this.forwardView.set(0, 0, -1);
    this.skater.recover(this.skater.lastSafePosition, this.forwardView.normalize());
    this.skaterVisual.teleportSync();
    this.updateCameraTarget();
    this.cameraRig.snap(this.cameraTarget);
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

  /** Exception dans la boucle : la partie s'arrête avec un message clair, la progression est écrite. */
  private onFatalError(e: unknown): void {
    console.error(e);
    void this.profile.flush();
    showErrorScreen({
      title: 'Le jeu s’est arrêté',
      message: 'Une erreur inattendue a interrompu la partie. Ta progression est sauvegardée ; recharger la page relance le jeu.',
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  /** Fenêtre qui perd le focus (autre application, notification) en pleine partie : pause. */
  private readonly onBlur = (): void => {
    if (this.mode === 'play' && !this.menus.isOpen && !this.replayActive) this.openPause();
  };

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
