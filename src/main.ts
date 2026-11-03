import { Game } from '@/core/Game';
import { loadRapier } from '@/physics/PhysicsWorld';
import { ProceduralAssets } from '@/world/assets';
import { SaveStore } from '@/save/SaveStore';
import { Profile } from '@/progress/Profile';

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

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app introuvable');

  const params = new URLSearchParams(location.search);
  const debug = import.meta.env.DEV || params.has('debug');

  await loading.step(0.1, 'Moteur physique…');
  const assets = new ProceduralAssets();
  const rapierPromise = loadRapier();
  const storePromise = SaveStore.open();
  await loading.step(0.35, 'Textures…');
  await assets.preload();
  await loading.step(0.55, 'Sauvegarde…');
  const profile = await Profile.load(await storePromise);
  const rapier = await rapierPromise;
  await loading.step(0.8, 'Construction du skatepark…');

  const game = new Game({ container, rapier, assets, debug, profile });
  game.start();
  if (debug) window.__skate = game;
  await loading.step(1, 'Prêt');
  loading.hide();

  if (import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  const msg = document.querySelector<HTMLElement>('#loading .msg');
  const text = `Erreur au démarrage : ${err instanceof Error ? err.message : String(err)}`;
  if (msg) {
    msg.textContent = text;
    msg.style.color = '#f66';
    return;
  }
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f66;padding:16px;font:14px monospace;white-space:pre-wrap';
  pre.textContent = text;
  document.body.appendChild(pre);
});
