/**
 * The render stage.
 *
 * Owns the renderer, scene and camera, plus the performance behaviour the
 * brief asks for: adaptive pixel ratio, rendering paused while the tab is
 * hidden, and honest disposal of every GPU resource on teardown.
 *
 * Performance policy: we start at the device tier's pixel-ratio cap and step
 * down if the measured frame time stays bad for a sustained stretch. Stepping
 * back up is intentionally slow and only happens once the scene is calm, to
 * avoid oscillating between two ratios (which is more distracting than simply
 * running at the lower one).
 */

import { clamp } from '../util/math.js';

export function createStage(canvas, ctx = {}) {
  const quality = ctx.quality || { maxDpr: 2 };
  const tier = quality.tier != null ? quality.tier : 2;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier > 0,
    alpha: true,
    powerPreference: tier > 0 ? 'high-performance' : 'default',
    stencil: false,
    depth: true,
  });

  let dprCap = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
  let dprCurrent = dprCap;

  renderer.setPixelRatio(dprCurrent);
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.sortObjects = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 140);
  camera.position.set(0, 1.45, 7.4);
  camera.lookAt(0, 1.15, 0.3);

  /* ---------------- perf governor ---------------- */
  const perf = {
    frames: 0,
    accum: 0,
    slowStreak: 0,
    calmStreak: 0,
    fps: 60,
    downgrades: 0,
    upgrades: 0,
  };

  function tickPerf(dt) {
    perf.frames++;
    perf.accum += dt;
    if (perf.accum < 0.5) return;
    perf.fps = perf.frames / perf.accum;
    perf.frames = 0;
    perf.accum = 0;

    if (perf.downgrades >= 2) return;

    if (perf.fps < 48 && dprCurrent > 0.9) {
      perf.slowStreak++;
      perf.calmStreak = 0;
      if (perf.slowStreak >= 3) {
        perf.slowStreak = 0;
        dprCurrent = Math.max(0.85, dprCurrent - 0.25);
        renderer.setPixelRatio(dprCurrent);
        perf.downgrades++;
      }
    } else if (perf.fps > 58 && dprCurrent < dprCap) {
      perf.calmStreak++;
      perf.slowStreak = 0;
      // Very patient upgrade path.
      if (perf.calmStreak >= 12) {
        perf.calmStreak = 0;
        dprCurrent = Math.min(dprCap, dprCurrent + 0.25);
        renderer.setPixelRatio(dprCurrent);
        perf.upgrades++;
      }
    } else {
      perf.slowStreak = 0;
    }
  }

  /* ---------------- resize ---------------- */
  let width = 0;
  let height = 0;
  const resizeListeners = [];

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of resizeListeners) fn(w, h, renderer.getPixelRatio());
  }

  function onResize() {
    resize();
  }

  /* ---------------- visibility ---------------- */
  let hidden = false;
  const onVisibility = () => {
    hidden = document.hidden;
    // Drop the accumulated clock so the scene does not jump on return.
    for (const fn of visibilityListeners) fn(!hidden);
  };
  const visibilityListeners = [];

  function init() {
    resize();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    // Explicitly release every GPU resource reachable from the scene graph.
    scene.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture && v.dispose) v.dispose();
        }
        if (m.dispose) m.dispose();
      }
    });
    scene.clear && scene.clear();
    renderer.dispose();
    // Free the backing drawing buffer where the browser supports it.
    const gl = renderer.getContext && renderer.getContext();
    const ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  return {
    renderer,
    scene,
    camera,
    init,
    resize,
    render,
    tickPerf,
    dispose,
    onResize: (fn) => resizeListeners.push(fn),
    onVisibility: (fn) => visibilityListeners.push(fn),
    get isHidden() {
      return hidden;
    },
    get dpr() {
      return dprCurrent;
    },
    get cap() {
      return dprCap;
    },
    perf,
    /** Scene fog needs the stage's scene reference; set after environment builds. */
    setFog(fog) {
      scene.fog = fog;
    },
    clampExposure(v) {
      renderer.toneMappingExposure = clamp(v, 0.8, 1.5);
    },
  };
}
