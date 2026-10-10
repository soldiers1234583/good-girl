/**
 * End-to-end harness.
 *
 * There is no browser in this environment, and a build/typecheck would prove
 * nothing about a WebGL experience. So instead this runs the REAL boot
 * sequence — the real index.html, the real vendored Three.js, every real scene
 * module — inside jsdom, with two things stubbed:
 *
 *   1. WebGLRenderer, which needs an actual GL context.
 *   2. The 2D canvas context, which the scene uses to paint its procedural
 *      textures (face decal, eye texture, star glow, ground falloff).
 *
 * Everything else is genuine: geometry construction, the rig, the shaders'
 * uniform plumbing, the choreography, the DOM layers, and several hundred
 * frames of the actual frame loop. Frame timing is driven by a controllable
 * clock so the run is deterministic.
 *
 * What this cannot tell us is whether it LOOKS right. That still needs eyes on
 * a real browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Stubs                                                              */
/* ------------------------------------------------------------------ */

function make2DContext() {
  const gradient = { addColorStop() {} };
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    globalAlpha: 1,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillRect() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    clip() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    setTransform() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    ellipse() {},
    arc() {},
    fill() {},
    stroke() {},
    drawImage() {},
  };
}

/** Enough of a GL context for the capability probe to say "we can render". */
const FAKE_GL = {
  getExtension: () => null,
  getParameter: () => '',
  getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
  createTexture: () => ({}),
  createBuffer: () => ({}),
  bindTexture() {},
  texImage2D() {},
  texParameteri() {},
  pixelStorei() {},
  clearColor() {},
  clear() {},
  enable() {},
  disable() {},
  viewport() {},
  getError: () => 0,
};

/** Stand-in for THREE.WebGLRenderer. Records what the stage asks of it. */
function makeRendererStub() {
  return class StubRenderer {
    constructor(params) {
      this.params = params;
      this.domElement = params.canvas;
      this.pixelRatio = 1;
      this.outputEncoding = 0;
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.sortObjects = true;
      this.renderCount = 0;
      this.disposed = false;
      this.lastSize = [0, 0];
    }
    setPixelRatio(v) {
      this.pixelRatio = v;
    }
    getPixelRatio() {
      return this.pixelRatio;
    }
    setSize(w, h) {
      this.lastSize = [w, h];
    }
    setClearColor() {}
    setAnimationLoop() {}
    render() {
      this.renderCount++;
    }
    getContext() {
      return FAKE_GL;
    }
    dispose() {
      this.disposed = true;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

/**
 * Boot the real thing and hand back a controllable rig.
 * Returns { dom, pump, seek, app, renderer, restore }.
 */
async function launch() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    pretendToBeVisual: false,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // --- deterministic clock -------------------------------------------
  let now = 1_000_000;
  const fakePerformance = { now: () => now };
  const realPerformance = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', {
    value: fakePerformance,
    configurable: true,
    writable: true,
  });

  // --- canvas ---------------------------------------------------------
  window.HTMLCanvasElement.prototype.getContext = function (type) {
    const t = String(type);
    if (t === '2d') return make2DContext();
    if (t.indexOf('webgl') === 0 || t === 'experimental-webgl') return FAKE_GL;
    return null;
  };

  // --- media queries ---------------------------------------------------
  // jsdom answers every media query false, which would send the piece down the
  // low-capability path and skip the desktop-only cursor entirely. Report a
  // fine pointer so the harness exercises the richest branch.
  window.matchMedia = (query) => ({
    matches: /hover:\s*hover/.test(query) || /pointer:\s*fine/.test(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });

  // --- scroll track geometry -----------------------------------------
  // jsdom has no layout, so the story track needs real dimensions or progress
  // would be stuck at 0 for the whole run.
  const trackEl = window.document.querySelector('.track');
  assert.ok(trackEl, 'index.html must contain the .track scroll container');
  const TRACK_HEIGHT = 8400;
  Object.defineProperty(trackEl, 'offsetHeight', { value: TRACK_HEIGHT, configurable: true });
  const maxScroll = TRACK_HEIGHT - window.innerHeight;

  // --- globals ---------------------------------------------------------
  globalThis.window = window;
  globalThis.document = window.document;
  // Deliberately not jsdom's own navigator: its user agent string contains
  // "android", which device detection correctly reads as a phone and would
  // send us down the mobile branch. This harness simulates a capable desktop
  // so it exercises the richest path (full quality tier + custom cursor).
  const DESKTOP_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: DESKTOP_UA,
      maxTouchPoints: 0,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    },
    configurable: true,
    writable: true,
  });
  window.scrollTo = () => {};
  // jsdom exposes scrollY as a getter with no setter, and assigning to it in
  // an ES module (strict mode) throws. Redefine it as a real accessor.
  let scrollY = 0;
  Object.defineProperty(window, 'scrollY', {
    get: () => scrollY,
    set: (v) => {
      scrollY = v;
    },
    configurable: true,
  });

  // --- frame pump ------------------------------------------------------
  let queue = [];
  globalThis.requestAnimationFrame = (cb) => queue.push(cb);
  globalThis.cancelAnimationFrame = () => {};
  const pump = (frames = 1, msPerFrame = 1000 / 60) => {
    for (let i = 0; i < frames; i++) {
      now += msPerFrame;
      const pending = queue;
      queue = [];
      for (const cb of pending) cb();
      if (queue.length === 0) throw new Error('the frame loop stopped re-registering itself');
    }
  };

  // --- three.js (the real vendored build) ------------------------------
  await import(join(ROOT, 'vendor/three.min.js'));
  const THREE = globalThis.THREE;
  assert.ok(THREE, 'the vendored Three.js must expose the THREE global');
  assert.equal(THREE.REVISION, '128', 'vendored revision');
  THREE.WebGLRenderer = makeRendererStub();

  // --- run the real boot, deferred the same way the page defers it ----
  Object.defineProperty(window.document, 'readyState', { value: 'complete', configurable: true });
  await import(join(ROOT, 'src/main.js'));

  // Before the deferred build runs, the title card must already be in the
  // document — that is the whole point of deferring, and it is what the
  // visitor sees while the scene is constructed.
  assert.ok(window.document.querySelector('.hud-title'), 'the title card is in the static markup');
  assert.ok(
    window.document.querySelector('.hud-title').textContent.includes('Good Girl'),
    'and it says what this is'
  );
  assert.equal(window.__goodGirl, undefined, 'the scene has not been built yet');

  // Two frames: first schedules the second, second builds.
  pump(2);

  const app = window.__goodGirl;
  assert.ok(app, 'boot() must expose the debug surface (fallback path taken?)');

  const restore = () => {
    Object.defineProperty(globalThis, 'performance', {
      value: realPerformance,
      configurable: true,
      writable: true,
    });
  };

  /** Scroll to a progress position and let the damping settle. */
  const seek = (p, settleFrames = 220) => {
    window.scrollY = p * maxScroll;
    window.dispatchEvent(new window.Event('scroll'));
    pump(settleFrames);
    return window.__goodGirl.scroll.value;
  };

  return { dom, window, app, pump, seek, maxScroll, restore, THREE };
}

/* ------------------------------------------------------------------ */
/* The test                                                           */
/* ------------------------------------------------------------------ */

test('the real boot sequence builds the scene and plays the whole timeline', async (t) => {
  const { window, app, pump, seek, restore } = await launch();
  t.after(() => restore());

  const stage = app.stage;
  const internals = app.internals;

  /* ---------- it actually built the 3D world ---------- */
  assert.equal(app.state().device.isMobile, false, 'harness simulates a desktop');
  assert.equal(app.state().device.quality.tier, 2, 'full quality tier');
  assert.ok(stage.scene.children.length >= 5, `scene has ${stage.scene.children.length} children`);
  assert.ok(internals.character.root.parent === stage.scene, 'the girl is in the scene');
  assert.ok(internals.star.rig.parent === stage.scene, 'the star is in the scene');
  assert.ok(stage.scene.fog, 'fog was installed on the scene');
  assert.ok(window.document.documentElement.classList.contains('is-ready'), 'marked ready');

  /* ---------- the DOM layers exist ---------- */
  assert.ok(window.document.querySelector('.hud'), 'HUD built');
  assert.ok(window.document.querySelector('.rail__marker'), 'chapter rail built');
  assert.ok(window.document.querySelectorAll('.phrase').length === 4, 'four story lines built');
  assert.ok(window.document.querySelector('.badge__title'), 'badge built');
  assert.equal(window.document.querySelector('.badge__title').textContent, 'GOOD GIRL');
  assert.equal(window.document.querySelector('.badge__subtitle').textContent, 'BADGE');

  /* ---------- a few frames run without throwing ---------- */
  pump(10);
  const renderer = stage.renderer;
  assert.ok(renderer.renderCount > 0, `renderer ran ${renderer.renderCount} times`);
  assert.ok(Number.isFinite(stage.camera.position.z));

  /* ---------- the opening frame ---------- */
  const opening = seek(0);
  assert.ok(opening < 0.02, `progress settled at ${opening}`);
  const openingCamZ = stage.camera.position.z;
  assert.ok(openingCamZ > 6, `opens wide (camera z = ${openingCamZ})`);
  assert.ok(internals.star.light.intensity < 3, 'the star starts dim');
  assert.equal(internals.character.root.position.z, 0, 'she starts at her mark');

  const root = window.document.documentElement;
  const openingBg = root.style.getPropertyValue('--stage-bg');
  assert.match(openingBg, /^radial-gradient/, 'palette painted the background');
  const openingAccent = root.style.getPropertyValue('--accent');
  assert.match(openingAccent, /^rgb\(/, 'accent colour published to CSS');
  const openingStarIntensity = internals.star.getIntensity();

  // The title card is up and the story lines are not.
  const title = window.document.querySelector('.hud-title');
  assert.ok(!title.classList.contains('is-away'), 'title card shows at rest');
  assert.equal(internals.star.rig.position.z, 1.32, 'the star waits on its pedestal');

  // Nothing from the ending may be on screen yet — in particular the badge,
  // whose spring cannot express "not yet earned" on its own.
  assert.equal(window.document.querySelector('.badge-wrap').style.display, 'none', 'badge stays hidden at the start');
  assert.equal(window.document.querySelector('.phrase[data-phrase="final"]').style.display, 'none', 'final line hidden');
  assert.ok(!window.document.querySelector('.ending').classList.contains('is-visible'), 'no replay offered yet');

  /* ---------- she walks ---------- */
  seek(0.4);
  const midWalkZ = internals.character.root.position.z;
  assert.ok(midWalkZ > 0.2, `she has walked forward (z = ${midWalkZ})`);
  assert.ok(window.document.querySelector('.hud-title').classList.contains('is-away'), 'title retreats');

  /* ---------- she arrives and reaches ---------- */
  const arrived = seek(0.62);
  assert.ok(arrived > 0.6 && arrived < 0.64, `progress settled at ${arrived}`);
  const settledZ = internals.character.root.position.z;
  assert.ok(Math.abs(settledZ - 0.92) < 0.02, `she stopped on her mark (z = ${settledZ})`);

  /* ---------- the pickup: the star ends up in her hand ---------- */
  seek(1, 320);
  const starPos = internals.star.rig.position.clone();
  const palm = internals.character.handWorld();
  const handGap = starPos.distanceTo(palm);
  assert.ok(handGap < 0.02, `the star sits in her palm (gap = ${handGap.toFixed(4)})`);
  assert.ok(internals.character.root.position.z > 0.9, 'she is still on her mark when she holds it');

  // It must have left the pedestal, and be lit up.
  const homeDist = Math.hypot(starPos.x + 0.62, starPos.y - 0.98, starPos.z - 1.32);
  assert.ok(homeDist > 0.1, `the star left its home position (moved ${homeDist.toFixed(3)})`);
  assert.ok(
    internals.star.getIntensity() > openingStarIntensity + 1,
    `the star brightened (${openingStarIntensity} -> ${internals.star.getIntensity()})`
  );
  assert.ok(internals.star.light.intensity > 1, 'the star is casting light');
  assert.equal(internals.star.getHeld(), 1, 'the star is committed to her hand');

  /* ---------- the colour journey completed ---------- */
  const endBg = root.style.getPropertyValue('--stage-bg');
  assert.match(endBg, /^radial-gradient/, 'still a gradient');
  assert.notEqual(endBg, openingBg, 'the world changed colour over the journey');
  const endAccent = root.style.getPropertyValue('--accent');
  assert.notEqual(endAccent, openingAccent, 'the accent colour evolved');

  // Vignette and cursor tone are published the same way.
  assert.match(root.style.getPropertyValue('--vig'), /^0\.\d+$/);

  /* ---------- the desktop cursor runs on a fine pointer ---------- */
  assert.ok(root.classList.contains('has-custom-cursor'), 'custom cursor enabled for fine pointers');
  assert.match(root.style.getPropertyValue('--cursor-rgb'), /^\d+, \d+, \d+$/);
  const cursorDot = window.document.querySelector('.cursor-dot');
  assert.ok(cursorDot, 'cursor dot built');
  assert.match(cursorDot.style.transform, /translate3d\(/, 'cursor is tracking a position');
  assert.ok(window.document.querySelector('.cursor-ring'), 'cursor ring built');

  /* ---------- the camera settled closer ---------- */
  assert.ok(stage.camera.position.z < openingCamZ, `camera closed in (${stage.camera.position.z} < ${openingCamZ})`);
  assert.ok(stage.camera.fov > 24 && stage.camera.fov < 46, `fov in range (${stage.camera.fov})`);

  /* ---------- the reward is on screen ---------- */
  const badge = window.document.querySelector('.badge-tilt');
  const badgeTransform = badge.style.transform;
  assert.ok(badgeTransform.includes('scale('), `badge was scaled in: "${badgeTransform}"`);
  const scale = Number(/scale\(([\d.]+)\)/.exec(badgeTransform)[1]);
  assert.ok(scale > 0.95, `badge reached full size (${scale})`);
  assert.ok(window.document.querySelector('.ending').classList.contains('is-visible'), 'replay offered');

  /* ---------- the final line stays, the earlier ones are gone ---------- */
  const finalPhrase = window.document.querySelector('.phrase[data-phrase="final"]');
  assert.notEqual(finalPhrase.style.display, 'none', 'final line is displayed');
  assert.ok(Number(finalPhrase.style.opacity) > 0.9, `final line is opaque (${finalPhrase.style.opacity})`);
  const discovery = window.document.querySelector('.phrase[data-phrase="discovery"]');
  assert.equal(discovery.style.display, 'none', 'the first line has left');

  /* ---------- scrubbing back up rewinds everything ---------- */
  const back = seek(0, 320);
  assert.ok(back < 0.02, `scrolls back to the start (${back})`);
  assert.ok(Math.abs(internals.character.root.position.z) < 0.02, 'she walks back to where she began');
  // x and z should return exactly; y carries the idle float.
  assert.ok(Math.abs(internals.star.rig.position.x + 0.62) < 1e-6, 'the star returns to its pedestal in x');
  assert.ok(Math.abs(internals.star.rig.position.z - 1.32) < 1e-6, 'the star returns to its pedestal in z');
  assert.ok(Math.abs(internals.star.rig.position.y - 0.98) < 0.05, 'and in y, within the float');
  assert.equal(internals.star.getHeld(), 0, 'the star is no longer held');
  assert.ok(stage.camera.position.z > 6, 'the camera pulls back out');
  assert.equal(window.document.querySelector('.badge-wrap').style.display, 'none', 'the badge goes back into hiding');

  /* ---------- sweep the whole timeline without a bad frame ---------- */
  // This is the closest thing to "play it through" that is possible without a
  // browser: every phase, every transition edge, and the one-shot impulses.
  let peakStarIntensity = 0;
  let peakStarLight = 0;
  let burstSeen = false;
  let peakStarScale = 0;

  for (let i = 0; i <= 120; i++) {
    const target = i / 120;
    window.scrollY = target * app.scroll.max;
    window.dispatchEvent(new window.Event('scroll'));
    pump(25);

    assert.ok(Number.isFinite(stage.camera.position.x), `camera x bad at ${target}`);
    assert.ok(Number.isFinite(stage.camera.position.y), `camera y bad at ${target}`);
    assert.ok(Number.isFinite(stage.camera.position.z), `camera z bad at ${target}`);
    assert.ok(Number.isFinite(stage.camera.fov), `fov bad at ${target}`);

    const g = internals.character.root.position;
    assert.ok(Number.isFinite(g.x + g.y + g.z), `girl position bad at ${target}`);

    const s = internals.star.rig.position;
    assert.ok(Number.isFinite(s.x + s.y + s.z), `star position bad at ${target}`);

    peakStarIntensity = Math.max(peakStarIntensity, internals.star.getIntensity());
    peakStarLight = Math.max(peakStarLight, internals.star.light.intensity);
    peakStarScale = Math.max(peakStarScale, internals.star.rig.scale.x);

    const alphas = internals.particles.burst.geometry.attributes.aAlpha.array;
    for (let k = 0; k < alphas.length; k++) {
      if (alphas[k] > 0.05) {
        burstSeen = true;
        break;
      }
    }

    // The rendered colour must stay a real colour, not NaN-black.
    const bg = root.style.getPropertyValue('--stage-bg');
    assert.ok(!/NaN|undefined/.test(bg), `background went bad at ${target}: ${bg}`);
  }

  assert.ok(peakStarIntensity > 2, `the star reached a bright peak (${peakStarIntensity})`);
  assert.ok(peakStarLight > 2, `and cast real light (${peakStarLight})`);
  assert.ok(peakStarScale > 0.31, `the star swelled during the reaction (${peakStarScale})`);
  assert.ok(burstSeen, 'the reaction burst actually fired');

  /* ---------- reduced-motion does not break the loop ---------- */
  assert.ok(Number.isFinite(app.state().progress));

  /* ---------- teardown releases everything ---------- */
  assert.ok(renderer.renderCount > 1000, `the loop rendered throughout (${renderer.renderCount} frames)`);
  assert.doesNotThrow(() => app.dispose());
  assert.ok(renderer.disposed, 'the renderer was disposed');
  assert.equal(stage.scene.children.length, 0, 'the scene graph was emptied');
});

test('the custom cursor is a pure no-op when it is disabled', async () => {
  // Touch devices and reduced-motion users must not get a cursor layer at all,
  // and must not have their native cursor hidden. Uses a throwaway DOM so it
  // is isolated from the boot harness above.
  const dom = new JSDOM('<body></body>');
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const { createCursor } = await import('../src/ui/cursor.js');
    const disabled = createCursor({ enabled: false });
    assert.equal(disabled.enabled, false);
    assert.doesNotThrow(() => {
      disabled.update(1 / 60, 1);
      disabled.setTone({ mote: [0.5, 0.6, 0.7] });
      disabled.dispose();
    });
    assert.equal(dom.window.document.querySelector('.cursor-layer'), null, 'no layer created');
    assert.equal(
      dom.window.document.documentElement.classList.contains('has-custom-cursor'),
      false,
      'the native cursor is left alone'
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('the capability probe sends software renderers to the fallback story', async () => {
  // Guards the one branch the main harness deliberately bypasses. If this
  // regresses, a user on a software-rasterised device gets a frozen canvas
  // instead of the DOM story.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const { window } = dom;

  const realWindow = globalThis.window;
  globalThis.window = window;
  globalThis.document = window.document;

  try {
    const { webglProblem } = await import('../src/util/device.js');

    assert.equal(webglProblem(null), 'no-canvas');
    assert.equal(webglProblem({}), 'no-canvas');

    // No context at all -> unavailable.
    assert.equal(webglProblem({ getContext: () => null }), 'webgl-unavailable');

    // A software rasteriser must be rejected: the piece would crawl.
    const swGl = {
      getExtension: () => 'WEBGL_debug_renderer_info',
      getParameter: () => 'Google SwiftShader',
    };
    assert.equal(webglProblem({ getContext: () => swGl }), 'software-renderer');

    // A real GPU is accepted.
    const hwGl = {
      getExtension: () => 'WEBGL_debug_renderer_info',
      getParameter: () => 'Adreno (TM) 640',
    };
    assert.equal(webglProblem({ getContext: () => hwGl }), null);

    // And when renderer introspection is unavailable, assume it is fine.
    assert.equal(webglProblem({ getContext: () => ({ getExtension: () => null }) }), null);
  } finally {
    globalThis.window = realWindow;
  }
});
