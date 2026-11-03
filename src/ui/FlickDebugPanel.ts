import { FLICK } from '@/config/physics';
import type { FlickRecognizer } from '@/core/FlickRecognizer';
import { TRICK_DEFS, trickName } from '@/skater/tricks';

/** Taille du schéma du stick (px CSS). */
const SIZE = 150;
const DEG = 180 / Math.PI;

/**
 * Panneau de debug du flick : stick droit en direct, chemin du dernier geste,
 * caractéristiques mesurées, trick retenu et score des autres modèles.
 */
export class FlickDebugPanel {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly text: HTMLPreElement;
  private visible: boolean;
  private shownEvent: unknown = null;

  constructor(parent: HTMLElement, visible: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'flick-debug';
    Object.assign(this.el.style, {
      position: 'fixed',
      top: 'max(8px, env(safe-area-inset-top))',
      right: 'max(8px, env(safe-area-inset-right))',
      padding: '6px 8px',
      background: 'rgba(0,0,0,0.55)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '10',
      color: '#e8f0e8',
      font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    } satisfies Partial<CSSStyleDeclaration>);
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = SIZE * dpr;
    Object.assign(this.canvas.style, { width: `${SIZE}px`, height: `${SIZE}px`, display: 'block', margin: '0 auto 4px' });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
    this.text = document.createElement('pre');
    Object.assign(this.text.style, { margin: '0', whiteSpace: 'pre', minWidth: '210px' });
    this.el.append(this.canvas, this.text);
    parent.appendChild(this.el);
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
  }

  update(recognizer: FlickRecognizer, stickX: number, stickY: number): void {
    if (!this.visible) return;
    this.draw(recognizer, stickX, stickY);
    const ev = recognizer.lastEvent;
    if (ev === this.shownEvent && this.text.textContent) {
      this.text.textContent = this.text.textContent.replace(/^phase .*$/m, `phase  ${recognizer.currentPhase}`);
      return;
    }
    this.shownEvent = ev;
    const lines = [`phase  ${recognizer.currentPhase}`];
    if (ev) {
      const f = ev.features;
      lines.push(
        `geste  début ${(f.startAngle * DEG).toFixed(0)}°  sortie ${(f.endAngle * DEG).toFixed(0)}°`,
        `       balayé ${(f.sweep * DEG).toFixed(0)}°  r min ${f.minRadius.toFixed(2)}`,
        `       ampl. ${f.amplitude.toFixed(2)}  ${(f.duration * 1000).toFixed(0)} ms  charge ${(f.chargeTime * 1000).toFixed(0)} ms`,
        `trick  ${trickName(ev.trick, ev.side)}${ev.fallback ? ' (par défaut)' : ''}`,
        `score  ${(ev.score * 100).toFixed(0)} %`,
      );
      for (const c of ev.candidates.slice(1, 4)) lines.push(`       ${TRICK_DEFS[c.trick].name.padEnd(13)} ${(c.score * 100).toFixed(0)} %`);
    } else {
      lines.push('geste  -');
    }
    this.text.textContent = lines.join('\n');
  }

  private draw(recognizer: FlickRecognizer, sx: number, sy: number): void {
    const ctx = this.ctx;
    const c = SIZE / 2;
    const R = SIZE / 2 - 8;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.lineWidth = 1;
    // Bord du stick, disque intérieur (frontière trait / arc) et zone de charge.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(c, c, R * FLICK.arcRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(232,178,58,0.22)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, R, Math.PI / 2 - FLICK.chargeHalfAngle, Math.PI / 2 + FLICK.chargeHalfAngle);
    ctx.closePath();
    ctx.fill();
    // Directions de sortie : haut, diagonales du kickflip et du heelflip.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const a of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * R, c - Math.sin(a) * R, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Chemin du dernier geste, du jaune (départ) au vert (sortie).
    const n = recognizer.lastPathLength;
    const p = recognizer.lastPath;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.strokeStyle = `rgb(${Math.round(232 - 140 * t)}, ${Math.round(178 + 50 * t)}, ${Math.round(58 + 40 * t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c + p[(i - 1) * 2]! * R, c - p[(i - 1) * 2 + 1]! * R);
      ctx.lineTo(c + p[i * 2]! * R, c - p[i * 2 + 1]! * R);
      ctx.stroke();
    }
    // Stick en direct.
    ctx.fillStyle = '#ff6b5b';
    ctx.beginPath();
    ctx.arc(c + sx * R, c - sy * R, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
