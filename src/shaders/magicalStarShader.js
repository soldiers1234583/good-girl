/**
 * The magic star's shader.
 *
 * Evolved from the original standalone asset ("Magic Star — Three.js
 * Asset.html"), which already shipped a custom core-gradient/wrap-light/
 * fresnel material. Kept: the geometry, the aura sprites, the point light and
 * the exp() tonemap that stops the core blowing out under ACES. Added:
 *
 *   - an emissive core that breathes with uTime
 *   - two scrolling noise octaves = energy flowing across the surface, gated
 *     by uProgress so the star is dormant at the intro and comes alive as she
 *     discovers and approaches it (the "clean dormant → awakened transition")
 *   - blocky pixel glints riding the facets (the Minecraft-shader sparkle)
 *   - uInteraction: reach → grip → reaction flare flushes the rim and glints
 *
 * Intensity itself is NOT a local uniform: `uIntensity` is the shared object
 * owned by shaders/controller.js, and the star's real PointLight is driven
 * from the same number in scene/star.js — so what glows is always what
 * illuminates her face, hair and hands. A shader colour cannot light a scene;
 * the light can.
 *
 * uColorA = body gold (edge), uColorB = pale hot core (centre),
 * uTint = environment reflection tint (palette starTint: blue → gold),
 * uL = key light direction.
 */

export const STAR_VERT = `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vP = position;
  gl_Position = projectionMatrix * mv;
}`;

export const STAR_FRAG = `
uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform float uInteraction;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uTint;
uniform vec3 uL;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

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
  vec3 N = normalize(vN), V = normalize(vV), L = normalize(uL);
  float r = length(vP.xy);

  // Breathing core. Frozen (constant) under reduced motion, since uTime = 0.
  float core = pow(clamp(1.0 - r / 0.85, 0.0, 1.0), 1.7);
  float breathe = 0.82 + 0.18 * sin(uTime * 1.6);

  // Energy flow: two scrolling octaves over the star's own surface, gated by
  // the story — nothing at the intro, alive through discovery/approach.
  float flow = vnoise(vP.xy * 3.5 + vec2(uTime * 0.22, -uTime * 0.15)) * 0.65 +
               vnoise(vP.xy * 7.5 + vec2(-uTime * 0.34, uTime * 0.11)) * 0.35;
  float awake = smoothstep(0.1, 0.5, uProgress);
  float energy = smoothstep(0.35, 0.95, flow) * awake;

  // Blocky glints: quantized cells twinkling on the facets.
  vec2 gc = floor(vP.xy * 9.0 + vec2(uTime * 0.9, uTime * 0.6));
  float gh = hash21(gc);
  float glint = step(0.955, gh) * (0.5 + 0.5 * sin(uTime * 5.0 + gh * 60.0)) * awake;

  float touch = uInteraction;
  float lo = min(uIntensity, 1.0);
  float wrap = 0.5 + 0.5 * dot(N, L);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 52.0);
  float fres = pow(max(1.0 - max(dot(N, V), 0.0), 0.0), 2.5);

  vec3 base = mix(uColorA, uColorB, 1.0 - smoothstep(0.15, 0.95, r));
  base *= 0.92 + 0.35 * energy;

  vec3 lit = base * (0.45 + 0.6 * wrap) * (0.28 + 0.55 * lo);
  vec3 emis = mix(base, uColorB, core) *
              (core * (1.5 + 0.6 * breathe) + 0.22 + 0.5 * energy * core) * uIntensity;
  vec3 rim = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.74, 0.76), 0.25) * fres *
             (0.15 + 0.45 * uIntensity);
  vec3 env = uTint * (0.35 + 0.65 * (N.y * 0.5 + 0.5)) * fres * 0.7;

  vec3 col = lit + emis + rim + env +
             spec * vec3(1.0, 0.95, 0.85) * (0.35 + 0.65 * lo) +
             uColorB * glint * (0.35 + 0.5 * touch) +
             uColorA * touch * fres * 0.35;

  col = 1.0 - exp(-col * 1.45);
  gl_FragColor = vec4(col, 1.0);
}`;
