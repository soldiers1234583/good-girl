/**
 * Scroll progress.
 *
 * The page is a tall track with a sticky stage inside it, so the browser's own
 * (well-optimised, momentum-correct) scrolling drives everything. This module
 * only converts `scrollY` into a 0..1 story progress and smooths it.
 *
 * Why not a scroll library: the smoothing here is ~20 lines and gives complete
 * control over the damping curve, there is no scroll-jacking (the native
 * scrollbar still behaves normally, which matters on mobile), and the piece
 * ships zero runtime dependencies beyond Three.js.
 *
 * Two values are exposed:
 *   raw    - the literal scroll position, used for the HUD rail
 *   value  - the damped value every visual system consumes. The lag is what
 *            makes motion ease instead of feeling bolted to the scrollbar.
 */

import { clamp, damp } from '../util/math.js';

export function createScrollProgress(opts = {}) {
  // Slower = more cinematic lag. Reduced-motion users get near-1:1 tracking so
  // the scene does not visibly swim after their finger stops.
  const rate = opts.reducedMotion ? 16 : 4.2;

  let raw = 0;
  let value = 0;
  let max = 1;
  let dirty = true;

  const trackEl = opts.track || document.querySelector('.track');
  const checkpoints = [];

  function measure() {
    if (!trackEl) return;
    const doc = document.documentElement;
    // Total scrollable distance of the story track.
    max = Math.max(1, trackEl.offsetHeight - window.innerHeight);
    raw = clamp(window.scrollY / max);
    // Snap the first read so the opening frame is not mid-lag.
    if (dirty) {
      value = raw;
      dirty = false;
    }
  }

  const onScroll = () => {
    raw = clamp(window.scrollY / max);
  };

  function init() {
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('orientationchange', measure, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }

  /** Advance the damping. Returns the smoothed progress. */
  function update(dt) {
    value = damp(value, raw, rate, Math.min(dt, 1 / 30));
    return value;
  }

  /** True while the smoothed value is still catching up (or a burst is live). */
  const isMoving = (eps = 0.00015) => Math.abs(raw - value) > eps;

  /** Jump the page to a progress position (used by the chapter rail). */
  function scrollTo(p, smooth = true) {
    const y = clamp(p) * max;
    if (smooth) window.scrollTo({ top: y, behavior: opts.reducedMotion ? 'auto' : 'smooth' });
    else window.scrollTo(0, y);
  }

  /** Registered checkpoints make the rail clickable. */
  function addCheckpoint(p, label) {
    checkpoints.push({ p, label });
  }

  function reset() {
    dirty = true;
    value = 0;
    raw = 0;
  }

  return {
    init,
    update,
    measure,
    isMoving,
    scrollTo,
    addCheckpoint,
    reset,
    get raw() {
      return raw;
    },
    get value() {
      return value;
    },
    get max() {
      return max;
    },
    checkpoints,
  };
}
