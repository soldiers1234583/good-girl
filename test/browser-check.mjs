/**
 * Real-browser verification — screenshots, console/WebGL error capture,
 * uniform probes and pixel probes through the whole timeline.
 *
 * Run:
 *   node test/browser-check.mjs ./_baseline/dist/index.html baseline
 *   node test/browser-check.mjs ./dist/index.html after
 *
 * Why it exists: the jsdom harness stubs WebGLRenderer, so shader compilation
 * and actual pixels are only observable in a real (even if software-rendered)
 * browser. This device has no GUI, so we drive Termux Chromium headlessly via
 * puppeteer-core.
 *
 * Three findings this harness is built around (each cost real debugging):
 *   1. A software-renderer string would (correctly) send the site down its
 *      no-WebGL fallback, so a CDP-injected shim hides ONLY the
 *      WEBGL_debug_renderer_info extension. It must patch BOTH WebGL
 *      prototypes — Chrome flattens the IDL mixin, so WebGL2 carries its own
 *      getExtension. Puppeteer's evaluateOnNewDocument runs in an isolated
 *      world (v25) and never reaches page prototypes; Page.addScriptTo-
 *      EvaluateOnNewDocument on a CDP session does.
 *   2. THIS DEVICE'S RASTERISER CANNOT DRAW. Proven by bisection, not guessed:
 *        - a raw `gl.clear` + readPixels round-trips perfectly ([115,20,161,255]);
 *        - drawing one triangle gives [0,0,0,0] — linked program, valid
 *          attrib location, glGetError() === 0, and even the cleared alpha is
 *          gone. Nothing rasterises.
 *      Context attributes, drawing-buffer size, preset flags (7 sets incl.
 *      `--disable-gpu-watchdog`), headless vs `headless_shell`, the default
 *      framebuffer, a three.js WebGLRenderTarget, and readPixels itself were
 *      each eliminated as the cause. So three.js renders nothing here, the
 *      compositor's read sees an invalid canvas, and THAT is what makes the
 *      context churn ("GPU stall due to ReadPixels" is a downstream symptom).
 *      A minimal one-cube three.js scene fails identically to this app and to
 *      the pre-shader baseline, so none of it implicates the shader work.
 *
 *      Consequence: SCREENSHOTS AND PIXEL STATISTICS ARE IMPOSSIBLE HERE, but
 *      compiling and uniform upload are not. That is why the real evidence
 *      below is PROGRAM-LEVEL (reading the fragment source back off each
 *      compiled WebGLProgram) and UNIFORM-LEVEL (reading values back off the
 *      materials) rather than pixel-level. The screenshot path is retained and
 *      reported as BLOCKED, never as a pass.
 *   3. Frame rates here mean nothing (software rasteriser); this script
 *      deliberately does not report FPS as a performance result.
 *
 * Finding 1 has a consequence for reporting. When the context is dead the
 * screenshot does not contain the app's output at all, so every pixel-derived
 * check is UNTESTABLE rather than failed — and a device-side GPU meltdown must
 * not be reported as an app regression. This script therefore keeps two kinds
 * of red apart and exits differently for each:
 *
 *   failures  product problems (bad uniform, shader compile error, console
 *             error, an unexpected fallback)                     → exit 1
 *   blocked   precondition absent on this device (pixel checks when the GL
 *             context was lost at capture)                     → exit 2
 *   neither   everything that could run, passed                → exit 0
 *
 * Blocked checks are printed explicitly. They are never reported as passes.
 * The report block runs even if an earlier step throws, so a harness timeout
 * can no longer swallow the console/shader evidence.
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const target = resolve(process.argv[2] || join(ROOT, 'dist', 'index.html'));
const label = process.argv[3] || 'after';
const outDir = join(ROOT, '_shots', label);
mkdirSync(outDir, { recursive: true });

const executablePath =
  process.env.CHROME_PATH ||
  (() => {
    for (const bin of ['chromium-browser', 'chromium', 'headless_shell']) {
      try {
        return execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim();
      } catch {
        /* next */
      }
    }
    throw new Error('no chromium binary found (pkg install chromium)');
  })();

/** Flag sets tried in order until a WebGL context actually appears. */
const FLAG_SETS = [
  ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
];

const BEATS = [
  { p: 0.0, name: '00-intro' },
  { p: 0.35, name: '10-approach' },
  { p: 0.65, name: '20-contact' },
  { p: 0.76, name: '30-reaction' },
  { p: 0.97, name: '40-reward' },
  { p: 0.2, name: '50-scrub-back' },
];

const failures = [];
const blocked = [];
const notes = [];
// Hoisted so the report block at the bottom can run (and print) after any
// exception.
const states = [];
const consoleLines = [];

/** CDP-injected main-world shim — see findings note 1 at the top of the file. */
const SHIM = `(() => {
  const patched = [];
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    let p = ctor && ctor.prototype;
    while (p) {
      const d = Object.getOwnPropertyDescriptor(p, 'getExtension');
      if (d && typeof d.value === 'function') {
        if (!patched.includes(p)) {
          patched.push(p);
          const orig = d.value;
          p.getExtension = function (name) {
            if (name === 'WEBGL_debug_renderer_info') return null;
            return orig.call(this, name);
          };
        }
        break;
      }
      p = Object.getPrototypeOf(p);
    }
  }
})();`;

/**
 * A fresh page (shimmed, console-capturing, viewport set) in the given browser.
 * Each browser gets its own GPU process; SwiftShader on this device survives
 * roughly two navigations per process, which is why the reduced-motion pass
 * below runs in a second browser rather than reloading this one a third time.
 */
async function setupPage(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SHIM });
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
  return page;
}
const fail = (msg) => failures.push(msg);
const blockedCheck = (msg) => blocked.push(msg);
const note = (msg) => notes.push(msg);

/* ------------------------------------------------------------------ */
/* Minimal PNG reader (8-bit, non-interlaced, RGB/RGBA — what Chrome    */
/* screenshots are). Pure Node: inflate + scanline unfilter.            */
/* ------------------------------------------------------------------ */
function pngStats(input) {
  const buf = Buffer.from(input); // puppeteer 25 returns Uint8Array
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: depth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  let r = 0, g = 0, b = 0, blown = 0, maxLum = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const R = out[i * ch], G = out[i * ch + 1], B = out[i * ch + 2];
    r += R; g += G; b += B;
    const l = R > G ? (R > B ? R : B) : G > B ? G : B;
    if (l > 250) blown++;
    if (l > maxLum) maxLum = l;
  }
  return {
    w, h,
    meanR: +(r / n).toFixed(1),
    meanG: +(g / n).toFixed(1),
    meanB: +(b / n).toFixed(1),
    blownPct: +((blown / n) * 100).toFixed(2),
    maxLum,
  };
}

/* ------------------------------------------------------------------ */

async function launchWithWebGL() {
  for (const args of FLAG_SETS) {
    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath,
        args,
        headless: true,
        protocolTimeout: 60_000,
      });
      const page = await browser.newPage();
      const support = await page.evaluate(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return { ok: false };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          ok: true,
          version: String(gl.getParameter(gl.VERSION)),
          renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '(hidden)',
        };
      });
      await browser.close();
      if (support.ok) return { args, support };
      note(`flags ${JSON.stringify(args)} → no WebGL context, trying next`);
    } catch (err) {
      note(`flags ${JSON.stringify(args)} → launch failed: ${err.message.split('\n')[0]}`);
      if (browser) await browser.close().catch(() => {});
    }
  }
  throw new Error('no flag set produced a WebGL context');
}

/**
 * SwiftShader on this device loses the WebGL context shortly after boot (and
 * again after compositing readbacks), but three r128 fully re-initialises on
 * `webglcontextrestored`. So before every capture: if the context is gone,
 * poke WEBGL_lose_context.restoreContext() and give three a few frames.
 */
async function ensureContext(page) {
  for (let i = 0; i < 5; i++) {
    const state = await page.evaluate(() => {
      const gl = window.__goodGirl.stage.renderer.getContext();
      if (!gl.isContextLost()) return 'ok';
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'no-ext';
      try {
        ext.restoreContext();
        return 'restoring';
      } catch (e) {
        return 'threw:' + e.message;
      }
    });
    if (state === 'ok') return true;
    await new Promise((r) => setTimeout(r, 800));
    note(`context ${state} → waiting for three to re-init (${i + 1}/5)`);
  }
  return false;
}

async function seek(page, p) {
  await page.evaluate((target_p) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, target_p * max);
  }, p);
  await page.waitForFunction(
    (t) => {
      const app = window.__goodGirl;
      return app && Math.abs(app.scroll.value - t) < 0.015;
    },
    { timeout: 12_000, polling: 120 },
    p
  );
  // A few extra frames so damped values (lights, wash, springs) settle.
  await new Promise((r) => setTimeout(r, 450));
}

/** GL health without any readback (readPixels kills SwiftShader here). */
function glState() {
  const app = window.__goodGirl;
  const gl = app.stage.renderer.getContext();
  return {
    lost: gl.isContextLost(),
    err: gl.getError(),
    programs: app.stage.renderer.info.programs.length,
  };
}

/**
 * Read the fragment source back off every COMPILED program.
 *
 * This is the strongest check this device allows: rasterisation is broken, but
 * compilation is not, so this proves which shaders actually made it into real
 * GPU programs — including the fresnel tail three injects into the built-in
 * materials via onBeforeCompile, which no uniform readback could confirm.
 *
 * It POLLS INTERNALLY: gl.getShaderSource is rejected while the context is
 * lost (which it usually is here), so waiting from Node between separate
 * evaluates would race against the restore. Awaiting inside the page keeps the
 * check and its precondition in the same turn.
 *
 * Needles must be unique to one shader. (`aT` was tried for the trail and
 * matched 23/23 programs — substrings are a trap; `uFade` is used instead.)
 */
async function programInspection() {
  const app = window.__goodGirl;
  const gl = app.stage.renderer.getContext();
  const progs = (app.stage.renderer.info.programs || []).slice();
  const needle = {
    sky: 'vnoise', // only BG_FRAG
    star: 'uTint', // only the star material
    trail: 'uFade', // only TRAIL_FRAG
    rim: 'uRimStrength', // only the injected fresnel block
    rimTail: 'rimF', // the injected tail itself
    low: '#define LOW', // tier-0 sky variant
  };
  const collect = () => {
    const tags = {};
    let readSources = 0;
    let bytes = 0;
    // On this build three's wrapper NEVER carries the source as a string —
    // measured with a live context: `typeof p.fragmentShader === 'string'` was
    // false for all 23 programs. The ONLY working path is reading it off the
    // attached GL shader objects, so that is the primary path here, not a
    // fallback. It requires a live context; getAttachedShaders on a lost one
    // logs "object does not belong to this context", so skip when lost.
    const lost = gl.isContextLost();
    for (const p of progs) {
      let src = typeof p.fragmentShader === 'string' ? p.fragmentShader : '';
      if (!src && !lost && p.program) {
        try {
          for (const s of gl.getAttachedShaders(p.program) || []) {
            const t = gl.getShaderSource(s) || '';
            if (t.includes('void main')) src += t;
          }
        } catch (e) {
          /* not readable on this program */
        }
      }
      if (!src) continue;
      readSources++;
      bytes += src.length;
      for (const k of Object.keys(needle)) {
        if (src.includes(needle[k])) tags[k] = (tags[k] || 0) + 1;
      }
    }
    return { tags, readSources, bytes };
  };

  // One shot, synchronously — the exact shape of the standalone probe that
  // demonstrably read all 23 sources. Polling from inside the page did NOT help
  // (three never restored while the loop held the task queue), so the retry
  // lives in Node, one fresh browser per attempt.
  //
  // Deliberately NOT gated on `isContextLost()`: the sources are plain JS
  // strings on three's wrappers, so if they survive a loss they are still worth
  // reading. `alive` is reported for diagnosis only — an earlier version gated
  // the read on it and threw away readable output.
  const r = progs.length ? collect() : { tags: {}, readSources: 0, bytes: 0 };
  return { programs: progs.length, alive: !gl.isContextLost(), tier: app.state().device.quality.tier, ...r };
}

function readState() {
  const app = window.__goodGirl;
  // Tolerate the baseline build, which has no shader system yet.
  const sh = app.internals.shaders;
  const u = sh && sh.shared;
  const post = app.internals.post;
  const trail = app.internals.trail;
  const bg = app.internals.background;
  const star = app.internals.star;
  // Read the SAME uniform back off the actual materials, not just off the
  // controller: this is what proves the shared objects really reached the
  // compiled shaders (and that reduced motion froze them there too).
  const matTime = (obj) => {
    const u = obj && obj.material && obj.material.uniforms && obj.material.uniforms.uTime;
    return u ? +u.value.toFixed(2) : null;
  };
  // Read a vec3 colour uniform off a material and return 0..255-ish triples.
  const colTriple = (obj, name = 'uColorA') => {
    const u = obj && obj.material && obj.material.uniforms && obj.material.uniforms[name];
    if (!u || !u.value) return null;
    const c = u.value;
    return [+c.r.toFixed(3), +c.g.toFixed(3), +c.b.toFixed(3)];
  };
  return {
    bgTime: matTime(bg && bg.mesh),
    // star.spin.children[0] is the star body mesh carrying the shared uniforms
    starTime: matTime(star && star.spin ? star.spin.children[0] : null),
    // The sky's colour pair: the Reimagined-style journey reaching the shader.
    skyA: colTriple(bg && bg.mesh),
    skyB: colTriple(bg && bg.mesh, 'uColorB'),
    progress: +app.scroll.value.toFixed(3),
    uTime: u ? +u.uTime.value.toFixed(2) : null,
    uProgress: u ? +u.uProgress.value.toFixed(3) : null,
    uIntensity: u ? +u.uIntensity.value.toFixed(3) : null,
    uReveal: u ? +u.uReveal.value.toFixed(3) : null,
    uInteraction: u ? +u.uInteraction.value.toFixed(3) : null,
    uResolution: u ? `${u.uResolution.value.x}x${u.uResolution.value.y}` : null,
    postEnabled: post ? post.enabled : null,
    tier: app.state().device.quality.tier,
    mobile: app.state().device.isMobile,
    trailVisible: trail ? trail.points.visible : null,
    badgeShown: !!window.document.querySelector('.badge__title'),
    noWebglClass: document.documentElement.classList.contains('no-webgl'),
  };
}

const { args, support } = await launchWithWebGL();
note(`webgl: ${support.version} via ${support.renderer}`);
note(`flags: ${args.join(' ')}`);
if (!existsSync(target)) throw new Error(`target not found: ${target}`);


/* ------------------------------------------------------------------ */
/* Program-source pass — its own browser, own GPU process.             */
/*                                                                     */
/* gl.getShaderSource is rejected while the context is lost, and in    */
/* the main pass above the context is already gone at boot. A fresh    */
/* browser at a smaller viewport reliably starts alive (that is how    */
/* this check was first made to work), so the inspection gets its own  */
/* process and its own polling window.                                 */
/*                                                                     */
/* What it proves: which shaders actually reached real GPU programs —  */
/* including the fresnel tail three injects into the built-in          */
/* materials, which no uniform readback in JS could confirm.           */
/* ------------------------------------------------------------------ */
if (label === 'after') {
  // RETRIED on purpose. Whether this device's context happens to be alive at
  // any given moment is a coin flip (measured: one run read all 23 sources,
  // the next read 0), so a single attempt would report a false result half the
  // time. Each attempt gets a fresh browser, hence a fresh GPU process. If
  // every attempt misses, it is reported BLOCKED — never as a pass.
  const ATTEMPTS = 5;
  let insp = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let progBrowser = null;
    try {
      progBrowser = await puppeteer.launch({
        executablePath,
        args,
        headless: true,
        protocolTimeout: 120_000,
      });
      const progPage = await setupPage(progBrowser, { width: 800, height: 600, deviceScaleFactor: 1 });
      await progPage.goto(`file://${target}`, { waitUntil: 'load', timeout: 60_000 });
      await progPage.waitForFunction(() => window.__goodGirl !== undefined, { timeout: 30_000 });
      // Settle first — three restores the context in the first second or two.
      await new Promise((r) => setTimeout(r, 2500));
      const got = await progPage.evaluate(programInspection);
      note(
        `program sources (attempt ${attempt}/${ATTEMPTS}): ${got.readSources}/${got.programs} readable, ` +
          `alive=${got.alive}, bytes=${got.bytes}, tags=${JSON.stringify(got.tags)}`
      );
      if (!insp || got.readSources > insp.readSources) insp = got;
      if (insp.readSources >= insp.programs) break;
    } catch (err) {
      note(`program-source attempt ${attempt} failed: ${String(err.message || err).split('\n')[0]}`);
    } finally {
      if (progBrowser) await progBrowser.close().catch(() => {});
    }
  }

  if (!insp) {
    fail('program-source pass never ran');
  } else {
    if (insp.programs < 20) fail(`only ${insp.programs} GPU programs compiled (expected 20+)`);
    if (insp.readSources < insp.programs) {
      blockedCheck(
        `read ${insp.readSources}/${insp.programs} program sources in ${ATTEMPTS} attempts — ` +
          'GL shader-source reads need a live context and this device rarely has one'
      );
    } else {
      if (!insp.tags.rim) fail('the fresnel rim never reached a compiled program');
      if (insp.tags.rim !== insp.tags.rimTail) fail('rim injected without its tail (or vice versa)');
      if (!insp.tags.sky) fail('the sky shader did not compile into a program');
      if (!insp.tags.star) fail('the star shader did not compile into a program');
      if (!insp.tags.trail) fail('the energy-trail shader did not compile into a program');
      if (insp.tags.sky > 2) fail(`sky shader in ${insp.tags.sky} programs — expected 1 (2 with a LOW variant)`);
      // Tier gating, against the tier this browser actually booted at.
      const tier0 = insp.tier === 0;
      if (tier0 && !insp.tags.low) fail('tier-0 sky compiled WITHOUT the LOW define');
      if (!tier0 && insp.tags.low) fail(`LOW define present at tier ${insp.tier} — quality gate is wrong`);
      note(
        `program tags VERIFIED: rim=${insp.tags.rim} sky=${insp.tags.sky} ` +
          `star=${insp.tags.star} trail=${insp.tags.trail} low=${insp.tags.low || 0} (tier ${insp.tier})`
      );
    }
  }
}

const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };

const browser = await puppeteer.launch({
  executablePath,
  args,
  headless: true,
  protocolTimeout: 120_000,
});

let page = null;
try {
  page = await setupPage(browser, DESKTOP);

  await page.goto(`file://${target}`, { waitUntil: 'load', timeout: 60_000 });
  try {
    await page.waitForFunction(() => window.__goodGirl !== undefined, { timeout: 30_000 });
  } catch (err) {
    const diag = await page
      .evaluate(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return {
          cls: document.documentElement.className,
          shimActive: dbg === null,
          hasApp: window.__goodGirl !== undefined,
          hasFallback: !!document.querySelector('.fallback'),
          hasThree: !!window.THREE,
        };
      })
      .catch((e) => ({ err: String(e) }));
    console.log(`boot timed out. diag: ${JSON.stringify(diag)}`);
    for (const l of consoleLines) console.log('  ' + l);
    throw err;
  }
  await new Promise((r) => setTimeout(r, 600));

  const boot = await page.evaluate(readState);
  const bootGl = await page.evaluate(glState);
  note(`boot state: ${JSON.stringify(boot)}`);
  note(`boot gl: ${JSON.stringify(bootGl)}`);
  if (boot.noWebglClass) fail('site fell back to no-webgl path despite a working context');
  if (label === 'after' && boot.postEnabled !== true) note('bloom NOT active (tier/feature gate)');
  if (bootGl.programs < 5) fail(`suspiciously few GPU programs compiled (${bootGl.programs})`);

  // Inspect the compiled programs HERE, right after boot, and RETRY until the
  // context happens to be alive: shader-source reads are rejected while the
  // context is lost (which it frequently already is at boot on this device),
  // and three replaces its WebGLProgram wrappers during a restore. Without the
  // retry this check produces false failures that say nothing about the code.
  // Program-source inspection happens in its OWN browser further down: it needs
  // a live context, and the one this page gets is already gone at boot.

  let lostSeen = 0;
  let restoreFails = 0;
  for (const beat of BEATS) {
    await seek(page, beat.p);
    const alive = await ensureContext(page);
    if (!alive) restoreFails++;
    const state = await page.evaluate(readState);
    const gl = await page.evaluate(glState);
    if (gl.lost) lostSeen++;
    const shot = await page.screenshot({ path: join(outDir, `${beat.name}.png`) });
    const pixels = pngStats(shot);
    states.push({ beat: beat.name, ...state, gl, pixels });
  }
  if (lostSeen) note(`GL context was lost on ${lostSeen}/${BEATS.length} beats despite restore attempts (SwiftShader churn)`);
  if (restoreFails) blockedCheck(`context could not be restored on ${restoreFails} beats — those screenshots are blank`);

  const st = (name) => states.find((s) => s.beat === name);

  // ---- colour journey from real pixels. Valid for BOTH runs: the baseline
  //      paints its sky with CSS, the shader build with the sky quad.
  //
  //      These assert on the SCREENSHOT, so they are only meaningful if the
  //      screenshot really holds the app's output. A dead SwiftShader context
  //      paints the canvas blank-white (finding 2). Rather than let a white
  //      capture pass, or blame the app for the device's GPU, route them to
  //      `blocked` when the context was lost and note it loudly.
  const contextLostAtCapture = states.some((s) => s.gl.lost);
  const pxAssert = (ok, msg) => {
    if (ok) return;
    if (contextLostAtCapture) blockedCheck(`(pixel) ${msg} [GL context lost at capture — frame is not the app's output]`);
    else fail(msg);
  };
  if (contextLostAtCapture) {
    note('pixel assertions downgraded to BLOCKED: the GL context was lost at capture');
  }

  const intro = st('00-intro');
  const reward = st('40-reward');
  const reaction = st('30-reaction');
  // A lost context paints the canvas blank-white; catch that explicitly so a
  // white screenshot can never masquerade as a pass.
  pxAssert(
    !(intro.pixels.meanR > 200 && intro.pixels.meanB > 200),
    `intro screenshot is white-washed (mean [${intro.pixels.meanR},${intro.pixels.meanG},${intro.pixels.meanB}])`
  );
  pxAssert(intro.pixels.meanB > intro.pixels.meanR, `intro should read blue (R${intro.pixels.meanR} B${intro.pixels.meanB})`);
  pxAssert(reward.pixels.meanR > reward.pixels.meanB, `reward should read warm (R${reward.pixels.meanR} B${reward.pixels.meanB})`);
  pxAssert(intro.pixels.blownPct <= 5, `intro has ${intro.pixels.blownPct}% blown pixels — highlights clip`);
  pxAssert(reaction.pixels.maxLum >= 200, `star should be bright at reaction peak (maxLum ${reaction.pixels.maxLum})`);

  // ---- COLOUR-JOURNEY assertions (after-run only) ---------------------
  //
  // This replaces what the pixel checks were meant to establish. It needs no
  // rasterisation: it reads the colours actually uploaded to the sky shader.
  if (label === 'after') {
    // ---- the colour journey, off the sky material's own uniforms -------
    // The pixel check wanted "intro reads blue, reward reads warm". Rendered
    // pixels are unavailable, so assert it at the last link that is: the
    // colours actually uploaded to the sky shader at each beat.
    const lum = (c) => (c ? c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 : null);
    const iA = st('00-intro').skyA;
    const rA = st('40-reward').skyA;
    const rB = st('40-reward').skyB;
    if (!iA || !rA) {
      fail('sky colour uniforms not readable off the material');
    } else {
      if (!(iA[2] > iA[0])) fail(`intro sky should be blue-dominant (got ${iA})`);
      if (!(rA[0] > rA[2])) fail(`reward sky should be warm (got ${rA})`);
      if (!(rB[0] >= rB[2])) fail(`reward sky outer should be warm (got ${rB})`);
      const introL = lum(iA), rewardL = lum(rA);
      if (!(rewardL > introL)) fail(`reward sky should be brighter than intro (${introL} vs ${rewardL})`);
      // Scrubbing back must rewind the colours too.
      const backA = st('50-scrub-back').skyA;
      if (!(backA[2] > backA[0])) fail(`scrubbed-back sky should be blue again (got ${backA})`);
      note(`sky journey: intro=${iA} → reward=${rA} → back=${backA}`);
    }
  }

  // ---- shader-system assertions (after-run only) ----
  if (label === 'after') {
    if (Math.abs(st('00-intro').uProgress) > 0.05) fail('uProgress not near 0 at intro');
    if (st('00-intro').uInteraction > 0.1) fail('uInteraction should be ~0 at intro');
    if (st('20-contact').uInteraction < 0.3) fail(`uInteraction should rise at contact (got ${st('20-contact').uInteraction})`);
    if (st('30-reaction').uIntensity < 1.2) fail(`uIntensity should peak at reaction (got ${st('30-reaction').uIntensity})`);
    if (st('40-reward').uReveal < 0.5) fail(`uReveal should be high at reward (got ${st('40-reward').uReveal})`);
    if (st('50-scrub-back').uReveal > 0.1) fail('scrubbing back did not rewind uReveal');
    if (st('50-scrub-back').trailVisible) fail('trail should be hidden after scrubbing back');
    const progresses = states.map((s) => s.uProgress);
    if (new Set(progresses).size < 4) fail('uProgress did not vary across beats');

    // Mobile viewport + orientation.
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 700));
    await seek(page, 0.65);
    await ensureContext(page);
    const mobShot = await page.screenshot({ path: join(outDir, '60-mobile-portrait.png') });
    const mobPx = pngStats(mobShot);
    const mobState = await page.evaluate(readState);
    if (mobState.noWebglClass) fail('mobile viewport triggered the no-webgl fallback');
    if (mobPx.h < mobPx.w) fail('portrait screenshot came out landscape?');
    note(`mobile portrait px: ${mobPx.w}x${mobPx.h} mean=[${mobPx.meanR},${mobPx.meanG},${mobPx.meanB}]`);

    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 700));
    await ensureContext(page);
    await page.screenshot({ path: join(outDir, '61-mobile-landscape.png') });
    const orientGl = await page.evaluate(glState);
    if (orientGl.err !== 0 && !orientGl.lost) fail(`orientation change left gl error ${orientGl.err}`);

  }
} catch (err) {
  // Never let an exception hide the evidence collected so far.
  fail(`harness stopped early: ${String(err.message || err).split('\n')[0]}`);
} finally {
  await browser.close();
}

/* ------------------------------------------------------------------ */
/* Reduced-motion pass — its own browser.                              */
/*                                                                     */
/* It needs a fresh document, and the restore loop above leaves the    */
/* software GPU past the point where a further navigation can acquire  */
/* a context at all (observed: no-webgl fallback + `freshContext:      */
/* false`, on a device where the identical reload boots in a fresh     */
/* browser). A second process keeps the check real instead of skipped. */
/* ------------------------------------------------------------------ */
if (label === 'after') {
  let rmBrowser = null;
  try {
    rmBrowser = await puppeteer.launch({
      executablePath,
      args,
      headless: true,
      protocolTimeout: 120_000,
    });
    const rmPage = await setupPage(rmBrowser, DESKTOP);
    await rmPage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await rmPage.goto(`file://${target}`, { waitUntil: 'load', timeout: 60_000 });
    await rmPage.waitForFunction(() => window.__goodGirl !== undefined, { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 700));
    const rmState = await rmPage.evaluate(readState);
    note(`reduced-motion boot: ${JSON.stringify(rmState)}`);
    if (rmState.noWebglClass) fail('reduced-motion boot fell back to no-webgl');
    if (rmState.uTime !== 0) fail(`reduced motion must freeze uTime (got ${rmState.uTime})`);
    if (rmState.bgTime !== 0) fail(`reduced motion must freeze the sky shader (got ${rmState.bgTime})`);
    if (rmState.trailVisible) fail('reduced motion should not draw the energy trail');
    await rmPage.screenshot({ path: join(outDir, '70-reduced-motion.png') });
  } catch (err) {
    const why = String(err.message || err).split('\n')[0];
    fail(`reduced-motion pass failed: ${why}`);
  } finally {
    if (rmBrowser) await rmBrowser.close().catch(() => {});
  }
}
/* ------------------------------------------------------------------ */
/* Report — outside the try, so it always runs.                        */
/* ------------------------------------------------------------------ */

// ---- console verdict ----
// Precise markers only: three's own compile-failure format. Loose patterns
// like /gl_/ false-positive on GL_CLOSE_PATH_NV driver chatter.
const errors = consoleLines.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
const shaderNoise = consoleLines.filter((l) =>
  /THREE\.WebGLProgram|Shader Error|NOT_COMPILED|^ERROR: \d|framebuffer incomplete|INVALID_(ENUM|VALUE|OPERATION)/i.test(l)
);
const benign = /GPU stall due to ReadPixels|CONTEXT_LOST_WEBGL|Context Lost|Context Restored|GL Driver Message/i;
const realErrors = errors.filter((l) => !benign.test(l));
for (const e of realErrors) fail(`console: ${e}`);
for (const s of shaderNoise) fail(`shader/console noise: ${s}`);
if (consoleLines.length) note(`console captured ${consoleLines.length} lines (${realErrors.length} real errors)`);

console.log(`\n=== browser-check [${label}] ${target} ===`);
for (const n of notes) console.log(`  note: ${n}`);
for (const s of states) {
  const px = `px=[${s.pixels.meanR},${s.pixels.meanG},${s.pixels.meanB}] blown=${s.pixels.blownPct}% max=${s.pixels.maxLum}`;
  const uni =
    s.uProgress === null
      ? ''
      : ` uP=${s.uProgress} uI=${s.uIntensity} uR=${s.uReveal} uX=${s.uInteraction} trail=${s.trailVisible}`;
  console.log(`  ${s.beat}: p=${s.progress}${uni} progs=${s.gl.programs} lost=${s.gl.lost} ${px}`);
}

if (failures.length) {
  console.log('\nFAILURES (product):');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exitCode = 1;
}
if (blocked.length) {
  console.log('\nBLOCKED — could not be tested on this device (NOT passes):');
  for (const b of blocked) console.log(`  ⚠ ${b}`);
  if (!process.exitCode) process.exitCode = 2;
}
if (!failures.length && !blocked.length) console.log('\nALL BROWSER CHECKS PASSED');
console.log(`screenshots: ${outDir}`);
