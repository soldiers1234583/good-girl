# Good Girl — a tiny interactive film

A scroll-driven cinematic experience: a chibi girl, a glowing star, and a badge
waiting at the end. Scrolling is the timeline. Nothing plays on its own.

Built from the two assets that were already in `Download/chibi/` — the chibi
character and the magic star — both of which are procedural Three.js with no
external files.

---

## Run it

**Easiest — one file, no server:**

```
dist/index.html
```

Open it anywhere (file manager, browser, send it to someone). It has zero
external references: CSS, Three.js and the whole module graph are inlined.

**Or the modular source**, which is what you'd work on:

```bash
npm run serve          # http://localhost:8080
```

> ES modules can't load from `file://` (CORS), so the modular version needs
> the server. `dist/index.html` exists specifically because it can't.

**Build / test:**

```bash
npm run check   # syntax across every source file
npm test        # 59 tests: story logic, headless boot, bundle, GLSL compilation
npm run build   # regenerates dist/index.html
```

There is also a real-browser harness (headless Chromium via `puppeteer-core`,
installed separately — it is not a project dependency):

```bash
node test/browser-check.mjs ./dist/index.html after
```

It screenshots every beat, reads the shared uniform objects back off the
compiled materials, and fails on any console/shader error. See
*What is verified, and what is not* for what it can and cannot prove here.

---

## The story

| Progress | Beat |
|---|---|
| 0.00 | **Scene 01 — The Introduction.** Wide establishing shot. She stands; the star waits. |
| 0.16 | **Scene 02 — The Star.** Camera drifts in. The glow builds. She notices. |
| 0.33 | **Scene 03 — The Approach.** She walks to her mark; the camera tracks. |
| 0.50 | **Scene 04 — The Pickup.** Her arm unfolds on the last step, reaches, the star reacts, she takes it. |
| 0.75 | **Star Reaction.** Flare, particle burst, light and camera respond, the world warms. |
| 0.85 | *You earned something special.* |
| 0.91 | **The Reward.** *You have earned a Good Girl Badge.* — spring-in, float, tilt. |

The colour journey (Deep Night → Blue → Purple → Magenta → Warm Gold) is one
continuous interpolation across the whole timeline, driving background, fog,
lights, star tint, particles, character light and the typography accent from a
single object.

---

## Architecture

```
index.html
css/style.css
vendor/three.min.js          r128, vendored (offline, no CDN)
vendor/postprocessing.js     r128 examples: EffectComposer + UnrealBloomPass
build.mjs                    emits dist/index.html
src/
 ├── main.js                 composition: world layout + the frame loop
 ├── config-free
 ├── util/
 │   ├── math.js             pure: clamp, damp, spring, noise, colour
 │   └── device.js           capability tier, pointer type, reduced motion
 ├── story/                  ── pure, no THREE, no DOM ──
 │   ├── phases.js           phase windows and named beats
 │   ├── palette.js          the 5-stop colour journey
 │   └── choreography.js     scroll -> ONE directive object
 ├── shaders/                ── every animated GLSL parameter ──
 │   ├── controller.js       the one uniform hub + per-frame subscribers
 │   ├── backgroundShader.js the sky (BG_VERT/BG_FRAG)
 │   ├── magicalStarShader.js the star (STAR_VERT/STAR_FRAG)
 │   └── fresnelRim.js       injects a rim into the r128 standard/physical shader
 ├── effects/
 │   ├── energyTrail.js      star -> palm stream, positions computed in-shader
 │   └── postProcessing.js   tier-gated UnrealBloomPass, feature-detected
 ├── scene/
 │   ├── character.js        your chibi rig (walk + reach + grip added)
 │   ├── star.js            your magic star (intensity + tint + pickup)
 │   ├── background.js       the sky quad that draws behind everything
 │   ├── environment.js      ground, parallax silhouettes, fog
 │   ├── particles.js        ambient motes + the reaction burst
 │   └── lighting.js         palette -> hemisphere / key / rim / wash
 ├── camera/cameraRig.js     shot keyframes + damping + handheld drift
 ├── scroll/scrollProgress.js  sticky track -> damped 0..1
 └── ui/                     typography, badge, cursor, HUD
```

`story/` has no dependencies on Three.js or the DOM, which is why the whole
choreography is unit-testable in Node.

---

## The GLSL system

The brief was "add shaders without rebuilding the site", so the shaders were
fitted around the existing architecture rather than beside it. Three rules made
that work:

1. **One loop, one renderer, one scroll listener.** Nothing new was added to
   `main.js`'s frame; the shaders hang off new *objects* that the same loop
   already visits.
2. **One writer per uniform.** `src/shaders/controller.js` owns the shared
   scalars as single objects and hands those *same objects* to every material.
   Three uploads per material, but one JS write updates them all — no copies, no
drift, no two systems fighting over `uTime`.
3. **Predictable shaders.** The sky quad is drawn first (`renderOrder -1000`,
   `depthTest: false`), so nothing can poke through it; it is not a
   depth-writing object and it never touches the scene graph's lighting.

### The uniform vocabulary

These six are the agreed interface. They are created once and shared:

| Uniform | Meaning | Written from |
|---|---|---|
| `uTime` | animation seconds | the loop clock; **0** under reduced motion |
| `uProgress` | story position, 0..1 | `scroll.update()` → `direct(p)` |
| `uIntensity` | star energy, ~0.05..2.7 | `d.star.intensity` |
| `uReveal` | badge presentation, 0..1 | `d.ui.badgeIn` |
| `uInteraction` | touch energy, 0..1 | `max(grip, burst, reach × 0.6)` |
| `uResolution` | drawing-buffer size, px | `measure()` / resize, via `stage.dpr` |

`uColorA` / `uColorB` are deliberately **not** shared: every shader pairs
different colours (sky inner/outer, rim cool/warm, star body/core), so each
module owns its own pair. Anything that has to follow the palette registers a
subscriber instead of being polled.

### Scroll → uniform, and why scrubbing back is exact

Every value above is a **pure function of scroll progress**. There is no
accumulated state anywhere in the shader layer — no `+=`, no physics, no
timers:

- `uInteraction` is `max(grip, burst, reach × 0.6)`, all of which come out of
  `direct(p)`. The energy stream's `uFade` is a `smoothstep` window over the
  reach→grip beats (`test/shaders.test.mjs` asserts the window sits inside
  `BEAT`).
- The star's breathing and energy flow are driven by `uTime`, so they stop
  when time stops and resume with the scroll untouched.
- Scrolling up rewinds the world exactly. The headless browser run confirms
  it: at `p=0.97` `uReveal` reads 0.947, and after scrubbing back to `p=0.2` it
  reads 0.000 with the trail hidden again.

This is the same discipline the walk cycle already used, for the same reason: a
dt-accumulated shader would keep animating while you scroll backwards.

### What each effect does

- **Sky (`backgroundShader.js`)** — reproduces the CSS backdrop's base
  gradient in the same coordinate space (ellipse 120 % × 90 % at 50 % / 44 %,
  inner→outer over 72 %), sampling `palette.bgInner` / `bgOuter` into
  `uColorA` / `uColorB` every frame — which is what lets the colour journey
  authored in `story/palette.js` carry over unchanged. On top: a hashed star
  field that fades out as the story leaves night, blocky voxel clouds from
  quantised value noise, a square sun with halo and god rays, a reveal bloom +
  one-shot sweep driven by `uReveal`, and a per-pixel dither so the dark
  gradients don't band.
- **Star (`magicalStarShader.js`)** — the original core gradient, wrap, spec,
  fresnel and env terms are kept, with the `1.0 - exp(-col × 1.45)` rolloff
  intact. Added: a breathing core, a two-octave scrolling energy flow gated by
  `uProgress`, blocky glints, and an `uInteraction` flare.
- **Rim light (`fresnelRim.js`)** — injected into every character material via
  `onBeforeCompile`, after `#include <common>`, replacing the exact line
  `gl_FragColor = vec4( outgoingLight, diffuseColor.a );` in r128's
  `meshphysical_frag` so the rim is tone-mapped with everything else. The cool
  blue → gold crossfade is a `smoothstep(0.5, 0.92, uProgress)`. Because r128's
  default `customProgramCacheKey` is `onBeforeCompile.toString()`, all the
  injected materials still share one program.
- **Energy stream (`energyTrail.js`)** — one `Points` draw call, one geometry,
  positions computed entirely in the vertex shader between `uFrom` (star) and
  `uTo` (palm); the CPU writes two vectors per frame. It switches itself off
  outside the reach→grip window, so the long stretches of the timeline pay
  nothing for it.
- **Bloom (`postProcessing.js`)** — `UnrealBloomPass` via `EffectComposer`
  (strength 0.38, radius 0.5, threshold 0.78), **tier 2 only**, and only when
  `EffectComposer`/`UnrealBloomPass` are actually present and
  `renderer.getRenderTarget` exists. It returns `null` otherwise and the loop
  falls back to `stage.render()` — so a device without it draws exactly what it
did before. The pixel-ratio governor also disables it if the frame rate has
needed two downgrades.

### Metrics that survive the look changing

Bloom, crossfades and tone mapping are the classic way to wash a scene out, so
the numbers were pinned down instead of eyeballed:

- `renderer.outputEncoding = sRGBEncoding`, `ACESFilmicToneMapping`,
  `toneMappingExposure = 1.12` — untouched from the original.
- The badge is still **DOM + SVG** (crisp text, selectable, screen-reader
  reachable); it gains a `--badge-sweep` / `--badge-sweep-a` pair that both the
  CSS sheen and the glint behind it key off, so the two cannot drift apart.
- Whether highlights clip is settled **on pixels, not by eye**: the browser
  harness counts blown pixels per beat and fails the run above 5 %.

---

## How your assets were used

**Chibi Character — Three.js Asset.html**
Geometry, materials and the canvas-painted face/eyes are carried over
essentially unchanged — that code is what makes her *her*, and rewriting it
would have gained nothing. What changed:

- **Legs became addressable joints.** They were built in a `forEach` that kept
  no references, so there was no way to animate them. Now they mirror the arms.
- **A walk cycle was added**, and it is derived from scrubbed progress rather
  than accumulated from delta time. The timeline reverses when you scroll up; a
  dt-driven cycle would moonwalk.
- **`reach` and `grip`** now drive a carry pose, so she brings the star to her
  chest instead of leaving her arm extended.
- The demo's button UI and star prop were removed; both are owned by the story.

**Magic Star — Three.js Asset.html**
Carried over largely as-is: the extruded ten-point geometry, the emissive /
fresnel / facet shader, the layered aura sprites, the flare, the point light and
the orbiting sparkles. Added:

- `setIntensity` / `setTint` replace the button presets, so the choreography
  drives it instead of a control panel.
- The flare is now a *response to her touch*, fired on a rising edge of the
  scrub so scrolling back re-arms it rather than strobing.
- Position and world scale moved out (the composition owns them).
- Aura layers scale with device tier.

The blue / purple / gold environment presets from both files became the middle
stops of the colour journey, extended with Deep Night at the start and Magenta
before the gold.

---

## Decisions worth knowing

- **No GSAP.** The brief allowed "ScrollTrigger *or an equivalent*". The sticky
  track is CSS, scroll is a passive listener, and one damp function smooths
  every scrubbed value. That is ~20 lines instead of a dependency, it does not
  scroll-jack (the native scrollbar still behaves normally, which matters on a
  phone), and it keeps the runtime dependency count at exactly one.
- **Sticky track instead of pinning.** `position: sticky` costs nothing, can't
  desync, and is immune to scrollbar-width bugs.
- **Aim blending guarantees composition.** The camera's look target is a
  weighted blend of her chest and the star, so the subject can never leave
  frame as her choreography changes.
- **`tight` on every shot.** Handheld drift and pointer parallax are scaled by
  how close the frame is. A quarter-unit swing is a breath in the wide shot and
  a lurch in the pickup close-up.
- **The star sits 0.51 units from her shoulder when she reaches**, against an
  arm length of 0.63 — so the elbow stays bent (a reach, not a stretch), they
  never interpenetrate, and her palm lands on its home position with no IK
  cheating.

---

## Performance

- **First paint before construction.** The opening title card is static markup
  in `index.html`; the scene is built two frames later. `boot()` measures
  **258 ms** in Node (a few hundred meshes plus four canvas textures — more on a
  phone), and building that on the critical path means staring at a blank
  screen while it happens. Deferring it costs one frame.
- **The frame loop is not the bottleneck:** 0.29 ms of JS per frame in
  Node (~3489 fps of headroom) — the budget is all GPU, which cannot be
  measured here.
- **Quality tiers** chosen from cores / DPR / touch: particle count, star aura
  layers, hair strands, geometry detail, antialiasing and pixel-ratio cap all
  scale down.
- **Adaptive pixel ratio.** Steps down after sustained sub-48fps frames, upgrades
  again only after a calm stretch — deliberately asymmetric so it can't oscillate.
- **Rendering pauses** when the tab is hidden, and the clock is flushed on
  return so nothing fast-forwards.
- **No shadow maps.** Every light is analytical; the ground reads as lit from a
  painted falloff plus fog.
- **Cheap writes.** Gradients, palette and vignette are bucketed and published as
  CSS custom properties, so a custom property isn't rewritten 60×/second.
- **`prefers-reduced-motion`** is honoured live: no camera shake, no star spin,
  no badge float, near-1:1 scroll tracking, and a notice explains the mode.
- **Fallbacks.** No WebGL, or a software renderer (SwiftShader/llvmpipe), sends
  you to a DOM-only version of the same story so the reward is still reachable.
  No JavaScript still shows a `<noscript>` message including the badge.
- **The CSS `.backdrop` stays.** The sky quad covers it when WebGL is alive;
  when it isn't, the gradient is still there. Same for the fallback ring.
- **Shader cost scales with the same tiers as everything else.** The sky's
  noise/star/cloud work is gated behind `#ifndef LOW`, and `LOW` is defined for
  **tier 0 only, at boot**. The energy stream's point count is
  `max(24, motes × 0.18)`, and **0 under reduced motion** (it is pure
  decoration). Bloom is tier 2 only. On a phone that means: fewer sky octaves,
  no bloom, ~1/5 the stream particles, and the existing reduced pixel-ratio cap
  — no separate mobile code path to keep in sync.

---

## What is verified, and what is not

**Verified** (`npm test`, 59 tests):

- Story logic — phases, beats, colour continuity (no colour step larger than
  0.002 across 4000 samples), camera continuity (no jump), phrase windows,
  range/NaN/monotonicity invariants.
- **A full headless boot of the real code** — the real `index.html`, the real
  vendored Three.js, every real scene module, ~4000 frames of the real loop. It
  checks she walks, stops on her mark, the star ends up *in her palm*, the star
  brightens and swells, the burst fires, the world changes colour, the camera
  closes in, the badge is presented, the final line reads, and scrubbing back
  unwinds all of it. Then the scene graph is emptied on dispose.
- **The single-file build** boots from one document with no imports and plays
  the same timeline forward and back.
- **The whole timeline's colour journey, at the shader's own uniforms.**
  Read back off the sky material each beat: intro `[0.039, 0.071, 0.188]`
  (blue-dominant) → reward `[0.353, 0.204, 0.039]` (warm, and brighter) →
  scrubbed back to `[0.058, 0.124, 0.320]` (blue again). This is the assertion
  the pixel check wanted, made at the last link that is observable.
- **Every shipped GLSL source compiles.** `test/shaders.test.mjs` runs each
  shader through `glslangValidator` (the sky twice — normal and `LOW`), plus a
  link check, a varying cross-check between stages, a dead-uniform scan, and an
  exact JS-vs-GLSL uniform-set comparison. It also asserts the fresnel
  injection against the *real* r128 `meshphysical_frag` text: injected once,
  before the output line, with an identical `onBeforeCompile.toString()` across
  materials (which is what proves they share one program).
- All 29 served files — the HTML, the CSS, every module and both vendored
  scripts — return HTTP 200 with correct MIME types.
- The delivered copy in `Download/chibi/good-girl/` is byte-identical to this
  source (`diff -r` clean, excluding `node_modules`).

**Verified in a real browser** (`node test/browser-check.mjs`, headless
Chromium 152 / ANGLE):

- **All 23 shader programs compile with zero errors** and zero console noise
  (the pre-shader build compiles 13 — the ten new ones are the sky, the stream,
  the rim variants and the bloom passes).
- **The shared uniform objects really reach the compiled materials.** Read back
  off the materials themselves, not off the controller: at boot
  `sky.uTime === star.uTime === controller.uTime === 1.81`.
- **The whole timeline maps correctly.** `uProgress` 0 → 0.97 matches each
  beat, `uInteraction` 0 → 0.583 at contact → 1.0 at the reaction, `uIntensity`
  peaks at 2.619, `uReveal` reaches 0.947 at the reward, and scrubbing back to
  0.2 leaves `uReveal` 0 and the trail hidden.
- **Reduced motion freezes time in the shaders**, not just in the DOM —
  `uTime`, `sky.uTime` and `star.uTime` are all exactly 0.
- No unexpected fallback, no GL error from the mobile portrait/landscape
  viewport swaps.

**Not verified: how it looks — and why.** This device's Chromium **cannot
rasterise geometry at all**. That is a measured finding, not a guess:

| Probe (raw WebGL, no three.js) | Result |
|---|---|
| `gl.clear` + `readPixels` | `[115, 20, 161, 255]` — correct |
| one triangle, linked program, `attribLoc` 0, `glGetError()` 0 | `[0, 0, 0, 0]` — nothing drawn, and the cleared alpha is gone |

Eliminated as causes, each by direct test: context attributes (seven sets,
including three.js's exact defaults), drawing-buffer size (1280×800 down to
320×240), seven Chromium flag sets including `--disable-gpu-watchdog`,
`--disable-hang-monitor`, `--gpu-no-context-lost`, `headless` vs
`headless_shell`, the default framebuffer, a three.js `WebGLRenderTarget`, and
`readPixels` itself. So three.js renders nothing here, the compositor reads an
invalid canvas, and *that* is what makes the context churn — the
`GPU stall due to ReadPixels` line is a downstream symptom, not the cause. A
one-cube three.js scene fails identically to this app and to the pre-shader
baseline, so none of it implicates the shader work.

Consequences:

1. **Screenshots and pixel statistics are impossible here.** The dead canvas
   composites white: the intro mean reads `[220.4, 220.5, 221.2]`
   **identically for the pre-shader and post-shader builds**, which is itself
   proof the pixels say nothing about the app. Pixel checks are reported as
   **BLOCKED, never as passes**; the harness exits `2` for them and `1` for a
   genuine product failure.
2. **Frame rate is meaningless** (software rasteriser), so the harness does not
   report FPS and no measured speedup is claimed.
3. **Program-source inspection is opportunistic.** `node test/browser-check.mjs`
   reads each compiled program's fragment source back out of the GL context,
   which is the one way left to prove the injected fresnel actually shipped. It
   needs a live context, and on this device that is a coin flip per launch; the
   harness retries in fresh browsers and reports BLOCKED if it never lands.

So: camera framing, colour grading balance, whether the sky reads as a sky,
whether the rim light is too strong and whether the pickup still reads clearly
all still need eyes — desktop and phone. Treat this as mechanically verified and
visually unreviewed up to the boundary above.

---

## Tuning

Everything you'd adjust lives in two places:

- **Timing** — `src/story/phases.js` `BEAT` (when things happen) and the
  `PHRASES` windows in `src/story/choreography.js`.
- **Framing** — the `SHOTS` table in `src/story/choreography.js`. Each keyframe
  has `pos`, `fov`, `tight` and an `aim` weight pair.
- **Layout** — the constants at the top of `src/main.js` (`STAR_HOME`,
  `STAND_POS`, `STAND_YAW`, `STAR_SCALE`). Moving the star or her mark without
  keeping the shoulder-to-star distance near ~0.5 will make the reach read as a
  stretch.
- **Length** — `--track-height` in `css/style.css`.
