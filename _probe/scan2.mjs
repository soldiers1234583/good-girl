import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
const exe = execSync('command -v chromium-browser', { encoding: 'utf8' }).trim();
const U = '--enable-unsafe-swiftshader';
const SETS = [
  { n: 'angle+swiftshader +unsafe', args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader',U] },
  { n: 'swiftshader-webgl +unsafe', args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader-webgl',U] },
  { n: 'swiftshader-webgl alone',    args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader-webgl'] },
  { n: 'angle+swiftshader alone',    args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader'] },
  { n: 'egl +unsafe',                args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=egl',U] },
  { n: 'angle gl-egl +unsafe',       args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=gl-egl',U] },
];
function png(input) {
  const buf = Buffer.from(input); let off = 8, w = 0, h = 0, ct = 0, dp = 0; const idat = [];
  while (off < buf.length) { const len = buf.readUInt32BE(off); const t = buf.toString('ascii', off+4, off+8); const d = buf.subarray(off+8, off+8+len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); dp = d[8]; ct = d[9]; } else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break; off += 12 + len; }
  const ch = ct === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat));
  const stride = w*ch; const out = Buffer.alloc(h*stride); let prev = Buffer.alloc(stride); let pos = 0;
  for (let y = 0; y < h; y++) { const f = raw[pos++]; const row = raw.subarray(pos, pos+stride); pos += stride; const cur = out.subarray(y*stride, (y+1)*stride);
    for (let x = 0; x < stride; x++) { const a = x>=ch?cur[x-ch]:0, b = prev[x], cc = x>=ch?prev[x-ch]:0; let v = row[x];
      if (f===1) v+=a; else if (f===2) v+=b; else if (f===3) v+=(a+b)>>1; else if (f===4){const p=a+b-cc,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-cc);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:cc;}
      cur[x]=v&0xff; } prev=cur; }
  let y0=0,b0=0,w0=0,o=0,rSum=0,gSum=0,blSum=0; const n=w*h;
  for (let i=0;i<n;i++){const R=out[i*ch],G=out[i*ch+1],B=out[i*ch+2]; rSum+=R;gSum+=G;blSum+=B;
    if(R>200&&G>200&&B<80)y0++; else if(B>200&&R<80&&G<80)b0++; else if(R>200&&G>200&&B>200)w0++; else o++;}
  return { mean:[Math.round(rSum/n),Math.round(gSum/n),Math.round(blSum/n)], yellow:y0, blue:b0, white:w0, other:o };
}
for (const s of SETS) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ executablePath: exe, args: s.args, headless: true, protocolTimeout: 60000 });
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
    let glerr = null;
    page.on('console', m => { if (/WebGL|GPU|SwiftShader|fallback/i.test(m.text())) glerr = (glerr||[]).concat(m.text().slice(0,110)); });
    await page.goto(`file://${resolve('_probe/drawshot.html')}?v=1`, { waitUntil: 'load', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    const st = await page.evaluate(() => window.__probe).catch(e => ({ err: String(e).slice(0,80) }));
    const shot = await page.screenshot();
    const p = png(shot);
    const ok = p.yellow > 1000;
    console.log(`  ${ok?'DRAW OK ':'NO DRAW '} ${s.n.padEnd(30)} ${JSON.stringify(st)} mean=${JSON.stringify(p.mean)} yellow=${p.yellow}${glerr?' log:'+glerr[0]:''}`);
  } catch (e) { console.log(`  NOCTX   ${s.n.padEnd(30)} ${String(e.message).split('\n')[0]}`); }
  finally { if (browser) await browser.close().catch(()=>{}); }
}
