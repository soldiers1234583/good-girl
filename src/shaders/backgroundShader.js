/**
 * Cinematic background shader — the sky itself.
 *
 * Replaces the CSS radial-gradient backdrop with a GPU-rendered one while
 * keeping the EXACT same base gradient (the ellipse 120% x 90% at 50%/44%,
 * inner → outer by 72%) so the palette journey authored in story/palette.js
 * carries over unchanged. On top of that base, in cheap layers:
 *
 *   - a pixel star field that twinkles and fades as the story leaves night
 *   - blocky drifting clouds (value noise sampled on a quantised lattice,
 *     so the shapes come out as hard-edged slabs — voxel clouds)
 *   - a SQUARE sun that rises as the world warms, with a soft halo and
 *     restrained god rays (one sine field masked by distance — no raymarching)
 *   - the reward: a centre bloom plus ONE soft sweep of light that crosses
 *     the frame during the badge reveal and is gone once it settles
 *   - a per-pixel dither that kills banding on the dark radial gradient
 *
 * Everything is a pure function of uTime/uProgress/uReveal — deterministic
 * under scrubbing, frozen when the clock is paused. `LOW` (tier-0 devices,
 * set once at boot — never recompiled during scroll) drops the clouds and
 * god rays for the two cheapest layers that still read as a sky.
 *
 * Colour policy (same as the star and particle shaders): values are authored
 * in display space and written straight out — no tonemapping/encoding chunk,
 * because the palette colours ARE sRGB and the sky has to agree with the CSS
 * backdrop it draws over.
 */

export const BG_VERT = `
varying vec2 vUv;
void main() {
  // Screen-space quad: ignore the camera entirely. PlaneGeometry(2, 2)
  // already spans NDC [-1, 1]; derive uv from position so we do not depend
  // on the uv attribute being declared for ShaderMaterial.
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

export const BG_FRAG = `
uniform float uTime;        // animation seconds (0 under reduced motion)
uniform float uProgress;    // story progress 0..1
uniform float uIntensity;   // star energy 0.05..3, drives ray strength
uniform float uReveal;      // badge reveal 0..1
uniform vec3 uColorA;       // inner sky glow (palette bgInner)
uniform vec3 uColorB;       // outer deep sky (palette bgOuter)
uniform vec2 uResolution;   // drawing-buffer size, px
varying vec2 vUv;

/* Reimagined-style night ramp relationships (written fresh for this shader:
   relationships observed while reading that pack's sky colors — zenith darkest,
   a mid band reusing a squared-down version of the up color, and a horizon band
   pushed slightly blue. The code itself is ours.) */
vec3 nightMid(vec3 upColor) {
  return sqrt(max(upColor, vec3(0.0))) * 0.65;
}
vec3 nightDown(vec3 midColor) {
  return midColor * vec3(0.82, 0.82, 0.92);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Smooth value noise — the shape behind the clouds.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);

  /* ---- base gradient: the CSS backdrop's ellipse, inherited verbatim, then
         regraded Reimagined-style: zenith darkest, a mid band at sqrt*0.65 of
         the up color, horizon band pushed slightly blue and brighter. ---- */
  vec2 rc = (uv - vec2(0.5, 0.44)) / vec2(1.2, 0.9);
  float rawLen = length(rc) / 0.72;
  float t = clamp(rawLen, 0.0, 1.0);
  vec3 col = mix(uColorA, uColorB, t);
  float night = 1.0 - smoothstep(0.1, 0.45, uProgress);
  if (night > 0.001) {
    vec3 up = uColorB * 0.9;
    vec3 mid = nightMid(up);
    vec3 down = nightDown(mid);
    // Horizon band: away from centre (rawLen>1) fades the outer colour into
    // the 'down' tint, strongest near the horizon line (vUv.y ~ 0.44).
    float horizonBand = exp(-abs(uv.y - 0.42) * 5.5) * smoothstep(0.35, 1.15, rawLen);
    col = mix(col, down, min(horizonBand * 0.28 * night, 0.6));
    col = mix(col, mid, smoothstep(0.4, 0.9, rawLen) * 0.12 * night);
  }

  /* ---- night: pixel stars on a coarse grid, gone by mid-journey. Reimagined
         style: three hash octaves multiplied (their GetStars), brightness
         squared, fade gated to the upper sky and near-horizon occlusion. ---- */
  float nightNow = 1.0 - smoothstep(0.1, 0.45, uProgress);
  vec2 cell = floor(uv * max(uResolution, vec2(1.0)) / 3.0);
  float h = hash21(cell);
  float star = step(0.992, h);
  star *= hash21(cell + 0.1);
  star *= hash21(cell + 0.23);
  float twinkle = 0.55 + 0.45 * sin(uTime * 2.2 + h * 90.0);
  twinkle *= twinkle;
  float upper = smoothstep(0.3, 0.55, uv.y);
  col += vec3(0.38, 0.4, 0.5) * star * twinkle * nightNow * upper * 0.8;

#ifndef LOW
  /* ---- nebula: a DIM two-octave FBM band near the horizon (inspired by the
         five-octave aurora/nebula common to shader packs, cut down for
         mobile). Cold blue with a hint of warm accent, drifting very slowly. ---- */
  float neb = 0.0;
  vec2 np = vec2(uv.x * aspect * 2.0 + uTime * 0.004, (uv.y - 0.42) * 6.0);
  {
    float n1 = vnoise(np);
    float n2 = vnoise(np * 2.7 + 11.0);
    neb = n1 * 0.65 + n2 * 0.35;
    neb = smoothstep(0.55, 0.85, neb);
    neb *= exp(-abs(uv.y - 0.46) * 4.0) * nightNow;
  }
  col += neb * (vec3(0.10, 0.16, 0.26) + vec3(0.05, 0.03, 0.0) * vnoise(np * 1.3 + 40.0));

  /* ---- moonlit soft clouds (two layers): smooth vnoise clouds this time,
         drifting slowly; the upper layer, nearer the moon, catches a cool
         rim. Day steel-blue turns golden as the story warms. ---- */
  float day = smoothstep(0.35, 0.95, uProgress);
  // layer A: high, thin
  {
    vec2 cp = vec2(uv.x * aspect * 3.2 + uTime * 0.006, uv.y * 5.0);
    float cn = vnoise(cp) * 0.7 + vnoise(cp * 2.3 + 31.0) * 0.3;
    float cloudA = smoothstep(0.60, 0.78, cn);
    vec3 litA = mix(vec3(0.30, 0.38, 0.55) * (0.55 + nightNow * 0.45), vec3(1.0, 0.86, 0.62), day);
    col = mix(col, litA, cloudA * 0.16 * upper);
  }
  // layer B: low, denser
  {
    vec2 cp = vec2(uv.x * aspect * 5.5 - uTime * 0.010, uv.y * 6.5 + 9.0);
    float cn = vnoise(cp) * 0.6 + vnoise(cp * 3.1 + 7.0) * 0.4;
    float cloudB = smoothstep(0.62, 0.82, cn);
    vec3 litB = mix(vec3(0.24, 0.30, 0.46) * (0.5 + nightNow * 0.5), vec3(1.0, 0.9, 0.7), day);
    col = mix(col, litB, cloudB * 0.12 * upper);
  }
#endif

  /* ---- the moon: full against the night, fades as the story warms toward
         the sunrise ending. Fixed direction (mirrors the directional
         moonlight in scene/lighting.js). Cel + halo + glare falloff. ---- */
  {
    vec2 md2 = (uv - vec2(0.22, 0.78)) * vec2(aspect, 1.0);
    float mDist = length(md2);
    float moonVis = 1.0 - smoothstep(0.45, 0.75, uProgress);
    float mDisc = (1.0 - smoothstep(0.030, 0.034, mDist)) * moonVis;
    // crisper moon with a thin crater-ish inner shade
    float inner = (1.0 - smoothstep(0.018, 0.022, mDist)) * moonVis;
    float mHalo = exp(-mDist * 9.0) * moonVis;
    vec3 moonCol = vec3(0.86, 0.9, 1.0);
    col += moonCol * (mDisc * (0.55 + 0.35 * inner) * 0.85 + mHalo * 0.22);
  }

  /* ---- the square sun: vanilla's sun IS a block. It rises as the story
         turns warm — disc, halo, then rays. ---- */
  float dayX = smoothstep(0.4, 0.95, uProgress);
  vec2 sunPos = vec2(0.68, mix(0.02, 0.42, dayX));
  vec2 sd2 = (uv - sunPos) * vec2(aspect, 1.0);
  float sunVis = smoothstep(0.45, 0.78, uProgress);
  float box = max(abs(sd2.x), abs(sd2.y));
  float disc = (1.0 - smoothstep(0.034, 0.038, box)) * sunVis;
  float halo = exp(-length(sd2) * 6.0) * sunVis;
  vec3 sunCol = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.88, 0.55), dayX);
  col += sunCol * (disc * 0.9 + halo * 0.34);

#ifndef LOW
  // God rays: angular streaks masked by distance falloff. pow() only ever
  // sees 0.5 + 0.5*sin >= 0 (GLSL pow is undefined for negative bases).
  float ang = atan(sd2.y, sd2.x);
  float rayField = 0.5 + 0.5 * sin(ang * 7.0 + uTime * 0.05 +
                                  vnoise(vec2(ang * 2.5, uTime * 0.06)) * 2.2);
  float rays = pow(rayField, 3.0) * exp(-length(sd2) * 3.2) * sunVis;
  col += sunCol * rays * 0.3 * (0.4 + 0.3 * min(uIntensity, 2.0));
#endif

  /* ---- reward: centre bloom + one brief sweep across the frame ---- */
  vec2 dc = (uv - vec2(0.5, 0.46)) * vec2(aspect, 1.0);
  col += uReveal * exp(-length(dc) * 2.1) * vec3(0.34, 0.23, 0.08);
  float revealWave = uReveal * (1.0 - uReveal) * 4.0; // 0 → 1 → 0: brief
  float sweepQ = (uv.x + (1.0 - uv.y) * 0.3 - mix(-0.35, 1.35, uReveal)) * 5.5;
  col += exp(-sweepQ * sweepQ) * revealWave * vec3(1.0, 0.87, 0.58) * 0.34;

  /* ---- dither: one hash to keep the dark gradient band-free ---- */
  col += (hash21(gl_FragCoord.xy + fract(uTime) * 7.0) - 0.5) * (2.0 / 255.0);

  gl_FragColor = vec4(col, 1.0);
}`;
