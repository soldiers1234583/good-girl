/**
 * Device capability + user preference detection.
 *
 * The brief is explicit that mobile must be an adaptation, not a shrink, and
 * that reduced-motion has to be honoured. Both decisions live here so every
 * scene module reads the same verdict instead of each re-testing matchMedia.
 *
 * All probes are guarded so this module can be imported in Node (the tests do).
 */

const hasWindow = typeof window !== 'undefined';
const mq = (q) => (hasWindow && window.matchMedia ? window.matchMedia(q) : { matches: false });

/** Compute the quality tier once at boot. */
export function detect() {
  const nav = hasWindow ? navigator : null;
  const ua = (nav && nav.userAgent) || '';
  const coarse = mq('(hover: none) and (pointer: coarse)').matches;
  const fine = mq('(hover: hover) and (pointer: fine)').matches;
  const touch = (nav && nav.maxTouchPoints) || 0;

  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua);
  const isMobile = coarse || uaMobile || (touch > 1 && !fine);

  const cores = (nav && nav.hardwareConcurrency) || 4;
  const mem = (nav && nav.deviceMemory) || 4;
  const dpr = (hasWindow && window.devicePixelRatio) || 1;

  // Tier 0 = constrained phone, 1 = capable phone/tablet, 2 = desktop.
  let tier = 2;
  if (isMobile) tier = cores <= 6 || dpr >= 3 ? 0 : 1;
  else if (cores <= 4 && mem <= 4) tier = 1;

  const reducedMotion = mq('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!(nav && nav.connection && nav.connection.saveData);
  const lowPower = saveData || reducedMotion;

  const sizes = [
    // tier 0 / 1 / 2
    { maxDpr: 1.35, motes: 110, starDetail: 0.75, hairDetail: 0.6, shadows: false, backdrop: 0.6 },
    { maxDpr: 1.75, motes: 220, starDetail: 0.9, hairDetail: 0.85, shadows: false, backdrop: 0.85 },
    { maxDpr: 2, motes: 380, starDetail: 1, hairDetail: 1, shadows: false, backdrop: 1 },
  ];
  const quality = { ...sizes[tier], tier };

  if (lowPower) {
    quality.maxDpr = Math.min(quality.maxDpr, 1.25);
    quality.motes = Math.round(quality.motes * 0.55);
    quality.backdrop = Math.min(quality.backdrop, 0.6);
  }

  return {
    isMobile,
    touch: coarse || touch > 0,
    /** Custom cinematic cursor is a fine-pointer affordance only. */
    wantsCustomCursor: fine && !reducedMotion && !isMobile,
    reducedMotion,
    lowPower,
    saveData,
    quality,
  };
}

/** Live-updating motion preference (users change this without reloading). */
export function watchReducedMotion(cb) {
  if (!hasWindow || !window.matchMedia) return () => {};
  const m = window.matchMedia('(prefers-reduced-motion: reduce)');
  const on = (e) => cb(e.matches);
  if (m.addEventListener) m.addEventListener('change', on);
  else if (m.addListener) m.addListener(on);
  return () => {
    if (m.removeEventListener) m.removeEventListener('change', on);
    else if (m.removeListener) m.removeListener(on);
  };
}

/**
 * Software renderer / no-WebGL guard. Returns a reason string when 3D cannot
 * be trusted, so `main.js` can fall back to the DOM-only story.
 */
export function webglProblem(canvas) {
  if (!hasWindow || !canvas || !canvas.getContext) return 'no-canvas';
  let gl = null;
  try {
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  } catch (e) {
    return 'webgl-unavailable';
  }
  if (!gl) return 'webgl-unavailable';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    // SwiftShader/llvmpipe mean software rasterisation: the piece would crawl.
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 'software-renderer';
  } catch (e) {
    /* renderer info is best-effort only */
  }
  return null;
}
