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
npm test        # 56 tests: story logic, full headless boot, single-file bundle
npm run build   # regenerates dist/index.html
```

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
vendor/three.min.js        r128, vendored (offline, no CDN)
build.mjs                  emits dist/index.html
src/
 ├── main.js               composition: world layout + the frame loop
 ├── config-free
 ├── util/
 │   ├── math.js           pure: clamp, damp, spring, noise, colour
 │   └── device.js         capability tier, pointer type, reduced motion
 ├── story/                ── pure, no THREE, no DOM ──
 │   ├── phases.js         phase windows and named beats
 │   ├── palette.js        the 5-stop colour journey
 │   └── choreography.js   scroll -> ONE directive object
 ├── scene/
 │   ├── character.js      your chibi rig (walk + reach + grip added)
 │   ├── star.js           your magic star (intensity + tint + pickup)
 │   ├── environment.js    ground, parallax silhouettes, fog
 │   ├── particles.js      ambient motes + the reaction burst
 │   └── lighting.js       palette -> hemisphere / key / rim / wash
 ├── camera/cameraRig.js   shot keyframes + damping + handheld drift
 ├── scroll/scrollProgress.js  sticky track -> damped 0..1
 └── ui/                   typography, badge, cursor, HUD
```

`story/` has no dependencies on Three.js or the DOM, which is why the whole
choreography is unit-testable in Node.

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

---

## What is verified, and what is not

**Verified** (`npm test`, 56 tests):

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
- All 21 files serve over HTTP 200 with correct MIME types.
- The delivered copy in `Download/chibi/good-girl/` is byte-identical to this
  source (`diff -r` clean, excluding `node_modules`).

**Not verified: how it looks.** There is no browser in this environment, so
nothing here has been *seen*. Camera framing, lighting balance, whether the
pickup reads clearly and whether the timing feels right all still need eyeballs
in a real browser — desktop and phone. Treat this as mechanically verified and
visually unreviewed.

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
