/**
 * World lighting.
 *
 * Four lights, each with a job:
 *   - hemi   : the sky/ground base tone of the evolving palette
 *   - key    : the warm side that gives her form
 *   - rim    : the cold back edge that separates her from the fog
 *   - wash   : fakes the star's bounce light spilling onto her
 *
 * The palette drives every one of them, which is what makes the colour
 * journey read as the world changing rather than a CSS filter over the top.
 */

export function createLighting(THREE, ctx = {}) {
  const quality = Object.assign({ tier: 2, shadows: false }, ctx.quality || {});
  const group = new THREE.Group();

  const ambient = new THREE.AmbientLight(0x14224a, 0.18);

  const hemi = new THREE.HemisphereLight(0x14224a, 0x04040c, 0.34);

  const key = new THREE.DirectionalLight(0x3a5bb8, 0.55);
  key.position.set(-2, 3, 4);

  const rim = new THREE.DirectionalLight(0x24409a, 0.9);
  rim.position.set(2.5, 2.5, -3);

  // Warm bounce: positioned at the star each frame so the light on her face
  // tracks the thing she is walking toward.
  const wash = new THREE.PointLight(0xffc766, 0, 4.5, 1.8);

  // Moonlight: cool, steadier than the palette key, from a fixed celestial
  // direction (matches the moon drawn in the sky shader). Casts the one
  // terrain/character shadow pass on the desktop tier.
  const moon = new THREE.DirectionalLight(0x8fa8e8, 0.42);
  moon.position.set(-4, 7, -5);
  const shadows = quality.shadows && quality.tier >= 2;
  if (shadows) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 40;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.02;
    moon.shadow.radius = 2.5;
  }

  // Soft round contact shadow under her feet. Every tier gets this: a cheap
  // radial-gradient plane that grounds her even where shadow maps are off.
  const contactCanvas = document.createElement('canvas');
  contactCanvas.width = contactCanvas.height = 64;
  {
    const c = contactCanvas.getContext('2d');
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(2,4,10,0.75)');
    g.addColorStop(0.6, 'rgba(2,4,10,0.35)');
    g.addColorStop(1, 'rgba(2,4,10,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  }
  const contactTex = new THREE.CanvasTexture(contactCanvas);
  const contactMat = new THREE.MeshBasicMaterial({
    map: contactTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.8,
  });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), contactMat);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;

  group.add(ambient, hemi, key, rim, wash, moon, contact);

  const keyDir = new THREE.Vector3();
  const washColor = new THREE.Color();
  let washTarget = 0;

  /**
   * @param {object} pal palette reading
   * @param {number} starInfluence 0..1.6 from `story/palette.js`
   * @param {THREE.Vector3} starPos world position of the star
   * @param {boolean} reducedMotion
   */
  function applyPalette(pal, starInfluence = 0, starPos = null, reducedMotion = false) {
    hemi.color.setRGB(pal.sky[0], pal.sky[1], pal.sky[2]);
    hemi.groundColor.setRGB(pal.ground[0], pal.ground[1], pal.ground[2]);
    hemi.intensity = pal.hemi;

    key.color.setRGB(pal.key[0], pal.key[1], pal.key[2]);
    key.intensity = pal.keyI;

    rim.color.setRGB(pal.rim[0], pal.rim[1], pal.rim[2]);
    rim.intensity = reducedMotion ? pal.rimI * 0.7 : pal.rimI;

    ambient.color.setRGB(pal.sky[0] * 0.6, pal.sky[1] * 0.6, pal.sky[2] * 0.7);
    ambient.intensity = 0.1 + pal.hemi * 0.2;

    washColor.setRGB(pal.mote[0], pal.mote[1], pal.mote[2]);
    wash.color.copy(washColor);
    washTarget = starInfluence * 1.5;

    // Keep the key light roughly opposite the star so she is lit from the
    // world while the star rims her.
    if (starPos) {
      keyDir.copy(starPos).setY(0).normalize();
      key.position.set(-keyDir.x * 3.2 - 0.6, 3, -keyDir.z * 3.2 + 1.4);
    }
  }

  function update(dt, starPos) {
    if (starPos) wash.position.copy(starPos);
    wash.intensity += (washTarget - wash.intensity) * (1 - Math.exp(-dt * 2.6));
    // The contact shadow follows her (main.js also passes girlPos — see
    // signature note; when only starPos is given, keep it tracking the light).
  }

  /** Called with moonColor so the sky-shader moon and this light agree. */
  function setMoonColor(hex) {
    moon.color.set(hex);
  }

  function dispose() {
    ambient.dispose();
    hemi.dispose();
    key.dispose();
    rim.dispose();
    wash.dispose();
  }

  return { group, ambient, hemi, key, rim, wash, moon, contact, setMoonColor, applyPalette, update, dispose };
}
