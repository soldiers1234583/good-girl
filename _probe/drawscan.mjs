import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const bins = {};
for (const b of ['chromium-browser', 'chromium', 'headless_shell']) {
  try { bins[b] = execSync(`command -v ${b}`, { encoding: 'utf8' }).trim(); } catch { /* absent */ }
}

const SETS = [
  { n: 'base+unsafe-swiftshader', bin: 'chromium-browser', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] },
  { n: 'WITHOUT unsafe-swiftshader', bin: 'chromium-browser', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] },
  { n: 'swiftshader-webgl', bin: 'chromium-browser', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader-webgl'] },
  { n: 'angle+swiftshader', bin: 'chromium-browser', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader'] },
  { n: 'disable-gpu+unsafe', bin: 'chromium-browser', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--enable-unsafe-swiftshader'] },
  { n: 'headless_shell+unsafe', bin: 'headless_shell', headless: 'shell', args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] },
];

console.log('=== draw scan: does geometry rasterise? (version x flag set) ===');
for (const set of SETS) {
  if (!bins[set.bin]) { console.log(`  ${set.n.padEnd(28)} binary missing`); continue; }
  for (const v of ['1', '2']) {
    let browser = null;
    try {
      browser = await puppeteer.launch({ executablePath: bins[set.bin], args: set.args, headless: set.headless, protocolTimeout: 60000 });
      const page = await browser.newPage();
      await page.goto(`file://${resolve('_probe/draw.html')}?v=${v}`, { waitUntil: 'load', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2500));
      const p = await page.evaluate(() => window.__probe);
      const drew = p.distinctFromClear;
      const mark = drew > 0 ? 'DRAW OK ' : 'NO DRAW ';
      console.log(`  ${mark}${set.n.padEnd(26)} webgl${v} clear=${JSON.stringify(p.clearPixel)} draw=${JSON.stringify(p.drawPixel)} covered=${drew}/256 frames=${p.frames} lost=${p.lostDuringFrames} lossFrame=${p.lossFrame} err=${p.glError}/${p.drawError} link=${p.linkStatus} attrib=${p.attribLoc} shaderErr=${p.shaderErr ? String(p.shaderErr).slice(0,60) : '-'}`);
    } catch (e) {
      console.log(`  FAIL    ${set.n.padEnd(26)} webgl${v} ${String(e.message).split('\n')[0]}`);
    } finally { if (browser) await browser.close().catch(() => {}); }
  }
}
