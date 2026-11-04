/**
 * Écran d'erreur plein écran, autonome (styles en ligne) : il peut s'afficher avant le chargement de la
 * feuille de style du jeu, ou après une erreur qui a cassé le reste de l'interface.
 */
export interface ErrorScreenOptions {
  title: string;
  message: string;
  /** Détail technique, affiché en petit (message d'exception). */
  detail?: string;
  /** Bouton principal (Recharger par défaut). null : pas de bouton (attente d'une restauration). */
  action?: { label: string; run: () => void } | null;
}

let current: HTMLDivElement | null = null;

export function showErrorScreen(opts: ErrorScreenOptions): void {
  hideErrorScreen();
  const el = document.createElement('div');
  el.className = 'error-screen';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-live', 'assertive');
  el.style.cssText =
    'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
    'padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));' +
    'background:#14161a;color:#f2f2f2;font:500 15px/1.5 system-ui,sans-serif;text-align:center;box-sizing:border-box;';
  const title = document.createElement('div');
  title.style.cssText = 'font:800 22px/1.25 system-ui,sans-serif;color:#ff7a66;';
  title.textContent = opts.title;
  const msg = document.createElement('div');
  msg.style.cssText = 'max-width:520px;color:rgba(242,242,242,0.85);';
  msg.textContent = opts.message;
  el.append(title, msg);
  if (opts.detail) {
    const d = document.createElement('code');
    d.style.cssText = 'max-width:560px;font:12px/1.4 ui-monospace,monospace;color:rgba(242,242,242,0.5);overflow-wrap:anywhere;';
    d.textContent = opts.detail;
    el.appendChild(d);
  }
  const action = opts.action === undefined ? { label: 'Recharger', run: () => location.reload() } : opts.action;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.style.cssText =
      'margin-top:6px;padding:12px 22px;border-radius:10px;border:none;background:#f4d35e;color:#1b1b1b;font:700 16px/1 system-ui,sans-serif;cursor:pointer;';
    b.addEventListener('click', action.run);
    el.appendChild(b);
  }
  document.body.appendChild(el);
  current = el;
}

export function hideErrorScreen(): void {
  current?.remove();
  current = null;
}

/** Erreur de démarrage avec un message pour le joueur. */
export class BootError extends Error {
  constructor(
    readonly title: string,
    readonly userMessage: string,
    cause?: unknown,
  ) {
    super(cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : title);
    this.name = 'BootError';
  }
}
