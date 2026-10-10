/**
 * The chibi girl.
 *
 * Refactored from the original standalone asset ("Chibi Character - Three.js
 * Asset.html") into a driven module. The geometry, materials and texture
 * painting are carried over unchanged - that is the part that reads as *her*
 * and there was nothing to gain by rewriting it. What changed:
 *
 *   - Legs became addressable joints on the same convention as the arms, so a
 *     walk cycle is possible (the original built them inline in a forEach and
 *     kept no references).
 *   - A palm marker was added so the star can be placed into her hand exactly.
 *   - Animation moved out of the asset's demo loop and into `setIntent()`,
 *     driven by the choreography's girl directives.
 *   - The walk cycle is derived from the scrubbed `walk` progress rather than
 *     accumulated from delta time. That is essential: the timeline is
 *     reversible, and a dt-driven cycle would moonwalk when the user scrolls
 *     back up.
 *   - Everything is disposable.
 */

const PALM = [0, -0.058, 0.012];

export function createCharacter(THREE, ctx = {}) {
  const quality = Object.assign({ hairDetail: 1, starDetail: 1 }, ctx.quality || {});
  const G = THREE.Group;
  const V3 = THREE.Vector3;

  /* ---------- tiny local helpers (as in the source asset) ---------- */
  const add = (o, p, par) => {
    if (p) o.position.set(p[0], p[1], p[2]);
    if (par) par.add(o);
    return o;
  };
  const M = (c, r, m, x) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m || 0 }, x || {}));
  const cyl = (a, b, l, m, p, par, top) => {
    const g = new THREE.CylinderGeometry(a, b, l, 12, 1);
    if (top) g.translate(0, -l / 2, 0);
    return add(new THREE.Mesh(g, m), p, par);
  };
  const sph = (r, m, p, par, s) => {
    const o = add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m), p, par);
    if (s) o.scale.set(s[0], s[1], s[2]);
    return o;
  };

  const textures = [];
  function tex(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    fn(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    textures.push(t);
    return t;
  }

  const mat = {
    skin: M(0xf0c0a6, 0.5, 0, { emissive: 0x4a1a0c, emissiveIntensity: 0.3 }),
    hair: M(0xffffff, 0.36, 0.12, { vertexColors: true }),
    cap: M(0x73462c, 0.4, 0.12),
    bodice: M(0xb7a6e6, 0.75),
    skirt: M(0xa6c2ee, 0.8),
    under: M(0xf2dcef, 0.85),
    ribbon: M(0xf2a6c2, 0.3, 0),
    cream: M(0xfff0da, 0.8),
    shoe: new THREE.MeshPhysicalMaterial({ color: 0xe895b3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.2 }),
    sole: M(0x5a3a3a, 0.7),
    gold: M(0xf5d27a, 0.3, 0.6),
  };

  /* ---------- rig ---------- */
  const root = new G();
  const hips = add(new G(), [0, 0.62, 0], root);
  const spine = add(new G(), [0, 0, 0], hips);

  /* ---------- torso & dress ---------- */
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg || 48);
  const ds = (g, m) => {
    m.side = THREE.DoubleSide;
    return new THREE.Mesh(g, m);
  };

  const torso = add(
    ds(lathe([[0.001, 0], [0.15, 0], [0.14, 0.15], [0.125, 0.28], [0.14, 0.42], [0.12, 0.5], [0.06, 0.56]]), mat.bodice),
    null,
    spine
  );
  torso.scale.x = 1.05;
  cyl(0.045, 0.05, 0.1, mat.skin, [0, 0.53, 0], spine);
  const collar = add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.024, 10, 32), mat.cream), [0, 0.5, 0], spine);
  collar.rotation.x = Math.PI / 2;
  [0.3, 0.38, 0.46].forEach((y, i) => sph(0.012, mat.gold, [0, y, 0.14 - i * 0.012], spine));

  const skInner = lathe([[0.15, 0.28], [0.2, 0.2], [0.29, 0.03], [0.35, -0.12], [0.375, -0.24]]);
  const skOuter = lathe([[0.15, 0.3], [0.19, 0.24], [0.27, 0.08], [0.34, -0.08], [0.365, -0.18]], 64);
  {
    // Scalloped hem: pull the lower rim into soft points so the skirt reads as
    // fabric rather than a lathe solid.
    const p = skOuter.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = Math.max(0, Math.min(1, (-0.08 - y) / 0.1));
      p.setY(i, y - 0.045 * k * (0.5 + 0.5 * Math.cos(10 * Math.atan2(x, z))));
    }
    skOuter.computeVertexNormals();
  }
  add(ds(skInner, mat.under), null, hips);
  add(ds(skOuter, mat.skirt), null, hips);
  const hem = add(new THREE.Mesh(new THREE.TorusGeometry(0.372, 0.01, 6, 64), mat.cream), [0, -0.235, 0], hips);
  hem.rotation.x = Math.PI / 2;
  const sash = add(new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.024, 8, 40), mat.ribbon), [0, 0.29, 0], hips);
  sash.rotation.x = Math.PI / 2;

  function bow(par, s, p, rx) {
    const g = add(new G(), p, par);
    g.scale.setScalar(s);
    g.rotation.x = rx || 0;
    [-1, 1].forEach((k) => {
      const l = sph(0.05, mat.ribbon, [k * 0.055, 0, 0], g, [1.1, 0.7, 0.45]);
      l.rotation.z = k * 0.3;
      const t = cyl(0.02, 0.008, 0.12, mat.ribbon, [k * 0.03, -0.01, -0.01], g, 1);
      t.rotation.z = k * 0.28;
      t.scale.z = 0.35;
    });
    sph(0.024, mat.ribbon, [0, 0, 0.008], g);
    return g;
  }
  bow(spine, 1, [0, 0.44, 0.135], -0.15);
  bow(hips, 1.4, [0, 0.27, -0.15], 0.2);

  /* ---------- head ---------- */
  const headPivot = add(new G(), [0, 0.58, 0], spine);
  const hc = add(new G(), [0, 0.42, 0], headPivot);
  const face = add(new G(), null, hc);
  const HR = 0.48;
  face.scale.set(1, 0.96, 0.97);
  sph(HR, mat.skin, null, face);
  sph(0.3, mat.skin, [0, -0.2, 0.14], face, [0.85, 0.8, 0.8]);

  const patch = (rad, dy, dp, cy, cp, m, par) => {
    const pv = add(new G(), null, par);
    pv.rotation.set(-cp, cy, 0, 'YXZ');
    const g = new THREE.SphereGeometry(rad, 24, 16, Math.PI / 2 - dy / 2, dy, Math.PI / 2 - dp / 2, dp);
    const o = new THREE.Mesh(g, m);
    pv.add(o);
    return o;
  };

  const decal = tex(512, 384, (x) => {
    [-1, 1].forEach((s) => {
      const cx = 256 + s * 164;
      const g = x.createRadialGradient(cx, 269, 0, cx, 269, 50);
      g.addColorStop(0, 'rgba(255,120,130,.55)');
      g.addColorStop(1, 'rgba(255,120,130,0)');
      x.fillStyle = g;
      x.fillRect(cx - 60, 225, 120, 90);
    });
    x.strokeStyle = '#5a3422';
    x.lineCap = 'round';
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(74, 60);
    x.quadraticCurveTo(114, 38, 156, 54);
    x.stroke();
    x.beginPath();
    x.moveTo(356, 50);
    x.quadraticCurveTo(398, 24, 438, 56);
    x.stroke();
    x.lineWidth = 3;
    x.strokeStyle = '#d58f7e';
    x.beginPath();
    x.moveTo(250, 238);
    x.quadraticCurveTo(256, 244, 262, 238);
    x.stroke();
    x.fillStyle = '#b24a4c';
    x.beginPath();
    x.ellipse(256, 304, 11, 8, 0, 0, 7);
    x.fill();
    x.fillStyle = '#e58a8a';
    x.beginPath();
    x.ellipse(256, 308, 7, 3.5, 0, 0, 7);
    x.fill();
  });
  patch(HR + 0.003, 1.44, 0.9, 0, -0.1, new THREE.MeshStandardMaterial({ map: decal, transparent: true, depthWrite: false, roughness: 0.6 }), face);

  const eyeTex = (s) =>
    tex(256, 290, (x) => {
      if (s > 0) {
        x.translate(256, 0);
        x.scale(-1, 1);
      }
      x.beginPath();
      x.ellipse(128, 150, 110, 128, 0, 0, 7);
      x.fillStyle = '#fdf6f2';
      x.fill();
      x.save();
      x.clip();
      let g = x.createLinearGradient(0, 40, 0, 270);
      g.addColorStop(0, '#4a2414');
      g.addColorStop(0.45, '#a8672f');
      g.addColorStop(1, '#f0c27a');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(128, 162, 84, 112, 0, 0, 7);
      x.fill();
      x.fillStyle = '#24100a';
      x.beginPath();
      x.ellipse(128, 160, 36, 48, 0, 0, 7);
      x.fill();
      g = x.createLinearGradient(0, 30, 0, 130);
      g.addColorStop(0, 'rgba(30,12,6,.7)');
      g.addColorStop(1, 'rgba(30,12,6,0)');
      x.fillStyle = g;
      x.fillRect(0, 30, 256, 100);
      x.fillStyle = '#fff';
      x.beginPath();
      x.ellipse(98, 112, 24, 30, -0.3, 0, 7);
      x.fill();
      x.beginPath();
      x.ellipse(164, 208, 11, 13, 0, 0, 7);
      x.fill();
      x.globalAlpha = 0.7;
      x.beginPath();
      x.arc(150, 92, 7, 0, 7);
      x.fill();
      x.restore();
      x.strokeStyle = '#2a140d';
      x.lineWidth = 15;
      x.lineCap = 'round';
      x.beginPath();
      x.ellipse(128, 150, 108, 126, 0, Math.PI * 1.03, Math.PI * 1.97);
      x.stroke();
      x.lineWidth = 9;
      x.beginPath();
      x.moveTo(30, 92);
      x.lineTo(8, 70);
      x.stroke();
    });

  const eyes = [-1, 1].map((s) => {
    const t = eyeTex(s);
    return patch(
      HR + 0.007,
      0.62,
      0.72,
      s * 0.4,
      -0.06,
      new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.12, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.45 }),
      face
    );
  });

  /* ---------- hair ---------- */
  const hairs = [];
  const HC0 = new THREE.Color(0x6a3f27);
  const HC1 = new THREE.Color(0xb98558);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.526, 40, 24, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, 2.3), mat.cap), null, hc);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.53, 40, 14, 0, Math.PI * 2, 0, 0.95), mat.cap), null, hc);

  const fullHair = quality.hairDetail >= 0.8;
  function strand(yaw, pitch, tilt, len, w, th, curl, rz, ph) {
    const g = new THREE.CylinderGeometry(w, 0.006, len, 8, 6);
    g.translate(0, -len / 2, 0);
    const p = g.attributes.position;
    const col = [];
    for (let i = 0; i < p.count; i++) {
      const t = -p.getY(i) / len;
      p.setX(i, p.getX(i) + curl * t * t * len);
      const c = HC0.clone().lerp(HC1, t);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, mat.hair);
    o.scale.z = th / w;
    const pv = new G();
    pv.add(o);
    const R = 0.535;
    pv.position.set(R * Math.sin(yaw) * Math.cos(pitch), R * Math.sin(pitch), R * Math.cos(yaw) * Math.cos(pitch));
    pv.rotation.set(-tilt, yaw, rz, 'YXZ');
    pv.userData = { rx: -tilt, rz, ph };
    hc.add(pv);
    hairs.push(pv);
  }

  // Bangs.
  [-0.62, -0.38, -0.12, 0.14, 0.4, 0.66].forEach((y, i) => {
    if (!fullHair && i % 2 === 1) return;
    strand(y, 0.6, 0.1, [0.26, 0.32, 0.36, 0.3, 0.34, 0.28][i], 0.09, 0.035, y < 0 ? -0.05 : 0.05, -0.18, i);
  });
  // Side locks.
  [-1, 1].forEach((s, i) => {
    strand(s * 1.0, 0.15, 0.05, 0.62, 0.07, 0.03, s * 0.12, 0, i + 7);
    strand(s * 1.45, -0.05, 0.08, 0.78, 0.14, 0.05, s * 0.18, 0, i + 9);
  });
  // Back length.
  [1.9, 2.3, 2.7, 3.14, 3.58, 3.98, 4.38].forEach((y, i) => {
    if (!fullHair && i % 2 === 1) return;
    strand(y, 0.05, 0.22, 0.95 - Math.abs(y - 3.14) * 0.08, 0.15, 0.05, (i % 2 ? 1 : -1) * 0.12, 0, i + 2);
  });
  // Gold hairpins.
  [0, 1].forEach((i) => {
    const yw = 0.95 + i * 0.14;
    const pt = 0.5 - i * 0.08;
    const R = 0.545;
    const c = cyl(0.011, 0.011, 0.1, mat.gold, [R * Math.sin(yw) * Math.cos(pt), R * Math.sin(pt), R * Math.cos(yw) * Math.cos(pt)], hc);
    c.rotation.set(-pt, yw, Math.PI / 2 + 0.35);
  });

  /* ---------- hands ---------- */
  function hand(sg, par) {
    const h = add(new G(), null, par);
    const fs = [];
    sph(0.05, mat.skin, [0, -0.05, 0], h, [1, 1.05, 0.5]);
    [
      [-0.034, 0.05, 0.04],
      [-0.011, 0.06, 0.05],
      [0.012, 0.055, 0.047],
      [0.034, 0.045, 0.038],
    ].forEach((f) => {
      const p1 = add(new G(), [f[0], -0.09, 0], h);
      sph(0.016, mat.skin, null, p1);
      cyl(0.0155, 0.0135, f[1], mat.skin, null, p1, 1);
      const p2 = add(new G(), [0, -f[1], 0], p1);
      sph(0.0135, mat.skin, null, p2);
      cyl(0.0135, 0.011, f[2], mat.skin, null, p2, 1);
      sph(0.011, mat.skin, [0, -f[2], 0], p2);
      fs.push([p1, p2]);
    });
    const t1 = add(new G(), [-sg * 0.04, -0.05, 0.02], h);
    sph(0.017, mat.skin, null, t1);
    cyl(0.017, 0.014, 0.045, mat.skin, null, t1, 1);
    const t2 = add(new G(), [0, -0.045, 0], t1);
    sph(0.014, mat.skin, null, t2);
    cyl(0.014, 0.011, 0.04, mat.skin, null, t2, 1);
    sph(0.011, mat.skin, [0, -0.04, 0], t2);
    // Exact point the star latches onto.
    const palm = add(new G(), PALM, h);
    return { fs, t1, t2, sg, palm };
  }

  /* ---------- arms ---------- */
  function arm(sg) {
    const sh = add(new G(), [sg * 0.2, 0.46, 0], spine);
    sph(0.085, mat.bodice, null, sh, [1, 0.95, 1]);
    cyl(0.055, 0.05, 0.3, mat.skin, null, sh, 1);
    const el = add(new G(), [0, -0.3, 0], sh);
    sph(0.05, mat.skin, null, el);
    cyl(0.05, 0.042, 0.24, mat.skin, null, el, 1);
    const wr = add(new G(), [0, -0.24, 0], el);
    sph(0.042, mat.skin, null, wr);
    return { sg, sh, el, wr, h: hand(sg, wr) };
  }
  const arms = { right: arm(-1), left: arm(1) };

  function poseHand(h, curl1, curl2, spread) {
    h.fs.forEach((f, i) => {
      f[0].rotation.set((i - 1.5) * spread, 0, -h.sg * curl1);
      f[1].rotation.z = -h.sg * curl2;
    });
    h.t1.rotation.set(-0.6 + spread * -1, 0, -h.sg * (0.45 + spread * 2));
    h.t2.rotation.z = -h.sg * (curl1 * 0.5);
  }

  /* ---------- legs (now addressable) ---------- */
  const legs = [-1, 1].map((s) => {
    const hip = add(new G(), [s * 0.12, -0.04, 0], hips);
    hip.rotation.y = s * 0.08;
    cyl(0.065, 0.058, 0.26, mat.skin, null, hip, 1);
    const knee = add(new G(), [0, -0.26, 0], hip);
    sph(0.058, mat.skin, null, knee);
    cyl(0.055, 0.045, 0.22, mat.skin, null, knee, 1);
    cyl(0.06, 0.052, 0.17, mat.cream, [0, -0.04, 0], knee, 1);
    const ankle = add(new G(), [0, -0.22, 0], knee);
    sph(0.075, mat.shoe, [0, -0.045, 0.04], ankle, [1, 0.67, 1.67]);
    cyl(0.06, 0.06, 0.012, mat.sole, [0, -0.093, 0.04], ankle);
    const strap = add(new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.009, 6, 20), mat.ribbon), [0, -0.02, 0], ankle);
    strap.rotation.x = Math.PI / 2;
    sph(0.016, mat.ribbon, [0, -0.03, 0.1], ankle);
    return { s, hip, knee, ankle };
  });

  /* ---------- animation state ---------- */
  const HIP_Y = 0.62;
  // Full gait cycles across the entire walk. The walk covers about one world
  // unit, so this is set from stride length rather than chosen for looks —
  // a higher number makes her shuffle, a lower one makes her skate.
  const STRIDES = 2.0;
  const TAU = Math.PI * 2;

  const qAim = new THREE.Quaternion();
  const qCarry = new THREE.Quaternion();
  const qWalk = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const DOWN = new V3(0, -1, 0);
  const tmp = new V3();
  const lookV = new V3();
  const worldStar = new V3();

  let blinkClock = 2.2;
  let hy = 0; // smoothed head yaw
  let hp = 0; // smoothed head pitch
  let swayPhase = 0;

  function setIntent(girl, starPos, dt, t) {
    const breathe = girl.breathe;
    const reach = girl.reach;
    const grip = girl.grip;
    const stride = girl.stride;
    const attention = girl.attention;
    const walk = girl.walk;
    worldStar.copy(starPos);

    /* --- breathing / idle life --- */
    hips.position.y = HIP_Y + Math.sin(t * 1.5) * 0.004 * breathe;
    spine.scale.y = 1 + Math.sin(t * 1.5) * 0.008 * breathe;

    /* --- walk cycle, derived from scrubbed progress --- */
    const cyc = walk * STRIDES;
    const th = cyc * TAU;
    const sw = Math.sin(th);
    const amp = 0.5 * stride;
    // Hip bob runs at twice stride frequency (one dip per footfall).
    const bob = -Math.cos(th * 2) * 0.016 * stride;
    const lean = 0.055 * stride;

    legs[0].hip.rotation.x = sw * amp;
    legs[1].hip.rotation.x = -sw * amp;
    // Knee flexes through the swing phase; offset per side so it trails the hip.
    legs[0].knee.rotation.x = Math.max(0, Math.sin(th - 0.7)) * 0.55 * stride;
    legs[1].knee.rotation.x = Math.max(0, Math.sin(th - 0.7 + Math.PI)) * 0.55 * stride;
    const aLift = 0.3 * stride;
    legs[0].ankle.rotation.x = -Math.max(0, Math.sin(th + 0.9)) * aLift;
    legs[1].ankle.rotation.x = -Math.max(0, Math.sin(th + 0.9 + Math.PI)) * aLift;

    /* --- torso: walk counter-sway blended with the head's yaw follow --- */
    spine.updateWorldMatrix(true, false);

    // Head aim at the star, gated by how much attention she is paying it.
    const lookTarget = lookV.copy(worldStar);
    if (attention < 0.5) {
      // Before she notices, she looks off into the middle distance instead of
      // staring straight at the star she has not noticed yet.
      lookTarget.set(0, 1.5, 3).applyMatrix4(root.matrixWorld);
    }
    const v = spine.worldToLocal(lookTarget.clone()).sub(headPivot.position);
    const targetYaw = Math.max(-0.9, Math.min(0.9, Math.atan2(v.x, v.z)));
    const targetPitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    const eyeRate = 3 * (0.35 + attention * 0.65);
    hy = THREE.MathUtils.lerp(hy, targetYaw * attention, 1 - Math.exp(-dt * eyeRate));
    hp = THREE.MathUtils.lerp(hp, targetPitch * attention, 1 - Math.exp(-dt * eyeRate));

    const sway = sw * 0.085 * stride;
    swayPhase += (sway - swayPhase) * 0.2;
    headPivot.rotation.set(
      -hp * 0.55 + Math.sin(t * 0.7) * 0.015 * breathe,
      hy * 0.85,
      0.07 + Math.sin(t * 0.5) * 0.01 * breathe
    );
    spine.rotation.y = hy * 0.2 - swayPhase;
    spine.rotation.x = lean;

    /* --- right arm: walk swing -> reach -> grip --- */
    const r = arms.right;
    const swingArm = Math.sin(th + Math.PI) * 0.34 * stride * (1 - reach);
    eul.set(-0.05 + swingArm, 0, -0.22 - Math.abs(swingArm) * 0.1);
    qWalk.setFromEuler(eul);

    // Aim the upper arm at the star, then slerp so the reach grows out of the
    // walk rather than snapping on.
    tmp.copy(spine.worldToLocal(worldStar.clone())).sub(r.sh.position).normalize();
    qAim.setFromUnitVectors(DOWN, tmp);
    r.sh.quaternion.copy(qWalk).slerp(qAim, reach);

    const carry = girl.carry || 0;
    if (carry > 0.001) {
      // After the grip she folds the arm in, bringing the star to her chest.
      // Expressed as a quaternion so it can slerp out of the reach cleanly
      // instead of fighting it through Euler angles.
      eul.set(-0.5, -0.34, -0.52);
      qCarry.setFromEuler(eul);
      r.sh.quaternion.slerp(qCarry, carry);
    }

    const elbowReach = -(0.3 + 0.12 * reach) * (1 - reach * 0.35) - 0.22 * reach;
    // Cradle: forearm comes up so the palm ends in front of her chest.
    r.el.rotation.x = THREE.MathUtils.lerp(elbowReach, -1.28, carry);
    r.wr.rotation.x = -0.25 * reach - 0.2 * carry;

    // Hand opens to receive, then closes around the star on the grip.
    const curl = THREE.MathUtils.lerp(0.42, 0.1, reach) + grip * 0.9;
    const curl2 = THREE.MathUtils.lerp(0.4, 0.16, reach) + grip * 0.8;
    const spread = THREE.MathUtils.lerp(0.18, 0.03, reach) - grip * 0.02;
    poseHand(r.h, curl, curl2, spread);

    /* --- left arm: idle sway, plus a small celebration lift at the reward --- */
    const l = arms.left;
    const celebrate = girl.settle;
    l.sh.rotation.set(
      -0.08 + Math.sin(th) * 0.2 * stride * (1 - celebrate) - celebrate * 0.42,
      0,
      0.22 + Math.sin(t * 1.5) * 0.01 * breathe + celebrate * 0.16
    );
    l.el.rotation.x = -0.35 - celebrate * 0.62;
    l.wr.rotation.set(-0.1, 0, 0);
    poseHand(l.h, 0.32 - celebrate * 0.1, 0.45, 0.03);

    /* --- hair follow-through --- */
    for (const p of hairs) {
      const u = p.userData;
      p.rotation.x = u.rx + Math.sin(t * 0.9 + u.ph * 1.3) * 0.03 * breathe - lean * 0.8;
      p.rotation.z = u.rz + Math.sin(t * 1.1 + u.ph) * 0.035 * breathe + swayPhase * 0.5;
    }

    /* --- blink --- */
    if (t > blinkClock) {
      const ph = (t - blinkClock) / 0.16;
      if (ph >= 1) {
        blinkClock = t + 2.5 + Math.random() * 3;
        eyes.forEach((e) => (e.scale.y = 1));
      } else {
        eyes.forEach((e) => (e.scale.y = 1 - 0.92 * Math.sin(Math.PI * ph)));
      }
    }

    // Micro-bounce when the star lands in her palm.
    root.position.y = 0;
    if (girl.bounce > 0.001) {
      const k = Math.sin(girl.bounce * Math.PI) * 0.035;
      hips.position.y += k;
      root.position.y = 0;
    }
    hips.position.y += bob;

    return null;
  }

  /** World position of the palm - where the star should sit when held. */
  function handWorld(out) {
    arms.right.h.palm.updateWorldMatrix(true, false);
    return arms.right.h.palm.getWorldPosition(out || new V3());
  }

  function dispose() {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) m.dispose();
    });
    textures.forEach((t) => t.dispose());
    hairs.length = 0;
  }

  return {
    root,
    joints: { hips, spine, headPivot, arms, legs, eyes, hairs },
    setIntent,
    handWorld,
    dispose,
    /** Palm sits slightly inside the hand mesh; the star uses this radius. */
    palmRadius: 0.06,
  };
}
