/**
 * Story typography.
 *
 * Four lines, total. The brief is explicit that text is a narrative instrument
 * here rather than a landing-page feature, so this module does one thing well:
 * reveal a line with a masked, word-staggered wipe.
 *
 * The reveal is driven by two scrubbed values from the choreography:
 *   alpha   - line opacity in/out
 *   stagger - a travelling wave head, one step behind each word in turn
 *
 * Because `stagger` is scrubbed rather than tweened, the words arrive and
 * retreat in step with the user's own scrolling, which is what keeps the text
 * inside the same continuous timeline as the camera.
 */

export function createTypography(root, phrases, ctx = {}) {
  const reduced = !!ctx.reducedMotion;
  const nodes = [];

  for (const ph of phrases) {
    const el = document.createElement('div');
    el.className = `phrase phrase--${ph.size || 'md'}${ph.pin ? ' phrase--pin' : ''}`;
    el.dataset.phrase = ph.id;
    if (ph.pin) {
      // The reward is the one line a screen reader should announce: it is the
      // payoff, and it is the only text that stays on screen.
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
    }

    const inner = document.createElement('span');
    inner.className = 'phrase__line';

    // Split on whitespace but keep words intact; each gets a mask wrapper so
    // the reveal slides up from behind a hard edge instead of fading.
    const words = ph.text.split(' ');
    words.forEach((w, i) => {
      const outer = document.createElement('span');
      outer.className = 'w';
      const wInner = document.createElement('span');
      wInner.className = 'w__i';
      wInner.textContent = w;
      outer.appendChild(wInner);
      inner.appendChild(outer);
      if (i < words.length - 1) inner.appendChild(document.createTextNode(' '));
    });

    el.appendChild(inner);
    root.appendChild(el);
    nodes.push({ ph, el, inner, wordNodes: Array.from(inner.querySelectorAll('.w__i')), wordCount: words.length });
  }

  let lastSignature = '';
  const writes = [];
  let writeCount = 0;

  function commit() {
    if (!writes.length) return;
    for (const w of writes) w();
    writes.length = 0;
  }

  /** @param {Array} sample from `choreography.direct().ui.phrases` */
  function update(sample) {
    // Cheap early-out: nothing about the phrasing changed since last frame.
    let signature = '';
    for (const s of sample) signature += `${s.alpha.toFixed(3)}${s.stagger.toFixed(3)}|`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const s = sample[i];
      if (!s) continue;

      const visible = s.alpha > 0.002;
      // `shown` starts as null so the first evaluation always writes the
      // display value, including the initial "hidden" state.
      if (node.shown !== visible) {
        node.shown = visible;
        const display = visible ? '' : 'none';
        writes.push(() => {
          node.el.style.display = display;
        });
      }
      if (!visible) continue;

      const stagger = reduced ? 1 : s.stagger;
      const span = 0.85;
      const step = node.wordCount > 1 ? (1 - span) / (node.wordCount - 1) : 0;

      // Word reveal.
      for (let k = 0; k < node.wordCount; k++) {
        const local = Math.max(0, Math.min(1, (stagger - k * step) / span));
        // Ease-out so the word decelerates into place.
        const e = 1 - Math.pow(1 - local, 3);
        const y = (1 - e) * 118;
        const op = Math.max(0, Math.min(1, local * 1.6));
        const wi = node.wordNodes[k];
        writes.push(() => {
          wi.style.transform = `translate3d(0,${y.toFixed(2)}%,0)`;
          wi.style.opacity = op.toFixed(3);
        });
      }

      // Whole-line tracking and lift: looser when arriving, tighter at rest.
      const lineLift = (1 - s.alpha) * (reduced ? 0 : 16);
      const tracking = 0.16 - 0.13 * s.alpha;
      writes.push(() => {
        node.el.style.opacity = s.alpha.toFixed(3);
        node.inner.style.transform = `translate3d(0,${lineLift.toFixed(2)}px,0)`;
        node.inner.style.letterSpacing = `${tracking.toFixed(3)}em`;
      });
    }

    commit();
  }

  function dispose() {
    for (const n of nodes) n.el.remove();
    nodes.length = 0;
  }

  return { update, dispose };
}
