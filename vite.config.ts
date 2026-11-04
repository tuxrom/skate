import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/** Couleur de fond de l'application (écran de démarrage, barre d'état). */
const BACKGROUND = '#14161a';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // Le morceau Rapier pèse 4,3 Mo (1,7 Mo compressé), presque tout en WASM encodé en base64 :
    // seuil relevé pour ce seul morceau connu, le code du jeu fait environ 240 Ko.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        // Bibliothèques à part : chargées en parallèle, et gardées en cache quand seul le code du jeu change.
        advancedChunks: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  plugins: [
    VitePWA({
      // Une nouvelle version attend l'accord du joueur (bandeau « Mettre à jour ») : pas de rechargement en pleine partie.
      registerType: 'prompt',
      injectRegister: false,
      // globPatterns couvre déjà tout le build, public/ compris : pas de seconde liste (entrées en double).
      includeAssets: [],
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Skate',
        short_name: 'Skate',
        description: 'Jeu de skateboard 3D : flicks au stick, grinds, manuals et combos, jouable hors ligne.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'landscape',
        theme_color: BACKGROUND,
        background_color: BACKGROUND,
        categories: ['games', 'sports'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Précache de tout le build : le WASM de Rapier est intégré au bundle JS (rapier3d-compat), il part avec lui.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
        // manifest.webmanifest est ajouté au précache par le plugin lui-même.
        // Le bundle principal pèse environ 5 Mo (WASM en base64 compris) ; marge pour la suite.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Le premier service worker prend la main sur la page déjà ouverte (première visite) : la mise à jour
        // suivante peut alors la recharger. Une nouvelle version, elle, attend toujours l'accord du joueur.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Tout le reste (même origine, hors précache) : réponse du cache tout de suite, rafraîchie en arrière-plan.
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.method === 'GET' && request.mode !== 'navigate',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'skate-runtime',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
