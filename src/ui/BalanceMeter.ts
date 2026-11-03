import { BALANCE } from '@/config/physics';

/**
 * Jauge d'équilibre des grinds et manuals : zone sûre, zone d'alerte, curseur.
 * Le vrai HUD arrive à l'étape 8 ; celle-ci suffit pour jouer.
 */
export class BalanceMeter {
  private readonly el: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'balance-meter';
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '50%',
      bottom: 'max(24px, env(safe-area-inset-bottom))',
      transform: 'translateX(-50%)',
      width: '240px',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '12',
      font: '600 13px/1.2 system-ui, sans-serif',
      color: '#f2f2f2',
      textAlign: 'center',
      textShadow: '0 1px 2px rgba(0,0,0,0.6)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.label = document.createElement('div');
    this.label.style.marginBottom = '4px';
    const bar = document.createElement('div');
    const warn = (BALANCE.warnZone / BALANCE.limit) * 50;
    Object.assign(bar.style, {
      position: 'relative',
      height: '12px',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.6)',
      background: `linear-gradient(90deg, #c8553d 0%, #e8b23a ${50 - warn}%, #5fae6a ${50 - warn}%, #5fae6a ${50 + warn}%, #e8b23a ${50 + warn}%, #c8553d 100%)`,
      opacity: '0.9',
    } satisfies Partial<CSSStyleDeclaration>);
    this.cursor = document.createElement('div');
    Object.assign(this.cursor.style, {
      position: 'absolute',
      top: '-4px',
      width: '4px',
      height: '20px',
      marginLeft: '-2px',
      left: '50%',
      background: '#ffffff',
      borderRadius: '2px',
      boxShadow: '0 0 3px rgba(0,0,0,0.8)',
    } satisfies Partial<CSSStyleDeclaration>);
    bar.appendChild(this.cursor);
    this.el.append(this.label, bar);
    parent.appendChild(this.el);
  }

  /** `name` null cache la jauge. `value` va de -limit à +limit. */
  update(name: string | null, value: number): void {
    const show = name !== null;
    if (show !== this.visible) {
      this.visible = show;
      this.el.style.display = show ? 'block' : 'none';
    }
    if (!show) return;
    if (this.label.textContent !== name) this.label.textContent = name;
    const x = Math.max(-1, Math.min(1, value / BALANCE.limit));
    this.cursor.style.left = `${50 + x * 50}%`;
  }
}
