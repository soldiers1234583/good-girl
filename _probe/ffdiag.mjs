import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const FF = resolve('_env/ff/data/data/com.termux/files/usr/lib/firefox/firefox');
const GK = resolve('_env/gk/data/data/com.termux/files/usr/bin/geckodriver');
const BASE = 'http://127.0.0.1:4447';
const drv = spawn(GK, ['--port', '4447'], { stdio: ['ignore','pipe','pipe'] });
const call = async (m, p, b) => { const r = await fetch(BASE+p, { method: m, headers: { 'content-type':'application/json' }, body: b===undefined?undefined:JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(j.value||j).slice(0,300)}`); return j.value; };
for (let i=0;i<60;i++){ try { const s=await fetch(BASE+'/status'); if(s.ok) break; } catch {} await new Promise(r=>setTimeout(r,300)); }
const SESSION = {
  capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': {
    binary: FF, args: ['-headless','-width','640','-height','400'],
    prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'webgl.software': true, 'gfx.webrender.software': true, 'layers.acceleration.disabled': true, 'webgl.disable-fail-if-major-performance-caveat': true, 'webgl.enable-webgl2': true }
  } } }
};
let id=null;
try {
  const s = await call('POST','/session',SESSION); id = s.sessionId;
  await call('POST', `/session/${id}/url`, { url: 'data:text/html,<title>x</title><body style="background:#111;color:#eee">x</body>' });
  await new Promise(r=>setTimeout(r,1500));
  const diag = await call('POST', `/session/${id}/execute/sync`, { script: `
    const out = {};
    out.hasWebGLRenderingContext = typeof WebGLRenderingContext;
    out.hasWebGL2 = typeof WebGL2RenderingContext;
    out.WebGL2RenderingContext_pref = null;
    const c = document.createElement('canvas');
    const tries = {};
    for (const kind of ['webgl2','webgl','experimental-webgl']) {
      try { const g = c.getContext(kind); tries[kind] = g ? 'OK' : 'NULL'; if (g) { tries[kind+'_renderer'] = g.getParameter(g.RENDERER); tries[kind+'_version'] = g.getParameter(g.VERSION); } }
      catch (e) { tries[kind] = 'THROW: ' + e.message; }
    }
    out.contexts = tries;
    // canvas 2D works?
    const c2 = document.createElement('canvas'); c2.width=8; c2.height=8;
    const x2 = c2.getContext('2d'); out.canvas2d = !!x2;
    if (x2) { x2.fillStyle='#f0f'; x2.fillRect(0,0,8,8); const d = x2.getImageData(0,0,1,1).data; out.canvas2dPixel = Array.from(d); }
    out.userAgent = navigator.userAgent;
    out.hardwareConcurrency = navigator.hardwareConcurrency;
    return out;`, args: [] });
  console.log(JSON.stringify(diag, null, 1));
} catch (e) { console.error('FAIL: ' + e.message); }
finally { if (id) await call('DELETE', `/session/${id}`).catch(()=>{}); drv.kill('SIGTERM'); }
