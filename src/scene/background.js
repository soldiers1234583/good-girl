/**
 * The sky, as a mesh.
 *
 * One screen-space quad drawn first (renderOrder -1000, depthTest off) so it
 * behaves exactly like the CSS `.backdrop` layer it stands in for: the world
 * draws on top of it, the vignette and grain layers still sit above the
 * canvas. The CSS backdrop itself is left untouched — it remains the
 * fallback whenever WebGL is unavailable (see main.js / hud.js).
 *
 * Colours come from the palette every frame (one subscriber, three float
 * writes); time/progress/reveal come from the shared uniform objects owned by
 * the shader controller, so nothing else can fight over them.
 */

import { BG_VERT, BG_FRAG } from '../shaders/backgroundShader.js';

export function createBackground(THREE, ctx = {}) {
  const controller = ctx.controller;
  const quality = Object.assign({ tier: 2 }, ctx.quality || {});

  const uniforms = {
    uTime: controller.shared.uTime,
    uProgress: controller.shared.uProgress,
    uIntensity: controller.shared.uIntensity,
    uReveal: controller.shared.uReveal,
    uResolution: controller.shared.uResolution,
    uColorA: { value: new THREE.Color(0x0a1230) },
    uColorB: { value: new THREE.Color(0x03050f) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BG_VERT,
    fragmentShader: BG_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    fog: false,
    // Constrained devices drop the cloud/ray layers. Compiled ONCE at boot;
    // the shader is never recompiled during scroll.
    defines: quality.tier > 0 ? {} : { LOW: '' },
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000; // opaque sort key: first, behind everything

  const off = controller.subscribe((d) => {
    const p = d.palette;
    uniforms.uColorA.value.setRGB(p.bgInner[0], p.bgInner[1], p.bgInner[2]);
    uniforms.uColorB.value.setRGB(p.bgOuter[0], p.bgOuter[1], p.bgOuter[2]);
  });

  function dispose() {
    off();
    geometry.dispose();
    material.dispose();
  }

  return { mesh, uniforms, material, dispose };
}
