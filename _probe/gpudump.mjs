import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const exe = execSync('command -v chromium-browser', { encoding: 'utf8' }).trim();
const ARGS = ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'];
const browser = await puppeteer.launch({ executablePath: exe, args: ARGS, headless: true, protocolTimeout: 60000 });

// --- chrome://gpu ---
try {
  const page = await browser.newPage();
  await page.goto('chrome://gpu', { waitUntil: 'networkidle0', timeout: 30000 }).catch(()=>{});
  await new Promise(r => setTimeout(r, 2500));
  const txt = await page.evaluate(() => {
    const g = document.body ? document.body.innerText : '';
    return g.slice(0, 6000);
  }).catch(e => 'UNAVAILABLE: ' + String(e).slice(0,200));
  writeFileSync('_evidence/chrome-gpu.txt', txt);
  console.log('=== chrome://gpu (saved to _evidence/chrome-gpu.txt) ===');
  const lines = txt.split('\n');
  for (const l of lines) if (/WebGL|Canvas|SwiftShader|Vulkan|GL_RENDERER|GL_VERSION|GPU0|Problems|fallback|Software|ANGLE|command line|Feature/i.test(l)) console.log('  ' + l.trim());
  await page.close().catch(()=>{});
} catch (e) { console.log('chrome://gpu unavailable: ' + String(e).split('\n')[0]); }

// --- full console during a draw-loss session ---
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto('file://' + process.cwd() + '/_probe/drawshot.html?v=1', { waitUntil: 'load', timeout: 30000 });
await new Promise(r => setTimeout(r, 4000));
const st = await page.evaluate(() => window.__probe);
writeFileSync('_evidence/minimal-cube-console.log', logs.join('\n'));
console.log('\n=== minimal cube (draw) ===');
console.log('  state: ' + JSON.stringify(st));
console.log('=== console log ===');
for (const l of logs) console.log('  ' + l);
await browser.close();
