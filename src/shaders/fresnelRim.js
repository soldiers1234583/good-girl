/**
 * Fresnel rim light, injected into the built-in materials.
 *
 * Strategy: `onBeforeCompile`, NOT a replacement material. Her skin, hair,
 * dress and shoes keep their exact lighting, maps, vertex colours and
 * clearcoat — we only append a view-dependent edge term to `outgoingLight`,
 * before tone mapping and encoding, so the rim is tone-mapped like every
 * other light in the scene (no cartoon outline, no double-tonemapped glow).
 *
 * Program sharing: r128's default `customProgramCacheKey` is
 * `onBeforeCompile.toString()`. This file assigns the SAME function source to
 * every material, so all rimmed materials compile to ONE shared program (plus
 * one more for materials carrying different defines such as USE_COLOR); the
 * per-material uniform values stay per-material. Nothing recompiles during
 * scroll.
 *
 * Colours: uColorA = cool atmosphere rim (blue/violet nights),
 * uColorB = warm gold rim (after the star is collected), crossfaded by
 * uProgress in the shader. Strength breathes with uIntensity so the rim
 * brightens with the star instead of sitting there like a decal.
 */

export const FRAG_UNIFORMS = `
uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform float uRimStrength;
uniform vec3 uColorA;
uniform vec3 uColorB;`;

// Runs exactly where the standard/physical fragment shader assigns
// gl_FragColor — outgoingLight is final, tone mapping has not run yet.
// `normal` (view space, from normal_fragment_begin) and `vViewPosition`
// (declared unconditionally by meshphysical_frag) are both in scope.
export const FRAG_TAIL = `
  {
    vec3 rimV = normalize(vViewPosition);
    float rimF = 1.0 - max(dot(normalize(normal), rimV), 0.0);
    rimF = rimF * rimF * (3.0 - 2.0 * rimF); // smooth, soft edge — no outline
    float warm = smoothstep(0.5, 0.92, uProgress);
    vec3 rimCol = mix(uColorA, uColorB, warm);
    float shimmer = 0.92 + 0.08 * sin(uTime * 1.1);
    float energy = 0.55 + 0.45 * clamp(uIntensity * 0.6, 0.0, 2.0);
    outgoingLight += rimCol * pow(rimF, 2.2) * uRimStrength * shimmer * energy;
  }
  gl_FragColor = vec4( outgoingLight, diffuseColor.a );`;

/**
 * Add the rim to one material. Returns the material's private uniforms for
 * tuning and tests.
 *
 * @param {object} THREE  the vendored Three global
 * @param {THREE.Material} material  MeshStandardMaterial or MeshPhysicalMaterial
 * @param {{controller: object}} ctx
 */
export function applyFresnelRim(THREE, material, ctx = {}) {
  const shared = ctx.controller.shared;
  const uniforms = {
    uTime: shared.uTime,
    uProgress: shared.uProgress,
    uIntensity: shared.uIntensity,
    uColorA: { value: new THREE.Color(0x5f7cff) },
    uColorB: { value: new THREE.Color(0xffc46a) },
    uRimStrength: { value: 0.34 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_UNIFORMS)
      .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', FRAG_TAIL);
  };

  return uniforms;
}
