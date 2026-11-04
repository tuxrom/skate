/** Intervalle de vérification d'une nouvelle version, application ouverte (ms). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** Durée d'affichage de « Prêt hors ligne » (ms). */
const OFFLINE_NOTICE_MS = 4000;

/**
 * Service worker (build de production) : précache, mise à jour sur demande.
 * Quand une nouvelle version est prête, un bandeau propose de recharger ; rien ne se recharge
 * sans l'accord du joueur, pour ne pas couper une partie.
 */
export class PwaUpdates {
  private readonly banner: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly actions: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** État lisible par le debug et les tests. */
  status: 'none' | 'registered' | 'offline-ready' | 'update-ready' | 'error' = 'none';

  constructor(parent: HTMLElement) {
    this.banner = document.createElement('div');
    this.banner.className = 'pwa-banner';
    this.banner.setAttribute('role', 'status');
    this.text = document.createElement('span');
    this.actions = document.createElement('div');
    this.actions.className = 'actions';
    this.banner.append(this.text, this.actions);
    parent.appendChild(this.banner);
  }

  async register(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW: (_url, registration) => {
        this.status = 'registered';
        if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS);
      },
      onOfflineReady: () => {
        this.status = 'offline-ready';
        this.show('Prêt à jouer hors ligne.', []);
        this.hideTimer = setTimeout(() => this.hide(), OFFLINE_NOTICE_MS);
      },
      onNeedRefresh: () => {
        this.status = 'update-ready';
        this.show('Nouvelle version disponible.', [
          ['Mettre à jour', 'primary', () => this.applyUpdate(updateSW)],
          ['Plus tard', '', () => this.hide()],
        ]);
      },
      onRegisterError: () => {
        this.status = 'error';
      },
    });
  }

  /**
   * Active la version en attente puis recharge. workbox-window ne recharge que si la page avait déjà un
   * service worker à son ouverture ; après une première visite, on recharge nous-mêmes au changement
   * de contrôleur (une seule fois).
   */
  private applyUpdate(updateSW: (reload?: boolean) => Promise<void>): void {
    let reloading = false;
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      },
      { once: true },
    );
    this.show('Mise à jour…', []);
    void updateSW(true);
  }

  private show(message: string, actions: ReadonlyArray<readonly [string, string, () => void]>): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.text.textContent = message;
    this.actions.replaceChildren();
    for (const [label, variant, onClick] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `menu-btn small ${variant}`;
      b.textContent = label;
      b.addEventListener('click', onClick);
      this.actions.appendChild(b);
    }
    this.banner.classList.add('on');
  }

  private hide(): void {
    this.banner.classList.remove('on');
  }

  dispose(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.banner.remove();
  }
}
