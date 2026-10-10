/**
 * The interactive colour journey.
 *
 * Deep Night -> Blue -> Purple -> Magenta -> Warm Gold, interpolated
 * continuously across the timeline so the palette reads as part of the story
 * rather than a set of theme presets.
 *
 * Every consumer (background, fog, world lights, star tint, particles,
 * character key light, typography accent) reads from the single object this
 * module produces, which is what keeps them synchronised for free.
 */

import { clamp, lerp, smoothstep, rgb, rgbToCss, sampleStops, sampleScalar } from '../util/math.js';

/**
 * A palette stop. Colours are 0..1 rgb triples (see `rgb()`); intensities are
 * plain numbers consumed directly by the lights.
 */
const stop = (at, o) => ({
  at,
  bgInner: rgb(o.bgInner),
  bgOuter: rgb(o.bgOuter),
  fog: rgb(o.fog),
  sky: rgb(o.sky),
  ground: rgb(o.ground),
  key: rgb(o.key),
  rim: rgb(o.rim),
  starTint: rgb(o.starTint),
  mote: rgb(o.mote),
  accent: rgb(o.accent),
  hemi: o.hemi,
  keyI: o.keyI,
  rimI: o.rimI,
});

/**
 * Five stops. Intensities are held low at the start and lift through the
 * journey so the world literally brightens as she gets closer to the star.
 */
export const STOPS = [
  stop(0.0, { bgInner: 0x0a1230, bgOuter: 0x03050f, fog: 0x040612, sky: 0x14224a, ground: 0x04040c, key: 0x3a5bb8, rim: 0x24409a, starTint: 0x2a55d8, mote: 0x6f8fd0, accent: 0x9fb6e8, hemi: 0.34, keyI: 0.55, rimI: 0.9 }),
  stop(0.28, { bgInner: 0x10235a, bgOuter: 0x050a1f, fog: 0x060c22, sky: 0x2b4fa8, ground: 0x0a0a1c, key: 0x8fb0ff, rim: 0x6aa0ff, starTint: 0x3a6bff, mote: 0x9fc0ff, accent: 0xc7d6ff, hemi: 0.52, keyI: 0.8, rimI: 1.4 }),
  stop(0.52, { bgInner: 0x35145f, bgOuter: 0x0d0620, fog: 0x120826, sky: 0x6a3cc0, ground: 0x120824, key: 0xc9a0ff, rim: 0xb070ff, starTint: 0x8a4cff, mote: 0xd3b0ff, accent: 0xe2ccff, hemi: 0.62, keyI: 0.85, rimI: 1.55 }),
  stop(0.74, { bgInner: 0x6a1250, bgOuter: 0x1c0518, fog: 0x28061f, sky: 0xc03ca0, ground: 0x2a0722, key: 0xff9ad8, rim: 0xff6ec0, starTint: 0xff64b8, mote: 0xffb0e0, accent: 0xffc2e6, hemi: 0.7, keyI: 0.95, rimI: 1.6 }),
  stop(1.0, { bgInner: 0x5a340a, bgOuter: 0x1a0f04, fog: 0x241305, sky: 0xc88a3c, ground: 0x2a1608, key: 0xffd28a, rim: 0xffb860, starTint: 0xff9a3a, mote: 0xffe0a8, accent: 0xffdca0, hemi: 0.78, keyI: 1.05, rimI: 1.45 }),
];

const CHANNELS = ['bgInner', 'bgOuter', 'fog', 'sky', 'ground', 'key', 'rim', 'starTint', 'mote', 'accent'];
const SCALARS = ['hemi', 'keyI', 'rimI'];

/** Pre-split per-channel stop lists — avoids per-frame allocation. */
const colorStops = CHANNELS.map((ch) => ({ ch, stops: STOPS.map((s) => ({ at: s.at, value: s[ch] })) }));
const scalarStops = SCALARS.map((ch) => ({ ch, stops: STOPS.map((s) => ({ at: s.at, value: s[ch] })) }));

/**
 * Sample the whole journey at `p`.
 *
 * @param {number} p progress in [0, 1]
 * @param {number} warmth extra 0..1 push toward the final gold stop, used by
 *   the star reaction so the world warms a touch faster than scroll alone.
 * @returns {object} palette readings; colours as rgb triples.
 */
export function samplePalette(p, warmth = 0) {
  // The reaction lets the world arrive at gold slightly ahead of the scroll.
  const x = clamp(p + warmth * 0.06);
  const out = {};
  for (const { ch, stops } of colorStops) out[ch] = sampleStops(x, stops);
  for (const { ch, stops } of scalarStops) out[ch] = sampleScalar(x, stops);
  return out;
}

/** Pre-rendered CSS gradient strings, keyed by 0..1 progress bucketed to 1%. */
const gradientCache = new Map();

/**
 * The body background gradient. Cached per 1% bucket because rebuilding a
 * radial-gradient string every frame forces a style recalc for no benefit —
 * the eye cannot resolve 1% of gradient shift.
 */
export function gradientFor(pal) {
  const key = `${Math.round(pal.bgInner[0] * 40)}-${Math.round(pal.bgInner[1] * 40)}-${Math.round(pal.bgInner[2] * 40)}` +
    `|${Math.round(pal.bgOuter[0] * 40)}-${Math.round(pal.bgOuter[1] * 40)}-${Math.round(pal.bgOuter[2] * 40)}`;
  let css = gradientCache.get(key);
  if (!css) {
    css = `radial-gradient(ellipse 120% 90% at 50% 44%, ${rgbToCss(pal.bgInner)} 0%, ${rgbToCss(pal.bgOuter)} 72%)`;
    gradientCache.set(key, css);
  }
  return css;
}

/** The single CSS custom property the typography and cursor tint from. */
export const accentCss = (pal) => rgbToCss(pal.accent);

/* ------------------------------------------------------------------ */
/* Story-driven modifiers                                             */
/* ------------------------------------------------------------------ */


/**
 * How strongly the star washes its surroundings, independent of base palette.
 * Drives the point light, the character's fill light and the motes.
 */
export function starInfluence(p) {
  const a = smoothstep(0.12, 0.3, p) * 0.45; // dim, then noticed
  const b = smoothstep(0.3, 0.55, p) * 0.35; // approach
  const c = smoothstep(0.62, 0.78, p) * 0.95; // the pickup reaction
  const d = smoothstep(0.78, 0.95, p) * -0.35; // settle into peaceful
  return clamp(a + b + c + d, 0, 1.6);
}

/** Vignette darkness. Deepens slightly as the world warms to frame the gold. */
export const vignetteFor = (p) => lerp(0.55, 0.34, smoothstep(0.0, 0.8, p));
