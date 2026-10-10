/**
 * Atmosphere particles.
 *
 * Two systems, one draw call each:
 *
 *   1. MOTES   - ambient dust that drifts slowly through the volume. Density
 *                and brightness are scrubbed, so the air thickens as the story
 *                builds and calms again at the reward.
 *   2. BURST   - a small pooled system for the star reaction. It is fired on a
 *                RISING EDGE of the scrubbed burst impulse, so scrolling back
 *                and forth re-arms it rather than strobing it every frame.
 *
 * Both draw as soft point sprites with a tiny cross flare, which reads as
 * "glowing dust" at any size and costs one attribute-less fragment shader.
 */

import { makeRandom } from '../util/math.js';

const MOTE_VERT = `attribute float aPhase;attribute float aSize;attribute float aAlpha;uniform float uTime;uniform float uPx;uniform vec3 uColor;uniform float uA;varying float vA;
void main(){
  vec3 pos=position;
  pos.x+=sin(uTime*0.28+aPhase*6.283)*0.35;
  pos.y+=sin(uTime*0.19+aPhase*3.1)*0.28;
  pos.z+=cos(uTime*0.23+aPhase*4.7)*0.32;
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  vA=aAlpha*uA*(0.35+0.65*(0.5+0.5*sin(uTime*0.9+aPhase*12.0)));
  gl_PointSize=aSize*uPx/(-mv.z);
  gl_Position=projectionMatrix*mv;
}`;

const MOTE_FRAG = `varying float vA;uniform vec3 uColor;
void main(){
  vec2 p=gl_PointCoord-0.5;float d=length(p);
  float a=1.0-smoothstep(0.05,0.5,d);a*=a;
  float cross=exp(-abs(p.x)*34.0)*(1.0-smoothstep(0.0,0.5,abs(p.y)))
             +exp(-abs(p.y)*34.0)*(1.0-smoothstep(0.0,0.5,abs(p.x)));
  gl_FragColor=vec4(uColor,(a+cross*0.35)*vA);
}`;

const BURST_VERT = `attribute float aSize;attribute float aAlpha;uniform float uPx;varying float vA;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vA=aAlpha;gl_PointSize=aSize*uPx/(-mv.z);gl_Position=projectionMatrix*mv;}`;

const BURST_FRAG = `varying float vA;uniform vec3 uColor;
void main(){
  vec2 p=gl_PointCoord-0.5;float d=length(p);
  float a=1.0-smoothstep(0.0,0.5,d);a*=a;
  gl_FragColor=vec4(uColor,a*vA);
}`;

export function createParticles(THREE, ctx = {}) {
  const quality = Object.assign({ motes: 240 }, ctx.quality || {});
  const reduced = !!ctx.reducedMotion;
  const group = new THREE.Group();
  const disposables = [];

  /* ---------------- motes ---------------- */
  const N = Math.max(40, Math.round(quality.motes));
  const pos = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const rand = makeRandom(0x5eed1234);

  for (let i = 0; i < N; i++) {
    // Distributed through a volume wide enough to be seen from every camera
    // keyframe, denser near the action.
    const r = Math.pow(rand(), 0.6);
    const a = rand() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r * 7.5;
    pos[i * 3 + 1] = rand() * 5.6 - 0.2;
    pos[i * 3 + 2] = Math.sin(a) * r * 7.5;
    phase[i] = rand();
    size[i] = 1.6 + rand() * 5.4;
    alpha[i] = 0.18 + rand() * 0.7;
  }

  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  moteGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  moteGeo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));

  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 300 }, uA: { value: 1 }, uColor: { value: new THREE.Color(0x9fc0ff) } },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  group.add(motes);
  disposables.push(moteGeo, moteMat);

  /* ---------------- burst pool ---------------- */
  const BN = reduced ? 0 : Math.max(24, Math.round(quality.motes * 0.35));
  const bPos = new Float32Array(Math.max(1, BN) * 3);
  const bSize = new Float32Array(Math.max(1, BN));
  const bAlpha = new Float32Array(Math.max(1, BN));
  const bVel = new Float32Array(Math.max(1, BN) * 3);
  const bLife = new Float32Array(Math.max(1, BN));

  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  burstGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));
  burstGeo.setAttribute('aAlpha', new THREE.BufferAttribute(bAlpha, 1));
  const burstMat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 300 }, uColor: { value: new THREE.Color(0xffd9a0) } },
    vertexShader: BURST_VERT,
    fragmentShader: BURST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const burstPoints = new THREE.Points(burstGeo, burstMat);
  burstPoints.frustumCulled = false;
  group.add(burstPoints);
  disposables.push(burstGeo, burstMat);

  let armed = true;

  /** Fire the pool from `center` with `strength` 0..1. */
  function fire(center, strength) {
    for (let i = 0; i < BN; i++) {
      const a = rand() * Math.PI * 2;
      const el = (rand() - 0.35) * 1.7;
      const sp = (0.55 + rand() * 1.5) * strength;
      bPos[i * 3] = center.x;
      bPos[i * 3 + 1] = center.y;
      bPos[i * 3 + 2] = center.z;
      bVel[i * 3] = Math.cos(a) * Math.cos(el) * sp;
      bVel[i * 3 + 1] = Math.sin(el) * sp * 0.8 + 0.25 * strength;
      bVel[i * 3 + 2] = Math.sin(a) * Math.cos(el) * sp;
      bLife[i] = 0.9 + rand() * 1.1;
      bSize[i] = 4 + rand() * 9;
      bAlpha[i] = 0.5 + rand() * 0.5;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burstGeo.attributes.aSize.needsUpdate = true;
    burstGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* ---------------- state ---------------- */
  const moteColor = new THREE.Color(0x9fc0ff);
  const burstColor = new THREE.Color(0xffd9a0);

  function applyPalette(pal) {
    moteColor.setRGB(pal.mote[0], pal.mote[1], pal.mote[2]);
    burstColor.setRGB(
      Math.min(1, pal.mote[0] * 1.1 + 0.15),
      Math.min(1, pal.mote[1] * 1.05 + 0.06),
      Math.min(1, pal.mote[2] * 0.95)
    );
    moteMat.uniforms.uColor.value.copy(moteColor);
    burstMat.uniforms.uColor.value.copy(burstColor);
  }

  /**
   * @param {number} px  viewport height in device pixels, already scaled by
   *   the same factor the star uses, so point sizes stay consistent with the
   *   star's own sparkles across devices.
   */
  function update(dt, t, atmosphere, center, px) {
    moteMat.uniforms.uTime.value = t;
    moteMat.uniforms.uA.value += (atmosphere.motes - moteMat.uniforms.uA.value) * (1 - Math.exp(-dt * 2.2));
    moteMat.uniforms.uPx.value = px;
    burstMat.uniforms.uPx.value = px * 0.9;

    const impulse = atmosphere.burst || 0;
    // Rising edge only — see the note at the top of the file.
    if (impulse > 0.35 && armed) {
      fire(center, Math.min(1, impulse));
      armed = false;
    } else if (impulse < 0.08) {
      armed = true;
    }

    // Integrate the pool. Damped, plus a light gravity well so sparks arc
    // rather than drift off in straight lines.
    const decay = Math.exp(-dt * 1.05);
    for (let i = 0; i < BN; i++) {
      if (bLife[i] <= 0) {
        bAlpha[i] = 0;
        continue;
      }
      bLife[i] -= dt;
      const f = dt * decay;
      bVel[i * 3] *= 1 - f * 1.6;
      bVel[i * 3 + 1] -= dt * 0.35;
      bVel[i * 3 + 2] *= 1 - f * 1.6;
      bPos[i * 3] += bVel[i * 3] * dt;
      bPos[i * 3 + 1] += bVel[i * 3 + 1] * dt;
      bPos[i * 3 + 2] += bVel[i * 3 + 2] * dt;
      const life = Math.max(0, bLife[i]);
      bAlpha[i] = Math.min(1, life * 1.1) * 0.9;
      bSize[i] *= 1 + dt * 0.5;
    }
    if (BN > 0) {
      burstGeo.attributes.position.needsUpdate = true;
      burstGeo.attributes.aAlpha.needsUpdate = true;
      burstGeo.attributes.aSize.needsUpdate = true;
    }
  }

  function dispose() {
    disposables.forEach((d) => d.dispose && d.dispose());
  }

  return { group, motes, burst: burstPoints, applyPalette, update, dispose, fire };
}
