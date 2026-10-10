/**
 * Energy stream between the star and her hand.
 *
 * A single Points draw call whose positions are computed ENTIRELY in the
 * vertex shader: every point owns a parameter aT along the segment and drifts
 * from star (uFrom) to palm (uTo), so the CPU only ever writes two endpoint
 * vectors — no per-particle arrays, no JS physics, one draw call.
 *
 * It exists only across the reach → grip window: `uFade` is scrubbed from
 * progress by a controller subscriber (deterministic, rewinds with the
 * scroll), and the mesh switches itself off entirely outside the window so
 * the timeline's long stretches pay zero cost for it.
 *
 * The sprites are hard-edged squares with a soft halo — blocky pixels that
 * match the Minecraft-shaders look of the sky and the star's glints.
 */

import { BEAT } from '../story/phases.js';
import { smoothstep } from '../util/math.js';

export const TRAIL_VERT = `
attribute float aT;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uTime;
uniform float uPx;
uniform float uFade;
uniform float uInteraction;
varying float vA;
varying float vT;
void main() {
  // Each point loops along the segment: star → hand, over and over.
  float u = fract(aT + uTime * 0.35);
  vec3 axis = uTo - uFrom;
  float len = max(length(axis), 1e-4);
  vec3 dir = axis / len;
  vec3 p = mix(uFrom, uTo, u);

  // Side vector for the wobble. The epsilon keeps normalize() safe even if
  // dir ends up parallel to +Y (star resting in the palm → axis ≈ 0).
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 1e-4));
  float bulge = sin(u * 3.14159);
  p += side * sin(u * 17.0 + uTime * 6.0 + aT * 21.0) * 0.035 * bulge;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // Fade at both ends of the segment so the stream grows out of the star and
  // dissolves into her hand instead of terminating on a hard dot.
  vA = uFade * smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.85, 1.0, u)) *
       (0.45 + 0.55 * uInteraction);
  vT = u;
  gl_PointSize = (2.2 + 3.4 * (1.0 - u)) * uPx / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

export const TRAIL_FRAG = `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vA;
varying float vT;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  vec2 e = abs(q);
  // Hard square core (the blocky pixel) with a soft round halo around it.
  float square = 1.0 - smoothstep(0.28, 0.34, max(e.x, e.y));
  float glow = 1.0 - smoothstep(0.0, 0.5, length(q));
  vec3 col = mix(uColorA, uColorB, vT);
  float a = (square * 0.7 + glow * glow * 0.5) * vA;
  if (a < 0.004) discard; // no invisible additive overdraw
  gl_FragColor = vec4(col * (0.75 + 0.6 * square), a);
}`;

export function createEnergyTrail(THREE, ctx = {}) {
  const controller = ctx.controller;
  const quality = Object.assign({ motes: 240, tier: 2 }, ctx.quality || {});
  const reduced = !!ctx.reducedMotion;

  // Density follows the existing tier ladder; reduced motion gets none (the
  // stream is pure decoration — the story reads without it).
  const N = reduced ? 0 : Math.max(24, Math.round(quality.motes * 0.18));

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(Math.max(1, N) * 3); // computed in-shader
  const aT = new Float32Array(Math.max(1, N));
  for (let i = 0; i < N; i++) aT[i] = N > 1 ? i / (N - 1) : 0;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));

  const uniforms = {
    uTime: controller.shared.uTime,
    uInteraction: controller.shared.uInteraction,
    uFrom: { value: new THREE.Vector3() },
    uTo: { value: new THREE.Vector3() },
    uPx: { value: 300 },
    uFade: { value: 0 },
    uColorA: { value: new THREE.Color(0xffd27a) }, // star-side gold
    uColorB: { value: new THREE.Color(0xfff3d8) }, // hand-side pale
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false; // off until the reach begins

  // Scrubbed window: ignites as her hand closes in, dies just after the grip
  // hands the star over to the reaction. Pure function of progress.
  const off = controller.subscribe((d) => {
    const rise = smoothstep(BEAT.REACH_START + 0.02, BEAT.STAR_CONTACT, d.p);
    const fall = 1 - smoothstep(BEAT.GRIP + 0.01, BEAT.GRIP + 0.07, d.p);
    const fade = rise * fall;
    uniforms.uFade.value = fade;
    points.visible = N > 0 && fade > 0.004;
  });

  /** @param {THREE.Vector3} from star position (world) @param {THREE.Vector3} to palm position (world) */
  function setEndpoints(from, to) {
    uniforms.uFrom.value.copy(from);
    uniforms.uTo.value.copy(to);
  }

  function setPx(px) {
    uniforms.uPx.value = px;
  }

  function dispose() {
    off();
    geometry.dispose();
    material.dispose();
  }

  return { points, uniforms, setEndpoints, setPx, dispose };
}
