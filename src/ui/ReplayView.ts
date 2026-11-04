import { REPLAY } from '@/config/render';

export type ReplayCamera = 'game' | 'free';

/**
 * Lecteur du replay : barre de commandes (lecture, temps, vitesse, caméra, quitter) et caméra libre en orbite
 * autour du skateur (glisser pour tourner, molette ou pincement pour zoomer). Clavier : Espace lecture/pause,
 * ← → pour avancer ou reculer d'une seconde ; Échap (action pause du jeu) quitte.
 */
export class ReplayView {
  active = false;
  playing = true;
  /** Temps courant (s) dans l'enregistrement, et sa durée. */
  time = 0;
  duration = 0;
  speed: number = REPLAY.speeds[0]!;
  camera: ReplayCamera = 'game';
  /** Caméra libre, en coordonnées sphériques autour du skateur. */
  readonly orbit = { yaw: 0, pitch: 0.35, distance: REPLAY.orbitDistance as number };
  onExit: () => void = () => {};

  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly range: HTMLInputElement;
  private readonly clock: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly camBtns: HTMLButtonElement[] = [];
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private scrubbing = false;
  private lastClock = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'replay-layer';
    const title = document.createElement('div');
    title.className = 'replay-title';
    title.textContent = 'REPLAY';
    this.hint = document.createElement('div');
    this.hint.className = 'replay-hint';
    this.bar = document.createElement('div');
    this.bar.className = 'replay-bar';
    this.playBtn = button('❚❚', () => this.togglePlay());
    this.playBtn.setAttribute('aria-label', 'Lecture ou pause');
    this.range = document.createElement('input');
    this.range.type = 'range';
    this.range.min = '0';
    this.range.step = '0.01';
    this.range.setAttribute('aria-label', 'Position dans le replay');
    this.range.addEventListener('input', () => {
      this.scrubbing = true;
      this.time = Number(this.range.value);
    });
    this.range.addEventListener('change', () => {
      this.scrubbing = false;
    });
    this.clock = document.createElement('span');
    this.clock.className = 'clock';
    const speeds = group();
    for (const s of REPLAY.speeds) {
      const b = button(s === 1 ? '1×' : s === 0.5 ? '½×' : s === 0.25 ? '¼×' : `${s}×`, () => this.setSpeed(s));
      b.dataset.speed = String(s);
      this.speedBtns.push(b);
      speeds.appendChild(b);
    }
    const cams = group();
    for (const [id, label] of [['game', 'Caméra de jeu'], ['free', 'Caméra libre']] as const) {
      const b = button(label, () => this.setCamera(id));
      b.dataset.camera = id;
      this.camBtns.push(b);
      cams.appendChild(b);
    }
    const quit = button('Quitter', () => this.onExit());
    quit.classList.add('quit');
    quit.dataset.key = 'replayQuit';
    this.bar.append(this.playBtn, this.range, this.clock, speeds, cams, quit);
    this.root.append(title, this.hint, this.bar);
    parent.appendChild(this.root);

    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
  }

  /** Ouvre le lecteur sur un enregistrement de `duration` secondes, en partant du début. */
  open(duration: number, startYaw: number): void {
    this.duration = duration;
    this.time = 0;
    this.playing = true;
    this.orbit.yaw = startYaw;
    this.range.max = String(duration);
    this.active = true;
    this.root.classList.add('on');
    this.refresh();
  }

  close(): void {
    this.active = false;
    this.pointers.clear();
    this.root.classList.remove('on');
  }

  /** Avance la lecture (rendu). */
  update(frameDt: number): void {
    if (!this.active) return;
    if (this.playing && !this.scrubbing) {
      this.time += frameDt * this.speed;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.playing = false;
        this.refresh();
      }
    }
    const clock = `${this.time.toFixed(1)} / ${this.duration.toFixed(1)} s`;
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      if (!this.scrubbing) this.range.value = String(this.time);
    }
  }

  private togglePlay(): void {
    if (!this.playing && this.time >= this.duration) this.time = 0;
    this.playing = !this.playing;
    this.refresh();
  }

  private setSpeed(s: number): void {
    this.speed = s;
    this.refresh();
  }

  private setCamera(c: ReplayCamera): void {
    this.camera = c;
    this.refresh();
  }

  private refresh(): void {
    this.playBtn.textContent = this.playing ? '❚❚' : '▶';
    for (const b of this.speedBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === this.speed));
    for (const b of this.camBtns) b.setAttribute('aria-pressed', String(b.dataset.camera === this.camera));
    this.hint.textContent = this.camera === 'free' ? 'Glisser : tourner · molette ou pincer : zoomer' : '';
  }

  // Caméra libre.

  private readonly onDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest('.replay-bar')) return;
    if (this.camera !== 'free') this.setCamera('free');
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.root.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) this.pinchDistance = this.pinch();
    e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (this.pointers.size >= 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const d = this.pinch();
      if (this.pinchDistance > 0 && d > 0) this.zoom(this.pinchDistance / d);
      this.pinchDistance = d;
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.orbit.yaw -= dx * REPLAY.orbitDragSpeed;
    this.orbit.pitch = Math.min(REPLAY.orbitMaxPitch, Math.max(REPLAY.orbitMinPitch, this.orbit.pitch + dy * REPLAY.orbitDragSpeed));
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.pinchDistance = this.pointers.size === 2 ? this.pinch() : 0;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    if (this.camera !== 'free') this.setCamera('free');
    this.zoom(Math.exp(e.deltaY * REPLAY.wheelZoom));
  };

  private zoom(factor: number): void {
    this.orbit.distance = Math.min(REPLAY.orbitMaxDistance, Math.max(REPLAY.orbitMinDistance, this.orbit.distance * factor));
  }

  private pinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.active || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      this.time = Math.min(this.duration, Math.max(0, this.time + (e.code === 'ArrowRight' ? 1 : -1)));
    }
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function group(): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'replay-group';
  return g;
}
