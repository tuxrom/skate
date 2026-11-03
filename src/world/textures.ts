import * as THREE from 'three';

/** Générateur pseudo-aléatoire déterministe (mulberry32) pour des textures reproductibles. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ConcreteOptions {
  size?: number;
  base?: string;
  seed?: number;
  /** Espacement des joints de dalle en pixels. */
  slab?: number;
}

/** Texture de béton : grain bruité + joints de dalles, générée sur un canvas. */
export function createConcreteTexture(opts: ConcreteOptions = {}): THREE.CanvasTexture {
  const size = opts.size ?? 512;
  const slab = opts.slab ?? 128;
  const rand = seededRandom(opts.seed ?? 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');

  ctx.fillStyle = opts.base ?? '#8d8f92';
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    d[i] = clamp8(d[i]! + n);
    d[i + 1] = clamp8(d[i + 1]! + n);
    d[i + 2] = clamp8(d[i + 2]! + n);
  }
  ctx.putImageData(img, 0, 0);

  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 8 + rand() * 40, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(40,40,44,0.55)';
  ctx.lineWidth = 2;
  for (let p = 0; p <= size; p += slab) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Damier simple, utile pour les objets de debug. */
export function createCheckerTexture(a = '#e8b23a', b = '#2b2d31', cells = 4, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  const c = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
      ctx.fillRect(x * c, y * c, c, c);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
