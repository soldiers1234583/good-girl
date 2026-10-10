import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
const exe = execSync('command -v chromium-browser', { encoding: 'utf8' }).trim();
const U = '--enable-unsafe-swiftshader';
const SETS = [
  { n: 'base+unsafe',           args: ['--no-sandbox','--disable-dev-shm-usage',U] },
  { n: 'swiftshader-webgl',     args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader-webgl',U] },
  { n: 'egl',                   args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=egl',U] },
  { n: 'angle gl (desktop)',    args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=gl',U] },
  { n: 'angle gl-egl',          args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=gl-egl',U] },
  { n: 'angle vulkan',          args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan',U] },
  { n: 'angle swiftshader',     args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader',U] },
];
for (const s of SETS) {
  let br = null;
  try {
    br = await puppeteer.launch({ executablePath: exe, args: s.args, headless: true, protocolTimeout: 45000 });
    const p = await br.newPage();
    const info = await p.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { context: 'NONE' };
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        context: 'ok',
        version: String(gl.getParameter(gl.VERSION)),
        renderer: d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        vendor: d ? String(gl.getParameter(d.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
        webgl2: !!c.getContext('webgl2'),
      };
    });
    console.log(`  ${s.n.padEnd(20)} ${JSON.stringify(info)}`);
  } catch (e) { console.log(`  ${s.n.padEnd(20)} LAUNCH-FAIL ${String(e.message).split('\n')[0]}`); }
  finally { if (br) await br.close().catch(()=>{}); }
}
