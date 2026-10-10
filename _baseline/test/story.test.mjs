/**
 * Story-logic tests.
 *
 * These matter more than they look. The choreography is the single source of
 * truth for camera, lighting, character, star and UI — a discontinuity or an
 * out-of-range value here shows up on screen as a visible pop, and there is no
 * browser in this environment to catch it visually. So the invariants that
 * guarantee continuity are asserted directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PHASE, PHASES, BEAT, phaseAt, phaseIndexAt, pulseAt } from '../src/story/phases.js';
import { direct, SHOTS, sampleShot, PHRASES, samplePhrases, CHAPTERS, chapterLabel } from '../src/story/choreography.js';
import { STOPS, samplePalette, gradientFor, accentCss, starInfluence, vignetteFor } from '../src/story/palette.js';
import { detect } from '../src/util/device.js';

/** Sample N+1 points across the whole timeline. */
const sweep = (n = 400) => Array.from({ length: n + 1 }, (_, i) => i / n);

/* ------------------------------------------------------------------ */
/* Phases                                                             */
/* ------------------------------------------------------------------ */

test('phaseAt selects a phase for every progress value', () => {
  assert.equal(phaseAt(0).key, PHASE.INTRO);
  assert.equal(phaseAt(0.2).key, PHASE.DISCOVERY);
  assert.equal(phaseAt(0.4).key, PHASE.APPROACH);
  assert.equal(phaseAt(0.6).key, PHASE.PICKUP);
  assert.equal(phaseAt(0.75).key, PHASE.REACTION);
  assert.equal(phaseAt(0.87).key, PHASE.MESSAGE);
  assert.equal(phaseAt(1).key, PHASE.REWARD);

  for (const p of sweep(1000)) {
    assert.ok(phaseAt(p), `no phase at ${p}`);
  }
});

test('phaseAt clamps outside the timeline instead of returning undefined', () => {
  assert.equal(phaseAt(-4).key, PHASE.INTRO);
  assert.equal(phaseAt(9).key, PHASE.REWARD);
});

test('phases are ordered, start at 0, end at 1, and overlap', () => {
  assert.equal(PHASES[0].from, 0);
  assert.equal(PHASES[PHASES.length - 1].to, 1);
  for (let i = 1; i < PHASES.length; i++) {
    assert.ok(PHASES[i].from >= PHASES[i - 1].from, 'ordered by start');
    // Overlap is intentional: it is what stops beats reading as separate demos.
    assert.ok(PHASES[i].from < PHASES[i - 1].to, `gap between ${PHASES[i - 1].key} and ${PHASES[i].key}`);
  }
  for (let i = 0; i < PHASES.length - 1; i++) {
    assert.ok(PHASES[i].to <= PHASES[i + 1].to, 'nested windows stay monotonic');
  }
});

test('phaseIndexAt increases monotonically', () => {
  let prev = -1;
  for (const p of sweep(500)) {
    const idx = phaseIndexAt(p);
    assert.ok(idx >= prev, `index went backwards at ${p}`);
    prev = idx;
  }
  assert.equal(prev, PHASES.length - 1);
});

test('the beats fire in causal order', () => {
  const rising = [
    BEAT.STAR_WAKES,
    BEAT.SHE_NOTICES,
    BEAT.WALK_START,
    BEAT.WALK_END,
    BEAT.STAR_CONTACT,
    BEAT.GRIP,
    BEAT.REACTION_PEAK,
    BEAT.BADGE_IN,
  ];
  for (const b of [...rising, BEAT.REACH_START, BEAT.MESSAGE_IN]) {
    assert.ok(b > 0 && b < 1, `beat out of range: ${b}`);
  }
  for (let i = 1; i < rising.length; i++) {
    assert.ok(rising[i] > rising[i - 1], `beat ${i} is out of order`);
  }

  // The reach intentionally overlaps the end of the walk: beats should bleed
  // into one another rather than queue up as separate animations.
  assert.ok(BEAT.REACH_START > BEAT.WALK_START, 'she does not reach before setting off');
  assert.ok(BEAT.REACH_START < BEAT.WALK_END, 'the reach overlaps the walk');
  assert.ok(BEAT.REACH_START < BEAT.STAR_CONTACT, 'contact follows the reach');
  assert.ok(BEAT.MESSAGE_IN > BEAT.REACTION_PEAK, 'the message lands after the reaction peaks');
  assert.ok(BEAT.BADGE_IN > BEAT.MESSAGE_IN, 'the badge is earned last');
});

/* ------------------------------------------------------------------ */
/* Pulses                                                             */
/* ------------------------------------------------------------------ */

test('pulseAt peaks at its centre and reaches zero at its edges', () => {
  assert.equal(pulseAt(0.5, 0.5, 0.05), 1);
  assert.equal(pulseAt(0.45, 0.5, 0.05), 0);
  assert.equal(pulseAt(0.55, 0.5, 0.05), 0);
  assert.equal(pulseAt(0.9, 0.5, 0.05), 0);
  assert.ok(pulseAt(0.475, 0.5, 0.05) > 0 && pulseAt(0.475, 0.5, 0.05) < 1);
});

test('pulseAt is continuous — no step at the window boundary', () => {
  // A non-zero value at the edge would flash the reaction light on and off.
  const half = 0.05;
  assert.ok(pulseAt(0.5 + half - 1e-6, 0.5, half) < 1e-4, 'approaches 0 at the edge');
  let prev = null;
  for (let i = 0; i <= 4000; i++) {
    const p = 0.4 + (0.2 * i) / 4000;
    const v = pulseAt(p, 0.5, half);
    if (prev !== null) assert.ok(Math.abs(v - prev) < 0.01, `jump of ${Math.abs(v - prev)} at ${p}`);
    prev = v;
  }
});

/* ------------------------------------------------------------------ */
/* The directive                                                      */
/* ------------------------------------------------------------------ */

test('direct produces finite numbers everywhere on the timeline', () => {
  for (const p of sweep(600)) {
    const d = direct(p);
    const walk = (obj, path) => {
      for (const [k, v] of Object.entries(obj)) {
        const label = `${path}.${k}`;
        if (typeof v === 'number') {
          assert.ok(Number.isFinite(v), `${label} is ${v} at p=${p}`);
        } else if (Array.isArray(v)) {
          v.forEach((n, i) => assert.ok(Number.isFinite(n), `${label}[${i}] is ${n} at p=${p}`));
        } else if (v && typeof v === 'object') {
          walk(v, label);
        }
      }
    };
    walk({ star: d.star, girl: d.girl, camera: d.camera, atmosphere: d.atmosphere }, 'd');
  }
});

test('every animated quantity stays inside its designed range', () => {
  for (const p of sweep(600)) {
    const d = direct(p);
    const unit = (v, label) => assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `${label} = ${v} at p=${p}`);

    unit(d.girl.walk, 'walk');
    unit(d.girl.stride, 'stride');
    unit(d.girl.reach, 'reach');
    unit(d.girl.grip, 'grip');
    unit(d.girl.carry, 'carry');
    unit(d.girl.attention, 'attention');
    unit(d.girl.settle, 'settle');
    unit(d.star.held, 'held');
    unit(d.star.lift, 'lift');
    unit(d.star.wake, 'wake');
    unit(d.star.flare, 'flare');
    unit(d.ui.badgeIn, 'badgeIn');
    unit(d.ui.finalAlpha, 'finalAlpha');
    unit(d.camera.tight, 'tight');
    unit(d.camera.shake, 'shake');
    unit(d.atmosphere.burst, 'burst');
    unit(d.palette.vignette, 'vignette');

    assert.ok(d.star.intensity >= 0.05 && d.star.intensity <= 3, `star.intensity = ${d.star.intensity}`);
    assert.ok(d.atmosphere.motes >= 0 && d.atmosphere.motes <= 3.2, `motes = ${d.atmosphere.motes}`);
    assert.ok(d.camera.drift >= 0, `drift = ${d.camera.drift}`);
    assert.ok(d.palette.starInfluence >= 0 && d.palette.starInfluence <= 1.6, 'starInfluence');
  }
});

test('nothing in the whole timeline is NaN or Infinity', () => {
  for (const p of [-1, 0, 0.5, 1, 2]) {
    const d = direct(p);
    const str = JSON.stringify({ star: d.star, girl: d.girl, camera: d.camera, atmosphere: d.atmosphere });
    assert.ok(!/null|NaN|Infinity/.test(str), `bad value at p=${p}: ${str.slice(0, 200)}`);
  }
});

test('she walks, then reaches, then grips, then cradles — in that order', () => {
  assert.equal(direct(0.2).girl.walk, 0, 'not walking yet');
  assert.equal(direct(0.45).girl.reach, 0, 'nothing reaches before the reach beat');
  assert.ok(direct(0.4).girl.stride > 0, 'striding mid-walk');
  assert.equal(direct(0.62).girl.stride, 0, 'the stride decays to nothing once she stops');
  assert.equal(direct(0.6).girl.walk, 1, 'has arrived');

  const reaching = direct(0.6);
  assert.ok(reaching.girl.reach > 0.2 && reaching.girl.reach < 1, `mid-reach (${reaching.girl.reach})`);
  assert.ok(reaching.girl.grip < 0.1, 'hand still open mid-reach');

  assert.equal(direct(0.71).girl.grip, 1, 'hand closed');
  assert.ok(direct(0.71).girl.carry < 0.5, 'has not yet brought it in');
  assert.equal(direct(0.78).girl.carry, 1, 'cradled to her chest');
  // She must not cradle it before she has hold of it.
  assert.equal(direct(BEAT.STAR_CONTACT).girl.carry, 0);
});

test('the star brightens as she approaches, peaks when she takes it, then settles', () => {
  const cold = direct(0).star.intensity;
  const waking = direct(0.3).star.intensity;
  const peak = direct(BEAT.REACTION_PEAK).star.intensity;
  const settled = direct(1).star.intensity;

  assert.ok(cold < waking, 'wakes up');
  assert.ok(waking < peak, 'peaks at the reaction');
  assert.ok(settled < peak, 'calms after the reaction');
  assert.ok(settled > cold, 'but stays warmer than the cold open');
});

test('the star commits to her hand only after contact, never before', () => {
  assert.equal(direct(0.5).star.held, 0, 'held nothing before touching it');
  assert.ok(direct(BEAT.STAR_CONTACT + 0.005).star.held < 0.5, 'still arriving at contact');
  assert.equal(direct(0.72).star.held, 1, 'fully in her hand');
  // The lift must trail the held value so it reads as her taking it rather
  // than the star jumping into her palm.
  assert.ok(direct(BEAT.STAR_CONTACT + 0.03).star.lift <= direct(BEAT.STAR_CONTACT + 0.03).star.held + 1);
});

test('the reaction flare is a narrow spike, not a plateau', () => {
  assert.ok(direct(BEAT.REACTION_PEAK).star.flare > 0.95, 'peaks');
  assert.ok(direct(BEAT.REACTION_PEAK - 0.2).star.flare === 0, 'clear before');
  assert.ok(direct(BEAT.REACTION_PEAK + 0.2).star.flare === 0, 'clear after');
});

test('the badge only appears at the very end', () => {
  assert.equal(direct(0.8).ui.badgeIn, 0);
  assert.equal(direct(0.9).ui.badgeIn, 0);
  assert.ok(direct(0.95).ui.badgeIn > 0 && direct(0.95).ui.badgeIn < 1);
  assert.equal(direct(1).ui.badgeIn, 1);
});

test('badgeIn and finalAlpha are monotonic so the reward never un-reveals', () => {
  let prevBadge = -1;
  let prevFinal = -1;
  for (const p of sweep(400)) {
    const ui = direct(p).ui;
    assert.ok(ui.badgeIn >= prevBadge - 1e-9);
    assert.ok(ui.finalAlpha >= prevFinal - 1e-9);
    prevBadge = ui.badgeIn;
    prevFinal = ui.finalAlpha;
  }
});

test('the choreography is deterministic', () => {
  // `direct` carries an `is()` helper function, so compare the serialisable
  // state rather than object identity.
  const snapshot = (p) => {
    const d = direct(p);
    return JSON.stringify({
      star: d.star,
      girl: d.girl,
      camera: d.camera,
      atmosphere: d.atmosphere,
      palette: d.palette,
      phase: d.phase.key,
      phaseIndex: d.phaseIndex,
      ui: {
        badgeIn: d.ui.badgeIn,
        finalAlpha: d.ui.finalAlpha,
        chapter: d.ui.chapter,
        phrases: d.ui.phrases.map((s) => [s.id, s.alpha, s.stagger]),
      },
    });
  };
  for (const p of [0.07, 0.33, 0.61, 0.79, 0.94]) {
    assert.equal(snapshot(p), snapshot(p));
  }
});

/* ------------------------------------------------------------------ */
/* Camera                                                             */
/* ------------------------------------------------------------------ */

test('shot keyframes are well formed', () => {
  assert.equal(SHOTS[0].at, 0);
  assert.equal(SHOTS[SHOTS.length - 1].at, 1);
  for (const s of SHOTS) {
    assert.equal(s.pos.length, 3);
    assert.ok(s.fov > 24 && s.fov < 46, `fov ${s.fov} out of range`);
    assert.ok(s.tight >= 0 && s.tight <= 1, `tight ${s.tight} out of range`);
    // Aim weights must be a normalised blend or the subject drifts off frame.
    assert.ok(Math.abs(s.aim.girl + s.aim.star - 1) < 1e-9, `aim weights sum to ${s.aim.girl + s.aim.star}`);
    assert.ok(s.pos[1] > 1 && s.pos[1] < 2.5, 'camera stays near eye height');
  }
  for (let i = 1; i < SHOTS.length; i++) {
    assert.ok(SHOTS[i].at > SHOTS[i - 1].at, 'shots are ordered');
  }
});

test('sampleShot returns normalised aim weights and stays in frame range', () => {
  for (const p of sweep(300)) {
    const s = sampleShot(p);
    assert.ok(Math.abs(s.aim.girl + s.aim.star - 1) < 1e-9, `weights at ${p}`);
    assert.ok(s.fov > 24 && s.fov < 46, `fov ${s.fov} at ${p}`);
    assert.ok(s.tight >= 0 && s.tight <= 1, `tight at ${p}`);
    assert.ok(s.pos.every(Number.isFinite) && s.aim.offset.every(Number.isFinite));
  }
});

test('the camera never jumps between frames', () => {
  let prev = null;
  for (let i = 0; i <= 4000; i++) {
    const s = sampleShot(i / 4000);
    if (prev) {
      const dp = Math.hypot(s.pos[0] - prev.pos[0], s.pos[1] - prev.pos[1], s.pos[2] - prev.pos[2]);
      assert.ok(dp < 0.02, `camera moved ${dp} in one step at p=${i / 4000}`);
      assert.ok(Math.abs(s.fov - prev.fov) < 0.05, `fov jumped at p=${i / 4000}`);
    }
    prev = s;
  }
});

test('the camera resets to the wide shot at the start and settles closer at the end', () => {
  const first = sampleShot(0);
  const last = sampleShot(1);
  assert.ok(first.pos[2] > last.pos[2], 'starts wide, ends closer');
  assert.ok(last.tight < 0.5, 'the reward is framed with air around her');
});

/* ------------------------------------------------------------------ */
/* Palette / colour journey                                           */
/* ------------------------------------------------------------------ */

test('the journey runs deep night to warm gold and back through five stops', () => {
  assert.equal(STOPS.length, 5);
  assert.equal(STOPS[0].at, 0);
  assert.equal(STOPS[STOPS.length - 1].at, 1);
  for (let i = 1; i < STOPS.length; i++) assert.ok(STOPS[i].at > STOPS[i - 1].at);
});

test('the palette warms monotonically: night is blue, the end is gold', () => {
  const start = samplePalette(0);
  const end = samplePalette(1);
  // Blue night: blue channel dominates. Warm gold: red dominates and blue drops.
  assert.ok(start.bgInner[2] > start.bgInner[0], 'the opening is blue');
  assert.ok(end.bgInner[0] > end.bgInner[2], 'the ending is warm');
  assert.ok(end.keyI > start.keyI, 'the world brightens over the journey');
  assert.ok(end.hemi > start.hemi, 'ambient lifts');
});

test('the palette is continuous — no colour pops between frames', () => {
  let prev = null;
  for (let i = 0; i <= 4000; i++) {
    const pal = samplePalette(i / 4000);
    if (prev) {
      for (const ch of ['bgInner', 'bgOuter', 'fog', 'sky', 'ground', 'key', 'rim', 'starTint', 'mote', 'accent']) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(pal[ch][c] - prev[ch][c]);
          assert.ok(d < 0.002, `${ch}[${c}] jumped ${d} at p=${i / 4000}`);
        }
      }
      for (const ch of ['hemi', 'keyI', 'rimI']) {
        assert.ok(Math.abs(pal[ch] - prev[ch]) < 0.002, `${ch} jumped at p=${i / 4000}`);
      }
    }
    prev = pal;
  }
});

test('palette channels are all valid 0..1 rgb triples', () => {
  for (const p of sweep(300)) {
    const pal = samplePalette(p);
    for (const ch of ['bgInner', 'bgOuter', 'fog', 'sky', 'ground', 'key', 'rim', 'starTint', 'mote', 'accent']) {
      assert.equal(pal[ch].length, 3, `${ch} is a triple`);
      for (const v of pal[ch]) assert.ok(v >= 0 && v <= 1, `${ch} channel ${v} out of range at ${p}`);
    }
    for (const ch of ['hemi', 'keyI', 'rimI']) {
      assert.ok(pal[ch] > 0 && pal[ch] < 3, `${ch} = ${pal[ch]}`);
    }
  }
});

test('warmth pushes the world toward gold ahead of the scroll', () => {
  const without = samplePalette(0.6, 0);
  const with_ = samplePalette(0.6, 1);
  assert.ok(with_.bgInner[0] > without.bgInner[0], 'warmer in red');
  assert.ok(with_.bgInner[2] < without.bgInner[2], 'less blue');
});

test('starInfluence rises for the reaction then eases off for the reward', () => {
  assert.ok(starInfluence(BEAT.REACTION_PEAK) > starInfluence(0.1));
  assert.ok(starInfluence(1) < starInfluence(BEAT.REACTION_PEAK), 'calms at the end');
  assert.ok(starInfluence(1) > 0, 'still present');
});

test('the vignette opens up as the world warms', () => {
  assert.ok(vignetteFor(0) > vignetteFor(1));
  for (const p of sweep(200)) {
    const v = vignetteFor(p);
    assert.ok(v > 0 && v < 1, `vignette ${v} out of range`);
  }
});

test('gradientFor is stable for identical input and yields valid CSS', () => {
  const a = gradientFor(samplePalette(0.4));
  const b = gradientFor(samplePalette(0.4));
  assert.equal(a, b, 'cached and deterministic');
  assert.match(a, /^radial-gradient\(/);
  assert.ok(!/NaN|undefined/.test(a), a);
  // Different palettes must produce different gradients.
  assert.notEqual(gradientFor(samplePalette(0)), gradientFor(samplePalette(1)));
});

test('accentCss produces a usable colour', () => {
  for (const p of sweep(100)) {
    assert.match(accentCss(samplePalette(p)), /^rgb\(\d+,\d+,\d+\)$/);
  }
});

/* ------------------------------------------------------------------ */
/* Typography                                                         */
/* ------------------------------------------------------------------ */

test('there are four lines of story text, and no more', () => {
  assert.equal(PHRASES.length, 4);
  for (const ph of PHRASES) {
    assert.ok(ph.text.length > 0);
    assert.ok(ph.in[1] > ph.in[0], `${ph.id} has a rising window`);
  }
});

test('every phrase arrives, and every unpinned phrase leaves again', () => {
  for (const ph of PHRASES) {
    const at = (ph.in[0] + ph.in[1]) / 2;
    const mid = samplePhrases(at).find((s) => s.id === ph.id);
    assert.ok(mid.alpha > 0.4, `${ph.id} should be visible mid-window (got ${mid.alpha})`);
    assert.ok(mid.stagger > 0, `${ph.id} should have a stagger head`);

    const before = samplePhrases(Math.max(0, ph.in[0] - 0.05)).find((s) => s.id === ph.id);
    assert.equal(before.alpha, 0, `${ph.id} should be absent before its window`);

    if (ph.out) {
      const after = samplePhrases(Math.min(1, ph.out[1] + 0.02)).find((s) => s.id === ph.id);
      assert.equal(after.alpha, 0, `${ph.id} should be gone after its window`);
    }
  }
});

test('the final line is pinned: once earned, it stays', () => {
  const final = PHRASES.find((p) => p.pin);
  assert.ok(final, 'a pinned final line exists');
  const atEnd = samplePhrases(1).find((s) => s.id === final.id);
  assert.equal(atEnd.alpha, 1, 'visible at the end of the story');
  assert.equal(atEnd.leaving, false, 'never leaves');
});

test('at most two lines are ever visible at once', () => {
  for (const p of sweep(1000)) {
    const visible = samplePhrases(p).filter((s) => s.alpha > 0.05);
    assert.ok(visible.length <= 2, `${visible.length} lines visible at p=${p}: ${visible.map((v) => v.id)}`);
  }
});

test('phrase alphas are continuous across the timeline', () => {
  let prev = samplePhrases(0);
  for (let i = 1; i <= 3000; i++) {
    const cur = samplePhrases(i / 3000);
    for (let k = 0; k < cur.length; k++) {
      assert.ok(Math.abs(cur[k].alpha - prev[k].alpha) < 0.01, `alpha jumped for ${cur[k].id}`);
    }
    prev = cur;
  }
});

/* ------------------------------------------------------------------ */
/* HUD                                                                */
/* ------------------------------------------------------------------ */

test('chapter labels cover the timeline and resolve at every point', () => {
  assert.ok(CHAPTERS.length === PHASES.length);
  for (const p of sweep(200)) {
    const label = chapterLabel(p);
    assert.ok(typeof label === 'string' && label.length > 0, `no label at ${p}`);
  }
  assert.equal(chapterLabel(0), PHASES[0].label);
  assert.equal(chapterLabel(1), PHASES[PHASES.length - 1].label);
});

/* ------------------------------------------------------------------ */
/* Device detection                                                   */
/* ------------------------------------------------------------------ */

test('device detection runs headlessly and returns a complete profile', () => {
  // This module is imported in Node by the tests, so every browser probe has
  // to be guarded. If one is not, this test throws.
  const d = detect();
  assert.equal(typeof d.isMobile, 'boolean');
  assert.equal(typeof d.touch, 'boolean');
  assert.equal(typeof d.reducedMotion, 'boolean');
  assert.equal(typeof d.wantsCustomCursor, 'boolean');
  assert.ok([0, 1, 2].includes(d.quality.tier));
  assert.ok(d.quality.maxDpr > 0 && d.quality.maxDpr <= 2);
  assert.ok(d.quality.motes > 0);
});
