/**
 * Sons de planche synthétisés. Chaque fonction joue une voix courte branchée sur `out`.
 * Aucun sample : bruit filtré pour le claquement, oscillateurs pour le corps du son.
 */

import { AUDIO } from '@/config/render';

let noiseBuffer: AudioBuffer | null = null;

/** Bruit blanc d'une seconde, généré une fois par contexte. */
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  noiseBuffer = buf;
  return buf;
}

interface NoiseVoice {
  readonly filter: BiquadFilterNode;
  readonly env: GainNode;
  source: AudioBufferSourceNode | null;
  busyUntil: number;
}

interface ToneVoice {
  readonly env: GainNode;
  source: OscillatorNode | null;
  busyUntil: number;
}

/**
 * Pool de voix par sortie : filtres et enveloppes créés une fois et réutilisés ; seules les sources
 * (à usage unique dans Web Audio) sont recréées. Le nombre de voix simultanées est borné : quand tout
 * est pris, la voix la plus ancienne est coupée et reprise (une chute en enchaîne des dizaines).
 */
class VoicePool {
  readonly noise: NoiseVoice[] = [];
  readonly tones: ToneVoice[] = [];

  constructor(ctx: AudioContext, out: AudioNode) {
    for (let i = 0; i < AUDIO.noiseVoices; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const env = ctx.createGain();
      env.gain.value = 0;
      filter.connect(env).connect(out);
      this.noise.push({ filter, env, source: null, busyUntil: 0 });
    }
    for (let i = 0; i < AUDIO.toneVoices; i++) {
      const env = ctx.createGain();
      env.gain.value = 0;
      env.connect(out);
      this.tones.push({ env, source: null, busyUntil: 0 });
    }
  }
}

const pools = new WeakMap<AudioNode, VoicePool>();

function poolFor(ctx: AudioContext, out: AudioNode): VoicePool {
  let p = pools.get(out);
  if (!p) pools.set(out, (p = new VoicePool(ctx, out)));
  return p;
}

/** Voix libre, ou la plus ancienne (coupée). */
function take<T extends { busyUntil: number }>(voices: readonly T[], t: number): T {
  let best = voices[0]!;
  for (const v of voices) {
    if (v.busyUntil <= t) return v;
    if (v.busyUntil < best.busyUntil) best = v;
  }
  return best;
}

function stop(source: AudioScheduledSourceNode | null, t: number): void {
  if (!source) return;
  try {
    source.stop(t);
  } catch {
    // Déjà arrêtée.
  }
}

/** Bouffée de bruit filtrée, enveloppe exponentielle. */
function noiseHit(ctx: AudioContext, out: AudioNode, t: number, freq: number, q: number, gain: number, decay: number): void {
  const v = take(poolFor(ctx, out).noise, t);
  stop(v.source, t);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.connect(v.filter);
  src.onended = () => src.disconnect();
  v.filter.frequency.setValueAtTime(freq, t);
  v.filter.Q.setValueAtTime(q, t);
  const g = v.env.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(gain, t);
  g.exponentialRampToValueAtTime(0.0001, t + decay);
  g.setValueAtTime(0, t + decay + 0.01);
  src.start(t, Math.random() * 0.5);
  src.stop(t + decay + 0.02);
  v.source = src;
  v.busyUntil = t + decay + 0.02;
}

/** Note brève dont la hauteur tombe : le « tock » du bois ou le choc sourd des roues. */
function tone(ctx: AudioContext, out: AudioNode, t: number, type: OscillatorType, from: number, to: number, gain: number, decay: number): void {
  const v = take(poolFor(ctx, out).tones, t);
  stop(v.source, t);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + decay);
  osc.connect(v.env);
  osc.onended = () => osc.disconnect();
  const g = v.env.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(gain, t + 0.003);
  g.exponentialRampToValueAtTime(0.0001, t + decay);
  g.setValueAtTime(0, t + decay + 0.01);
  osc.start(t);
  osc.stop(t + decay + 0.02);
  v.source = osc;
  v.busyUntil = t + decay + 0.02;
}

/** Pop : claquement sec du tail sur le sol. `strength` de 0 à 1 (charge). */
export function playPop(ctx: AudioContext, out: AudioNode, strength: number): void {
  const t = ctx.currentTime;
  const g = 0.35 + 0.45 * strength;
  noiseHit(ctx, out, t, 2600, 1.2, g, 0.035);
  tone(ctx, out, t, 'triangle', 950, 420, g * 0.6, 0.05);
}

/**
 * Réception : claque du deck, choc sourd des roues, plus un raclement si la réception est sale.
 * `strength` de 0 à 1 (impact), `sloppy` ajoute du grain.
 */
export function playLand(ctx: AudioContext, out: AudioNode, strength: number, sloppy: boolean): void {
  const t = ctx.currentTime;
  const g = 0.25 + 0.65 * strength;
  noiseHit(ctx, out, t, 1800, 0.9, g, 0.06 + 0.04 * strength);
  tone(ctx, out, t, 'sine', 140, 55, g * 0.9, 0.12 + 0.08 * strength);
  tone(ctx, out, t + 0.004, 'triangle', 620, 300, g * 0.4, 0.05);
  if (sloppy) noiseHit(ctx, out, t + 0.03, 900, 0.6, g * 0.5, 0.18);
}

/** Chute : choc sourd du corps sur le sol (grave, étouffé), plus fort avec `strength`. */
export function playBodyImpact(ctx: AudioContext, out: AudioNode, strength: number): void {
  const t = ctx.currentTime;
  const g = 0.2 + 0.6 * strength;
  tone(ctx, out, t, 'sine', 95 + Math.random() * 25, 40, g, 0.16 + 0.1 * strength);
  noiseHit(ctx, out, t, 420 + Math.random() * 180, 0.7, g * 0.7, 0.09);
  if (strength > 0.5) noiseHit(ctx, out, t + 0.01, 1600, 1.0, g * 0.3, 0.05);
}

/** Planche lâchée qui rebondit : claquement de bois et roues, plus aigu que le corps. */
export function playBoardClatter(ctx: AudioContext, out: AudioNode, strength: number): void {
  const t = ctx.currentTime;
  const g = 0.15 + 0.5 * strength;
  tone(ctx, out, t, 'triangle', 700 + Math.random() * 300, 380, g * 0.6, 0.06);
  noiseHit(ctx, out, t, 2200 + Math.random() * 600, 1.4, g, 0.04);
  tone(ctx, out, t + 0.02, 'square', 210, 160, g * 0.15, 0.05);
}
