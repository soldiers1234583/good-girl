/**
 * Single-file build.
 *
 * The modular site is the source of truth, but it needs an HTTP server: ES
 * modules are blocked from file:// by CORS, so a phone opening index.html
 * straight from the file manager would render a black screen.
 *
 * This emits `dist/index.html` — CSS, Three.js and the whole module graph
 * inlined into one document with no runtime imports — so the experience can
 * be opened anywhere, with no server and no network.
 *
 * Run: node build.mjs   (or: npm run build)
 */

import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Build the single file.
 * @returns {{ html: string, bytes: number, jsBytes: number }}
 */
export async function build() {
  // --- bundle the module graph ---------------------------------------
  const result = await esbuild.build({
    entryPoints: [join(HERE, 'src', 'main.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    write: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const js = result.outputFiles[0].text;

  const three = readFileSync(join(HERE, 'vendor', 'three.min.js'), 'utf8');
  const post = readFileSync(join(HERE, 'vendor', 'postprocessing.js'), 'utf8');
  const css = readFileSync(join(HERE, 'css', 'style.css'), 'utf8');
  let html = readFileSync(join(HERE, 'index.html'), 'utf8');

  // A literal `</script>` anywhere inside the JS would close the tag early and
  // leave a mangled, unbootable document. `\/` is equivalent to `/` inside a
  // JS string, template literal or regex, so escaping is safe everywhere and
  // changes no runtime value.
  const escapeClose = (src) => src.replace(/<\/script/gi, '<\\/script');
  const threeJs = escapeClose(three);
  const postJs = escapeClose(post);
  const bundleJs = escapeClose(js);

  // Replacement values contain minified JS full of `$` sequences, so every
  // substitution is a function — a string replacement would interpret `$&`
  // and silently corrupt the bundle.
  let replaces = 0;
  const must = (pattern, repl) => {
    if (!pattern.test(html)) throw new Error(`build: expected markup not found: ${pattern}`);
    html = html.replace(pattern, repl);
    replaces++;
  };

  must(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${css}\n</style>`);

  must(/<link rel="modulepreload" href="src\/main.js">\s*/, () => '');

  must(
    // Non-greedy across comments: index.html puts an HTML comment between the
    // classic scripts explaining that postprocessing is optional.
    /<script src="vendor\/three\.min\.js"><\/script>[\s\S]*?<script src="vendor\/postprocessing\.js"><\/script>[\s\S]*?<script type="module" src="src\/main\.js"><\/script>/,
    () => `<script>\n${threeJs}\n</script>\n<script>\n${postJs}\n</script>\n<script>\n${bundleJs}\n</script>`
  );

  if (replaces !== 3) throw new Error(`build: applied ${replaces} rewrites, expected 3`);

  mkdirSync(join(HERE, 'dist'), { recursive: true });
  const out = join(HERE, 'dist', 'index.html');
  writeFileSync(out, html);

  return { html, bytes: Buffer.byteLength(html), jsBytes: Buffer.byteLength(js) };
}

// Run directly (not when imported by a test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { html, bytes, jsBytes } = await build();
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`dist/index.html  ${kb(bytes)}  (bundle ${kb(jsBytes)}, css inlined, three inlined)`);
  // Sanity: the result must not still need a network or a module loader.
  if (/<script[^>]*\bsrc\s*=|<link[^>]*\brel=["']stylesheet|<script[^>]*type=["']module/i.test(html)) {
    console.error('FAIL: external script/stylesheet/module references remain');
    process.exit(1);
  }
  console.log('no external references remaining — openable from file://');
}
