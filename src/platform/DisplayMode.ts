import { detectTouchDevice } from './device';

/** API plein écran, préfixée chez Safari. */
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
}
/** `ScreenOrientation.lock` n'est plus dans les types DOM, et n'existe pas partout. */
interface LockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>;
}

/**
 * Affichage sur mobile : plein écran et verrouillage en paysage quand l'API le permet (au lancement
 * d'une partie, geste du joueur oblige), sinon écran de rotation tant que l'appareil est en portrait.
 * Bloque aussi le menu contextuel (appui long, clic droit) hors des champs de saisie.
 */
export class DisplayMode {
  /** Écran de rotation affiché : le jeu doit se mettre en pause. */
  rotateBlocked = false;
  /** Appelé quand l'écran de rotation apparaît ou disparaît. */
  onRotateChange: (blocked: boolean) => void = () => {};
  /** Interface tactile active (un téléphone se joue en paysage). */
  private touchUi = detectTouchDevice();
  private readonly overlay: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'rotate-overlay';
    this.overlay.setAttribute('role', 'alertdialog');
    this.overlay.setAttribute('aria-live', 'assertive');
    this.overlay.innerHTML =
      '<div class="phone" aria-hidden="true"></div><b>Tourne ton appareil</b><span>Skate se joue en paysage.</span>';
    parent.appendChild(this.overlay);
    window.addEventListener('resize', this.refresh);
    window.addEventListener('orientationchange', this.refresh);
    document.addEventListener('contextmenu', this.onContextMenu);
    this.refresh();
  }

  /** L'interface tactile vient d'être activée ou désactivée. */
  setTouchUi(on: boolean): void {
    this.touchUi = on;
    this.refresh();
  }

  /**
   * Lancement d'une partie (dans le gestionnaire du clic) : plein écran si demandé, puis verrouillage
   * en paysage. Chaque étape peut être refusée par le navigateur ; on continue sans.
   */
  async enterGame(wantFullscreen: boolean): Promise<void> {
    if (wantFullscreen && this.touchUi) await this.requestFullscreen();
    const orientation = (screen.orientation as (ScreenOrientation & LockableOrientation) | undefined) ?? null;
    if (orientation?.lock) {
      try {
        await orientation.lock('landscape');
      } catch {
        // Verrouillage refusé (hors plein écran, ordinateur, iOS) : l'écran de rotation prend le relais.
      }
    }
    this.refresh();
  }

  get isFullscreen(): boolean {
    const d = document as FullscreenDocument;
    return !!(document.fullscreenElement ?? d.webkitFullscreenElement);
  }

  private async requestFullscreen(): Promise<void> {
    if (this.isFullscreen) return;
    const el = document.documentElement as FullscreenElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else await el.webkitRequestFullscreen?.();
    } catch {
      // Refusé (pas de geste du joueur, iPhone) : on reste en fenêtre.
    }
  }

  private readonly refresh = (): void => {
    const portrait = window.innerHeight > window.innerWidth;
    const blocked = this.touchUi && portrait;
    this.overlay.classList.toggle('on', blocked);
    if (blocked !== this.rotateBlocked) {
      this.rotateBlocked = blocked;
      this.onRotateChange(blocked);
    }
  };

  private readonly onContextMenu = (e: Event): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    e.preventDefault();
  };

  dispose(): void {
    window.removeEventListener('resize', this.refresh);
    window.removeEventListener('orientationchange', this.refresh);
    document.removeEventListener('contextmenu', this.onContextMenu);
    this.overlay.remove();
  }
}
