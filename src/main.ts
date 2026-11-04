import { Game } from '@/core/Game';
import { loadRapier } from '@/physics/PhysicsWorld';
import { ProceduralAssets } from '@/world/assets';
import { SaveStore } from '@/save/SaveStore';
import { Profile } from '@/progress/Profile';
import { InstallPrompt } from '@/platform/InstallPrompt';
import { PwaUpdates } from '@/platform/PwaUpdates';
import { BootError, showErrorScreen } from '@/ui/ErrorScreen';

declare global {
  interface Window {
    /** Accès au jeu en mode debug (console, tests automatisés). */
    __skate?: Game;
  }
}

/** Écran de chargement (balisage dans index.html, affiché avant le chargement du script). */
const loading = {
  el: document.getElementById('loading'),
  step(progress: number, text: string): Promise<void> {
    const bar = this.el?.querySelector<HTMLElement>('.bar > div');
    const msg = this.el?.querySelector<HTMLElement>('.msg');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    if (msg) msg.textContent = text;
    // Laisse le navigateur peindre l'étape avant le travail synchrone qui suit.
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  },
  hide(): void {
    const el = this.el;
    if (!el) return;
    el.classList.add('done');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 800);
  },
};

// Écoute de beforeinstallprompt dès le chargement du script : l'événement peut précéder la création du jeu.
const install = new InstallPrompt();

/** WebGL 2 disponible (Three.js en a besoin) ? Sonde sur un canvas jetable. */
function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const WEBGL_HELP =
  'Le jeu a besoin de WebGL 2 pour l’affichage 3D. Active l’accélération matérielle dans les réglages du navigateur, ' +
  'mets à jour le navigateur ou les pilotes graphiques, ou essaie un autre navigateur (Chrome, Firefox, Safari récents).';
const WASM_HELP =
  'Le moteur physique (WebAssembly) n’a pas pu démarrer. Mets à jour le navigateur ; si WebAssembly est désactivé ' +
  '(mode de sécurité renforcée, politique d’entreprise), réactive-le pour ce site.';

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app introuvable');
  if (typeof WebAssembly !== 'object') throw new BootError('WebAssembly indisponible', WASM_HELP);
  if (!hasWebGL2()) throw new BootError('WebGL indisponible', WEBGL_HELP);

  const params = new URLSearchParams(location.search);
  const debug = import.meta.env.DEV || params.has('debug');

  await loading.step(0.1, 'Moteur physique…');
  const assets = new ProceduralAssets();
  const rapierPromise = loadRapier().catch((e: unknown) => {
    throw new BootError('Moteur physique indisponible', WASM_HELP, e);
  });
  const storePromise = SaveStore.open();
  await loading.step(0.35, 'Textures…');
  await assets.preload();
  await loading.step(0.55, 'Sauvegarde…');
  const profile = await Profile.load(await storePromise);
  const rapier = await rapierPromise;
  await loading.step(0.8, 'Construction du skatepark…');

  let game: Game;
  try {
    game = new Game({ container, rapier, assets, debug, profile, install });
  } catch (e) {
    // Three.js lève « Error creating WebGL context » quand le contexte est refusé malgré la sonde.
    if (e instanceof Error && /webgl/i.test(e.message)) throw new BootError('WebGL indisponible', WEBGL_HELP, e);
    throw e;
  }
  game.start();
  if (debug) window.__skate = game;
  await loading.step(1, 'Prêt');
  loading.hide();

  if (import.meta.env.PROD) {
    const updates = new PwaUpdates(container);
    if (debug) (window as Window & { __pwa?: PwaUpdates }).__pwa = updates;
    await updates.register();
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  document.getElementById('loading')?.remove();
  if (err instanceof BootError) {
    showErrorScreen({ title: err.title, message: err.userMessage, detail: err.message !== err.title ? err.message : undefined });
  } else {
    showErrorScreen({
      title: 'Le jeu n’a pas pu démarrer',
      message: 'Une erreur inattendue a empêché le chargement. Recharger la page suffit souvent.',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
