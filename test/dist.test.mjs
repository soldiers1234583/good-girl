/**
 * Verifies the single-file build actually runs.
 *
 * The bundle is a classic script (no imports) — that is exactly the property
 * that makes it work from file://. This builds it, then loads dist/index.html
 * in jsdom and executes its scripts the way a browser would, then drives the
 * timeline forward and back.
 *
 * If the bundle were broken — a missing import, a mangled `$&` substitution, an
 * unclosed <script> — nothing here would boot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from '../build.mjs';

function make2DContext() {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get: (o, k) => {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
        if (typeof k === 'string') return () => {};
        return undefined;
      },
      set: () => true,
    }
  );
}

const FAKE_GL = { getExtension: () => null, getParameter: () => '' };

test('the single-file build boots from one document with no imports', async (t) => {
  const { html, bytes } = await build();
  assert.ok(bytes > 100_000, `the bundle should be substantial (${bytes} bytes)`);
  assert.ok(!/<script[^>]+type="module"/i.test(html), 'no module scripts remain');
  assert.ok(!/<script[^>]*\bsrc\s*=/i.test(html), 'no externally referenced scripts remain');
  assert.ok(!/<link[^>]*rel="stylesheet"/i.test(html), 'css is inlined');

  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: false });
  const { window } = dom;

  let now = 1e6;
  const realPerformance = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', {
    value: { now: () => now },
    configurable: true,
    writable: true,
  });
  t.after(() => {
    Object.defineProperty(globalThis, 'performance', { value: realPerformance, configurable: true, writable: true });
  });

  window.HTMLCanvasElement.prototype.getContext = (type) => {
    const t2 = String(type);
    if (t2 === '2d') return make2DContext();
    if (t2.indexOf('webgl') === 0 || t2 === 'experimental-webgl') return FAKE_GL;
    return null;
  };

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

  const trackEl = window.document.querySelector('.track');
  assert.ok(trackEl, 'the track container survived the build');
  const TRACK = 8400;
  Object.defineProperty(trackEl, 'offsetHeight', { value: TRACK, configurable: true });
  const maxScroll = TRACK - window.innerHeight;

  let scrollY = 0;
  Object.defineProperty(window, 'scrollY', {
    get: () => scrollY,
    set: (v) => {
      scrollY = v;
    },
    configurable: true,
  });
  window.scrollTo = () => {};

  const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: DESKTOP_UA, maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8 },
    configurable: true,
    writable: true,
  });
  globalThis.window = window;
  globalThis.document = window.document;

  let queue = [];
  const raf = (cb) => queue.push(cb);
  const caf = () => {};
  // The bundle is evaluated inside window.eval, so its bare references resolve
  // against the jsdom window — not Node's globalThis.
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = caf;
  const pump = (frames) => {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      const pending = queue;
      queue = [];
      for (const cb of pending) cb();
      assert.ok(queue.length > 0, 'the bundled loop re-registers itself');
    }
  };

  /* ---- execute the inlined classic scripts, as a browser would ---- */
  const scripts = [...window.document.querySelectorAll('script')];
  assert.equal(scripts.length, 3, 'three scripts: three.js, postprocessing, bundle');
  assert.ok(
    scripts.every((s) => !s.type || s.type !== 'module'),
    'all three are classic scripts'
  );

  // Run them in order, pausing between to swap in the renderer stub — jsdom
  // runs scripts inline during parse, so there is no other hook.
  window.eval(scripts[0].textContent); // three.js
  assert.ok(window.THREE, 'three.js evaluated');
  window.eval(scripts[1].textContent); // postprocessing (bloom, optional)
  assert.ok(window.THREE.EffectComposer, 'postprocessing evaluated onto THREE');
  window.THREE.WebGLRenderer = class {
    constructor(p) {
      this.domElement = p.canvas;
      this.pixelRatio = 1;
      this.sortObjects = true;
      this.renderCount = 0;
    }
    setPixelRatio(v) {
      this.pixelRatio = v;
    }
    getPixelRatio() {
      return this.pixelRatio;
    }
    setSize() {}
    setClearColor() {}
    render() {
      this.renderCount++;
    }
    getContext() {
      return { getExtension: () => null };
    }
    dispose() {
      this.disposed = true;
    }
  };

  Object.defineProperty(window.document, 'readyState', { value: 'complete', configurable: true });
  window.eval(scripts[2].textContent); // the bundle

  // The bundle must show the title card before it builds the scene — that is
  // the lazy-load contract: static markup paints first, geometry after.
  assert.ok(window.document.querySelector('.hud-title'), 'title card present before the build');
  assert.equal(window.__goodGirl, undefined, 'the build is deferred, not run during parse');

  pump(2);
  assert.ok(window.document.documentElement.classList.contains('is-ready'), 'the bundle marked itself ready');

  /* ---- did it boot? ---- */
  const app = window.__goodGirl;
  assert.ok(app, 'the bundled app booted (no fallback taken)');
  assert.ok(window.THREE, 'three.js was loaded as a classic script');
  assert.equal(window.document.documentElement.classList.contains('no-webgl'), false);
  assert.equal(window.document.querySelector('.badge__title').textContent, 'GOOD GIRL');
  assert.ok(window.document.querySelectorAll('.phrase').length === 4);
  assert.ok(window.document.querySelector('.backdrop'), 'the backdrop layer survived');

  /* ---- play it forward ---- */
  const seek = (p, frames) => {
    window.scrollY = p * maxScroll;
    window.dispatchEvent(new window.Event('scroll'));
    pump(frames);
    return app.scroll.value;
  };

  assert.ok(seek(0.5, 300) > 0.45 && seek(0.5, 300) < 0.55, 'progress responds to scroll');
  // By mid-story she has walked toward the star. (The star itself does not
  // move until the pickup — it only leaves its pedestal during the reach.)
  assert.ok(
    app.internals.character.root.position.z > 0.5,
    `she has walked forward (z = ${app.internals.character.root.position.z})`
  );
  assert.equal(app.internals.star.rig.position.z, 1.32, 'the star still waits until the pickup');

  const end = seek(1, 320);
  assert.ok(end > 0.98, `reaches the end (${end})`);
  const gap = app.internals.star.rig.position.distanceTo(app.internals.character.handWorld());
  assert.ok(gap < 0.02, `the star reaches her palm (gap ${gap.toFixed(4)})`);

  const badge = window.document.querySelector('.badge-tilt').style.transform;
  const scale = Number(/scale\(([\d.]+)\)/.exec(badge)[1]);
  assert.ok(scale > 0.95, `the badge is presented (${scale})`);
  assert.ok(
    window.document.querySelector('.phrase[data-phrase="final"]').style.opacity > 0.9,
    'the reward line is readable'
  );

  /* ---- and back ---- */
  assert.ok(seek(0, 320) < 0.02, 'rewinds to the top');
  assert.equal(app.internals.star.getHeld(), 0, 'the star returns to its pedestal');
  assert.equal(window.document.querySelector('.badge-wrap').style.display, 'none', 'the badge hides again');

  assert.doesNotThrow(() => app.dispose());
});
