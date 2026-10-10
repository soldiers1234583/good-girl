/**
 * The narrative spine.
 *
 * The whole piece is ONE timeline from 0 to 1. Phases are named windows over
 * that timeline — they overlap on purpose so no beat reads as a separate
 * animation demo. Every other module asks this file "where are we in the
 * story?" rather than hard-coding its own scroll thresholds.
 */

import { clamp } from '../util/math.js';

/** Ordered scene keys, matching the story beats in the brief. */
export const PHASE = {
  INTRO: 'intro', // Scene 01 — she stands; the star waits.
  DISCOVERY: 'discovery', // Scene 02 — the star brightens, she notices.
  APPROACH: 'approach', // Scene 03 — she walks toward it.
  PICKUP: 'pickup', // Scene 04 — reach, contact, lift.
  REACTION: 'reaction', // Star reaction + colour journey peaks.
  MESSAGE: 'message', // "You have earned…" anticipation.
  REWARD: 'reward', // The badge.
};

/**
 * Phase windows in progress units.
 *
 * `from`/`to` are the hard bounds used for phase lookup; `blend` is how much
 * of the window's head and tail feathers into its neighbours, which is what
 * keeps the transitions continuous.
 */
export const PHASES = [
  { key: PHASE.INTRO, from: 0.0, to: 0.14, label: 'The still night' },
  { key: PHASE.DISCOVERY, from: 0.12, to: 0.34, label: 'A little star' },
  { key: PHASE.APPROACH, from: 0.31, to: 0.55, label: 'It is waiting for you' },
  { key: PHASE.PICKUP, from: 0.52, to: 0.71, label: 'Reach' },
  { key: PHASE.REACTION, from: 0.68, to: 0.84, label: 'It answers' },
  { key: PHASE.MESSAGE, from: 0.81, to: 0.93, label: 'Something special' },
  { key: PHASE.REWARD, from: 0.9, to: 1.0, label: 'Good Girl Badge' },
];

/**
 * Named moments on the timeline, used by the choreography to fire impulses
 * (particle bursts, light flares, impact bounces) exactly once.
 */
export const BEAT = {
  STAR_WAKES: 0.16, // the glow starts to build
  SHE_NOTICES: 0.26, // head turns, idle changes
  WALK_START: 0.33,
  WALK_END: 0.545,
  // Deliberately BEFORE the walk ends. Her arm starts unfolding as she takes
  // her last step, so the two beats bleed into each other the way the brief
  // asks for, instead of queueing up as separate demonstrations.
  REACH_START: 0.5,
  STAR_CONTACT: 0.645, // her hand meets the star
  GRIP: 0.672, // the star commits to her palm
  REACTION_PEAK: 0.755, // brightest moment of the whole piece
  MESSAGE_IN: 0.845,
  BADGE_IN: 0.905,
};

/** Half-width (in progress units) of the impulse windows around each beat. */
export const BEAT_WINDOW = 0.022;

/** The discrete phase containing `p`. Later phases win in the overlap. */
export function phaseAt(p) {
  const x = clamp(p);
  let found = PHASES[0];
  for (const ph of PHASES) {
    if (x >= ph.from) found = ph;
  }
  return found;
}

export const phaseKeyAt = (p) => phaseAt(p).key;

/** Ordered index of the current phase, handy for "have we passed X yet?". */
export function phaseIndexAt(p) {
  return PHASES.indexOf(phaseAt(p));
}

/**
 * A one-shot bump: 1 at `center`, falling smoothly to 0 at `center ± halfWidth`.
 *
 * The falloff is a smoothstep, so the pulse is C1-continuous at its edges.
 * That matters: these drive the reaction flare and the pickup bounce, and a
 * non-zero slope at the boundary would show up as a visible pop in brightness.
 */
export function pulseAt(p, center, halfWidth = BEAT_WINDOW) {
  const d = Math.abs(p - center) / halfWidth;
  if (d >= 1) return 0;
  const s = d * d * (3 - 2 * d); // smoothstep(0, 1, d)
  return 1 - s;
}
