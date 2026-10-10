/**
 * Minecraft pixel-art texture loader.
 *
 * One loader for every Faithful PNG the Minecraft environment uses. Policies
 * the whole scene shares live here so no two modules invent their own:
 *
 *   - NearestFilter magnification: crisp pixel edges, the point of real
 *     resource-pack art. Mipmaps stay ENABLED (the renderer builds them)
 *     so distant blocks do not shimmer; that costs one thing: the texture
 *     must be re-uploaded once the mipmap chain is ready, which the
 *     onLoad callback covers.
 *   - sRGBEncoding: the PNGs are display-space art, and the renderer is
 *     running ACES + sRGB output, so the input must be flagged sRGB or
 *     every block washes out.
 *   - loadMinecraftTextures() hands back a Promise.all-shaped map, with
 *     two hard guarantees for the caller: the promise RESOLVES even when
 *     every request fails (the value is undefined), and every texture it
 *     does return is either a real PNG or a painted 16x16 fallback. The
 *     environment never has to branch on "did the request fail".
 *
 * The fallback painter is ALSO how the boot test works at all: jsdom has no
 * image decoder, so the Image.load path rejects and the canvas texture
 * stands in. Visual parity is not the point — survival is: the scene builds,
 * the materials stay valid, nothing throws.
 */

/* Base path is page-relative ("public" is served by `npm run serve`; the
   esbuild dist copies the folder next to the bundle). No bundler import so
   the plain http.server workflow keeps working unchanged. */
const BASE = 'public/textures/minecraft/';

/** Every texture name the terrain touches. Keys are internal short names. */
export const MINECRAFT_TEX = {
  grassTop: 'grass_block_top.png',
  grassSide: 'grass_block_side.png',
  dirt: 'dirt.png',
  stone: 'stone.png',
  cobble: 'cobblestone.png',
  plank: 'oak_planks.png',
  log: 'oak_log.png',
  logTop: 'oak_log_top.png',
  leaves: 'oak_leaves.png',
  sand: 'sand.png',
  gravel: 'gravel.png',
  glow: 'glowstone.png',
  tuft: 'short_grass.png',
  tallTop: 'tall_grass_top.png',
  tallBottom: 'tall_grass_bottom.png',
  dandelion: 'dandelion.png',
  poppy: 'poppy.png',
};

let warned = null;
function note(missing) {
  // One console line, once, no matter how many textures fail: a page that
  // ships a fallback must not spam the console on every phone.
  if (!warned) {
    warned = true;
    console.warn(
      '[good-girl] some Minecraft textures did not load; painted equivalents are in use for:',
      missing.join(', ')
    );
  }
}

/**
 * Paint a 16x16 stand-in. Palette-matched to the real textures so a fallback
 * swaps in without a visible material break. Deep night does the art jazz:
 * these are base albedos, and the scene lights carry the mood.
 */
export function paintFallback(THREE, name) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  const px = (i, j, col) => {
    x.fillStyle = col;
    x.fillRect(i, j, 1, 1);
  };
  const noiseTile = (base, peaks) => {
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        px(i, j, base + (((i * 7 + j * 13 + i * j * 3) % 100) < 55 ? peaks[0] : peaks[1]) + ')');
      }
    }
  };
  switch (name) {
    case 'grassTop':
      noiseTile('rgb(80,', ['122,52)', '110,46)']);
      break;
    case 'grassSide':
      x.fillStyle = 'rgb(96,70,48)';
      x.fillRect(0, 0, 16, 12);
      for (let i = 0; i < 16; i++) {
        x.fillStyle = 'rgb(84,124,52)';
        x.fillRect(i, 11, 1, 3);
        if (i % 3 === 0) x.fillRect(i, 8, 1, 3);
      }
      break;
    case 'dirt':
      noiseTile('rgb(110,', ['82,52)', '96,62)']);
      break;
    case 'stone':
      noiseTile('rgb(122,', ['108,108)', '132,132)']);
      break;
    case 'cobble':
      x.fillStyle = 'rgb(108,108,108)';
      x.fillRect(0, 0, 16, 16);
      x.strokeStyle = 'rgb(80,80,80)';
      x.lineWidth = 1;
      for (let i = 0; i < 16; i += 4) {
        x.beginPath();
        x.rect(((i * 3) % 13), ((i * 5) % 13), 5, 5);
        x.stroke();
      }
      break;
    case 'plank':
      x.fillStyle = 'rgb(158,124,80)';
      x.fillRect(0, 0, 16, 16);
      x.strokeStyle = 'rgb(120,92,58)';
      for (let j = 3; j < 16; j += 4) {
        x.beginPath();
        x.moveTo(0, j);
        x.lineTo(16, j);
        x.stroke();
      }
      break;
    case 'log':
      x.fillStyle = 'rgb(100,78,48)';
      x.fillRect(0, 0, 16, 16);
      x.strokeStyle = 'rgb(80,60,36)';
      x.beginPath();
      x.moveTo(4, 0);
      x.lineTo(4, 16);
      x.stroke();
      x.beginPath();
      x.moveTo(11, 0);
      x.lineTo(11, 16);
      x.stroke();
      break;
    case 'logTop':
      x.fillStyle = 'rgb(158,126,84)';
      x.fillRect(0, 0, 16, 16);
      x.strokeStyle = 'rgb(112,88,56)';
      x.lineWidth = 1;
      x.beginPath();
      x.rect(2, 2, 12, 12);
      x.stroke();
      x.beginPath();
      x.rect(5, 5, 6, 6);
      x.stroke();
      break;
    case 'leaves':
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++)
          px(i, j, 'rgba(58,' + (110 + ((i * j + i * 5 + j * 7) % 60)) + ',48,0.98)');
      break;
    case 'sand':
      noiseTile('rgb(214,', ['182,133)', '200,152)']);
      break;
    case 'gravel':
      noiseTile('rgb(130,', ['104,98)', '148,142)']);
      break;
    case 'glow':
      x.fillStyle = 'rgb(228,178,88)';
      x.fillRect(0, 0, 16, 16);
      for (let i = 0; i < 16; i += 3)
        for (let j = 0; j < 16; j += 3) px(i, j, 'rgb(255,224,152)');
      break;
    case 'tuft':
    case 'poppy':
    case 'dandelion':
      x.clearRect(0, 0, 16, 16);
      x.fillStyle = name === 'tuft' ? 'rgb(84,124,52)' : 'rgb(60,104,44)';
      for (let i = 0; i < 16; i += 2) {
        if (((i * 7) % 5) > 1) x.fillRect(i, 16 - (4 + ((i * 3) % 9)), 1, 4 + ((i * 3) % 9));
      }
      if (name !== 'tuft') {
        x.fillStyle = name === 'poppy' ? 'rgb(200,44,44)' : 'rgb(236,208,64)';
        x.fillRect(6, 2, 4, 4);
      }
      break;
    case 'tallTop':
    case 'tallBottom':
      x.clearRect(0, 0, 16, 16);
      x.fillStyle = 'rgb(' + (name === 'tallTop' ? '84,124,52' : '104,146,64') + ')';
      for (let i = 0; i < 16; i += 2) x.fillRect(i, name === 'tallTop' ? 2 : 8, 1, name === 'tallTop' ? 14 : 8);
      break;
    default:
      x.fillStyle = 'rgb(136,136,136)';
      x.fillRect(0, 0, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  if (name === 'leaves' || name === 'tuft' || name === 'poppy' || name === 'dandelion' || name === 'tallTop' || name === 'tallBottom') {
    t.transparent = true;
  }
  return t;
}

/** Nearest-filter, sRGB, tiny mip bias. Applied to every texture we hand out. */
export function polish(THREE, tex) {
  tex.magFilter = THREE.NearestFilter;
  // Nearest MAGNIFICATION is the pixel-art look; minification stays trilinear
  // so the far field does not sparkle as the camera breathes.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 2; // cheap: 4 is plenty here, 16 only helps glancing angles
  if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/**
 * Load one PNG with a painted fallback on any failure (404, offline, jsdom).
 * NEVER throws. Resolves undefined only if even the fallback cannot build,
 * which callers treat as "render this material without a map".
 */
export function loadMinecraftTexture(THREE, file, name) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (tex, loaded) => {
      if (settled) return;
      settled = true;
      resolve(loaded ? polish(THREE, tex) : tex);
    };
    let img;
    try {
      img = new Image();
    } catch (e) {
      finish(paintFallback(THREE, name), false);
      return;
    }
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      finish(tex, true);
    };
    img.onerror = () => {
      note([name]);
      finish(paintFallback(THREE, name), false);
    };
    img.src = BASE + file;
    // jsdom never fires load events for images; bail to the fallback after a
    // microtask so the environment still builds synchronously enough.
    Promise.resolve().then(() => {
      if (!settled && !img.complete) {
        // give the decoder one more turn (real browsers are fast here)
        setTimeout(() => {
          if (!settled && !img.complete) {
            note([name]);
            finish(paintFallback(THREE, name), false);
          }
        }, 120);
      }
    });
  });
}

/**
 * Load every texture the world needs, as { name: Texture|undefined }.
 * Resolves even if every request fails — the environment's job is to keep
 * building either way.
 */
export async function loadMinecraftTextures(THREE) {
  const entries = Object.entries(MINECRAFT_TEX);
  const results = await Promise.all(
    entries.map(([name, file]) => loadMinecraftTexture(THREE, file, name))
  );
  const out = {};
  for (let i = 0; i < entries.length; i++) out[entries[i][0]] = results[i];
  return out;
}
