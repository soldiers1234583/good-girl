/**
 * Minimal WebDriver client (W3C) over Node's built-in fetch — no npm deps.
 *
 * Drives the locally-extracted Firefox + geckodriver. Used to establish whether
 * ANY renderer on this device can rasterise WebGL, and — once it can — to run
 * the visual regression: scroll to each beat, read uniforms, screenshot.
 *
 * Usage: node _probe/wd.mjs <file:// url> [label]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FF = resolve(ROOT, '_env/ff/data/data/com.termux/files/usr/lib/firefox/firefox');
const GK = resolve(ROOT, '_env/gk/data/data/com.termux/files/usr/bin/geckodriver');
const PORT = 4446;
const BASE = `http://127.0.0.1:${PORT}`;

const target = process.argv[2];
const label = process.argv[3] || 'probe';

/* --- PNG decode (same reader the harness uses) --- */
function pngStats(input) {
  const buf = Buffer.from(input);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const row = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  let r = 0, g = 0, b = 0, blown = 0, yellow = 0, white = 0, maxLum = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const R = out[i * ch], G = out[i * ch + 1], B = out[i * ch + 2];
    r += R; g += G; b += B;
    const l = Math.max(R, G, B);
    if (l > 250) blown++;
    if (l > maxLum) maxLum = l;
    if (R > 200 && G > 200 && B < 80) yellow++;
    if (R > 200 && G > 200 && B > 200) white++;
  }
  return {
    w, h,
    meanR: +(r / n).toFixed(1), meanG: +(g / n).toFixed(1), meanB: +(b / n).toFixed(1),
    blownPct: +((blown / n) * 100).toFixed(2),
    yellow, white, maxLum,
  };
}

/* --- geckodriver --- */
const driver = spawn(GK, ['--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
const driverLog = [];
driver.stdout.on('data', (d) => driverLog.push(String(d)));
driver.stderr.on('data', (d) => driverLog.push(String(d)));

async function waitForDriver(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/status`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('geckodriver did not become ready');
}

const call = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j.value || j).slice(0, 400)}`);
  return j.value;
};

let sessionId = null;
try {
  const status = await waitForDriver();
  console.log(`[wd] geckodriver ready: ${JSON.stringify(status.value).slice(0, 200)}`);

  const session = await call('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          binary: FF,
          args: ['-headless', '-width', '640', '-height', '400'],
          // Firefox refuses WebGL in headless mode by default (getContext
          // returns null). These prefs are the documented way to enable a
          // software WebGL backend under `-headless`.
          prefs: {
            'webgl.disabled': false,
            'webgl.force-enabled': true,
            'webgl.software': true,
            'gfx.webrender.software': true,
            'layers.acceleration.disabled': true,
          },
        },
      },
    },
  });
  sessionId = session.sessionId;
  console.log(`[wd] session ${sessionId.slice(0, 8)}… caps=${JSON.stringify(session.capabilities).slice(0, 240)}`);

  if (target) {
    await call('POST', `/session/${sessionId}/url`, { url: target });
    await new Promise((r) => setTimeout(r, 4000));

    let probe = null;
    try {
      probe = await call('POST', `/session/${sessionId}/execute/sync`, { script: 'return window.__probe;', args: [] });
    } catch (e) { console.log(`[wd] no __probe: ${e.message}`); }

    const shotB64 = await call('GET', `/session/${sessionId}/screenshot`);
    mkdirSync(join(ROOT, '_shots', label), { recursive: true });
    const pngPath = join(ROOT, '_shots', label, 'firefox.png');
    writeFileSync(pngPath, Buffer.from(shotB64, 'base64'));
    const st = pngStats(Buffer.from(shotB64, 'base64'));
    console.log(`[wd] probe  = ${JSON.stringify(probe)}`);
    console.log(`[wd] pixels = ${JSON.stringify(st)}  ->  ${pngPath}`);
  }
} catch (e) {
  console.error(`[wd] FAILED: ${e.message}`);
  process.exitCode = 2;
} finally {
  if (sessionId) await call('DELETE', `/session/${sessionId}`).catch(() => {});
  driver.kill('SIGTERM');
}
