/**
 * Postprocessing — tier-gated bloom.
 *
 * The r128 EffectComposer/UnrealBloomPass files are vendored as a classic
 * script (vendor/postprocessing.js) loaded after three.min.js. This module
 * FEATURE-DETECTS them: if the script is absent, or the device is below the
 * desktop tier, it returns null and the main loop falls back to a plain
 * `stage.render()` — bloom can never take the experience down with it, and
 * constrained phones never pay for a fullscreen pass.
 *
 * Settings are deliberately restrained: low strength, high threshold, so only
 * the star core, the glints and the reward sweep bloom — the character and
 * the text stay readable (the DOM typography/badge live ABOVE the canvas and
 * are never touched by any of this).
 *
 * Adaptive safety net: if the stage's perf governor has already stepped the
 * pixel ratio down twice, bloom switches itself off — frame rate wins over
 * decoration.
 */

export function createPostProcessing(THREE, renderer, scene, camera, ctx = {}) {
  const quality = Object.assign({ tier: 2 }, ctx.quality || {});

  // Graceful fallback: vendor script not loaded (offline build variant, test
  // harness, older cached page), a constrained device, or a renderer without
  // render-to-texture (capability check — the composer cannot exist without
  // it; the real WebGLRenderer always has it).
  if (
    quality.tier < 2 ||
    THREE.EffectComposer === undefined ||
    THREE.RenderPass === undefined ||
    THREE.UnrealBloomPass === undefined ||
    typeof renderer.getRenderTarget !== 'function'
  ) {
    return null;
  }

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new THREE.EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  const renderPass = new THREE.RenderPass(scene, camera);
  composer.addPass(renderPass);

  // strength, radius, threshold — restrained on purpose: highlights only.
  const bloom = new THREE.UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.38, // strength
    0.5, // radius
    0.78 // luminance threshold: star core / glints / sweep only
  );
  composer.addPass(bloom);

  let enabled = true;

  return {
    composer,
    bloom,
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = v !== false;
    },
    render(dt) {
      if (enabled) composer.render(dt);
      else renderer.render(scene, camera);
    },
    setPixelRatio(v) {
      composer.setPixelRatio(v);
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
    dispose() {
      bloom.dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      if (composer.copyPass && composer.copyPass.material) {
        composer.copyPass.material.dispose();
      }
    },
  };
}
