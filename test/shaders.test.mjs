/**
 * Shader validation — real GLSL compilation, not a smoke test.
 *
 * The jsdom harness stubs WebGLRenderer, so the app's own tests never compile
 * a single line of GLSL. This suite closes that hole with three layers:
 *
 *   1. Every shader string the app ships is compiled by glslangValidator (a
 *      real GLSL compiler — the Khronos front end) in both stages, including
 *      the LOW (tier-0) variant of the sky.
 *   2. Vertex/fragment varying declarations are cross-checked (glslang's -l
 *      mode does NOT catch varying mismatches on separate stage files, so the
 *      link rule is enforced here explicitly).
 *   3. JS uniforms ↔ GLSL declarations must agree exactly — no shader uniform
 *      the controller/JS side fails to provide, no JS uniform the GLSL never
 *      reads — and the required vocabulary (uTime, uProgress, uIntensity,
 *      uColorA, uColorB, uReveal, uInteraction, uResolution) must exist across
 *      the system.
 *
 * Plus integration checks against the REAL vendored three r128 chunks: the
 * fresnel injection must land in meshphysical_frag's actual output line.
 *
 * Temp files go to test/.glsl-tmp INSIDE the project — /tmp is read-only on
 * this device.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BG_VERT, BG_FRAG } from '../src/shaders/backgroundShader.js';
import { STAR_VERT, STAR_FRAG } from '../src/shaders/magicalStarShader.js';
import { TRAIL_VERT, TRAIL_FRAG } from '../src/effects/energyTrail.js';
import { FRAG_UNIFORMS, FRAG_TAIL, applyFresnelRim } from '../src/shaders/fresnelRim.js';
import { createShaderController } from '../src/shaders/controller.js';
import { createBackground } from '../src/scene/background.js';
import { createEnergyTrail } from '../src/effects/energyTrail.js';
import { createStar } from '../src/scene/star.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, '.glsl-tmp');

/* ------------------------------------------------------------------ */
/* three.js's injected prefix (r128 ShaderMaterial, non-raw)           */
/* ------------------------------------------------------------------ */

const VERT_PRELUDE = `precision highp float;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;

const FRAG_PRELUDE = `precision highp float;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;

/** glslangValidator is provided by the device (pkg install glslang). */
function findValidator() {
  const candidates = ['glslangValidator'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

const validator = findValidator();

function compile(label, vertSrc, fragSrc, extraFragDefine = '') {
  const vFile = join(TMP, `${label}.vert`);
  const fFile = join(TMP, `${label}.frag`);
  writeFileSync(vFile, VERT_PRELUDE + vertSrc);
  writeFileSync(fFile, (extraFragDefine ? `${extraFragDefine}\n` : '') + FRAG_PRELUDE + fragSrc);
  for (const file of [vFile, fFile]) {
    let out = '';
    try {
      out = execFileSync(validator, [file], { encoding: 'utf8' });
    } catch (err) {
      out = `${err.stdout || ''}${err.stderr || ''}`;
      assert.fail(`GLSL compile failed for ${label} (${file}):\n${out}`);
    }
    assert.ok(!/ERROR:/.test(out), `glslang reported errors for ${label}:\n${out}`);
  }
}

/** `varying <type> <name>;` occurrences across a stage. */
function varyings(src) {
  const out = new Map();
  const re = /varying\s+(\w+)\s+(\w+)\s*;/g;
  let m;
  while ((m = re.exec(src))) out.set(m[2], m[1]);
  return out;
}

/** `uniform <type> <name>;` occurrences across a stage. */
function uniformsOf(src) {
  const out = new Set();
  const re = /uniform\s+\w+\s+(\w+)\s*;/g;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/** Names declared on BOTH stages must agree; frag varyings ⊆ vert varyings. */
function checkLink(label, vertSrc, fragSrc) {
  const v = varyings(vertSrc);
  const f = varyings(fragSrc);
  for (const [name, type] of f) {
    assert.equal(v.get(name), type, `${label}: frag varying ${name}:${type} not declared identically in vert`);
  }
}

/** Every declared uniform must also be referenced beyond its declaration. */
function checkNoDeadUniforms(label, ...stages) {
  const all = stages.join('\n');
  for (const name of uniformsOf(all)) {
    const uses = all.split(name).length - 1;
    assert.ok(uses >= 2, `${label}: uniform ${name} is declared but never used`);
  }
}

/** The brief's required uniform vocabulary, across the whole system. */
const REQUIRED_UNIFORMS = [
  'uTime', 'uProgress', 'uIntensity', 'uColorA',
  'uColorB', 'uReveal', 'uInteraction', 'uResolution',
];

/* ------------------------------------------------------------------ */

test('every shipped shader compiles under glslang (both stages, both variants)', (t) => {
  if (!validator) {
    t.skip('glslangValidator not installed on this machine');
    return;
  }
  mkdirSync(TMP, { recursive: true });

  const systems = [
    ['background', BG_VERT, BG_FRAG],
    // The tier-0 variant prepends #define LOW to the FRAGMENT stage.
    ['background-low', BG_VERT, BG_FRAG, '#define LOW'],
    ['star', STAR_VERT, STAR_FRAG],
    ['trail', TRAIL_VERT, TRAIL_FRAG],
  ];
  for (const [label, vert, frag, def] of systems) {
    compile(label, vert, frag, def);
    checkLink(label, vert, frag);
    checkNoDeadUniforms(label, vert, frag);
  }

  // The fresnel injection compiles as the exact block it is: declarations +
  // the tail that gets spliced before gl_FragColor, in a standard-material-
  // shaped harness (normal/vViewPosition/outgoingLight/diffuseColor in scope).
  const rimHarness = `varying vec3 vViewPosition;
varying vec3 vNormal;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 outgoingLight = vec3(0.5);
  vec4 diffuseColor = vec4(1.0);
  ${FRAG_TAIL}
}`;
  const dummyVert = 'void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }';
  compile('fresnel-rim', dummyVert, `${FRAG_UNIFORMS}\n${rimHarness}`);
  checkNoDeadUniforms('fresnel-rim', FRAG_UNIFORMS, FRAG_TAIL);

  rmSync(TMP, { recursive: true, force: true });
});

test('JS uniform objects and GLSL declarations agree exactly', async () => {
  await import('../vendor/three.min.js');
  const THREE = globalThis.THREE;
  assert.ok(THREE, 'vendored three must load in node');

  const controller = createShaderController(THREE, {});

  // --- background ---------------------------------------------------------
  const bg = createBackground(THREE, { controller, quality: { tier: 2 } });
  const bgGlsl = uniformsOf(BG_FRAG).union(uniformsOf(BG_VERT));
  assert.deepEqual([...bgGlsl].sort(), Object.keys(bg.uniforms).sort(),
    'background: GLSL uniforms and JS uniforms must be the same set');

  // --- trail --------------------------------------------------------------
  const trail = createEnergyTrail(THREE, { controller, quality: { motes: 240 }, reducedMotion: false });
  const trailGlsl = uniformsOf(TRAIL_FRAG).union(uniformsOf(TRAIL_VERT));
  assert.deepEqual([...trailGlsl].sort(), Object.keys(trail.uniforms).sort(),
    'trail: GLSL uniforms and JS uniforms must be the same set');

  // --- star: construct the real factory with a minimal canvas stub --------
  const grad = { addColorStop() {} };
  const ctxStub = new Proxy({}, {
    get: (t2, k) => (k === 'createRadialGradient' || k === 'createLinearGradient'
      ? () => grad
      : () => undefined),
    set: () => true,
  });
  const docStub = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),
  };
  const realDoc = globalThis.document;
  globalThis.document = docStub;
  let star;
  try {
    star = createStar(THREE, { controller, quality: { tier: 2 }, reducedMotion: false });
  } finally {
    if (realDoc === undefined) delete globalThis.document;
    else globalThis.document = realDoc;
  }
  const body = star.spin.children.find((c) => c.material && c.material.isShaderMaterial);
  assert.ok(body, 'the star body mesh must exist');
  const starGlsl = uniformsOf(STAR_FRAG).union(uniformsOf(STAR_VERT));
  assert.deepEqual([...starGlsl].sort(), Object.keys(body.material.uniforms).sort(),
    'star: GLSL uniforms and JS uniforms must be the same set');

  // --- shared scalars must be the SAME objects (one write, all shaders) ---
  for (const [label, uniforms] of [['background', bg.uniforms], ['trail', trail.uniforms], ['star', body.material.uniforms]]) {
    for (const name of ['uTime', 'uProgress', 'uIntensity', 'uInteraction', 'uReveal', 'uResolution']) {
      if (uniforms[name] !== undefined && controller.shared[name] !== undefined) {
        assert.equal(uniforms[name], controller.shared[name],
          `${label}: ${name} must be the shared uniform object, not a copy`);
      }
    }
  }

  // --- the required vocabulary exists across the system -------------------
  const system = new Set();
  for (const src of [BG_VERT, BG_FRAG, STAR_VERT, STAR_FRAG, TRAIL_VERT, TRAIL_FRAG, FRAG_UNIFORMS]) {
    for (const n of uniformsOf(src)) system.add(n);
  }
  for (const name of REQUIRED_UNIFORMS) {
    assert.ok(system.has(name), `required uniform ${name} missing from the shader system`);
  }

  bg.dispose();
  trail.dispose();
  star.dispose();
});

test('fresnel injection lands in the real r128 standard-material chunk', async () => {
  await import('../vendor/three.min.js');
  const THREE = globalThis.THREE;
  const chunk = THREE.ShaderChunk.meshphysical_frag;

  // The anchors the injection replaces must exist in the vendored build —
  // if a three upgrade renames them, this fails loudly instead of the rim
  // silently vanishing.
  assert.ok(chunk.includes('#include <common>'), 'meshphysical_frag must include <common>');
  assert.ok(
    chunk.includes('gl_FragColor = vec4( outgoingLight, diffuseColor.a );'),
    'meshphysical_frag must assign gl_FragColor from outgoingLight (r128 layout)'
  );
  assert.ok(
    THREE.ShaderChunk.normal_fragment_begin.includes('vec3 normal'),
    'normal_fragment_begin must define `normal` for the rim calculation'
  );

  const controller = createShaderController(THREE, {});
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
  const uniforms = applyFresnelRim(THREE, material, { controller });

  // Run the REAL onBeforeCompile over the REAL chunk text.
  const shader = { uniforms: {}, fragmentShader: chunk, vertexShader: '' };
  material.onBeforeCompile(shader, {});

  const rimIndex = shader.fragmentShader.indexOf('outgoingLight += rimCol');
  const outIndex = shader.fragmentShader.indexOf('gl_FragColor = vec4( outgoingLight');
  assert.ok(rimIndex > 0, 'rim addition must be injected');
  assert.ok(outIndex > rimIndex, 'rim must be added BEFORE the output line (so it tone-maps)');
  assert.equal(shader.fragmentShader.split('outgoingLight += rimCol').length - 1, 1, 'inject exactly once');
  assert.ok(shader.fragmentShader.includes(FRAG_UNIFORMS), 'uniform block lands after <common>');

  // Uniforms: same shared objects for scalars, private pair for colours.
  assert.equal(shader.uniforms.uTime, controller.shared.uTime);
  assert.equal(shader.uniforms.uProgress, controller.shared.uProgress);
  assert.equal(shader.uniforms.uIntensity, controller.shared.uIntensity);
  assert.deepEqual(Object.keys(uniforms).sort(),
    ['uColorA', 'uColorB', 'uIntensity', 'uProgress', 'uRimStrength', 'uTime']);

  // Program sharing: the injected source must be byte-identical across
  // materials (r128 keys programs on onBeforeCompile.toString()).
  const m2 = new THREE.MeshStandardMaterial();
  applyFresnelRim(THREE, m2, { controller });
  assert.equal(material.onBeforeCompile.toString(), m2.onBeforeCompile.toString(),
    'identical injection source → shared compiled program');

  const src = readFileSync(join(HERE, '..', 'src', 'shaders', 'fresnelRim.js'), 'utf8');
  assert.ok(src.includes('gl_FragColor = vec4( outgoingLight, diffuseColor.a );'),
    'the tail must quote the exact anchor string (it is load-bearing)');
});
