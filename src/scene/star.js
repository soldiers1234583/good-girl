/**
 * The magic star.
 *
 * Refactored from the original standalone asset ("Magic Star - Three.js
 * Asset.html"). Carried over verbatim:
 *   - the extruded ten-point star geometry with its beveled ridges
 *   - the emissive/fresnel/facet shader
 *   - the layered additive aura sprites, flare and point light
 *   - the orbiting sparkle field
 *
 * New here:
 *   - `setIntensity` / `setTint` give the choreography direct control instead
 *     of the asset's button presets.
 *   - The flare is a response to her touch rather than a manual button.
 *   - Everything is disposable and the glow layers scale with device tier.
 *   - The material's animation uniforms (uTime/uProgress/uIntensity/
 *     uInteraction) are the SHARED objects owned by shaders/controller.js,
 *     written once per frame — this module only drives what is JS-side
 *     (light, auras, sparkles, spin), never the shader's story values.
 */

import { STAR_VERT, STAR_FRAG } from '../shaders/magicalStarShader.js';

/** Star geometry - ported unchanged from the source asset. */
function buildStarGeometry(THREE) {
  const R = 1;
  const r = 0.5;
  const d = 0.36;
  const h = 0.13;
  const tEdge = 0.05;
  const ring = 0.86;

  const base = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? r : R;
    base.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }

  // Round the root of each point so the silhouette reads as a soft toy star
  // rather than a hard-cut polygon.
  const out = [];
  for (let k = 0; k < 10; k++) {
    const pv = base[(k + 9) % 10];
    const cu = base[k];
    const nx = base[(k + 1) % 10];
    const t = k % 2 ? 0.07 : 0.13;
    const p1 = [cu[0] + (pv[0] - cu[0]) * t, cu[1] + (pv[1] - cu[1]) * t];
    const p2 = [cu[0] + (nx[0] - cu[0]) * t, cu[1] + (nx[1] - cu[1]) * t];
    for (let s = 0; s <= 5; s++) {
      const u = s / 5;
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      out.push([a * p1[0] + b * cu[0] + c * p2[0], a * p1[1] + b * cu[1] + c * p2[1]]);
    }
  }

  const pos = [];
  function tri(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) {
      const t = b;
      b = c;
      c = t;
    }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  const N = out.length;
  const M = (p, s) => {
    const rd = Math.hypot(p[0], p[1]);
    return [p[0] * ring, p[1] * ring, s * h * (0.6 + 0.4 * rd)];
  };
  const E = (p, s) => [p[0], p[1], s * tEdge];

  for (let k = 0; k < N; k++) {
    const j = (k + 1) % N;
    const pk = out[k];
    const pj = out[j];
    for (const s of [1, -1]) {
      const A = [0, 0, s * d];
      const Mk = M(pk, s);
      const Mj = M(pj, s);
      const Ek = E(pk, s);
      const Ej = E(pj, s);
      tri(A, Mk, Mj);
      tri(Mk, Ek, Ej);
      tri(Mk, Ej, Mj);
    }
    const a = E(pk, 1);
    const b = E(pj, 1);
    const c = E(pj, -1);
    const e = E(pk, -1);
    tri(a, b, c);
    tri(a, c, e);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function createStar(THREE, ctx = {}) {
  const quality = Object.assign({ starDetail: 1, motes: 240 }, ctx.quality || {});
  const reduced = !!ctx.reducedMotion;
  const shared = ctx.controller.shared;

  const rig = new THREE.Group();

  /* ---------- material (ported + enchanted) ---------- */
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      // Shared, controller-owned: one JS write, every shader sees it.
      uTime: shared.uTime,
      uProgress: shared.uProgress,
      uIntensity: shared.uIntensity,
      uInteraction: shared.uInteraction,
      // Star-specific colour pair: body gold → pale hot core.
      uColorA: { value: new THREE.Color(0xffae29) },
      uColorB: { value: new THREE.Color(0xfff4dc) },
      uTint: { value: new THREE.Color(0x3a6bff) },
      uL: { value: new THREE.Vector3(0.5, 0.7, 0.6).normalize() },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
  });

  const spin = new THREE.Group();
  rig.add(spin);
  const bodyGeo = buildStarGeometry(THREE);
  const body = new THREE.Mesh(bodyGeo, starMat);
  spin.add(body);

  /* ---------- glow layers ---------- */
  const disposables = [bodyGeo, starMat];
  function glowTex(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach((s) => g.addColorStop(s[0], s[1]));
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    disposables.push(t);
    return t;
  }
  const auraTex = glowTex([
    [0, 'rgba(255,214,120,1)'],
    [0.25, 'rgba(255,190,80,.55)'],
    [0.6, 'rgba(255,160,60,.14)'],
    [1, 'rgba(255,140,40,0)'],
  ]);
  const coreTex = glowTex([
    [0, 'rgba(255,255,245,1)'],
    [0.18, 'rgba(255,240,200,.75)'],
    [0.5, 'rgba(255,215,130,.18)'],
    [1, 'rgba(255,200,100,0)'],
  ]);

  function sprite(texture, scale, z, depthTest) {
    // `fog: false` matters here: additive glow that gets mixed toward the fog
    // colour turns grey and muddy. The glow should only ever add light.
    const m = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest, fog: false });
    const s = new THREE.Sprite(m);
    s.scale.set(scale, scale, 1);
    s.position.z = z;
    rig.add(s);
    disposables.push(m);
    return s;
  }

  // Constrained devices get one fewer aura layer; the loss is imperceptible
  // against the flare but the fill cost is not.
  const auraSpecs = quality.starDetail >= 0.9
    ? [[3.4, 0.55], [5.8, 0.26], [9.5, 0.12]]
    : [[3.4, 0.5], [6.2, 0.22]];
  const auras = auraSpecs.map((a) => ({ s: sprite(auraTex, a[0], -0.5, true), b: a[1], sc: a[0] }));
  const flare = sprite(coreTex, 1.9, 0.55, false);

  /* ---------- light the world sees ---------- */
  // Distance is world units and is NOT affected by the rig's scale, so it is
  // tuned to the composition rather than to the star's own size.
  const light = new THREE.PointLight(0xffc766, 2.6, 6, 1.6);
  rig.add(light);

  /* ---------- orbiting sparkles ---------- */
  const NP = Math.max(24, Math.round(64 * (quality.motes / 380) * 3));
  const pP = new Float32Array(NP * 3);
  const pPh = new Float32Array(NP);
  const pS = new Float32Array(NP);
  const pC = new Float32Array(NP * 3);
  const pd = [];
  const pal = [
    [1, 0.82, 0.45],
    [1, 0.95, 0.78],
    [1, 0.95, 0.78],
    [1, 0.76, 0.8],
  ];
  for (let i = 0; i < NP; i++) {
    pd.push({
      a: Math.random() * 6.283,
      rad: 1.3 + Math.random() * 1.5,
      y: (Math.random() - 0.5) * 3,
      sp: (0.08 + Math.random() * 0.18) * (Math.random() < 0.5 ? -1 : 1),
      ph: Math.random() * 6.283,
    });
    pPh[i] = Math.random();
    pS[i] = 0.05 + Math.random() * 0.09;
    const c = pal[Math.floor(Math.random() * pal.length)];
    pC.set(c, i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pP, 3));
  pg.setAttribute('aPhase', new THREE.BufferAttribute(pPh, 1));
  pg.setAttribute('aSize', new THREE.BufferAttribute(pS, 1));
  pg.setAttribute('aColor', new THREE.BufferAttribute(pC, 3));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 300 }, uA: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: `attribute float aPhase;attribute float aSize;attribute vec3 aColor;uniform float uTime;uniform float uPx;uniform float uA;varying float vA;varying vec3 vC;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vC=aColor;
        vA=(0.25+0.75*(0.5+0.5*sin(uTime*1.7+aPhase*6.283)))*uA;
        gl_PointSize=aSize*uPx/(-mv.z);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying float vA;varying vec3 vC;
      void main(){vec2 p=gl_PointCoord-0.5;float d=length(p);float a=1.0-smoothstep(0.0,0.5,d);a*=a;
        float cross=exp(-abs(p.x)*38.0)*(1.0-smoothstep(0.0,0.5,abs(p.y)))+exp(-abs(p.y)*38.0)*(1.0-smoothstep(0.0,0.5,abs(p.x)));
        gl_FragColor=vec4(vC,(a+cross*0.5)*vA);}`,
  });
  const points = new THREE.Points(pg, pMat);
  rig.add(points);
  disposables.push(pg, pMat);

  /* ---------- state ---------- */
  let level = 1; // drives emissiveness, light and glow
  let flareAmt = 0;
  let squash = 0;
  let heldAmount = 0;
  const tint = new THREE.Color(0x3a6bff);

  const applyTint = (rgbTriple) => {
    // Uniform only — allocating a Color per frame is the sort of thing that
    // shows up as GC jitter on a phone.
    tint.setRGB(rgbTriple[0], rgbTriple[1], rgbTriple[2]);
    starMat.uniforms.uTint.value.copy(tint);
  };

  const setLightColor = (hex) => light.color.setHex(hex);

  function update(dt, t, opts = {}) {
    const intensity = level;
    // The shader's uIntensity is written by the controller from the SAME
    // choreography value this `level` is set from — here we only keep the
    // real PointLight and the JS-side glow layers in step with it, so what
    // glows is what lights her face.
    light.intensity = (1.35 + intensity * 0.85) * (1 + flareAmt * 0.7);

    const k = Math.pow(Math.max(intensity, 0.001), 0.8);
    auras.forEach((a, i) => {
      a.s.material.opacity = Math.min(1, a.b * k * (1 + flareAmt * 0.5));
      a.s.scale.setScalar(a.sc * (0.92 + 0.08 * Math.min(intensity, 2.5)) * (1 + flareAmt * 0.22) * (1 + 0.03 * Math.sin(t * 1.3 + i)));
    });
    flare.material.opacity = Math.min(1, 0.1 * intensity * intensity + flareAmt * 0.85);
    flare.scale.setScalar(1.6 + 0.5 * Math.min(intensity, 3) + flareAmt * 0.9);

    // Position and world scale are owned by the composition (see main.js) —
    // this module only animates what the star IS, not where it sits.
    // Idle spin is suppressed under reduced motion so the piece stays still
    // for users who ask for that; the story is unaffected.
    const floaty = reduced ? 0 : 1;

    const swayX = reduced ? 0 : Math.sin(t * 0.7) * 0.07 * floaty;
    spin.rotation.set(-0.22 + swayX + (opts.tilt || 0), 0.5 + t * 0.32 * floaty + (opts.spin || 0), Math.sin(t * 0.5) * 0.05 * floaty);

    squash = Math.max(0, squash - dt * 3.4);
    const sc = 1 + flareAmt * 0.1 + squash * 0.12 + (reduced ? 0 : 0.015 * Math.sin(t * 2.3));
    spin.scale.set(1 + squash * 0.08, sc - squash * 0.14, 1 + squash * 0.08);

    // Sparkles: they orbit, breathe, and lean harder the brighter it burns.
    const boost = opts.atmosphere ? opts.atmosphere.burst || 0 : 0;
    for (let i = 0; i < NP; i++) {
      const p = pd[i];
      p.a += p.sp * dt;
      const rr = p.rad * (1 + boost * 0.6);
      pP[i * 3] = Math.cos(p.a) * rr;
      pP[i * 3 + 1] = p.y + Math.sin(t * 0.6 + p.ph) * 0.2;
      pP[i * 3 + 2] = Math.sin(p.a) * rr;
    }
    pg.attributes.position.needsUpdate = true;
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uA.value = (0.25 + 0.75 * Math.min(1, intensity)) * (1 + boost * 0.6);
    pMat.uniforms.uPx.value = opts.px || 300;
  }

  function dispose() {
    disposables.forEach((d) => (d && d.dispose ? d.dispose() : null));
  }

  return {
    rig,
    spin,
    light,
    setIntensity: (v) => {
      level = v;
    },
    getIntensity: () => level,
    setFlare: (v) => {
      flareAmt = v;
    },
    setSquash: (v) => {
      squash = v;
    },
    setTint: applyTint,
    setLightColor,
    setHeld: (h) => {
      heldAmount = h;
    },
    getHeld: () => heldAmount,
    update,
    dispose,
  };
}
