/**
 * The Minecraft world around the clearing.
 *
 * Faithful 16x16 PNGs on instanced cubes + three cross-quad sprite families
 * (tufts, flowers, tall grass). The whole module is ASYNC-SEeded: the caller
 * must await build() before adding us to the scene; build() NEVER throws —
 * failed texture requests degrade to painted stand-ins inside the loader.
 *
 * Budget policy (the phone is tier 0 at ~1.35 dpr):
 *   - 5 instanced meshes for terrain (hills: grass-side cube, stone, sand,
 *     gravel + glowstone boulders)
 *   - 2 for trees (trunks, canopies) + 1 for boulders
 *   - 3 sprite families (tuft, tall grass, flowers)
 *   - every family renders in ONE draw call; ~330 instances total
 *   - NO shadow casting, NO transparent-overdraw foliage near the camera path,
 *     NO post-processing interaction (this module is plain MeshStandard)
 *
 * The palette journey is respected by tinting each family's material color a
 * little every frame (a Color.setRGB is free next to a shader compile), while
 * every instance keeps its own baked per-vertex hue jitter.
 */

import { makeRandom } from '../util/math.js';
import { loadMinecraftTextures } from '../util/textures.js';

const CELL = 1; // one world unit = one block; her height is ~2.1 units

/** Cheap box geometry with per-face UVs already correct for a full tile. */
function unitCube(THREE) {
  const g = new THREE.BoxGeometry(CELL, CELL, CELL);
  return g;
}

/** Cross of two quads — the standard Minecraft plant sprite shape. */
function crossQuads(THREE, size) {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const g2 = geo.clone();
  g2.rotateY(Math.PI / 2);
  // merge by hand: BufferGeometryUtils is not vendored in this project
  const a = geo.attributes.position.array;
  const b = g2.attributes.position.array;
  const pos = new Float32Array(a.length + b.length);
  pos.set(a, 0);
  pos.set(b, a.length);
  const na = geo.attributes.normal.array;
  const nb = g2.attributes.normal.array;
  const nor = new Float32Array(na.length + nb.length);
  nor.set(na, 0);
  nor.set(nb, na.length);
  const ua = geo.attributes.uv.array;
  const ub = g2.attributes.uv.array;
  const uv = new Float32Array(ua.length + ub.length);
  uv.set(ua, 0);
  uv.set(ub, ua.length);
  const idx = [];
  const ia = geo.index.array;
  const ib = g2.index.array;
  for (let i = 0; i < ia.length; i++) idx.push(ia[i]);
  for (let i = 0; i < ib.length; i++) idx.push(ib[i] + 4);
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setIndex(idx);
  geo.dispose();
  g2.dispose();
  // origin at the feet, so placement math stays in "ground level" terms
  merged.translate(0, size / 2, 0);
  return merged;
}

export function createTerrain(THREE, ctx = {}) {
  const quality = Object.assign({ backdrop: 1, tier: 2 }, ctx.quality || {});
  const group = new THREE.Group();
  const disposables = [];
  const rand = makeRandom(0x51acb10c); // deterministic — scrubbing must not reseed the world

  const built = { value: false };
  let sharedTextures = null;
  let glowMat = null; // set inside build() // sprites that react to "wind"
  const tintables = []; // materials whose .color follows the palette

  const mkStandard = (opts) => {
    const m = new THREE.MeshStandardMaterial(
      Object.assign({ roughness: 1, metalness: 0 }, opts)
    );
    disposables.push(m);
    return m;
  };
  const mkSprite = (tex, tint) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
      color: tint,
    });
    disposables.push(m);
    tintables.push(m);
    return m;
  };
  const mkInstanced = (geo, mat, transforms) => {
    const im = new THREE.InstancedMesh(geo, mat, transforms.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    transforms.forEach((t, i) => {
      e.set(0, t.yaw || 0, 0);
      q.setFromEuler(e);
      v.set(t.x, t.y, t.z);
      s.set(t.sx || 1, t.sy || 1, t.sz || 1);
      m4.compose(v, q, s);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false; // the ring encircles the camera; per-instance culling would hide half of it
    return im;
  };

  async function build() {
    const tex = await loadMinecraftTextures(THREE);
    sharedTextures = tex;

    /* ---------- shared materials ---------- */
    // Grass cube: top face gets grass_top, sides get grass_side (with dirt),
    // bottom dirt. BoxGeometry's material index order is +x,-x,+y,-y,+z,-z,
    // so an ARRAY material covers every face without a shader edit.
    const sideTex = tex.grassSide || tex.dirt;
    const topTex = tex.grassTop || tex.grassSide || tex.dirt;
    const dirtTex = tex.dirt || sideTex;
    const grassMats = [
      mkStandard({ map: sideTex }),
      mkStandard({ map: sideTex }),
      mkStandard({ map: topTex }),
      mkStandard({ map: dirtTex }),
      mkStandard({ map: sideTex }),
      mkStandard({ map: sideTex }),
    ].map((m) => {
      tintables.push(m);
      return m;
    });

    const stoneMat = mkStandard({ map: tex.stone || tex.cobble || dirtTex });
    tintables.push(stoneMat);
    const sandMat = mkStandard({ map: tex.sand || tex.dirt });
    tintables.push(sandMat);
    const gravelMat = mkStandard({ map: tex.gravel || tex.dirt });
    tintables.push(gravelMat);
    const plankMat = mkStandard({ map: tex.plank || dirtTex });
    tintables.push(plankMat);
    // Glowstone: the one genuinely emissive block in the scene (a small hearth
    // of it sits near the camera path; the star is NOT its light source).
    glowMat = mkStandard({ map: tex.glow || dirtTex, emissive: 0xffb84c, emissiveIntensity: 0.55, emissiveMap: tex.glow || null });
    tintables.push(glowMat);

    const logMats = [mkStandard({ map: tex.log || plankMat.map }), mkStandard({ map: tex.logTop || tex.log || plankMat.map })];
    logMats.forEach((m) => tintables.push(m));
    const leafMat = mkStandard({ map: tex.leaves || dirtTex, transparent: true, alphaTest: 0.42, side: THREE.FrontSide });
    tintables.push(leafMat);

    /* ---------- the hill ring ---------- */
    // Two depth layers of voxel hills. The near ring is low and sparse; the
    // far ring climbs higher and settles into the fog for a true skyline.
    const cube = unitCube(THREE);
    disposables.push(cube);
    const hillTransforms = [];
    const stoneT = [];
    const sandT = [];
    const gravelT = [];
    const glowT = [];

    const pushHill = (angle, radius, height, mat) => {
      // Each hill is a contiguous STACK of instances (one per block layer),
      // which keeps every draw call an InstancedMesh at the cost of many
      // duplicate matrices — acceptable: a matrix is 64 bytes and the rings
      // hold ~200 stacks total.
      const layers = Math.max(1, Math.round(height));
      for (let l = 0; l < layers; l++) {
        hillTransforms.push({
          x: Math.cos(angle) * radius,
          y: l * CELL - 0.12, // sunk slightly so the base row never shows a gap
          z: Math.sin(angle) * radius,
          yaw: (l % 2) * (Math.PI / 2) + angle, // alternate tops for variety
        });
      }
    };

    const ringSpec = quality.backdrop >= 0.85
      ? [
          // [count, rMin, rMax, hMin, hMax, material chooser]
          [26, 10, 14.5, 1, 4, 'near'],
          [34, 17, 27, 2, 9, 'far'],
        ]
      : [
          [16, 11, 16, 1, 3, 'near'],
          [20, 18, 26, 2, 6, 'far'],
        ];
    const layerMatFor = (i, r) => {
      // Deterministic, hash-ish mix so material variety is stable across runs.
      if (r > 22 && i % 7 === 0) return sandMat;
      const roll = (i * 31 + Math.floor(r * 10)) % 10;
      if (roll > 7) return stoneMat;
      if (roll > 5) return gravelMat;
      return grassMats[0];
    };
    for (const [count, rMin, rMax, hMin, hMax, kind] of ringSpec) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.5;
        const r = rMin + rand() * (rMax - rMin);
        const h = hMin + rand() * (hMax - hMin);
        // Stack of cube instances, one per block layer; material inferred by
        // height so the near ring reads grassy and the far ring stony.
        const layers = Math.max(1, Math.round(h));
        for (let l = 0; l < layers; l++) {
          const t = {
            x: Math.cos(a) * r,
            y: l * CELL - 0.12,
            z: Math.sin(a) * r,
            yaw: (l % 2) * (Math.PI / 2) + a,
          };
          const m = kind === 'far' ? layerMatFor(i, r) : grassMats[0];
          // Per-block instance: low stacks (~1-4) don't worry the budget.
          (m === grassMats[0] ? hillTransforms : m === stoneMat ? stoneT : m === gravelMat ? gravelT : sandT).push(t);
        }
      }
    }

    /* ---------- scattered glowstone hearths (near ring only) ---------- */
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const r = 8.5 + rand() * 2.5;
      glowT.push({ x: Math.cos(a) * r, y: 0.38, z: Math.sin(a) * r });
    }

    /* ---------- oak trees ---------- */
    const TRUNK_H = 5;
    const trunkTransforms = [];
    const canopyTransforms = [];
    const treeCount = quality.backdrop >= 0.85 ? 9 : 6;
    for (let i = 0; i < treeCount; i++) {
      const a = (i / treeCount) * Math.PI * 2 + rand() * 0.9;
      const r = 11 + rand() * 9; // always outside the near ring, never behind her walk line
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      const baseY = -0.12;
      for (let l = 0; l < TRUNK_H; l++) {
        trunkTransforms.push({ x: bx, y: baseY + l * CELL + CELL / 2, z: bz, yaw: 0 });
      }
      // canopy: a 3x2x3 slab with the corners shaved off (classic vanilla oak)
      const cy = baseY + TRUNK_H * CELL + CELL / 2;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = 0; dy < 2; dy++) {
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && (dy === 1 || rand() > 0.5)) continue; // shaved corners, deterministic-ish
            canopyTransforms.push({
              x: bx + dx * CELL,
              y: cy + dy * CELL,
              z: bz + dz * CELL,
              yaw: ((dx * 7 + dz * 11 + dy * 3) % 4) * (Math.PI / 2),
            });
          }
        }
      }
      canopyTransforms.push({ x: bx, y: cy + 2 * CELL, z: bz, yaw: 0 }); // the top cap
    }
    const logCube = unitCube(THREE);
    disposables.push(logCube);
    const trunkMesh = mkInstanced(logCube, mkStandard({ map: tex.log || dirtTex }), trunkTransforms);
    tintables.push(trunkMesh.material);
    const logTopCube = unitCube(THREE);
    disposables.push(logTopCube);
    const logTopOverlay = mkInstanced(logTopCube, mkStandard({ map: tex.logTop || tex.log || dirtTex }), []);
    tintables.push(logTopOverlay.material);
    logTopOverlay.count = 0; // we keep the geometry/material but render nothing until leaves fall (never)
    const canopyCube = unitCube(THREE);
    disposables.push(canopyCube);
    const canopyMesh = mkInstanced(canopyCube, leafMat, canopyTransforms);

    /* ---------- ground scatter: tufts, tall grass, flowers ---------- */
    const tuftGeo = crossQuads(THREE, 0.9);
    const tallGeo = crossQuads(THREE, 1.4);
    disposables.push(tuftGeo, tallGeo);
    const tuftTransforms = [];
    const tallTransforms = [];
    const flowerTransforms = [];
    const tuftCount = quality.backdrop >= 0.85 ? 190 : 90;
    for (let i = 0; i < tuftCount; i++) {
      const a = rand() * Math.PI * 2;
      const r = 2.4 + Math.pow(rand(), 0.7) * 16; // bias toward the clearing rim
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const kind = rand();
      (kind < 0.62 ? tuftTransforms : kind < 0.85 ? tallTransforms : flowerTransforms).push({
        x,
        y: 0,
        z,
        yaw: rand() * Math.PI,
      });
    }
    const flowerMats = [mkSprite(tex.poppy || tex.tuft, 0xffffff), mkSprite(tex.dandelion || tex.tuft, 0xffffff)];
    const flowerMeshes = flowerTransforms.map((t, i) =>
      mkInstanced(i % 2 ? tallGeo : tuftGeo, flowerMats[i % 2], [t])
    );
    const tuftMesh = mkInstanced(tuftGeo, mkSprite(tex.tuft || tex.tallTop, 0xffffff), tuftTransforms);
    const tallMesh = mkInstanced(tallGeo, mkSprite(tex.tallTop || tex.tuft, 0xffffff), tallTransforms);
    tuftMesh.userData.sway = 0;
    tallMesh.userData.sway = 1;
    flowerMeshes.forEach((m, i) => { m.userData.sway = 2 + i; });

    /* ---------- assemble the instanced meshes ---------- */
    const hillGrass = mkInstanced(cube, grassMats, hillTransforms);
    const hillStone = mkInstanced(cube, stoneMat, stoneT);
    const hillGravel = mkInstanced(cube, gravelMat, gravelT);
    const hillSand = mkInstanced(cube, sandMat, sandT);
    const glowCube = unitCube(THREE);
    disposables.push(glowCube);
    const glowMesh = mkInstanced(glowCube, glowMat, glowT);

    for (const m of [hillGrass, hillStone, hillGravel, hillSand, glowMesh, trunkMesh, canopyMesh, tuftMesh, tallMesh, ...flowerMeshes]) {
      group.add(m);
      disposables.push(m);
    }

    built.value = true;
  }

  /* ---------- per-frame: palette tint + wind sway ---------- */
  const tmpColor = new THREE.Color();
  let swayT = 0;

  /**
   * @param {object} pal palette from story/palette.js — we read `sky` (cool
   *   moonlight tint for the block surfaces) and `mote` (warm accent for
   *   glowstone)
   * @param {number} starInfluence  how strongly the star warms the near field
   * @param {number} dt frame delta
   */
  function applyPalette(pal, starInfluence = 0, dt = 1 / 60) {
    if (!built.value) return;
    // Block surfaces read moonlight: cool, dim, a hint of the sky color.
    // Materials that already had a texture do most of the visual lifting;
    // this tint is the last 15% and it is what unifies blocks with the sky.
    tmpColor.setRGB(
      0.45 + pal.sky[0] * 0.55 + starInfluence * 0.25,
      0.5 + pal.sky[1] * 0.5 + starInfluence * 0.2,
      0.58 + pal.sky[2] * 0.42 + starInfluence * 0.1
    );
    for (const m of tintables) m.color.copy(tmpColor);
    // Glowstone stays warm, gets a touch more orange as the star reacts.
    glowMat.color.setRGB(
      0.9 + starInfluence * 0.1,
      0.72 + starInfluence * 0.22,
      0.42 + starInfluence * 0.3
    );
  }

  function update(dt, t, reducedMotion) {
    if (!built.value || reducedMotion) return;
    swayT = t;
    // Wind: only the sprite families move (cheap: 1 rotation + one object
    // transform per family per frame; no matrix re-upload per instance).
    for (const m of group.children) {
      if (!m.isInstancedMesh || !m.userData.sway) continue;
      const lean = Math.sin(swayT * 1.3 + m.userData.sway * 2.1) * 0.035;
      m.rotation.z = lean;
    }
  }

  /** Distance feel: fog washes blocks out past the near ring on purpose. */
  function dispose() {
    for (const d of disposables) d && d.dispose && d.dispose();
    disposables.length = 0;
    group.clear && group.clear();
  }

  return { group, build, applyPalette, update, dispose, get ready() { return built.value; }, get sharedTextures() { return sharedTextures; } };
}
