/**
 * Choreography — the single place scroll position becomes scene intent.
 *
 * This module is deliberately PURE: no THREE, no DOM, no timers. It answers
 * "at progress p, what does every part of the piece want to be doing?" and the
 * scene modules resolve that intent against their own geometry (the character
 * turns `reach` into shoulder rotations, the camera rig turns `aim` weights
 * into a lookAt vector, and so on).
 *
 * Two consequences that matter:
 *  1. The choreography can be unit-tested in Node (see test/choreography.test.mjs).
 *  2. Every system shares one source of truth, so the timeline stays
 *     continuous instead of drifting into disconnected animation blocks.
 */

import { clamp, lerp, smoothstep, easeInOut } from '../util/math.js';
import { PHASE, PHASES, BEAT, phaseAt, phaseIndexAt, pulseAt } from './phases.js';
import { samplePalette, starInfluence, vignetteFor } from './palette.js';

/* ------------------------------------------------------------------ */
/* Camera shot list                                                   */
/* ------------------------------------------------------------------ */

/**
 * Shots are keyframes, not scenes. Position is world-space; the aim is a
 * weighted blend between the girl's chest and the star so the subject can
 * never leave the frame even as her choreography changes.
 *
 *   aim.girl / aim.star   blend weights (normalised together)
 *   aim.offset            world-space nudge applied after the blend
 */
export const SHOTS = [
  // `tight` is 0 for a wide frame and 1 for a close-up. The camera rig scales
  // handheld drift and pointer parallax by it: a swing that reads as alive in
  // the establishing shot reads as seasickness in a 1.2-unit close-up.
  //
  // Wide establishing shot — she is small; the star is a distant glint.
  { at: 0.0, pos: [0.0, 1.45, 7.4], fov: 31, tight: 0.05, aim: { girl: 0.9, star: 0.1, offset: [0.0, 0.02, 0.0] } },
  // The camera drifts in and to the side; the star starts to register.
  { at: 0.16, pos: [0.55, 1.38, 5.9], fov: 32, tight: 0.15, aim: { girl: 0.75, star: 0.25, offset: [-0.06, 0.04, 0.1] } },
  // Medium shot — her torso reads, the star is clearly in the near field.
  { at: 0.34, pos: [1.25, 1.34, 4.2], fov: 34, tight: 0.3, aim: { girl: 0.6, star: 0.4, offset: [-0.18, 0.06, 0.2] } },
  // Closer character shot — the turn of her head toward the star.
  { at: 0.5, pos: [1.75, 1.34, 2.95], fov: 36, tight: 0.45, aim: { girl: 0.62, star: 0.38, offset: [-0.3, 0.08, 0.28] } },
  // Star focus — the camera commits to the star as she closes in.
  { at: 0.62, pos: [0.62, 1.28, 2.05], fov: 33, tight: 0.6, aim: { girl: 0.35, star: 0.65, offset: [-0.04, 0.06, 0.16] } },
  // Pickup close-up — tight on the hand/star contact.
  { at: 0.7, pos: [1.0, 1.4, 1.9], fov: 38, tight: 0.85, aim: { girl: 0.5, star: 0.5, offset: [-0.2, 0.06, 0.1] } },
  // Hero shot — she cradles the star; the frame opens back up.
  { at: 0.86, pos: [0.5, 1.5, 3.9], fov: 33, tight: 0.35, aim: { girl: 0.7, star: 0.3, offset: [-0.06, 0.1, 0.1] } },
  // Settle — the camera comes to rest, slow and quiet for the reward.
  { at: 1.0, pos: [0.2, 1.48, 4.9], fov: 32, tight: 0.2, aim: { girl: 0.68, star: 0.32, offset: [-0.02, 0.06, 0.05] } },
];

const vec3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Sample the shot list at `p`, easing between keyframes. */
export function sampleShot(p) {
  const x = clamp(p);
  let i = 0;
  for (let k = 0; k < SHOTS.length - 1; k++) if (x >= SHOTS[k].at) i = k;
  const a = SHOTS[i];
  const b = SHOTS[Math.min(i + 1, SHOTS.length - 1)];
  if (a === b) return { pos: a.pos.slice(), fov: a.fov, tight: a.tight, aim: { ...a.aim, offset: a.aim.offset.slice() } };
  const t = easeInOut((x - a.at) / (b.at - a.at));
  const wG = lerp(a.aim.girl, b.aim.girl, t);
  const wS = lerp(a.aim.star, b.aim.star, t);
  const norm = wG + wS || 1;
  return {
    pos: vec3(a.pos, b.pos, t),
    fov: lerp(a.fov, b.fov, t),
    tight: lerp(a.tight, b.tight, t),
    aim: {
      girl: wG / norm,
      star: wS / norm,
      offset: vec3(a.aim.offset, b.aim.offset, t),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Typography                                                         */
/* ------------------------------------------------------------------ */

/**
 * The four lines of the story. Kept to a minimum on purpose: text is a
 * narrative instrument here, not a landing-page feature list.
 *
 * wind = the phrase is permanently pinned once it has arrived (the final line).
 */
export const PHRASES = [
  {
    id: 'discovery',
    text: 'A little star\u2026',
    size: 'lg',
    in: [0.135, 0.215],
    out: [0.285, 0.345],
  },
  {
    id: 'waiting',
    text: 'It\u2019s waiting for you.',
    size: 'lg',
    in: [0.335, 0.415],
    out: [0.5, 0.56],
  },
  {
    id: 'special',
    text: 'You earned something special.',
    size: 'md',
    in: [0.775, 0.845],
    // Fades as the final line arrives rather than snapping away: a narrow out
    // window is steep enough to read as a pop on screen.
    out: [0.872, 0.932],
  },
  {
    id: 'final',
    text: 'You have earned a Good Girl Badge.',
    size: 'lg',
    pin: true,
    in: [0.885, 0.95],
    out: null,
  },
];

/**
 * Resolve every phrase to { alpha, stagger } at `p`.
 *
 * `stagger` is a normalised 0..1 wave head that the typography layer uses to
 * reveal words one after another — it keeps travelling after `alpha` has
 * settled, which is what makes the reveal feel like a mask wipe rather than a
 * fade.
 */
export function samplePhrases(p) {
  return PHRASES.map((ph) => {
    const rise = smoothstep(ph.in[0], ph.in[1], p);
    const fall = ph.out ? smoothstep(ph.out[0], ph.out[1], p) : 0;
    const alpha = clamp(rise - fall);
    // Stagger head runs slightly ahead of alpha so words are still arriving
    // as the line reaches full opacity.
    const head = clamp((p - ph.in[0]) / ((ph.in[1] - ph.in[0]) * 1.35));
    return { ...ph, alpha, stagger: alpha <= 0.001 ? 0 : head, leaving: fall > 0 && !ph.pin };
  });
}

/* ------------------------------------------------------------------ */
/* The directive                                                     */
/* ------------------------------------------------------------------ */

/**
 * Everything the scene needs at progress `p`.
 *
 * @param {number} p progress in [0, 1]
 * @returns {object} scene intent — see the JSDoc on each group below.
 */
export function direct(p) {
  const x = clamp(p);
  const phase = phaseAt(x);

  /* ---- star ------------------------------------------------------- */
  // Dim while she is unaware; builds as she notices; answers her hand; then
  // settles into a warm, steady light for the reward.
  const wake = smoothstep(0.14, 0.34, x);
  const approachGlow = smoothstep(0.34, 0.58, x) * 0.28;
  const contact = smoothstep(BEAT.REACH_START, BEAT.STAR_CONTACT, x);
  const reaction = smoothstep(BEAT.GRIP, BEAT.REACTION_PEAK, x) * 1.15;
  const settle = smoothstep(BEAT.REACTION_PEAK, 0.98, x) * -0.5;
  const intensity = clamp(0.34 + wake * 0.5 + approachGlow + contact * 0.35 + reaction + settle, 0.05, 3);

  // A one-shot flare through the reaction so the brightness reads as a
  // response to her touch, not a linear ramp. Narrow enough to feel like a
  // flash, wide enough that a scrubbing thumb cannot skip past it.
  const flare = pulseAt(x, BEAT.REACTION_PEAK, 0.045);
  // The star leans toward her hand during the reach: anticipation.
  const lean = smoothstep(BEAT.REACH_START, BEAT.STAR_CONTACT, x) * 0.4;
  // Committed to the palm. Deliberately a touch after contact so the lift
  // reads as "she takes it" rather than "it jumps into her hand".
  const held = smoothstep(BEAT.STAR_CONTACT, BEAT.GRIP, x);
  const lift = smoothstep(BEAT.STAR_CONTACT + 0.01, BEAT.REACTION_PEAK - 0.03, x);

  /* ---- girl ------------------------------------------------------- */
  const walk = smoothstep(BEAT.WALK_START, BEAT.WALK_END, x);
  // Stride amplitude: rises with the walk, then hands over to the reach.
  const stride = smoothstep(BEAT.WALK_START, BEAT.WALK_START + 0.06, x) *
    (1 - smoothstep(BEAT.WALK_END, BEAT.WALK_END + 0.05, x));
  const reach = smoothstep(BEAT.REACH_START, BEAT.STAR_CONTACT + 0.022, x);
  const grip = smoothstep(BEAT.STAR_CONTACT + 0.012, BEAT.GRIP + 0.02, x);
  // Once it is in her hand she brings it in to her chest — the difference
  // between "she grabbed an object" and "she is holding something precious".
  const carry = smoothstep(BEAT.GRIP + 0.03, BEAT.REACTION_PEAK - 0.01, x);
  const attention = smoothstep(BEAT.STAR_WAKES, BEAT.SHE_NOTICES + 0.05, x);
  // Idle breathing: present throughout, softening into stillness for the reward.
  const settleCalm = smoothstep(BEAT.REACTION_PEAK, 0.96, x);
  const breathe = lerp(1, 0.45, settleCalm);
  // A small impact bounce the moment she takes the star.
  const bounce = pulseAt(x, BEAT.GRIP + 0.018, 0.05);

  /* ---- camera ----------------------------------------------------- */
  const shot = sampleShot(x);
  // Handheld drift is strongest while she travels, scaled down hard for tight
  // shots, and gone once we settle. See the `tight` note on SHOTS above.
  const drift =
    (0.4 + smoothstep(0.2, 0.6, x) * 0.55) *
    (1 - 0.82 * shot.tight) *
    lerp(1, 0.3, smoothstep(0.86, 1, x));
  // The camera nudges on the pickup impact.
  const shake = pulseAt(x, BEAT.GRIP + 0.02, 0.06);

  /* ---- atmosphere ------------------------------------------------- */
  const motes = 0.55 + smoothstep(0.14, 0.5, x) * 0.55 + pulseAt(x, BEAT.REACTION_PEAK, 0.06) * 1.3;
  const burst = pulseAt(x, BEAT.REACTION_PEAK, 0.05) + pulseAt(x, BEAT.STAR_CONTACT, 0.03) * 0.35;
  const warmth = smoothstep(BEAT.GRIP, BEAT.REACTION_PEAK, x) * (1 - settleCalm * 0.55);

  const pal = samplePalette(x, warmth);

  /* ---- ui --------------------------------------------------------- */
  const badgeIn = smoothstep(BEAT.BADGE_IN, BEAT.BADGE_IN + 0.075, x);
  const finalAlpha = smoothstep(0.885, 0.95, x);

  return {
    p: x,
    phase,
    phaseIndex: phaseIndexAt(x),
    phaseCount: PHASES.length,

    palette: { ...pal, warmth, starInfluence: starInfluence(x), vignette: vignetteFor(x) },

    star: { intensity, flare, lean, held, lift, wake },

    girl: { walk, stride, reach, grip, carry, attention, breathe, bounce, settle: settleCalm },

    camera: { ...shot, drift, shake },

    atmosphere: { motes: clamp(motes, 0, 3.2), burst: clamp(burst, 0, 1), warmth },

    ui: { phrases: samplePhrases(x), badgeIn, finalAlpha, chapter: chapterLabel(x) },
  };
}

/** Short evocative chapter caption for the HUD progress rail. */
export const CHAPTERS = PHASES.map((ph) => ({ at: ph.from, label: ph.label }));

export function chapterLabel(p) {
  const x = clamp(p);
  let out = CHAPTERS[0];
  for (const c of CHAPTERS) if (x >= c.at) out = c;
  return out.label;
}

export { PHASE, BEAT };
