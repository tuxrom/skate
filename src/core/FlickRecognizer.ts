import { FIXED_DT, FLICK, INPUT } from '@/config/physics';

/** Tricks reconnaissables au stick droit. */
export type FlickTrickId = 'ollie' | 'kickflip' | 'heelflip' | 'popShoveIt' | 'treFlip' | 'varialFlip' | 'hardflip';

/** Caractéristiques mesurées sur la partie flick du geste (après la charge). */
export interface GestureFeatures {
  /** Angle de départ (rad), attendu vers -π/2 (en bas). */
  startAngle: number;
  /** Angle de sortie (rad), au point où le stick est relâché ou s'arrête. */
  endAngle: number;
  /** Angle balayé autour du centre (rad), signé : positif dans le sens trigonométrique. */
  sweep: number;
  /** Rayon minimal du chemin : bas pour un trait qui coupe le centre, haut pour un arc. */
  minRadius: number;
  /** Rayon maximal atteint (amplitude, 0 à 1). */
  amplitude: number;
  /** Durée de la partie flick (s). */
  duration: number;
  /** Durée passée en charge avant le flick (s). */
  chargeTime: number;
}

export interface TrickCandidate {
  trick: FlickTrickId;
  score: number;
}

/** Événement de trick normalisé, indépendant du périphérique qui a produit le geste. */
export interface FlickEvent {
  trick: FlickTrickId;
  /** Score de reconnaissance du trick retenu (0 à 1). */
  score: number;
  /** Sens de rotation du geste : +1 trigonométrique, -1 horaire, 0 pour un trait. */
  side: 1 | -1 | 0;
  /** Vrai si aucun modèle n'a atteint FLICK.minScore et que l'ollie a été retenu par défaut. */
  fallback: boolean;
  readonly features: GestureFeatures;
  /** Tous les modèles, du meilleur au moins bon. */
  readonly candidates: TrickCandidate[];
}

/** État du geste exposé au gameplay à chaque pas fixe. */
export interface GestureSnapshot {
  /** Le stick est tenu dans la zone de charge (le skateur s'accroupit). */
  charging: boolean;
  /** Le stick a quitté la zone de charge, le flick est en cours. */
  flicking: boolean;
  /** Geste terminé et reconnu à ce pas, null sinon. */
  event: FlickEvent | null;
  /** Geste abandonné à ce pas : retour au centre sans flick. */
  cancelled: boolean;
}

/**
 * Modèle de geste. Deux familles :
 * - trait : le chemin coupe le disque intérieur, seul l'angle de sortie compte ;
 * - arc : le chemin reste sur le bord, l'angle balayé et l'angle de sortie comptent.
 */
interface Template {
  trick: FlickTrickId;
  arc: boolean;
  /** Angle de sortie attendu (rad), null si indifférent. */
  end: number | null;
  /** Angle balayé attendu (rad). Signé si `signed`, sinon comparé en valeur absolue. */
  sweep: number;
  signed: boolean;
  /** Le balayage peut dépasser la valeur attendue sans pénalité (cercle complet). */
  atLeast: boolean;
}

const UP = Math.PI / 2;
const UP_LEFT = (3 * Math.PI) / 4;
const UP_RIGHT = Math.PI / 4;
const DOWN = -Math.PI / 2;

/**
 * Grammaire des gestes (tout commence stick en bas, la charge) :
 * - ollie : trait vers le haut ; kickflip : trait vers la diagonale haut-gauche ; heelflip : haut-droite ;
 * - pop shove-it : demi-cercle par un côté, sortie en haut (le côté donne le sens de rotation) ;
 * - 360 flip : cercle complet ;
 * - varial flip : arc de 225° par la droite, sortie sur la diagonale du kickflip ;
 * - hardflip : arc de 225° par la gauche, sortie sur la diagonale du heelflip.
 */
const TEMPLATES: readonly Template[] = [
  { trick: 'ollie', arc: false, end: UP, sweep: 0, signed: false, atLeast: false },
  { trick: 'kickflip', arc: false, end: UP_LEFT, sweep: 0, signed: false, atLeast: false },
  { trick: 'heelflip', arc: false, end: UP_RIGHT, sweep: 0, signed: false, atLeast: false },
  { trick: 'popShoveIt', arc: true, end: UP, sweep: Math.PI, signed: false, atLeast: false },
  { trick: 'varialFlip', arc: true, end: UP_LEFT, sweep: (5 * Math.PI) / 4, signed: true, atLeast: false },
  { trick: 'hardflip', arc: true, end: UP_RIGHT, sweep: (-5 * Math.PI) / 4, signed: true, atLeast: false },
  { trick: 'treFlip', arc: true, end: null, sweep: 2 * Math.PI * 0.9, signed: false, atLeast: true },
];

/** Nombre maximal d'échantillons d'un flick (à 120 Hz, couvre largement FLICK.maxFlickMs). */
const MAX_SAMPLES = 256;

type Phase = 'idle' | 'stray' | 'charging' | 'flicking';

/**
 * Analyse la trajectoire du stick droit et produit des événements de trick.
 * Appelé une fois par pas fixe avec le stick normalisé (zone morte déjà appliquée).
 */
export class FlickRecognizer {
  readonly snapshot: GestureSnapshot = { charging: false, flicking: false, event: null, cancelled: false };
  /** Chemin du dernier flick analysé (x, y entrelacés) et son nombre de points, pour le debug. */
  readonly lastPath = new Float32Array(MAX_SAMPLES * 2);
  lastPathLength = 0;
  /** Dernière analyse, conservée pour l'affichage. */
  lastEvent: FlickEvent | null = null;
  /** Sensibilité courante (réglages), FLICK.sensitivity par défaut : multiplie toutes les tolérances. */
  sensitivity: number = FLICK.sensitivity;

  private phase: Phase = 'idle';
  private readonly path = new Float32Array(MAX_SAMPLES * 2);
  private count = 0;
  private chargeTime = 0;
  private flickTime = 0;
  private stillTime = 0;
  private centerTime = 0;
  private reached = false;
  private lastX = 0;
  private lastY = 0;
  /** Somme des positions pendant la charge : sa direction donne l'angle de départ réel. */
  private chargeSumX = 0;
  private chargeSumY = 0;

  private readonly features: GestureFeatures = {
    startAngle: 0,
    endAngle: 0,
    sweep: 0,
    minRadius: 0,
    amplitude: 0,
    duration: 0,
    chargeTime: 0,
  };

  /** Phase courante, pour le debug. */
  get currentPhase(): Phase {
    return this.phase;
  }

  update(x: number, y: number): GestureSnapshot {
    const snap = this.snapshot;
    snap.event = null;
    snap.cancelled = false;
    const dt = FIXED_DT;
    const r = Math.hypot(x, y);
    const inSector = angleDistance(Math.atan2(y, x), DOWN) <= FLICK.chargeHalfAngle;
    const inCharge = r >= FLICK.chargeRadius && inSector;

    switch (this.phase) {
      case 'idle':
        if (inCharge) this.beginCharge();
        else if (r > FLICK.startRadius) this.phase = 'stray';
        break;
      case 'stray':
        // Geste qui ne commence pas en bas : ignoré jusqu'au retour au centre.
        if (r < FLICK.releaseRadius) this.phase = 'idle';
        else if (inCharge) this.beginCharge();
        break;
      case 'charging':
        if (inCharge) {
          this.chargeTime += dt;
          this.chargeSumX += x;
          this.chargeSumY += y;
          this.count = 0;
          this.push(x, y);
        } else {
          this.phase = 'flicking';
          this.flickTime = 0;
          this.stillTime = 0;
          this.centerTime = 0;
          // Flick vif : le stick peut sortir de la charge directement au bord, la sortie est déjà atteinte.
          this.reached = r >= FLICK.reachRadius && !inSector;
          this.push(x, y);
        }
        break;
      case 'flicking': {
        this.flickTime += dt;
        this.push(x, y);
        // Le geste compte quand le stick a quitté le secteur bas, pas seulement la zone de charge.
        if (r >= FLICK.reachRadius && !inSector) this.reached = true;
        if (inCharge && !this.reached) {
          // Retour en charge avant d'avoir flické : on recharge, sans pénalité.
          this.phase = 'charging';
          break;
        }
        const moved = Math.hypot(x - this.lastX, y - this.lastY);
        this.stillTime = moved < FLICK.holdEndMotion && r >= FLICK.reachRadius ? this.stillTime + dt : 0;
        this.centerTime = r < FLICK.releaseRadius ? this.centerTime + dt : 0;

        if (r < FLICK.releaseRadius && this.reached) this.finish();
        else if (!this.reached && this.centerTime * 1000 > INPUT.flickWindowMs) this.cancel();
        else if (this.reached && this.stillTime * 1000 >= FLICK.holdEndMs) this.finish();
        else if (this.flickTime * 1000 >= FLICK.maxFlickMs) {
          if (this.reached) this.finish();
          else this.cancel();
        }
        break;
      }
    }
    this.lastX = x;
    this.lastY = y;
    snap.charging = this.phase === 'charging';
    snap.flicking = this.phase === 'flicking';
    return snap;
  }

  private beginCharge(): void {
    this.phase = 'charging';
    this.chargeTime = 0;
    this.chargeSumX = this.chargeSumY = 0;
    this.count = 0;
  }

  private push(x: number, y: number): void {
    if (this.count >= MAX_SAMPLES) return;
    this.path[this.count * 2] = x;
    this.path[this.count * 2 + 1] = y;
    this.count++;
  }

  private cancel(): void {
    this.phase = this.isCentered() ? 'idle' : 'stray';
    this.snapshot.cancelled = true;
  }

  private isCentered(): boolean {
    return Math.hypot(this.lastX, this.lastY) < FLICK.releaseRadius;
  }

  private finish(): void {
    const event = this.analyze();
    this.lastPath.set(this.path.subarray(0, this.count * 2));
    this.lastPathLength = this.count;
    this.lastEvent = event;
    this.snapshot.event = event;
    // Si le stick reste hors du centre (fin par immobilité), on attend son retour avant un nouveau geste.
    this.phase = this.isCentered() ? 'idle' : 'stray';
  }

  /** Mesure les caractéristiques du chemin puis note chaque modèle. */
  private analyze(): FlickEvent {
    const f = this.features;
    const p = this.path;
    const n = this.count;
    // Départ : direction moyenne tenue pendant la charge. Le balayage part de là, et non du bord
    // du secteur de charge où le stick se trouve quand il en sort.
    f.startAngle = Math.atan2(this.chargeSumY, this.chargeSumX);
    f.duration = this.flickTime;
    f.chargeTime = this.chargeTime;

    let sweep = 0;
    let maxR = 0;
    let endIndex = 0;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2]!;
      const y = p[i * 2 + 1]!;
      const r = Math.hypot(x, y);
      maxR = Math.max(maxR, r);
      if (r >= FLICK.reachRadius) endIndex = i;
      if (i === 0) continue;
      const px = p[i * 2 - 2]!;
      const py = p[i * 2 - 1]!;
      // Un segment qui coupe le disque central (trait vif entre deux échantillons) ne balaie aucun angle.
      if (segmentDistance(px, py, x, y) < FLICK.sweepMinRadius) continue;
      sweep += wrapAngle(Math.atan2(y, x) - Math.atan2(py, px));
    }
    // La sortie se place avant la descente finale vers le centre (relâchement progressif d'un stick
    // ou des flèches) : ces points ne disent rien du geste.
    while (endIndex > 1 && Math.hypot(p[endIndex * 2 - 2]!, p[endIndex * 2 - 1]!) > Math.hypot(p[endIndex * 2]!, p[endIndex * 2 + 1]!) + 1e-3) {
      endIndex--;
    }
    // Rayon minimal entre le départ et la sortie : le relâchement final vers le centre ne compte pas.
    // Mesuré sur les segments et non sur les seuls échantillons : un flick vif peut ne laisser que deux
    // points (bas puis haut) ; c'est le segment qui les relie qui coupe le centre.
    let minR = Infinity;
    for (let i = 1; i <= endIndex; i++) minR = Math.min(minR, segmentDistance(p[i * 2 - 2]!, p[i * 2 - 1]!, p[i * 2]!, p[i * 2 + 1]!));
    if (!Number.isFinite(minR)) minR = maxR;
    sweep += wrapAngle(Math.atan2(p[1]!, p[0]!) - f.startAngle);
    f.sweep = sweep;
    f.minRadius = minR;
    f.amplitude = maxR;
    f.endAngle = Math.atan2(p[endIndex * 2 + 1]!, p[endIndex * 2]!);

    const s = this.sensitivity;
    const arcness = sigmoid((minR - FLICK.arcRadius) / (FLICK.arcRadiusWidth * s));
    const startFit = gauss(angleDistance(f.startAngle, DOWN), FLICK.startTolerance * s);
    const candidates: TrickCandidate[] = TEMPLATES.map((t) => {
      const family = t.arc ? arcness : 1 - arcness;
      const endFit = t.end === null ? 1 : gauss(angleDistance(f.endAngle, t.end), FLICK.endTolerance * s);
      let sweepFit = 1;
      if (t.arc) {
        const measured = t.signed ? sweep : Math.abs(sweep);
        const err = t.atLeast ? Math.max(0, t.sweep - measured) : Math.abs(measured - t.sweep);
        sweepFit = gauss(err, FLICK.sweepTolerance * s);
      }
      return { trick: t.trick, score: family * endFit * sweepFit * startFit };
    });
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0]!;
    const fallback = best.score < FLICK.minScore;
    let trick: FlickTrickId = fallback ? 'ollie' : best.trick;
    // Geste flou mais pas franchement un arc : le trait dont la sortie est la plus proche, plutôt que l'ollie
    // d'office. Un kickflip dont la charge était un peu décentrée ressemble à une corde d'arc.
    if (fallback && arcness < FLICK.fallbackMaxArcness) {
      let bestEnd = -1;
      for (const t of TEMPLATES) {
        if (t.arc || t.end === null) continue;
        const fit = gauss(angleDistance(f.endAngle, t.end), FLICK.endTolerance * s);
        if (fit > bestEnd) {
          bestEnd = fit;
          trick = t.trick;
        }
      }
    }
    const arc = trick === 'popShoveIt' || trick === 'treFlip' || trick === 'varialFlip' || trick === 'hardflip';
    const side: 1 | -1 | 0 = arc ? (sweep >= 0 ? 1 : -1) : 0;
    return { trick, score: best.score, side, fallback, features: { ...f }, candidates };
  }
}

/** Distance entre le centre du stick et le segment (ax, ay) → (bx, by). */
function segmentDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}

function gauss(err: number, tolerance: number): number {
  const k = err / tolerance;
  return Math.exp(-k * k);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-4 * x));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function angleDistance(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}
