import { INPUT, SKATING } from '@/config/physics';
import type { State, StateMachine } from './StateMachine';
import type { SkaterStateId } from './states';
import type { Skater } from './Skater';

type SkaterState = State<SkaterStateId, Skater>;

/** Arrêté sur la planche. On peut pivoter sur place et lancer une poussée. */
const idle: SkaterState = {
  id: 'idle',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (!sk.grounded) return 'air';
    if (sk.pushRequested()) return 'pushing';
    if (sk.speed > SKATING.stopSpeed * 2) return 'riding';
    return null;
  },
};

/** Roue libre. */
const riding: SkaterState = {
  id: 'riding',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (!sk.grounded) return 'air';
    if (sk.brakeRequested() && sk.speed > SKATING.stopSpeed) return 'braking';
    if (sk.pushRequested()) return 'pushing';
    if (sk.speed < SKATING.stopSpeed) return 'idle';
    return null;
  },
};

/**
 * Poussée : un temps de contact où l'accélération suit une cloche 2·sin²(πx)
 * (intégrale 1, donc l'impulsion totale vaut pushImpulse), puis le retour du pied.
 * L'efficacité baisse avec la vitesse jusqu'au plafond de poussée.
 */
const pushing: SkaterState = {
  id: 'pushing',
  enter(sk) {
    sk.pushTimer = 0;
    sk.brake = 0;
    sk.pushQueuedUntil = -1;
  },
  exit(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (!sk.grounded) return 'air';
    if (sk.brakeRequested()) return 'braking';

    const boost = sk.boostHeld();
    const cadence = boost ? SKATING.boostCadenceMultiplier : 1;
    const contact = SKATING.pushDuration / cadence;
    const recovery = SKATING.pushRecovery / cadence;
    sk.pushTimer += dt;

    if (sk.pushTimer < contact) {
      const x = sk.pushTimer / contact;
      const cap = boost ? SKATING.boostSpeedCap : SKATING.pushSpeedCap;
      const efficiency = Math.max(0, 1 - Math.max(0, sk.forwardSpeed) / cap);
      const impulse = SKATING.pushImpulse * (boost ? SKATING.boostImpulseMultiplier : 1);
      const bell = 2 * Math.sin(Math.PI * x) ** 2;
      sk.pushAccel = (impulse * efficiency * bell) / contact;
      sk.pushPhase = x;
    } else {
      sk.pushAccel = 0;
      sk.pushPhase = 1 + Math.min(1, (sk.pushTimer - contact) / recovery);
      if (sk.input.pressed.has('push')) sk.pushQueuedUntil = sk.time + INPUT.pushBufferMs / 1000;
    }

    if (sk.pushTimer >= contact + recovery) {
      if (sk.pushRequested()) {
        sk.pushTimer = 0;
        sk.pushQueuedUntil = -1;
        return null;
      }
      return sk.speed < SKATING.stopSpeed ? 'idle' : 'riding';
    }
    return null;
  },
};

/** Frein au pied, montée progressive de la force. */
const braking: SkaterState = {
  id: 'braking',
  enter(sk) {
    sk.brake = 0;
  },
  exit(sk) {
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (!sk.grounded) return 'air';
    if (sk.speed < SKATING.stopSpeed) return 'idle';
    if (!sk.brakeRequested()) return 'riding';
    sk.brake = Math.min(1, sk.brake + dt / SKATING.brakeRampTime);
    return null;
  },
};

/** En l'air. La réception est détectée par la simulation, qui repasse grounded à vrai. */
const air: SkaterState = {
  id: 'air',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (sk.grounded) return sk.speed < SKATING.stopSpeed ? 'idle' : 'riding';
    return null;
  },
};

export function registerSkaterStates(fsm: StateMachine<SkaterStateId, Skater>): void {
  fsm.add(idle).add(riding).add(pushing).add(braking).add(air);
}
