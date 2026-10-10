/**
 * Cinematic camera.
 *
 * The rig resolves the choreography's shot sample into an actual camera. Three
 * ideas do the heavy lifting:
 *
 *   1. AIM BLENDING. The look target is a weighted blend of her chest and the
 *      star, so the subject can never leave frame even though her position and
 *      the star's both change. Composition is guaranteed rather than eyeballed.
 *
 *   2. DAMPING. The camera approaches the sampled pose instead of being welded
 *      to it. Scrub hard and it lags slightly; stop and it settles. That lag is
 *      most of what makes motion read as "cinematic" rather than "attached to
 *      the scrollbar".
 *
 *   3. DRIFT + POINTER PARALLAX. A layered-noise handheld drift keeps the frame
 *      alive when the user stops scrolling, and a small pointer offset gives
 *      the desktop user a sense of looking around the scene.
 *
 * Every additive term is scaled by `amp` values the choreography controls, so
 * the camera is calm during the reward and alive during the journey.
 */

import { damp, fbm1, clamp } from '../util/math.js';

export function createCameraRig(THREE, ctx = {}) {
  const reduced = !!ctx.reducedMotion;

  const position = new THREE.Vector3(0, 1.45, 7.4);
  const look = new THREE.Vector3(0, 1.15, 0.3);
  const targetPos = new THREE.Vector3();
  const targetLook = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  const shakeOffset = new THREE.Vector3();

  let fov = 31;
  let fovCurrent = 31;
  let chestY = 1.15;

  /** Feed smoothed pointer position in [-1, 1]; ignored on touch. */
  function setPointer(x, y) {
    pointer.set(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  /**
   * @param {object} cameraDirective from `choreography.direct().camera`
   * @param {THREE.Vector3} girlPos   world position of the girl (her feet)
   * @param {THREE.Vector3} starPos   world position of the star
   * @param {number} dt
   * @param {number} t elapsed time
   */
  function update(cameraDirective, girlPos, starPos, dt, t) {
    const shot = cameraDirective;

    // She is ~2.1 units tall with her chest around y=1.15; tracking that
    // rather than her origin keeps the composition stable as she walks.
    chestY = girlPos.y + 1.15;

    targetPos.set(shot.pos[0], shot.pos[1], shot.pos[2]);
    // Follow her horizontally so the shot list can be authored around the
    // origin without breaking when she has walked away from it.
    targetPos.x += girlPos.x * 0.34;
    targetPos.z += girlPos.z * 0.16;

    targetLook.set(
      girlPos.x * shot.aim.girl + starPos.x * shot.aim.star + shot.aim.offset[0],
      chestY * shot.aim.girl + starPos.y * shot.aim.star + shot.aim.offset[1],
      girlPos.z * shot.aim.girl + starPos.z * shot.aim.star + shot.aim.offset[2]
    );

    // --- handheld drift -------------------------------------------------
    // Amplitudes are in world units, so they must shrink with the frame. A
    // quarter-unit swing is a gentle breath in the wide shot and a lurch in
    // the pickup close-up; `tight` is what reconciles the two.
    const looseness = 1 - 0.82 * (shot.tight || 0);
    const drift = reduced ? 0 : shot.drift;
    if (drift > 0) {
      const dx = (fbm1(t * 0.16, 3) - 0.5) * 0.34 * drift;
      const dy = (fbm1(t * 0.13 + 31.7, 3) - 0.5) * 0.22 * drift;
      const dz = (fbm1(t * 0.11 + 71.3, 3) - 0.5) * 0.16 * drift;
      targetPos.x += dx;
      targetPos.y += dy;
      targetPos.z += dz;
      targetLook.x += dx * 0.35;
      targetLook.y += dy * 0.5;
    }

    // --- pointer parallax ----------------------------------------------
    pointerSmooth.x = damp(pointerSmooth.x, pointer.x, 3, dt);
    pointerSmooth.y = damp(pointerSmooth.y, pointer.y, 3, dt);
    // Scaled by the same framing factor: the desktop look-around should feel
    // like leaning, not like dollying through the scene.
    const parallax = reduced ? 0 : 1;
    targetPos.x += pointerSmooth.x * 0.3 * parallax * looseness;
    targetPos.y += -pointerSmooth.y * 0.18 * parallax * looseness;
    targetLook.x += pointerSmooth.x * 0.12 * parallax * looseness;

    // --- impact shake ---------------------------------------------------
    // A short, high-frequency ring on the pickup. Tiny on purpose: it should
    // register as a physical thump, not a camera effect.
    shakeOffset.set(0, 0, 0);
    if (shot.shake > 0.001 && !reduced) {
      const s = shot.shake * 0.05;
      shakeOffset.set(
        Math.sin(t * 47) * s,
        Math.sin(t * 61 + 1.3) * s * 0.8,
        Math.sin(t * 53 + 2.1) * s * 0.6
      );
    }

    // --- damp toward the pose ------------------------------------------
    // Slower damping at the start (a heavy, deliberate push-in) and slightly
    // firmer later so the close-ups do not feel loose.
    const rate = 1.9 + shot.drift * 0.9;
    position.x = damp(position.x, targetPos.x + shakeOffset.x, rate, dt);
    position.y = damp(position.y, targetPos.y + shakeOffset.y, rate, dt);
    position.z = damp(position.z, targetPos.z + shakeOffset.z, rate, dt);

    look.x = damp(look.x, targetLook.x, rate * 1.25, dt);
    look.y = damp(look.y, targetLook.y, rate * 1.25, dt);
    look.z = damp(look.z, targetLook.z, rate * 1.25, dt);

    fovCurrent = damp(fovCurrent, shot.fov, 2.2, dt);
    fov = fovCurrent;

    return null;
  }

  function apply(camera) {
    camera.position.copy(position);
    camera.lookAt(look);
    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function reset() {
    position.set(0, 1.45, 7.4);
    look.set(0, 1.15, 0.3);
    fovCurrent = 31;
  }

  return { update, apply, setPointer, reset, position, look, get fov() { return fov; } };
}
