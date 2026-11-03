import type * as THREE from 'three';
import { InterpolatedBody } from '@/physics/InterpolatedBody';
import type { Skater } from './Skater';
import { createPose, type SkaterPose, type SkaterRig } from './SkaterRig';

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
    o.pushPhase = a.pushPhase >= 0 && b.pushPhase >= a.pushPhase ? a.pushPhase + (b.pushPhase - a.pushPhase) * alpha : b.pushPhase;
    o.airborne = b.airborne;
    this.rig.update(o, dt);
  }
}

function copyPose(out: SkaterPose, src: SkaterPose): void {
  out.lean = src.lean;
  out.pushPhase = src.pushPhase;
  out.brake = src.brake;
  out.crouch = src.crouch;
  out.speed = src.speed;
  out.airborne = src.airborne;
}
