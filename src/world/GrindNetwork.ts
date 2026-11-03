import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { SurfaceMaterial } from '@/config/physics';

/** Nature d'une ligne de grind : rail rond, barre plate, arête de ledge ou de box, coping de transition. */
export type GrindKind = 'round' | 'flat' | 'ledge' | 'coping';

/**
 * Segment orienté de grind : la ligne sur laquelle roulent les trucks ou glisse le deck.
 * Pour un rail, c'est le dessus du tube ; pour un ledge, l'arête supérieure.
 */
export interface GrindSegment {
  readonly index: number;
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  /** Direction unitaire de a vers b. */
  readonly dir: THREE.Vector3;
  readonly length: number;
  readonly kind: GrindKind;
  readonly material: SurfaceMaterial;
  /** Collider physique qui porte la ligne, s'il existe. */
  readonly collider: RAPIER.Collider | null;
  /** Segment qui prolonge celui-ci après b (même rail), null sinon. */
  next: GrindSegment | null;
  /** Segment qui précède celui-ci avant a, null sinon. */
  prev: GrindSegment | null;
}

/** Résultat de la recherche du segment le plus proche de l'axe du board. */
export interface GrindQuery {
  segment: GrindSegment;
  /** Abscisse du point le plus proche sur le segment (m depuis a). */
  t: number;
  /** Point le plus proche sur la ligne. */
  readonly railPoint: THREE.Vector3;
  /** Point le plus proche sur l'axe du board. */
  readonly boardPoint: THREE.Vector3;
  distance: number;
}

/** Tolérance pour considérer que deux segments se suivent (m). */
const LINK_TOLERANCE = 0.02;

/** Ensemble des lignes de grind du niveau. Peu de segments : la recherche est exhaustive. */
export class GrindNetwork {
  readonly segments: GrindSegment[] = [];

  /** Ajoute une polyligne de grind ; ses segments sont chaînés entre eux. */
  addLine(points: readonly THREE.Vector3[], kind: GrindKind, material: SurfaceMaterial, collider: RAPIER.Collider | null = null): GrindSegment[] {
    const added: GrindSegment[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!.clone();
      const b = points[i + 1]!.clone();
      const d = new THREE.Vector3().subVectors(b, a);
      const length = d.length();
      if (length < 1e-3) continue;
      const seg: GrindSegment = { index: this.segments.length, a, b, dir: d.divideScalar(length), length, kind, material, collider, next: null, prev: null };
      const before = added[added.length - 1];
      if (before) {
        before.next = seg;
        seg.prev = before;
      }
      this.segments.push(seg);
      added.push(seg);
    }
    return added;
  }

  /** Chaîne les segments dont les extrémités se touchent (rails construits en plusieurs morceaux). */
  linkEndpoints(): void {
    for (const s of this.segments) {
      if (s.next) continue;
      for (const o of this.segments) {
        if (o === s || o.prev || o.kind !== s.kind) continue;
        if (o.a.distanceTo(s.b) < LINK_TOLERANCE) {
          s.next = o;
          o.prev = s;
          break;
        }
      }
    }
  }

  /**
   * Segment le plus proche de l'axe du board (capsule autour du segment queue-nez).
   * `accept` filtre les candidats (hauteur, alignement, délai de réaccrochage).
   */
  closest(boardA: THREE.Vector3, boardB: THREE.Vector3, maxDistance: number, out: GrindQuery, accept: (q: GrindQuery) => boolean): boolean {
    let found = false;
    let best = maxDistance;
    const center = TMP_C.addVectors(boardA, boardB).multiplyScalar(0.5);
    for (const seg of this.segments) {
      // Point du rail le plus proche du centre du board, puis point du board le plus proche de celui-ci.
      // Plus stable qu'un segment contre segment quand le board est parallèle au rail (cas d'un 50-50) :
      // le couple de points y serait arbitraire et tomberait sur un bout du board.
      const t = THREE.MathUtils.clamp(TMP_R.subVectors(center, seg.a).dot(seg.dir), 0, seg.length);
      TMP_Q.copy(seg.a).addScaledVector(seg.dir, t);
      closestPointOnSegment(boardA, boardB, TMP_Q, TMP_P);
      const dist = TMP_P.distanceTo(TMP_Q);
      if (dist > best) continue;
      const candidate = SCRATCH;
      candidate.segment = seg;
      candidate.t = t;
      candidate.railPoint.copy(TMP_Q);
      candidate.boardPoint.copy(TMP_P);
      candidate.distance = dist;
      // `accept` peut recaler le point de grind (candidate.t, candidate.railPoint) : on recopie le candidat.
      if (!accept(candidate)) continue;
      best = dist;
      out.segment = seg;
      out.t = candidate.t;
      out.railPoint.copy(candidate.railPoint);
      out.boardPoint.copy(candidate.boardPoint);
      out.distance = dist;
      found = true;
    }
    return found;
  }
}

const TMP_P = new THREE.Vector3();
const TMP_Q = new THREE.Vector3();
const TMP_R = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const D1 = new THREE.Vector3();
const R0 = new THREE.Vector3();
const SCRATCH: GrindQuery = { segment: null as unknown as GrindSegment, t: 0, railPoint: new THREE.Vector3(), boardPoint: new THREE.Vector3(), distance: 0 };

/** Point du segment [a, b] le plus proche de p. */
export function closestPointOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const ab = D1.subVectors(b, a);
  const len2 = ab.lengthSq();
  const t = len2 > 1e-12 ? clamp01(R0.subVectors(p, a).dot(ab) / len2) : 0;
  return out.copy(a).addScaledVector(ab, t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
