/**
 * Pure math helpers.
 *
 * Deliberately dependency-free and DOM-free so the story logic that builds on
 * top of it stays unit-testable outside a browser (see test/).
 *
 * Convention: `p` arguments are normalised progress values in [0, 1].
 */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite smoothstep between two edges, clamped outside them. */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const smootherstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Ease-in-out cosine; gentler shoulders than smoothstep. */
export const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t));
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeOutQuint = (t) => 1 - Math.pow(1 - clamp(t), 5);
export const easeInCubic = (t) => Math.pow(clamp(t), 3);
export const easeOutBack = (t, s = 1.70158) => {
  const x = clamp(t) - 1;
  return 1 + x * x * ((s + 1) * x + s);
};

/** Remap x from [inMin, inMax] into [outMin, outMax], clamped. */
export const remap = (x, inMin, inMax, outMin, outMax, doClamp = true) => {
  if (inMin === inMax) return outMin;
  const t = (x - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, doClamp ? clamp(t) : t);
};

/**
 * Frame-rate independent exponential approach — the standard "critically
 * damped-ish" smoothing used for every scrubbed value in the piece.
 *
 * `rate` is roughly "how many e-folds per second"; higher is snappier.
 */
export const damp = (current, target, rate, dt) =>
  target + (current - target) * Math.exp(-rate * dt);

/** Same as `damp` but for arrays of numbers, in place. */
export function dampArray(current, target, rate, dt) {
  const k = Math.exp(-rate * dt);
  for (let i = 0; i < current.length; i++) {
    current[i] = target[i] + (current[i] - target[i]) * k;
  }
  return current;
}

/**
 * A lightly underdamped spring, integrated with semi-implicit Euler.
 *
 * Used for the badge so the reward reads as a physical object being presented
 * — it overshoots slightly and settles — rather than a scripted scale tween.
 *
 * Two details are load-bearing and were both wrong in the first draft:
 *
 *  1. DAMPING RATIO. The damping coefficient is 1.2*omega, giving zeta = 0.6
 *     and roughly 9% overshoot. A critically damped spring (2*omega) never
 *     overshoots at all, which defeats the entire reason for using a spring
 *     here.
 *
 *  2. STEP STABILITY. Explicit damping is only stable while omega*h < 1. A
 *     phone that hands us a 400ms hitch would otherwise blow the integrator
 *     up to 1e20 and permanently break the badge. So dt is clamped and then
 *     subdivided until omega*h is comfortably small.
 *
 * @param {object} s      mutable state { x, v } (position, velocity)
 * @param {number} target rest position
 * @param {number} omega  angular frequency (rad/s) — higher is stiffer
 * @param {number} dt     delta seconds (may be long; it is handled)
 */
export function springStep(s, target, omega, dt) {
  // Cap the hitch we are willing to simulate: beyond this the spring has
  // effectively already settled anyway.
  const span = Math.min(Math.max(dt, 0), 0.1);
  const maxH = 0.25 / Math.max(1e-6, omega);
  const steps = Math.max(1, Math.min(64, Math.ceil(span / maxH)));
  const h = span / steps;
  const damping = 1.2 * omega; // zeta = 0.6
  for (let i = 0; i < steps; i++) {
    const accel = -omega * omega * (s.x - target) - damping * s.v;
    s.v += accel * h;
    s.x += s.v * h;
  }
  return s;
}

/** Deterministic 1D value noise; cheap, stable, no allocation. */
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const h = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  return lerp(h(i), h(i + 1), u);
}

/** Layered value noise for organic drift (camera breathing, hair, motes). */
export function fbm1(x, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(x * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Mulberry32 — tiny seeded PRNG so the field looks identical every replay. */
export function makeRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Colors as [r, g, b] in 0..1 — the interchange format for the palette. */
export const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255);

export function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export const rgbToCss = (c, alpha = 1) =>
  alpha >= 1
    ? `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
    : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;

/** sRGB hex from a 0..1 rgb triple, for handing to THREE.Color#setHex. */
export const rgbToHex = (c) =>
  (Math.round(clamp(c[0]) * 255) << 16) | (Math.round(clamp(c[1]) * 255) << 8) | Math.round(clamp(c[2]) * 255);

/** Blend a list of { at, value } stops. Assumes `stops` is sorted by `at`. */
export function sampleStops(p, stops) {
  if (p <= stops[0].at) return stops[0].value;
  const last = stops[stops.length - 1];
  if (p >= last.at) return last.value;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (p >= a.at && p <= b.at) {
      const t = smoothstep(a.at, b.at, p);
      return mixRgb(a.value, b.value, t);
    }
  }
  return last.value;
}

/** Scalar counterpart to `sampleStops`. */
export function sampleScalar(p, stops, ease = smoothstep) {
  if (p <= stops[0].at) return stops[0].value;
  const last = stops[stops.length - 1];
  if (p >= last.at) return last.value;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (p >= a.at && p <= b.at) {
      const t = ease === smoothstep ? smoothstep(a.at, b.at, p) : clamp((p - a.at) / (b.at - a.at));
      return lerp(a.value, b.value, t);
    }
  }
  return last.value;
}
