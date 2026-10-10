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

  /* ---- base gradient: the CSS backdrop's ellipse, inherited verbatim ---- */
  vec2 rc = (uv - vec2(0.5, 0.44)) / vec2(1.2, 0.9);
  float t = clamp(length(rc) / 0.72, 0.0, 1.0);
  vec3 col = mix(uColorA, uColorB, t);

  /* ---- night: pixel stars on a coarse grid, gone by mid-journey ---- */
  vec2 cell = floor(uv * max(uResolution, vec2(1.0)) / 3.0);
  float h = hash21(cell);
  float star = step(0.994, h);
  float twinkle = 0.55 + 0.45 * sin(uTime * 2.2 + h * 90.0);
  float night = 1.0 - smoothstep(0.1, 0.45, uProgress);
  float upper = smoothstep(0.3, 0.55, uv.y);
  col += vec3(0.75, 0.85, 1.0) * star * twinkle * night * upper * 0.8;

#ifndef LOW
  /* ---- blocky clouds: noise sampled on a QUANTISED lattice, so each
         lattice cell shares one value and the shapes read as slabs ---- */
  vec2 cp = vec2(uv.x * aspect * 6.0 + uTime * 0.01, uv.y * 3.2);
  vec2 cq = floor(cp);
  float cn = vnoise(cq * 0.55) * 0.72 + hash21(cq) * 0.28;
  float cloud = smoothstep(0.58, 0.64, cn);
  float day = smoothstep(0.35, 0.95, uProgress);
  vec3 cloudCol = mix(vec3(0.42, 0.5, 0.72), vec3(1.0, 0.86, 0.62), day);
  col = mix(col, cloudCol, cloud * (0.1 + 0.06 * day) * upper);
#endif

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
