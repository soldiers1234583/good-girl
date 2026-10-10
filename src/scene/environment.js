/**
 * The world she stands in.
 *
 * Kept deliberately sparse: a blocky ground disc, two rings of stepped voxel
 * towers for parallax depth, and exponential fog that dissolves them into the
 * sky. The brief asks for a "deep atmospheric background", and depth reads
 * through separation and fog far better than through added detail — plus
 * every object saved here is a frame saved on a phone.
 *
 * The Minecraft-shaders look lives HERE rather than on the character: the
 * floor is painted in nearest-filtered blocks and the silhouettes are stacks
 * of boxes, while she stays the soft chibi the story is about.
 */

import { makeRandom } from '../util/math.js';

export function createEnvironment(THREE, ctx = {}) {
  const quality = Object.assign({ backdrop: 1 }, ctx.quality || {});
  const group = new THREE.Group();
  const disposables = [];

  /* ---------- ground ---------- */
  // A radial falloff painted in BLOCKS (16 px cells, nearest magnification):
  // the clearing reads as a lit voxel floor instead of a smooth decal — the
  // Minecraft-shaders look — while keeping the exact brightness curve the
  // original soft gradient had (bright under her, dark toward the rim).
  // Same alpha semantics as before: white where lit, transparent black where
  // dark, so material.color (palette-driven) still decides the hue.
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = groundCanvas.height = 256;
  {
    const x = groundCanvas.getContext('2d');
    const CELLS = 16;
    const C = 256 / CELLS;
    const gr = makeRandom(0x6d1a2b3c);
    for (let cy = 0; cy < CELLS; cy++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const u = (cx + 0.5) / CELLS - 0.5;
        const v = (cy + 0.5) / CELLS - 0.5;
        const d = Math.min(1, Math.hypot(u, v) * 2.05);
        let a = Math.pow(1 - d, 1.7) * 0.85;
        a *= 0.78 + 0.22 * gr(); // per-block unevenness
        if (gr() > 0.93) a = Math.min(1, a + 0.18); // the odd lit block
        if (a <= 0.004) continue;
        x.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        x.fillRect(cx * C, cy * C, C, C);
      }
    }
  }
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  // Nearest keeps the blocks crisp up close; mipmaps still soften the far
  // field so the disc does not sparkle under camera motion.
  groundTex.magFilter = THREE.NearestFilter;
  disposables.push(groundTex);

  const groundGeo = new THREE.CircleGeometry(34, quality.backdrop >= 0.85 ? 64 : 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f33,
    map: groundTex,
    roughness: 0.94,
    metalness: 0.06,
    transparent: false,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  group.add(ground);
  disposables.push(groundGeo, groundMat);

  /* ---------- distant blocky silhouettes ---------- */
  // Two rings at different radii read as two depth planes when the camera
  // moves; the far ring is darker and taller so it settles into the fog.
  // Each silhouette is a STACK OF BOXES — a stepped voxel tower — so the
  // horizon reads as blocky terrain rather than smooth crystal shards.
  const rand = makeRandom(20261008);

  function towerGeometry() {
    const parts = [
      { w: 1.0, h: 0.5, d: 1.0, x: 0.0, y: 0.25, z: 0.0 },
      { w: 0.74, h: 0.3, d: 0.74, x: 0.05, y: 0.65, z: -0.04 },
      { w: 0.46, h: 0.24, d: 0.46, x: -0.06, y: 0.92, z: 0.05 },
    ];
    let count = 0;
    const nonIndexed = parts.map((p) => {
      const raw = new THREE.BoxGeometry(p.w, p.h, p.d);
      const g = raw.toNonIndexed();
      raw.dispose();
      g.translate(p.x, p.y, p.z);
      count += g.attributes.position.count;
      return g;
    });
    // Merge by hand: BufferGeometryUtils lives in examples/jsm, which this
    // project deliberately does not vendor.
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    let offset = 0;
    for (const g of nonIndexed) {
      position.set(g.attributes.position.array, offset * 3);
      normal.set(g.attributes.normal.array, offset * 3);
      offset += g.attributes.position.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    return geo;
  }

  const layers = [];
  const layerSpecs = [
    // [count, radiusMin, radiusMax, heightMin, heightMax, shade]
    [14, 9.5, 14, 1.2, 3.4, 0.34],
    [18, 17, 26, 2.2, 6.2, 0.2],
  ];
  const layerCount = quality.backdrop >= 0.85 ? layerSpecs.length : 1;

  for (let li = 0; li < layerCount; li++) {
    const [count, rMin, rMax, hMin, hMax, shade] = layerSpecs[li];
    const geo = towerGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(shade, shade, shade * 1.12),
      roughness: 0.95,
      metalness: 0,
    });
    disposables.push(geo, material);
    const meshes = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, material);
      const a = (i / count) * Math.PI * 2 + rand() * 0.34;
      const r = rMin + rand() * (rMax - rMin);
      const h = hMin + rand() * (hMax - hMin);
      const w = h * (0.5 + rand() * 0.7);
      m.position.set(Math.cos(a) * r, -0.15 + h * 0.2, Math.sin(a) * r);
      m.scale.set(w, h, w * (0.7 + rand() * 0.5));
      m.rotation.y = rand() * Math.PI * 2;
      group.add(m);
      meshes.push({ mesh: m, baseY: m.position.y, ph: rand() * Math.PI * 2 });
    }
    layers.push(meshes);
  }

  /* ---------- fog ---------- */
  const fog = new THREE.FogExp2(0x040612, 0.052);

  /* ---------- state ---------- */
  const groundColor = new THREE.Color(0x1a1f33);
  const fogColor = new THREE.Color(0x040612);
  let targetFogDensity = 0.052;

  /**
   * @param {object} pal palette reading from `story/palette.js`
   * @param {number} p   story progress, used to gently clear the fog as the
   *                     world warms — the air feels less heavy at the reward.
   */
  function applyPalette(pal, p = 0) {
    fogColor.setRGB(pal.fog[0], pal.fog[1], pal.fog[2]);
    // Ground picks up the sky colour but stays several stops darker so she
    // keeps her silhouette.
    groundColor.setRGB(pal.ground[0] * 1.6, pal.ground[1] * 1.6, pal.ground[2] * 1.7);
    groundMat.color.copy(groundColor);
    targetFogDensity = 0.062 - 0.026 * p;
  }

  function update(dt, t, reducedMotion) {
    fog.density += (targetFogDensity - fog.density) * (1 - Math.exp(-dt * 2));
    if (reducedMotion) return;
    // A very slow drift on the far ring sells "atmospheric movement" without
    // costing a shader.
    for (const mesh of layers[layers.length - 1] || []) {
      mesh.mesh.position.y = mesh.baseY + Math.sin(t * 0.22 + mesh.ph) * 0.06;
    }
  }

  function dispose() {
    disposables.forEach((d) => d.dispose && d.dispose());
    layers.length = 0;
  }

  return { group, fog, applyPalette, update, dispose, ground };
}
