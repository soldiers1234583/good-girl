/**
 * The world she stands in.
 *
 * Kept deliberately sparse: a soft ground disc, two rings of distant
 * silhouettes for parallax depth, and exponential fog that dissolves them into
 * the sky. The brief asks for a "deep atmospheric background", and depth
 * reads through separation and fog far better than through added detail -
 * plus every object saved here is a frame saved on a phone.
 */

import { makeRandom } from '../util/math.js';

export function createEnvironment(THREE, ctx = {}) {
  const quality = Object.assign({ backdrop: 1 }, ctx.quality || {});
  const group = new THREE.Group();
  const disposables = [];

  /* ---------- ground ---------- */
  // A painted radial falloff (bright under her, dark toward the rim) plus fog
  // gives the sense of a lit clearing without any real shadowing.
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = groundCanvas.height = 256;
  {
    const x = groundCanvas.getContext('2d');
    const g = x.createRadialGradient(128, 128, 8, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  }
  const groundTex = new THREE.CanvasTexture(groundCanvas);
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

  /* ---------- distant silhouettes ---------- */
  // Two rings at different radii read as two depth planes when the camera
  // moves; the far ring is darker and taller so it settles into the fog.
  const rand = makeRandom(20261008);

  function rockGeometry(detail) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // Squash and skew so nothing reads as a plain icosahedron.
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = 0.78 + 0.34 * Math.abs(Math.sin(x * 3.1 + y * 2.2 + z * 1.7));
      p.setXYZ(i, x * n, y * n * 0.9, z * n);
    }
    g.computeVertexNormals();
    return g;
  }

  const layers = [];
  const layerSpecs = [
    // [count, radiusMin, radiusMax, heightMin, heightMax, detail, shade]
    [14, 9.5, 14, 1.2, 3.4, 1, 0.34],
    [18, 17, 26, 2.2, 6.2, 0, 0.2],
  ];
  const layerCount = quality.backdrop >= 0.85 ? layerSpecs.length : 1;

  for (let li = 0; li < layerCount; li++) {
    const [count, rMin, rMax, hMin, hMax, detail, shade] = layerSpecs[li];
    const geo = rockGeometry(detail);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(shade, shade, shade * 1.12),
      roughness: 0.95,
      metalness: 0,
      flatShading: detail === 0,
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
