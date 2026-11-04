import { isIos, isStandalone } from './device';

/** Événement `beforeinstallprompt` (Chrome, Edge, Android), absent des types DOM standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Ce que l'accueil peut proposer :
 * - 'prompt' : le navigateur permet l'installation, notre bouton ouvre sa boîte de dialogue ;
 * - 'ios' : Safari sur iPhone ou iPad, installation manuelle (Partager puis Sur l'écran d'accueil) ;
 * - 'none' : déjà installé, ou navigateur sans installation.
 */
export type InstallState = 'prompt' | 'ios' | 'none';

/**
 * Invite d'installation personnalisée. L'écoute de `beforeinstallprompt` commence dès le démarrage
 * (l'événement peut partir avant la création du jeu) ; la boîte de dialogue native est retenue
 * et ne s'ouvre qu'au clic sur notre bouton.
 */
export class InstallPrompt {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed = isStandalone();
  /** Appelé quand l'état change (bouton à afficher ou à masquer). */
  onChange: () => void = () => {};

  constructor() {
    window.addEventListener('beforeinstallprompt', this.onPrompt);
    window.addEventListener('appinstalled', this.onInstalled);
  }

  get state(): InstallState {
    if (this.installed) return 'none';
    if (this.deferred) return 'prompt';
    return isIos() ? 'ios' : 'none';
  }

  /** Ouvre la boîte de dialogue native. Renvoie vrai si le joueur a accepté. */
  async prompt(): Promise<boolean> {
    const e = this.deferred;
    if (!e) return false;
    this.deferred = null;
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === 'accepted') this.installed = true;
      return choice.outcome === 'accepted';
    } catch {
      return false;
    } finally {
      this.onChange();
    }
  }

  private readonly onPrompt = (e: Event): void => {
    // Pas de mini-barre du navigateur : notre invite prend le relais.
    e.preventDefault();
    this.deferred = e as BeforeInstallPromptEvent;
    this.onChange();
  };

  private readonly onInstalled = (): void => {
    this.installed = true;
    this.deferred = null;
    this.onChange();
  };

  dispose(): void {
    window.removeEventListener('beforeinstallprompt', this.onPrompt);
    window.removeEventListener('appinstalled', this.onInstalled);
  }
}
