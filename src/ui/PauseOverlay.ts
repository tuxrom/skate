/** Voile de pause minimal. Le vrai menu arrive à l'étape 8. */
export class PauseOverlay {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pause-overlay';
    Object.assign(this.el.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '10px',
      background: 'rgba(12,14,18,0.55)',
      color: '#f2f2f2',
      font: '600 28px/1.2 system-ui, sans-serif',
      letterSpacing: '0.08em',
      zIndex: '20',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const title = document.createElement('div');
    title.textContent = 'PAUSE';
    const hint = document.createElement('div');
    hint.textContent = 'Échap pour reprendre · R pour revenir au départ';
    Object.assign(hint.style, { font: '400 14px/1.4 system-ui, sans-serif', letterSpacing: '0', opacity: '0.8' });
    this.el.append(title, hint);
    parent.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'flex' : 'none';
  }
}
