/** Écran tactile sans souris : téléphone ou tablette. */
export function detectTouchDevice(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

/** iPhone, iPod ou iPad (un iPad récent se présente comme un Mac tactile). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Lancé depuis l'écran d'accueil (application installée). */
export function isStandalone(): boolean {
  if (typeof matchMedia === 'function') {
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui']) if (matchMedia(`(display-mode: ${mode})`).matches) return true;
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
