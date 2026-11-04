/**
 * Feuille de style du HUD et des menus, injectée une fois au démarrage.
 * Tailles fluides (clamp) : la même mise en page sert du téléphone en paysage au grand écran.
 */
const CSS = `
:root {
  --ui-bg: rgba(18, 20, 26, 0.86);
  --ui-bg-soft: rgba(18, 20, 26, 0.55);
  --ui-line: rgba(255, 255, 255, 0.14);
  --ui-text: #f2f2f2;
  --ui-dim: rgba(242, 242, 242, 0.68);
  --ui-accent: #f4d35e;
  --ui-good: #7fe08a;
  --ui-bad: #ff7a66;
  --ui-radius: 12px;
  --ui-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

/* ---------- HUD ---------- */
.hud { position: fixed; inset: 0; pointer-events: none; z-index: 11; color: var(--ui-text); font-family: var(--ui-font);
  text-shadow: 0 1px 3px rgba(0,0,0,0.75); transition: opacity 0.25s; }
.hud.hidden { opacity: 0; }
.hud-top { position: absolute; top: max(10px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  width: min(94vw, 560px); text-align: center; }
.hud-combo { display: none; }
.hud-combo.on { display: block; }
.hud-combo-points { font: 800 clamp(20px, 4.2vw, 30px)/1.1 var(--ui-font); font-variant-numeric: tabular-nums; }
.hud-combo-mult { color: var(--ui-accent); }
.hud-combo-list { font: 600 clamp(12px, 2.4vw, 15px)/1.3 var(--ui-font); opacity: 0.92; overflow-wrap: anywhere; margin-top: 2px; }
.hud-combo-timer { height: 3px; width: 140px; margin: 5px auto 0; background: rgba(255,255,255,0.22); border-radius: 2px; overflow: hidden; }
.hud-combo-timer > div { height: 100%; width: 100%; background: var(--ui-text); }
.hud-result { margin-top: 6px; font: 800 clamp(22px, 4.6vw, 34px)/1.15 var(--ui-font); opacity: 0; }
.hud-result small { display: block; font: 600 clamp(11px, 2.2vw, 14px)/1.3 var(--ui-font); opacity: 0.9; }
.hud-result.banked { color: var(--ui-good); animation: hud-bank 2.2s ease-out forwards; }
.hud-result.lost { color: var(--ui-bad); animation: hud-lost 2.2s ease-out forwards; }
.hud-result.lost .pts { text-decoration: line-through; }
@keyframes hud-bank {
  0% { opacity: 0; transform: scale(0.6); } 12% { opacity: 1; transform: scale(1.18); } 22% { transform: scale(1); }
  80% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-18px); } }
@keyframes hud-lost {
  0% { opacity: 0; transform: translateX(0); } 8% { opacity: 1; transform: translateX(-10px); } 14% { transform: translateX(9px); }
  20% { transform: translateX(-6px); } 26% { transform: translateX(3px); } 32% { transform: translateX(0); }
  80% { opacity: 1; } 100% { opacity: 0; transform: translateY(10px); } }
.hud-trick { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); text-align: center; white-space: nowrap;
  font: 800 clamp(18px, 4vw, 28px)/1.2 var(--ui-font); opacity: 0; }
.hud-trick small { display: block; color: var(--ui-accent); font: 700 clamp(13px, 2.6vw, 17px)/1.2 var(--ui-font); }
.hud-trick.show { animation: hud-trick 1.3s ease-out forwards; }
@keyframes hud-trick { 0% { opacity: 0; transform: translate(-50%, 8px) scale(0.9); } 12% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
  22% { transform: translate(-50%, 0) scale(1); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -14px); } }
.hud-speed { position: absolute; right: max(14px, env(safe-area-inset-right)); bottom: max(14px, env(safe-area-inset-bottom));
  text-align: right; font: 800 clamp(22px, 4vw, 30px)/1 var(--ui-font); font-variant-numeric: tabular-nums; }
.hud-speed small { font: 600 12px/1 var(--ui-font); opacity: 0.75; margin-left: 3px; }
.hud-level { position: absolute; left: max(14px, env(safe-area-inset-left)); bottom: max(14px, env(safe-area-inset-bottom));
  font: 700 13px/1.2 var(--ui-font); }
.hud-level .bar { width: 120px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.22); margin-top: 4px; overflow: hidden; }
.hud-level .bar > div { height: 100%; background: var(--ui-accent); width: 0; transition: width 0.4s; }
.hud-level .hint { font: 500 11px/1.3 var(--ui-font); opacity: 0.7; margin-top: 4px; }
.hud-session { position: absolute; top: max(10px, env(safe-area-inset-top)); right: max(14px, env(safe-area-inset-right));
  text-align: right; font: 600 12px/1.4 var(--ui-font); opacity: 0.9; font-variant-numeric: tabular-nums; }
.hud-session b { font-size: 15px; }
.hud-challenge { position: absolute; left: max(14px, env(safe-area-inset-left)); top: max(64px, calc(env(safe-area-inset-top) + 54px));
  width: min(300px, 44vw); background: var(--ui-bg-soft); border: 1px solid var(--ui-line); border-radius: var(--ui-radius);
  padding: 8px 10px; font: 500 12px/1.35 var(--ui-font); text-shadow: none; display: none; }
.hud-challenge.on { display: block; }
.hud-challenge h4 { margin: 0 0 4px; font: 800 13px/1.2 var(--ui-font); color: var(--ui-accent); letter-spacing: 0.02em; }
.hud-challenge .item { margin-top: 6px; }
.hud-challenge .item b { font-weight: 700; }
.hud-challenge .item.done { opacity: 0.6; }
.hud-challenge .timer { font: 800 18px/1.2 var(--ui-font); color: #ff8a5c; font-variant-numeric: tabular-nums; }
.progress { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.18); overflow: hidden; margin-top: 4px; }
.progress > div { height: 100%; background: var(--ui-accent); }
.progress.done > div { background: var(--ui-good); }
.hud-toasts { position: absolute; left: 50%; bottom: max(70px, calc(env(safe-area-inset-bottom) + 60px)); transform: translateX(-50%);
  display: flex; flex-direction: column-reverse; align-items: center; gap: 6px; width: min(92vw, 460px); }
.toast { background: var(--ui-bg); border: 1px solid var(--ui-line); border-radius: 999px; padding: 7px 16px; text-shadow: none;
  font: 700 13px/1.3 var(--ui-font); text-align: center; animation: toast 3.2s ease-out forwards; }
.toast.good { border-color: rgba(127, 224, 138, 0.6); }
.toast.gold { border-color: rgba(244, 211, 94, 0.8); color: var(--ui-accent); }
@keyframes toast { 0% { opacity: 0; transform: translateY(10px); } 8% { opacity: 1; transform: translateY(0); } 85% { opacity: 1; } 100% { opacity: 0; } }
@media (max-height: 430px) { .hud-challenge { top: max(54px, env(safe-area-inset-top)); width: min(240px, 40vw); font-size: 11px; } .hud-trick { top: 24%; } }
@media (max-width: 560px) { .hud-session { display: none; } .hud-challenge { width: min(240px, 60vw); } }

/* ---------- Menus ---------- */
@media (max-height: 420px) {
  .menu-buttons { display: grid; grid-template-columns: 1fr 1fr; }
  .menu-buttons .menu-btn.primary { grid-column: 1 / -1; }
  .menu-panel h2 { margin-bottom: 6px; }
}
@media (max-height: 520px) {
  .menu-panel h1 { font-size: 40px; }
  .menu-sub { display: none; }
  .menu-stats { margin-bottom: 10px; gap: 12px; }
  .menu-stats b { font-size: 15px; }
  .menu-buttons { gap: 6px; }
  .menu-btn { min-height: 38px; padding: 8px 14px; font-size: 15px; }
}
.menu-layer { position: fixed; inset: 0; z-index: 30; display: none; font-family: var(--ui-font); color: var(--ui-text);
  align-items: center; justify-content: center; padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
  max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); box-sizing: border-box; }
.menu-layer.on { display: flex; }
.menu-layer.backdrop { background: rgba(10, 12, 16, 0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.menu-layer.home { background: linear-gradient(90deg, rgba(10,12,16,0.82) 0%, rgba(10,12,16,0.35) 55%, rgba(10,12,16,0) 100%);
  justify-content: flex-start; }
.menu-layer.side { justify-content: flex-start; background: linear-gradient(90deg, rgba(10,12,16,0.7) 0%, rgba(10,12,16,0) 70%); }
.menu-panel { background: var(--ui-bg); border: 1px solid var(--ui-line); border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  width: min(560px, 100%); max-height: 100%; overflow: auto; padding: clamp(14px, 3vw, 24px); box-sizing: border-box;
  animation: menu-in 0.18s ease-out; overscroll-behavior: contain; }
.menu-layer.home .menu-panel, .menu-layer.side .menu-panel { width: min(420px, 100%); }
.menu-layer.home .menu-panel { background: transparent; border: none; box-shadow: none; }
@keyframes menu-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.menu-panel h1 { margin: 0; font: 900 clamp(44px, 10vw, 76px)/0.95 var(--ui-font); letter-spacing: 0.04em; }
.menu-panel h1 span { color: var(--ui-accent); }
.menu-panel h2 { margin: 0 0 12px; font: 800 clamp(20px, 4vw, 26px)/1.2 var(--ui-font); }
.menu-panel h3 { margin: 18px 0 8px; font: 700 13px/1.2 var(--ui-font); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ui-dim); }
.menu-panel p { margin: 6px 0; font: 400 14px/1.45 var(--ui-font); color: var(--ui-dim); }
.menu-sub { font: 500 14px/1.4 var(--ui-font); color: var(--ui-dim); margin: 6px 0 18px; }
.menu-stats { display: flex; gap: 18px; flex-wrap: wrap; margin: 0 0 18px; font: 600 13px/1.3 var(--ui-font); color: var(--ui-dim); }
.menu-stats b { display: block; color: var(--ui-text); font-size: 18px; }
.menu-buttons { display: flex; flex-direction: column; gap: 8px; }
.menu-btn { appearance: none; border: 1px solid var(--ui-line); background: rgba(255,255,255,0.06); color: var(--ui-text);
  font: 700 16px/1.2 var(--ui-font); padding: 12px 16px; border-radius: 10px; text-align: left; cursor: pointer; min-height: 46px;
  transition: background 0.12s, border-color 0.12s, transform 0.08s; }
.menu-btn:hover { background: rgba(255,255,255,0.12); }
.menu-btn:active { transform: scale(0.98); }
.menu-btn.primary { background: var(--ui-accent); color: #1b1b1b; border-color: transparent; }
.menu-btn.primary:hover { background: #ffe27a; }
.menu-btn.danger { color: var(--ui-bad); }
.menu-btn.small { font-size: 14px; padding: 8px 12px; min-height: 38px; }
.menu-layer :focus { outline: none; }
.menu-layer :focus-visible, .menu-layer[data-pad] :focus { outline: 3px solid var(--ui-accent); outline-offset: 2px; }
.menu-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.menu-head h2 { margin: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--ui-line);
  font: 600 14px/1.3 var(--ui-font); }
.row:last-child { border-bottom: none; }
.row label { flex: 1; }
.row output { min-width: 3.2em; text-align: right; color: var(--ui-dim); font-variant-numeric: tabular-nums; }
.row input[type=range] { width: min(200px, 42vw); accent-color: var(--ui-accent); height: 28px; }
.seg { display: inline-flex; border: 1px solid var(--ui-line); border-radius: 10px; overflow: hidden; flex-wrap: wrap; }
.seg button { appearance: none; background: transparent; border: none; color: var(--ui-text); font: 700 13px/1 var(--ui-font);
  padding: 10px 12px; cursor: pointer; min-height: 38px; }
.seg button[aria-checked=true] { background: var(--ui-accent); color: #1b1b1b; }
.toggle { appearance: none; width: 48px; height: 28px; border-radius: 14px; background: rgba(255,255,255,0.2); position: relative; cursor: pointer;
  border: none; transition: background 0.15s; }
.toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: left 0.15s; }
.toggle[aria-checked=true] { background: var(--ui-good); }
.toggle[aria-checked=true]::after { left: 23px; }
.keys { width: 100%; border-collapse: collapse; font: 500 13px/1.35 var(--ui-font); }
.keys td { padding: 5px 4px; border-bottom: 1px solid var(--ui-line); vertical-align: top; }
.keys td:first-child { color: var(--ui-dim); width: 42%; }
kbd { display: inline-block; font: 700 11px/1 var(--ui-font); padding: 3px 6px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.3);
  background: rgba(255,255,255,0.08); margin: 1px 2px 1px 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.card { appearance: none; border: 2px solid var(--ui-line); background: rgba(255,255,255,0.05); color: var(--ui-text); border-radius: 10px;
  padding: 8px; cursor: pointer; font: 700 12px/1.25 var(--ui-font); text-align: center; position: relative; }
.card[aria-pressed=true] { border-color: var(--ui-accent); }
.card:disabled { cursor: default; opacity: 0.45; }
.card .deck { height: 22px; border-radius: 11px; margin: 0 auto 6px; width: 92%; border: 1px solid rgba(0,0,0,0.3); }
.card .lock { display: block; font: 600 11px/1.2 var(--ui-font); color: var(--ui-dim); margin-top: 2px; }
.swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.swatch { appearance: none; width: 38px; height: 38px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; position: relative;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.25) inset; }
.swatch[aria-pressed=true] { border-color: var(--ui-accent); }
.swatch:disabled { cursor: default; opacity: 0.35; }
.swatch:disabled::after { content: attr(data-level); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font: 800 10px/1 var(--ui-font); color: #fff; text-shadow: 0 1px 2px #000; }
.challenge { padding: 10px 0; border-bottom: 1px solid var(--ui-line); }
.challenge:last-child { border-bottom: none; }
.challenge .t { display: flex; justify-content: space-between; gap: 8px; font: 700 14px/1.3 var(--ui-font); }
.challenge .t span { color: var(--ui-accent); white-space: nowrap; font-size: 12px; }
.challenge.done .t span { color: var(--ui-good); }
.challenge .d { font: 400 13px/1.4 var(--ui-font); color: var(--ui-dim); margin-top: 2px; }
.gestures { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
.gesture { background: rgba(255,255,255,0.05); border-radius: 10px; padding: 8px; text-align: center; font: 700 12px/1.25 var(--ui-font); }
.gesture svg { width: 100%; max-width: 110px; height: auto; display: block; margin: 0 auto 4px; }
.gesture small { display: block; font-weight: 500; color: var(--ui-dim); margin-top: 2px; }
.help-list { margin: 4px 0; padding-left: 18px; font: 400 13px/1.5 var(--ui-font); color: var(--ui-dim); }
.help-list b { color: var(--ui-text); }

/* ---------- Tactile ---------- */
html, body { overscroll-behavior: none; }
.touch-safe-probe { position: fixed; inset: 0; visibility: hidden; pointer-events: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.touch-layer { position: fixed; inset: 0; z-index: 12; display: none; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; font-family: var(--ui-font); }
.touch-layer.on { display: block; }
.touch-btn { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(18, 20, 26, 0.32); border: 2px solid rgba(255, 255, 255, 0.38); color: rgba(255, 255, 255, 0.92);
  font-weight: 800; letter-spacing: 0.01em; text-shadow: 0 1px 2px rgba(0,0,0,0.6); touch-action: none; box-sizing: border-box;
  transition: background 0.08s, transform 0.08s; }
.touch-btn.held { background: rgba(244, 211, 94, 0.5); border-color: rgba(244, 211, 94, 0.9); transform: translate(-50%, -50%) scale(0.94); }
.touch-stick { position: absolute; display: none; transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
  border: 2px solid rgba(255, 255, 255, 0.3); background: rgba(255, 255, 255, 0.07); }
.touch-stick.swipe { border-style: dashed; background: rgba(244, 211, 94, 0.05); }
.touch-knob { position: absolute; left: 50%; top: 50%; width: 42%; height: 42%; border-radius: 50%; transform: translate(-50%, -50%);
  background: rgba(255, 255, 255, 0.45); }
.touch-stick.swipe .touch-knob { background: rgba(244, 211, 94, 0.7); width: 30%; height: 30%; }
.touch-hint { position: absolute; bottom: max(18px, calc(env(safe-area-inset-bottom) + 8px)); color: rgba(255,255,255,0.75);
  font: 600 13px/1.3 var(--ui-font); text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none; transition: opacity 0.6s; }
.touch-hint.left { left: max(24px, calc(env(safe-area-inset-left) + 16px)); }
.touch-hint.right { left: 52%; max-width: 22%; }
.touch-hint.gone { opacity: 0; }
.touch-toolbar { display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(440px, 70vw);
  background: var(--ui-bg); border: 1px solid var(--ui-line); border-radius: 14px; padding: 12px; color: var(--ui-text); text-align: center; }
.touch-toolbar .title { font: 600 13px/1.4 var(--ui-font); color: var(--ui-dim); margin-bottom: 8px; }
.touch-toolbar .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center; font: 700 13px/1.2 var(--ui-font); }
.touch-toolbar .row span { min-width: 9em; }
.touch-layer.editing { background: rgba(10, 12, 16, 0.45); }
.touch-layer.editing .touch-toolbar { display: block; }
.touch-layer.editing .touch-hint { display: none; }
.touch-layer.editing .touch-btn { cursor: grab; border-style: dashed; }
.touch-layer.editing .touch-btn.selected { border-color: var(--ui-accent); border-style: solid; box-shadow: 0 0 0 3px rgba(244,211,94,0.35); }

/* HUD en mode tactile : les coins bas et la colonne de droite sont aux pouces. */
html.touch-ui .hud-speed { top: max(8px, env(safe-area-inset-top)); bottom: auto; left: max(12px, env(safe-area-inset-left)); right: auto;
  text-align: left; font-size: 20px; }
html.touch-ui .hud-level { top: max(34px, calc(env(safe-area-inset-top) + 28px)); bottom: auto; font-size: 11px; }
html.touch-ui .hud-level .bar { width: 90px; }
html.touch-ui .hud-level .hint, html.touch-ui .hud-session { display: none; }
html.touch-ui .hud-challenge { top: max(70px, calc(env(safe-area-inset-top) + 62px)); width: min(230px, 34vw); font-size: 11px; padding: 6px 8px; }
html.touch-ui .hud-challenge h4 { font-size: 12px; }
html.touch-ui .hud-challenge .item > div:not(.progress) { display: none; }
html.touch-ui .hud-challenge .item { margin-top: 3px; }
html.touch-ui .hud-top { width: min(54vw, 460px); }
html.touch-ui .hud-toasts { bottom: max(54px, calc(env(safe-area-inset-bottom) + 46px)); width: min(50vw, 420px); }
html.touch-ui .toast { font-size: 12px; padding: 6px 12px; }
html.touch-ui .menu-panel { touch-action: pan-y; }
`;

let installed = false;

export function installStyles(): void {
  if (installed) return;
  installed = true;
  const style = document.createElement('style');
  style.id = 'skate-ui';
  style.textContent = CSS;
  document.head.appendChild(style);
}
