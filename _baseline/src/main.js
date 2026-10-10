/**
 * Composition.
 *
 * This is the only module that knows about all the others. It owns two things:
 * the WORLD LAYOUT (where she stands, where the star sits, how big the star is)
 * and the FRAME LOOP that turns one progress number into a rendered frame.
 *
 * Layout is worth explaining, because the numbers look arbitrary and are not.
 * The star is placed so that when she has walked to her mark, her shoulder is
 * 0.51 world units from it and her arm's reach is 0.63 — close enough that the
 * elbow stays bent and the pose reads as a reach rather than a stretch, far
 * enough that they never interpenetrate. Her palm then lands almost exactly on
 * the star's home position, which is why the contact frame lines up without
 * any IK cheating.
 */

import { detect, watchReducedMotion, webglProblem } from './util/device.js';
import { direct, PHRASES, CHAPTERS } from './story/choreography.js';
import { gradientFor, accentCss } from './story/palette.js';
import { createStage } from './core/stage.js';
import { createCharacter } from './scene/character.js';
import { createStar } from './scene/star.js';
import { createEnvironment } from './scene/environment.js';
import { createParticles } from './scene/particles.js';
import { createLighting } from './scene/lighting.js';
import { createCameraRig } from './camera/cameraRig.js';
import { createScrollProgress } from './scroll/scrollProgress.js';
import { createTypography } from './ui/typography.js';
import { createBadge } from './ui/badge.js';
import { createCursor } from './ui/cursor.js';
import { createHud, createFallbackStory } from './ui/hud.js';
import { easeInOut, lerp, rgbToHex } from './util/math.js';

/* ------------------------------------------------------------------ */
/* World layout                                                        */
/* ------------------------------------------------------------------ */

const STAR_HOME = [ -0.62, 0.98, 1.32 ];
const STAR_SCALE = 0.3; // world scale: her head is ~0.96 wide, the star ~0.52
const START_POS = [0, 0, 0];
const START_YAW = -0.3;
const STAND_POS = [-0.34, 0, 0.92];
const STAND_YAW = -0.42;

export function boot() {
  const device = detect();
  const reducedMotion = device.reducedMotion;

  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');
  const badgeRoot = document.getElementById('overlay');

  // Tell CSS about the operating mode early so layout can adapt before the
  // first WebGL frame lands.
  document.documentElement.classList.toggle('is-touch', device.touch);
  document.documentElement.classList.toggle('is-reduced', device.reducedMotion);
  document.documentElement.classList.toggle('is-mobile', device.isMobile);
  document.documentElement.classList.toggle('tier-0', device.quality.tier === 0);
  document.documentElement.classList.toggle('tier-1', device.quality.tier === 1);

  // `globalThis` rather than `window`: identical in a browser (where the
  // vendored UMD build publishes THREE onto the global object), but it also
  // holds when the module is loaded somewhere `window` is not the global —
  // which is how the headless harness in test/ drives this file.
  const THREE = globalThis.THREE;

  /* ---------------- graceful degradation ---------------- */
  const problem = THREE ? webglProblem(canvas) : 'no-three';
  if (problem) {
    document.documentElement.classList.add('no-webgl');
    createFallbackStory(document.getElementById('overlay'), { reason: problem });
    const hud = createHud(uiRoot, {
      chapters: CHAPTERS,
      reducedMotion,
      notice: 'Showing the simplified version — 3D is unavailable on this device.',
    });
    const scroll = createScrollProgress({ reducedMotion });
    scroll.init();
    const clock = { last: performance.now() };
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - clock.last) / 1000, 1 / 20);
      clock.last = now;
      scroll.update(dt);
      hud.updateTitle(scroll.raw);
    };
    tick();
    return;
  }

  /* ---------------- stage ---------------- */
  const stage = createStage(canvas, { quality: device.quality });
  stage.init();

  /* ---------------- world objects ---------------- */
  const character = createCharacter(THREE, { quality: device.quality });
  stage.scene.add(character.root);

  const star = createStar(THREE, { quality: device.quality, reducedMotion });
  star.rig.scale.setScalar(STAR_SCALE);
  star.rig.position.set(STAR_HOME[0], STAR_HOME[1], STAR_HOME[2]);
  stage.scene.add(star.rig);

  const environment = createEnvironment(THREE, { quality: device.quality });
  stage.scene.add(environment.group);
  stage.setFog(environment.fog);

  const lighting = createLighting(THREE, {});
  stage.scene.add(lighting.group);

  const particles = createParticles(THREE, { quality: device.quality, reducedMotion });
  stage.scene.add(particles.group);

  const cameraRig = createCameraRig(THREE, { reducedMotion });

  /* ---------------- ui ---------------- */
  const typography = createTypography(uiRoot, PHRASES, { reducedMotion });
  const badge = createBadge(badgeRoot, { reducedMotion, interactive: !device.isMobile });
  const cursor = createCursor({ enabled: device.wantsCustomCursor });

  const scroll = createScrollProgress({ reducedMotion, track: document.querySelector('.track') });
  scroll.init();

  let hud = null;
  hud = createHud(uiRoot, {
    chapters: CHAPTERS,
    reducedMotion,
    notice: reducedMotion ? 'Motion is reduced to respect your system preference.' : null,
    onSeek: (p) => scroll.scrollTo(p),
    onReplay: () => {
      scroll.scrollTo(0);
    },
  });

  /* ---------------- shared temporaries ---------------- */
  const girlPos = new THREE.Vector3(START_POS[0], START_POS[1], START_POS[2]);
  const starPos = new THREE.Vector3(STAR_HOME[0], STAR_HOME[1], STAR_HOME[2]);
  const palm = new THREE.Vector3();

  const perfClock = new THREE.Clock();

  // Flush the clock when the tab comes back so the scene does not
  // fast-forward through the elapsed time in one frame.
  stage.onVisibility(() => {
    perfClock.getDelta();
  });

  // Point sizes are expressed against the viewport in device pixels. The 0.06
  // factor puts motes in the same visual size class as the star's own
  // sparkles, which is what keeps the field looking like one system.
  let pxUnit = 18;
  let lastGradient = '';
  let lastAccent = '';
  let lastVig = -1;
  let lastTintKey = '';
  let lastGrip = 0;
  let lastFlare = 0;
  let lastCursorTone = -1;
  let rafId = 0;

  const measure = () => {
    pxUnit = window.innerHeight * stage.dpr * 0.9 * 0.06;
  };
  measure();
  stage.onResize(measure);

  /* ---------------- pointer ---------------- */
  if (!device.touch) {
    window.addEventListener(
      'pointermove',
      (e) => {
        cameraRig.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      },
      { passive: true }
    );
  }

  /* ---------------- the loop ---------------- */
  const detectGrip = (grip, flare) => {
    // Rising edges only: the star squashes once when she takes it, and the
    // world flares once when it answers her.
    if (grip > lastGrip + 0.12) star.setSquash(0.4);
    if (flare > lastFlare + 0.3) {
      star.setSquash(0.55);
      document.documentElement.classList.add('is-flash');
      setTimeout(() => document.documentElement.classList.remove('is-flash'), 640);
    }
    lastGrip = grip;
    lastFlare = flare;
  };

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (stage.isHidden) return;

    const dt = Math.min(perfClock.getDelta(), 1 / 20);
    const t = perfClock.elapsedTime;

    // 1. progress -> intent -------------------------------------------------
    const p = scroll.update(dt);
    const d = direct(p);

    // 2. her ----------------------------------------------------------------
    // Walk her to her mark, then let the intent module do everything else.
    girlPos.set(
      lerp(START_POS[0], STAND_POS[0], d.girl.walk),
      0,
      lerp(START_POS[2], STAND_POS[2], d.girl.walk)
    );
    character.root.position.copy(girlPos);
    character.root.rotation.y = lerp(START_YAW, STAND_YAW, d.girl.walk);
    character.setIntent(d.girl, starPos, dt, t);

    // 3. the star -----------------------------------------------------------
    // Where is it? On its pedestal, or in her hand.
    character.handWorld(palm);
    const pull = Math.max(d.star.lift, d.star.lean * 0.1);
    starPos.lerpVectors(
      { x: STAR_HOME[0], y: STAR_HOME[1], z: STAR_HOME[2] },
      palm,
      easeInOut(pull)
    );
    // It only bobs freely until it is taken.
    if (!reducedMotion) {
      starPos.y += Math.sin(t * 0.9) * 0.035 * (1 - d.star.held);
    }
    star.rig.position.copy(starPos);
    star.rig.scale.setScalar(STAR_SCALE + d.star.flare * 0.05 + d.girl.carry * 0.02);

    star.setIntensity(d.star.intensity);
    star.setFlare(d.star.flare);
    star.setHeld(d.star.held);

    // Re-tint only when the palette has visibly moved on. The tint touches a
    // colour uniform and a light colour, so it is cheap — but it happens on
    // roughly 5% of frames instead of 100%, which adds up on a phone.
    const tintKey = d.palette.starTint.map((v) => Math.round(v * 24)).join(',');
    if (tintKey !== lastTintKey) {
      lastTintKey = tintKey;
      star.setTint(d.palette.starTint);
      star.setLightColor(rgbToHex(d.palette.starTint));
    }

    star.update(dt, t, {
      atmosphere: d.atmosphere,
      px: pxUnit,
      tilt: cameraRig.look.y * 0.01,
      spin: 0,
    });

    // 4. world --------------------------------------------------------------
    environment.applyPalette(d.palette, p);
    environment.update(dt, t, reducedMotion);
    lighting.applyPalette(d.palette, d.palette.starInfluence, starPos, reducedMotion);
    lighting.update(dt, starPos);
    particles.applyPalette(d.palette);
    particles.update(dt, t, d.atmosphere, starPos, pxUnit);

    // 5. camera -------------------------------------------------------------
    cameraRig.update(d.camera, girlPos, starPos, dt, t);
    cameraRig.apply(stage.camera);

    // 6. ui -----------------------------------------------------------------
    // Publish values, let CSS paint them. Same pattern as --accent and --vig:
    // one write, no shorthand parsing, and the stylesheet stays the only place
    // that decides how anything looks.
    const gradient = gradientFor(d.palette);
    if (gradient !== lastGradient) {
      lastGradient = gradient;
      document.documentElement.style.setProperty('--stage-bg', gradient);
    }
    const accent = accentCss(d.palette);
    if (accent !== lastAccent) {
      lastAccent = accent;
      document.documentElement.style.setProperty('--accent', accent);
    }
    // Vignette depth is part of the palette: it closes in during the night and
    // opens out once the world warms, which frames the gold. Bucketed so we
    // are not writing a custom property 60 times a second.
    const vig = Math.round(d.palette.vignette * 40) / 40;
    if (vig !== lastVig) {
      lastVig = vig;
      document.documentElement.style.setProperty('--vig', vig.toFixed(3));
    }

    typography.update(d.ui.phrases);
    badge.update(d.ui, dt, t);
    hud.update(d.ui, scroll.raw, dt, t);
    hud.updateTitle(scroll.raw);
    cursor.update(dt, t);
    if (cursor.enabled) {
      // Tint the cursor roughly once a second rather than every frame.
      const bucket = Math.round(p * 20);
      if (bucket !== lastCursorTone) {
        lastCursorTone = bucket;
        cursor.setTone(d.palette);
      }
    }

    detectGrip(d.girl.grip, d.star.flare);

    // 7. draw ---------------------------------------------------------------
    stage.render();
    stage.tickPerf(dt);
  }

  /* ---------------- go ---------------- */
  stage.resize();
  frame();
  document.documentElement.classList.add('is-ready');

  // React live if the user flips reduced-motion while the page is open.
  watchReducedMotion((on) => {
    document.documentElement.classList.toggle('is-reduced', on);
  });

  /* ---------------- debug / test surface ----------------
     Exposed deliberately: it is what the headless harness in test/boot.test.mjs
     drives, since this environment has no browser to click through the piece.
     Nothing in the experience reads it. */
  window.__goodGirl = {
    stage,
    scroll,
    internals: {
      character,
      star,
      environment,
      lighting,
      particles,
      cameraRig,
      badge,
      typography,
      hud,
      direct,
    },
    dispose() {
      cancelAnimationFrame(rafId);
      typography.dispose();
      badge.dispose();
      cursor.dispose();
      hud.dispose();
      character.dispose();
      star.dispose();
      environment.dispose();
      particles.dispose();
      lighting.dispose();
      stage.dispose();
    },
    state: () => ({ progress: scroll.value, device, perf: stage.perf }),
  };
}

/* ------------------------------------------------------------------ */
/* Entry                                                              */
/* ------------------------------------------------------------------ */

function fail(err) {
  // A thrown error must never leave a blank black page.
  console.error('[good-girl] boot failed', err);
  document.documentElement.classList.add('no-webgl');
  const overlay = document.getElementById('overlay');
  if (overlay && !overlay.querySelector('.fallback')) {
    createFallbackStory(overlay, { reason: 'boot-error' });
  }
}

let started = false;

function start() {
  if (started) return;
  started = true;

  const build = () => {
    try {
      boot();
    } catch (err) {
      fail(err);
    }
  };

  // Build after the first paint, not before it.
  //
  // boot() constructs a few hundred meshes and paints four canvas textures:
  // measured at ~258ms in Node, and appreciably more on a mid-range phone.
  // Running that on the critical path means staring at a blank screen while
  // it happens. Deferring costs one frame and lets the opening title card
  // paint first — which is why that markup lives in index.html.
  if (typeof requestAnimationFrame === 'function') {
    // Two frames, not one: a rAF callback runs *before* its frame paints, so
    // the second callback is the earliest point at which the title is
    // guaranteed to already be on screen.
    requestAnimationFrame(() => requestAnimationFrame(build));
  } else {
    build();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
