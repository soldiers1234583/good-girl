/**
 * The shader controller — one hub for every animated shader parameter.
 *
 * The brief's rule is "avoid multiple systems fighting over the same uniform",
 * so this module owns the SCALAR uniforms as single objects and hands those
 * same objects to every material that needs them (three uploads uniforms per
 * material, but sharing the object identity means one JS write updates every
 * shader at once — no per-material copies, no drift, no competing writers).
 *
 *   uTime         animation seconds; frozen under reduced motion and while the
 *                 tab is hidden (the frame loop does not advance the clock)
 *   uProgress     story progress 0..1 (from `story/choreography.js` → direct(p))
 *   uIntensity    the star's energy 0.05..3 — the world's "magic level"
 *   uReveal       reward reveal 0..1 (badge presentation)
 *   uInteraction  touch energy 0..1: reach → grip → reaction burst
 *   uResolution   drawing-buffer size in pixels (background aspect only)
 *
 * uColorA / uColorB are deliberately NOT shared: every shader pairs different
 * colours (sky inner/outer, rim cool/warm, star body/core). Each shader module
 * owns its own pair; the modules that need them per-frame register a
 * subscriber below instead of polling from the render loop.
 *
 * Subscribers are plain functions `(d, t, dt) => void` called once per frame
 * in registration order — that keeps story→shader wiring next to the shader
 * that cares about it, while still guaranteeing a single update pass.
 */

export function createShaderController(THREE, ctx = {}) {
  const reducedMotion = !!ctx.reducedMotion;

  const shared = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uIntensity: { value: 1 },
    uReveal: { value: 0 },
    uInteraction: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  const subscribers = [];
  let dimsW = 0;
  let dimsH = 0;

  /**
   * Register a per-frame subscriber. Returns an unsubscribe function.
   * @param {(d: object, t: number, dt: number) => void} fn
   */
  function subscribe(fn) {
    subscribers.push(fn);
    return () => {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  /**
   * Called exactly once per rendered frame from the main loop, BEFORE the
   * draw. Pure bookkeeping — no allocations beyond scalar writes.
   *
   * @param {number} dt seconds since last frame
   * @param {number} t  elapsed animation seconds (already frozen when hidden)
   * @param {object} d  `direct(p)` intent from story/choreography.js
   * @param {{w: number, h: number}} dims drawing-buffer size, px
   */
  function update(dt, t, d, dims) {
    // Reduced motion: hold time still so noise/shimmer stop moving, while
    // progress-driven colour still responds to the (user-driven) scroll.
    shared.uTime.value = reducedMotion ? 0 : t;
    shared.uProgress.value = d.p;
    shared.uIntensity.value = d.star.intensity;
    shared.uReveal.value = d.ui.badgeIn;

    // Touch energy: anticipation as her hand closes in, then the grip, then
    // the reaction burst. Everything is a pure function of progress, so
    // scrubbing backwards rewinds it exactly.
    shared.uInteraction.value = Math.max(
      d.girl.grip,
      d.atmosphere.burst,
      d.girl.reach * 0.6
    );

    if (dims && (dims.w !== dimsW || dims.h !== dimsH)) {
      dimsW = dims.w;
      dimsH = dims.h;
      shared.uResolution.value.set(dimsW, dimsH);
    }

    for (let i = 0; i < subscribers.length; i++) subscribers[i](d, t, dt);
  }

  function dispose() {
    subscribers.length = 0;
  }

  return { shared, subscribe, update, dispose };
}
