import type * as THREE from 'three';
import { InterpolatedBody } from '@/physics/InterpolatedBody';
import type { Skater } from './Skater';
import { copyPose, createPose, type SkaterRig } from './SkaterRig';

/** Relie la simulation du skateur à son rig : transform et pose d'animation interpolés. */
export class SkaterVisual {
  private readonly body: InterpolatedBody;
  private readonly prev = createPose();
  private readonly curr = createPose();
  private readonly out = createPose();

  constructor(
    private readonly skater: Skater,
    readonly rig: SkaterRig,
  ) {
    this.body = new InterpolatedBody(skater, rig.root);
    this.teleportSync();
  }

  get object(): THREE.Object3D {
    return this.rig.root;
  }

  /** Après chaque pas fixe. */
  capture(): void {
    this.body.capture();
    copyPose(this.prev, this.curr);
    this.skater.writeAnimationPose(this.curr);
  }

  teleportSync(): void {
    this.body.teleportSync();
    this.skater.writeAnimationPose(this.curr);
    copyPose(this.prev, this.curr);
  }

  /** À chaque frame rendue. */
  render(alpha: number, dt: number): void {
    this.body.apply(alpha);
    const a = this.prev;
    const b = this.curr;
    const o = this.out;
    o.lean = a.lean + (b.lean - a.lean) * alpha;
    o.brake = a.brake + (b.brake - a.brake) * alpha;
    o.crouch = a.crouch + (b.crouch - a.crouch) * alpha;
    o.speed = a.speed + (b.speed - a.speed) * alpha;
    // La phase de poussée boucle : pas d'interpolation à travers un redémarrage.
    o.pushPhase = lerpTimer(a.pushPhase, b.pushPhase, alpha);
    o.airborne = b.airborne;
    o.charge = b.charge > 0 ? a.charge + (b.charge - a.charge) * alpha : 0;
    o.popTime = lerpTimer(a.popTime, b.popTime, alpha);
    o.airTime = lerpTimer(a.airTime, b.airTime, alpha);
    o.landTime = lerpTimer(a.landTime, b.landTime, alpha);
    o.landImpact = b.landImpact;
    o.landQuality = b.landQuality;
    // Les angles de trick repartent de zéro à chaque pop : pas d'interpolation à travers un saut d'angle.
    const restart = Math.abs(b.trickFlip - a.trickFlip) > Math.PI || Math.abs(b.trickShove - a.trickShove) > Math.PI;
    o.trickFlip = restart ? b.trickFlip : a.trickFlip + (b.trickFlip - a.trickFlip) * alpha;
    o.trickShove = restart ? b.trickShove : a.trickShove + (b.trickShove - a.trickShove) * alpha;
    o.feetLift = a.feetLift + (b.feetLift - a.feetLift) * alpha;
    o.trickProgress = b.trickProgress;
    this.rig.update(o, dt);
  }
}

/** Interpole un temps qui croît pendant le segment ; un redémarrage ou un -1 prend la valeur courante. */
function lerpTimer(a: number, b: number, alpha: number): number {
  return a >= 0 && b >= a ? a + (b - a) * alpha : b;
}
