import { Game } from '@/core/Game';
import { loadRapier } from '@/physics/PhysicsWorld';
import { ProceduralAssets } from '@/world/assets';

declare global {
  interface Window {
    /** Accès au jeu en mode debug (console, tests automatisés). */
    __skate?: Game;
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app introuvable');

  const params = new URLSearchParams(location.search);
  const debug = import.meta.env.DEV || params.has('debug');

  const assets = new ProceduralAssets();
  const [rapier] = await Promise.all([loadRapier(), assets.preload()]);

  const game = new Game({ container, rapier, assets, debug });
  game.start();
  if (debug) window.__skate = game;

  if (import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f66;padding:16px;font:14px monospace;white-space:pre-wrap';
  pre.textContent = `Erreur au démarrage :\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(pre);
});
