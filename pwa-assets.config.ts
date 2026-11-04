import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Icônes PWA générées depuis public/icon.svg (`npm run icons`) : 64, 192 et 512 px, 512 px maskable
 * (le SVG a déjà sa marge : une petite marge de plus suffit à rester dans la zone sûre), icône Apple 180 px et favicon.ico.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.12, resizeOptions: { background: '#14161a' } },
    apple: { ...minimal2023Preset.apple, padding: 0.12, resizeOptions: { background: '#14161a' } },
  },
  images: ['public/icon.svg'],
});
