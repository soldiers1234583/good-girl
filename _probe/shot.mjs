import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
const exe = execSync('command -v chromium-browser', { encoding: 'utf8' }).trim();
function png(input) {
  const buf = Buffer.from(input); let off = 8, w = 0, h = 0, colorType = 0, depth = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off+4, off+8);
    const d = buf.subarray(off+8, off+8+len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; colorType = d[9]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch; const out = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride); let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++]; const row = raw.subarray(pos, pos+stride); pos += stride;
    const cur = out.subarray(y*stride, (y+1)*stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x-ch] : 0, b = prev[x], cc = x >= ch ? prev[x-ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a+b)>>1;
      else if (f === 4) { const p = a+b-cc, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-cc); v += pa<=pb&&pa<=pc?a:pb<=pc?b:cc; }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  let yellow = 0, blue = 0, white = 0, other = 0;
  const n = w*h;
  for (let i = 0; i < n; i++) {
    const R = out[i*ch], G = out[i*ch+1], B = out[i*ch+2];
    if (R > 200 && G > 200 && B < 80) yellow++;
    else if (B > 200 && R < 80 && G < 80) blue++;
    else if (R > 200 && G > 200 && B > 200) white++;
    else other++;
  }
  return { w, h, yellow, blue, white, other, yellowPct: +(yellow*100/n).toFixed(1) };
}
for (const v of ['1','2']) {
  const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'], headless: true, protocolTimeout: 60000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
  await page.goto(`file://${resolve('_probe/drawshot.html')}?v=${v}`, { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  const st = await page.evaluate(() => window.__probe);
  const shot = await page.screenshot({ path: `_probe/drawshot-webgl${v}.png` });
  console.log(`webgl${v}: ${JSON.stringify(st)}  pixels=${JSON.stringify(png(shot))}`);
  await browser.close();
}
