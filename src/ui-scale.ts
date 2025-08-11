// Lightweight UI scale controller: scales rems via CSS var --ui-scale

const STORAGE_KEY = 'ui-scale';

export function getScale(): number {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const n = saved ? Number(saved) : NaN;
  return Number.isFinite(n) ? clamp(n, 0.75, 1.6) : 1;
}

export function setScale(scale: number) {
  const s = clamp(scale, 0.75, 1.6);
  document.documentElement.style.setProperty('--ui-scale', String(s));
  try { localStorage.setItem(STORAGE_KEY, String(s)); } catch {}
}

export function initScale() {
  // If user saved a preference, use it; otherwise derive from DPR modestly
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (saved) {
    setScale(Number(saved));
    return;
  }
  const dpr = typeof window !== 'undefined' && (window as any).devicePixelRatio ? (window as any).devicePixelRatio : 1;
  // Heuristic: boost scale on very high-DPI small screens; keep desktop/web stable
  const isMobile = typeof navigator !== 'undefined' ? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) : false;
  let scale = 1;
  if (isMobile) {
    // Start at 1, add a small bump when DPR > 2
    if (dpr >= 3) scale = 1.2;
    else if (dpr >= 2.5) scale = 1.1;
    else if (dpr >= 2) scale = 1.05;
  }
  setScale(scale);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// Optional: expose helpers globally in dev builds for quick tweaking
if (typeof window !== 'undefined') {
  // @ts-ignore
  (window as any).__setUiScale = setScale;
}
