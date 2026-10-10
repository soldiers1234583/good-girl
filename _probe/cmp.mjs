import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
const old = execSync('command -v chromium-browser', { encoding: 'utf8' }).trim();
const c133 = resolve('_env/c133/data/data/com.termux/files/usr/lib/chromium/chrome');
const sh133 = resolve('_env/c133/data/data/com.termux/files/usr/lib/chromium/headless_shell');
const png = (buf) => {
  const b = Buffer.from(buf); let o=8,w=0,h=0,ct=0,dp=0; const id=[];
  while (o<b.length){const l=b.readUInt32BE(o),t=b.toString('ascii',o+4,o+8),d=b.subarray(o+8,o+8+l);
    if(t==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);dp=d[8];ct=d[9];}else if(t==='IDAT')id.push(d);else if(t==='IEND')break;o+=12+l;}
  const ch=ct===6?4:3,raw=inflateSync(Buffer.concat(id)),st=w*ch,out=Buffer.alloc(h*st);let pv=Buffer.alloc(st),p=0;
  for(let y=0;y<h;y++){const f=raw[p++],row=raw.subarray(p,p+st);p+=st;const cur=out.subarray(y*st,(y+1)*st);
    for(let x=0;x<st;x++){const a=x>=ch?cur[x-ch]:0,bb=pv[x],c=x>=ch?pv[x-ch]:0;let v=row[x];
      if(f===1)v+=a;else if(f===2)v+=bb;else if(f===3)v+=(a+bb)>>1;else if(f===4){const q=a+bb-c,pa=Math.abs(q-a),pb=Math.abs(q-bb),pc=Math.abs(q-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?bb:c;}cur[x]=v&0xff;}pv=cur;}
  let y0=0,rs=0,gs=0,bs=0; const n=w*h;
  for(let i=0;i<n;i++){const R=out[i*ch],G=out[i*ch+1],B=out[i*ch+2];rs+=R;gs+=G;bs+=B;if(R>200&&G>200&&B<80)y0++;}
  return { mean:[Math.round(rs/n),Math.round(gs/n),Math.round(bs/n)], yellow:y0, w, h };
};
const CANDS = [
  { n: 'chromium 152 (current)', exe: old },
  { n: 'chromium 133 (extracted)', exe: c133 },
  { n: 'chromium 133 headless_shell', exe: sh133 },
];
for (const c of CANDS) {
  let br = null;
  try {
    br = await puppeteer.launch({ executablePath: c.exe, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'], headless: true, protocolTimeout: 60000 });
    const p = await br.newPage();
    await p.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
    const logs = [];
    p.on('console', m => logs.push(m.text().slice(0,100)));
    await p.goto(`file://${resolve('_probe/drawshot.html')}?v=1`, { waitUntil: 'load', timeout: 40000 });
    await new Promise(r => setTimeout(r, 3000));
    const st = await p.evaluate(() => window.__probe);
    const pix = png(await p.screenshot());
    const ver = br.version();
    const ok = pix.yellow > 1000;
    console.log(`  ${ok?'>>> DRAW OK <<<      ':'NO DRAW              '} ${c.n.padEnd(30)} chrome=${ver}`);
    console.log(`        state=${JSON.stringify(st)} pixels=${JSON.stringify(pix)} logs=${JSON.stringify(logs.slice(0,3))}`);
  } catch (e) { console.log(`  FAIL ${c.n}: ${String(e.message).split('\n')[0]}`); }
  finally { if (br) await br.close().catch(()=>{}); }
}
