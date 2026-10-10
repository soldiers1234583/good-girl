import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
const exe = execSync('command -v chromium-browser', { encoding: 'utf8' }).trim();
const U = '--enable-unsafe-swiftshader';
const BASE = ['--no-sandbox','--disable-dev-shm-usage',U];
const SETS = [
  { n: 'baseline (control)',            args: BASE },
  { n: 'no watchdog/hangmonitor',       args: [...BASE,'--disable-gpu-watchdog','--disable-hang-monitor'] },
  { n: '+gpu-no-context-lost',          args: [...BASE,'--disable-gpu-watchdog','--disable-hang-monitor','--gpu-no-context-lost'] },
  { n: 'disable-gpu-wd + single proc',  args: [...BASE,'--disable-gpu-watchdog','--in-process-gpu'] },
  { n: 'angle gl (mesa desktop)',       args: [...BASE,'--use-gl=angle','--use-angle=gl'] },
  { n: 'disable-gpu (no fallback)',     args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-gpu-watchdog'] },
];
function png(buf){const b=Buffer.from(buf);let o=8,w=0,h=0,ct=0,dp=0;const id=[];
 while(o<b.length){const l=b.readUInt32BE(o),t=b.toString('ascii',o+4,o+8),d=b.subarray(o+8,o+8+l);
 if(t==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);dp=d[8];ct=d[9];}else if(t==='IDAT')id.push(d);else if(t==='IEND')break;o+=12+l;}
 const ch=ct===6?4:3,raw=inflateSync(Buffer.concat(id)),st=w*ch,out=Buffer.alloc(h*st);let pv=Buffer.alloc(st),p=0;
 for(let y=0;y<h;y++){const f=raw[p++],row=raw.subarray(p,p+st);p+=st;const cur=out.subarray(y*st,(y+1)*st);
 for(let x=0;x<st;x++){const a=x>=ch?cur[x-ch]:0,bb=pv[x],c=x>=ch?pv[x-ch]:0;let v=row[x];
 if(f===1)v+=a;else if(f===2)v+=bb;else if(f===3)v+=(a+bb)>>1;else if(f===4){const q=a+bb-c,pa=Math.abs(q-a),pb=Math.abs(q-bb),pc=Math.abs(q-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?bb:c;}cur[x]=v&0xff;}pv=cur;}
 let y0=0,b0=0,bl=0,rs=0,gs=0,bs=0;const n=w*h;
 for(let i=0;i<n;i++){const R=out[i*ch],G=out[i*ch+1],B=out[i*ch+2];rs+=R;gs+=G;bs+=B;
 if(R>200&&G>200&&B<80)y0++;else if(B>200&&R<80&&G<80)b0++;else if(R>200&&G>200&&B>200)bl++;}
 return {mean:[Math.round(rs/n),Math.round(gs/n),Math.round(bs/n)],yellow:y0,blue:b0,white:bl};}
for(const s of SETS){let br=null;
 try{ br=await puppeteer.launch({executablePath:exe,args:s.args,headless:true,protocolTimeout:60000});
  const pg=await br.newPage(); await pg.setViewport({width:640,height:400,deviceScaleFactor:1});
  await pg.goto(`file://${resolve('_probe/drawshot.html')}?v=1`,{waitUntil:'load',timeout:30000});
  await new Promise(r=>setTimeout(r,3000));
  const st=await pg.evaluate(()=>window.__probe).catch(e=>({err:String(e).slice(0,60)}));
  const p=png(await pg.screenshot());
  const ok=p.yellow>1000;
  console.log(`  ${ok?'DRAW OK ':'NO DRAW '} ${s.n.padEnd(28)} frames=${st.frames} lost=${st.lost} lossFrame=${st.lossFrame} mean=${JSON.stringify(p.mean)} yellow=${p.yellow}`);
 }catch(e){console.log(`  NOCTX   ${s.n.padEnd(28)} ${String(e.message).split('\n')[0]}`);}
 finally{if(br)await br.close().catch(()=>{});}}
