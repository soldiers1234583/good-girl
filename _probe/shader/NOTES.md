# Complementary Reimagined — shader inspection notes

**Download result: SUCCESS (genuine pack, official channel).**

- Source: https://www.complementary.dev/reimagined/ (official site; the page redirects
  to /shaders, which links **Modrinth** as its official distribution channel)
- Publisher-authorized distribution: Modrinth project `complementary-reimagined` (id `HVnmMxH1`)
- Version: **r5.9.3** (latest at download time)
- File: `ComplementaryReimagined_r5.9.3.zip`, **553,397 bytes**, valid ZIP (PK magic verified)
- Archive preserved at `_probe/shader/ComplementaryReimagined_r5.9.3.zip`
  (research area only — NOT in production assets, NOT executed)
- License: **Complementary License Agreement 1.7** (`License.txt` in archive).
  Normal Usage allows gameplay/content creation; **redistributing or modifying the pack's
  code is NOT permitted** (no open-source GLSL license). Therefore: no shader code is
  copied into this project. Only *visual techniques* observed from reading the files are
  re-implemented from scratch for Three.js, which is not distribution of the copyrighted code.

## Techniques found in the actual shader files

| Area | File(s) | Technique |
|---|---|---|
| Night stars | `lib/atmospherics/stars.glsl` | view-direction hash-grid star cells (3-octave `fract(sin(dot))` noise on a quantized lattice), star brightness `star*star`, cel-shaped fade by `VdotU` (up-ness), occlusion near sun/moon via `VdotS`, slow drift by time |
| Sky gradient | `lib/atmospherics/sky.glsl` | three-band gradient (up / middle / down colors from `lib/colors/skyColors.glsl`), blended by pow-curves of view-upness `VdotU`, light-scatter ground fade below horizon |
| Night colors | `skyColors.glsl` | `nightUpSkyColor ~ pow(nightColFactor,0.90)*0.45` with `nightColFactor ~ 0.9*vec3(0.07,0.14,0.24) + skyColor` — deep desaturated blue-purple, *darker at zenith, brighter to horizon* |
| Horizon glow / nebula | `lib/atmospherics/nightNebula.glsl` | 5-octave Perlin FBM drifting "aurora/nebula" tint in cold blue + warm orange accents |
| Fog | `lib/atmospherics/fog/mainFog.glsl` | border fog `1-exp(-3*fog)` with `fog = (dist/renderDist)^4` (very steep, distance-quad), fog color taken from the SKY function itself (fog always matches sky) |
| Bloom fog | `fog/bloomFog.glsl` | distance-gated additive bloom of the sky color toward horizon, `nightBloomAdd = 3.0` for night |
| Light colors | `lib/colors/lightAndAmbientColors.glsl` | night ambient `0.9*vec3(0.09,0.12,0.17)`, moonlight `0.9*vec3(0.15,0.14,0.20)` — cold, almost neutral blue-grey |
| Volumetric light | `lib/atmospherics/volumetricLight/volumetricLight.glsl` | raymarched light shafts, night version *very dim* (`vlMult *= 0.3..`, color ×0.0766) |
| Sun/moon glare | `sky.glsl` | `visfactor/(1-(1-visfactor)*pow(\|VdotS\|,k))` glare function, glares get cut by rain |
| Clouds | `lib/atmospherics/clouds/reimaginedClouds.glsl` | voxel-preserved blocky cloud layer (Reimagined's signature keeps Minecraft slab-clouds) |
| AA / TAA | `lib/antialiasing/taa.glsl`, `fxaa.glsl` | post AA (out of scope: our renderer is tier-gated; renderer antialias flag already set) |

## What we recreate in Three.js (project-adapted, mobile-tiered)

1. **Star field** — same idea as `stars.glsl`: hash-lattice star cells in the
   background shader, with the cel fade and twinkle. Already existed; tuned to match
   (three hash octaves, squared brightness, stronger near horizon, more stars).
2. **Three-band night gradient** — sky shader gets the Reimagined-style *dark zenith →
   brighter horizon* night ramp built from the same color relationships
   (nightFactorPow 0.90, mid = sqrt(up)*0.65, down slightly bluer) — written
   by hand from observed relationships, not copied.
3. **Horizon glow / bloom-fog** — the `nightBloomAdd` horizon brightening, plus a
   dim FBM nebula band (cheap 2-octave version of their 5-octave, mobile-gated).
4. **Fog matches sky** — the project already had fog; slightly warm-blue tint and
   the horizon-line brightening sell the same effect.

## NOT reproduced (and why)
- **Raymarched volumetric light shafts** — needs depth-buffer raymarching across the
  full screen; too expensive for tier-0/1 mobile at our dpr. A cheap fake "ray cone"
  at the star already exists (`energyTrail`, star shader halo).
- **TAA/FXAA** — post-processing AA passes duplicate the renderer's MSAA and cost a
  fullscreen pass; not needed on WebGL1 target (r128 tier-gated renderer).
- **Real shadow-map cascades** — Minecraft pack's shadow pass needs scene depth
  rendering with much higher res than mobile budget; project deliberately has
  `shadows: false` on all tiers (perf policy from stage.js).
- **Voxel clouds in 3D** — the sky shader's blocky cloud layer (already present,
  quantized-lattice noise) covers this read without a second transparent geometry
  layer overdraw on mobile.
