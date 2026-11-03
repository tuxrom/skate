import { INPUT, POP, SKATING } from '@/config/physics';
import type { State, StateMachine } from './StateMachine';
import type { SkaterStateId } from './states';
import type { Skater } from './Skater';

type SkaterState = State<SkaterStateId, Skater>;

/** Sortie commune des états au sol vers l'ollie : charge, ou pop immédiat pour un tap mémorisé. */
function ollieStart(sk: Skater): SkaterStateId | null {
  if (sk.recovery > 0) return null;
  const source = sk.ollieStartRequested();
  if (!source) return null;
  if (source === 'buffered') {
    sk.startBufferedPop();
    return 'pop';
  }
  sk.startCharge(source);
  return 'popCharge';
}

function rollingState(sk: Skater): SkaterStateId {
  return sk.speed < SKATING.stopSpeed ? 'idle' : 'riding';
}

/** Arrêté sur la planche. On peut pivoter sur place, pousser, ou faire un ollie sur place. */
const idle: SkaterState = {
  id: 'idle',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (sk.grinding) return 'grind';
    if (!sk.grounded) return 'air';
    const ollie = ollieStart(sk);
    if (ollie) return ollie;
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
    if (sk.grinding) return 'grind';
    if (!sk.grounded) return 'air';
    const ollie = ollieStart(sk);
    if (ollie) return ollie;
    if (sk.manualRequested()) return 'manual';
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
 * Maintenir la touche enchaîne des poussées plus fortes et plus rapides.
 */
const pushing: SkaterState = {
  id: 'pushing',
  enter(sk) {
    sk.pushTimer = 0;
    sk.pushChain = 0;
    sk.brake = 0;
    sk.pushQueuedUntil = -1;
  },
  exit(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (sk.grinding) return 'grind';
    if (!sk.grounded) return 'air';
    const ollie = ollieStart(sk);
    if (ollie) return ollie;
    if (sk.manualRequested()) return 'manual';
    if (sk.brakeRequested()) return 'braking';

    const boost = sk.boostHeld();
    const cadence = boost ? SKATING.boostCadenceMultiplier : 1;
    const contact = SKATING.pushDuration / cadence;
    const recovery = SKATING.pushRecovery / cadence;
    sk.pushTimer += dt;

    if (sk.pushTimer < contact) {
      const x = sk.pushTimer / contact;
      const cap = boost ? SKATING.boostSpeedCap : SKATING.pushSpeedCap;
      const efficiency = Math.max(0, 1 - Math.abs(sk.forwardSpeed) / cap);
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
        if (sk.input.held.has('push')) sk.pushChain++;
        sk.pushTimer = 0;
        sk.pushQueuedUntil = -1;
        return null;
      }
      return rollingState(sk);
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
    if (sk.grinding) return 'grind';
    if (!sk.grounded) return 'air';
    const ollie = ollieStart(sk);
    if (ollie) return ollie;
    if (sk.speed < SKATING.stopSpeed) return 'idle';
    if (!sk.brakeRequested()) return 'riding';
    sk.brake = Math.min(1, sk.brake + dt / SKATING.brakeRampTime);
    return null;
  },
};

/**
 * Charge de l'ollie : le skateur s'accroupit, la hauteur future croît avec la durée.
 * Quitter le sol pendant la charge garde la charge quelques millisecondes (coyote time).
 */
const popCharge: SkaterState = {
  id: 'popCharge',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    sk.updateCharge(dt);
    if (!sk.grounded) {
      sk.coyoteCharge = sk.charge;
      return 'air';
    }
    const release = sk.ollieReleaseRequested();
    if (release === 'pop') return 'pop';
    if (release === 'cancel') {
      sk.cancelCharge();
      return rollingState(sk);
    }
    return null;
  },
};

/** Claquement du tail : court délai avant le décollage, qui donne du poids au saut. */
const pop: SkaterState = {
  id: 'pop',
  enter(sk) {
    sk.popTimer = 0;
    sk.popTime = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    sk.popTimer += dt;
    if (sk.popTimer >= POP.popDelay || !sk.grounded) {
      sk.performPop(sk.charge);
      return 'air';
    }
    return null;
  },
};

/** En l'air. La réception est détectée et évaluée par la simulation. */
const air: SkaterState = {
  id: 'air',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (sk.tryCoyotePop()) return null;
    if (sk.grinding) return 'grind';
    if (sk.grounded) {
      // Réception propre touche de manual tenue : on enchaîne directement en manual (grind → manual).
      if (sk.manualRequested() && (sk.recovery <= 0 || (sk.landTime === 0 && sk.lastLanding.quality === 'clean'))) return 'manual';
      return sk.recovery > 0 ? 'landing' : rollingState(sk);
    }
    return null;
  },
};

/**
 * Grind : la simulation tient le board sur la ligne et fait évoluer la jauge (stick gauche gauche-droite).
 * Le skateur en sort par un ollie (avec flip possible), au bout du rail, en ralentissant trop, ou en chute.
 */
const grind: SkaterState = {
  id: 'grind',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
  },
  update(sk, dt) {
    if (!sk.grinding) return sk.grounded ? rollingState(sk) : 'air';
    if (sk.updateGrindPop(dt)) return 'air';
    return null;
  },
};

/**
 * Manual : touche tenue au sol, équilibre sur deux roues avec la même jauge (haut/bas avec la touche).
 * Sortie en relâchant, par un ollie ou un flip (vers un grind), ou en chute si la jauge sort.
 */
const manual: SkaterState = {
  id: 'manual',
  enter(sk) {
    sk.pushAccel = 0;
    sk.pushPhase = -1;
    sk.brake = 0;
    sk.startManual();
  },
  exit(sk) {
    sk.endManual('release');
  },
  update(sk, dt) {
    sk.updateLean(dt);
    if (sk.grinding) {
      sk.endManual('air');
      return 'grind';
    }
    if (!sk.grounded) {
      sk.endManual('air');
      return 'air';
    }
    const ollie = ollieStart(sk);
    if (ollie) {
      sk.endManual('pop');
      return ollie;
    }
    if (!sk.input.held.has('manual')) return rollingState(sk);
    if (sk.updateManual(dt)) {
      sk.manualBail();
      return 'bail';
    }
    if (sk.speed < SKATING.stopSpeed) {
      sk.endManual('slow');
      return 'idle';
    }
    return null;
  },
};

/** Récupération après une réception : ni pop ni poussée tant qu'elle dure. */
const landing: SkaterState = {
  id: 'landing',
  update(sk, dt) {
    sk.updateLean(dt);
    if (sk.grinding) return 'grind';
    if (!sk.grounded) return 'air';
    // Après une chute, il faut relâcher puis réappuyer la touche de manual pour en refaire un.
    if (sk.recovery <= 0) return sk.manualRequested() && sk.lastLanding.quality !== 'bail' ? 'manual' : rollingState(sk);
    return null;
  },
};

/** Chute : la simulation est suspendue, le ragdoll et BailController ont la main jusqu'à la relève. */
const bail: SkaterState = {
  id: 'bail',
  update(sk) {
    return sk.bailing ? null : 'idle';
  },
};

export function registerSkaterStates(fsm: StateMachine<SkaterStateId, Skater>): void {
  fsm.add(idle).add(riding).add(pushing).add(braking).add(popCharge).add(pop).add(air).add(landing).add(grind).add(manual).add(bail);
}
