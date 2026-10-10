/**
 * The Good Girl Badge.
 *
 * Built in DOM + SVG rather than in the 3D scene, for three reasons: the
 * typography stays crisp at every pixel ratio, it is immune to the fog and
 * tone mapping that would mute the gold, and it stays accessible (it can be
 * given a role, a label and readable contrast).
 *
 * Motion: the reveal is a real spring, not a scale tween. A spring overshoots
 * and settles, which is what makes it read as an object being *presented*
 * rather than a div being animated. Once settled it floats gently, and it
 * tilts toward the cursor as if it were a physical plaque catching the light.
 */

import { clamp, springStep, damp } from '../util/math.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createBadge(root, ctx = {}) {
  const reduced = !!ctx.reducedMotion;
  const interactive = ctx.interactive !== false;

  const wrap = document.createElement('div');
  wrap.className = 'badge-wrap';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Good Girl Badge — your reward for retrieving the star');

  /* ---------- ambient bloom behind the plaque ---------- */
  const bloom = document.createElement('div');
  bloom.className = 'badge-bloom';
  wrap.appendChild(bloom);

  /* ---------- the plaque ---------- */
  const stage = document.createElement('div');
  stage.className = 'badge-stage';

  const tilt = document.createElement('div');
  tilt.className = 'badge-tilt';

  const plaque = document.createElement('div');
  plaque.className = 'badge';

  // Ornate frame drawn as SVG so the ring, ticks and shine are all one scalable
  // vector rather than a stack of bordered divs.
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'badge__frame');
  svg.setAttribute('viewBox', '0 0 320 220');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <defs>
      <linearGradient id="ggbGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff2c9"/>
        <stop offset="0.34" stop-color="#ffd77a"/>
        <stop offset="0.55" stop-color="#e0a83c"/>
        <stop offset="1" stop-color="#8a5a16"/>
      </linearGradient>
      <linearGradient id="ggbSheen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
        <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0.25"/>
      </linearGradient>
      <radialGradient id="ggbInner" cx="0.5" cy="0.35" r="0.85">
        <stop offset="0" stop-color="#2a1c46" stop-opacity="0.94"/>
        <stop offset="1" stop-color="#150d26" stop-opacity="0.98"/>
      </radialGradient>
    </defs>
    <rect class="badge__plate" x="14" y="14" width="292" height="192" rx="26" fill="url(#ggbInner)"/>
    <rect class="badge__edge" x="14" y="14" width="292" height="192" rx="26" fill="none"
          stroke="url(#ggbGold)" stroke-width="5"/>
    <rect class="badge__edge-inner" x="26" y="26" width="268" height="168" rx="18" fill="none"
          stroke="url(#ggbGold)" stroke-width="1.6" opacity="0.75"/>
    <rect class="badge__sheen" x="14" y="14" width="292" height="192" rx="26" fill="url(#ggbSheen)"/>
    <g class="badge__ticks" fill="url(#ggbGold)">
      ${Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2 - Math.PI / 2;
        const cx = 160 + Math.cos(a) * 150;
        const cy = 110 + Math.sin(a) * 100;
        const r = i % 2 === 0 ? 3.1 : 1.7;
        const op = i % 2 === 0 ? 0.95 : 0.55;
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" opacity="${op}"/>`;
      }).join('')}
    </g>`
  plaque.appendChild(svg);

  const content = document.createElement('div');
  content.className = 'badge__content';
  content.innerHTML = `
    <div class="badge__flourish" aria-hidden="true">
      <span>✦</span><span>✦</span><span>✦</span>
    </div>
    <div class="badge__title">GOOD GIRL</div>
    <div class="badge__star" aria-hidden="true">★</div>
    <div class="badge__subtitle">BADGE</div>
    <div class="badge__flourish badge__flourish--low" aria-hidden="true">
      <span>✦</span><span>✦</span><span>✦</span>
    </div>`;
  plaque.appendChild(content);

  /* ---------- reveal light sweep ---------- */
  // A single soft highlight that travels across the plaque while the badge is
  // being presented, then is gone. Purely CSS-driven from two custom
  // properties written in update() — no extra rAF work, no JS animation.
  const glint = document.createElement('div');
  glint.className = 'badge__glint';
  glint.setAttribute('aria-hidden', 'true');
  plaque.appendChild(glint);

  tilt.appendChild(plaque);
  stage.appendChild(tilt);
  wrap.appendChild(stage);
  root.appendChild(wrap);

  /* ---------- motion state ---------- */
  const scale = { x: 0.62, v: 0 };
  const rise = { x: 26, v: 0 };
  const rot = { x: -9, v: 0 };
  const tilts = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };
  let glow = 0;
  let hovered = false;
  let revealed = 0;
  let bounds = null;

  if (interactive) {
    const onMove = (e) => {
      if (!bounds) bounds = plaque.getBoundingClientRect();
      const cx = bounds.left + bounds.width / 2;
      const cy = bounds.top + bounds.height / 2;
      // Normalised offset from the plaque centre, in screen units.
      pointer.x = clamp((e.clientX - cx) / (bounds.width * 0.9), -1, 1);
      pointer.y = clamp((e.clientY - cy) / (bounds.height * 0.9), -1, 1);
      const pad = 40;
      hovered =
        e.clientX > bounds.left - pad &&
        e.clientX < bounds.right + pad &&
        e.clientY > bounds.top - pad &&
        e.clientY < bounds.bottom + pad;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    // Re-measure on scroll: the plaque floats, so its rect goes stale fast.
    const onScroll = () => {
      bounds = null;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    wrap._cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
    };
  }

  let writeSig = '';

  /**
   * @param {object} ui  the choreography's `ui` group
   * @param {number} dt
   * @param {number} t
   */
  function update(ui, dt, t) {
    const target = ui.badgeIn;
    revealed = target;

    // The spring only ever scales between 0.62 and 1, so it cannot express
    // "not yet earned" on its own — without this gate the plaque would rest at
    // 62% opacity-and-blade over the entire opening scene. Visibility is
    // therefore driven directly by the reveal value.
    if (target <= 0.004) {
      if (wrap.style.display !== 'none') {
        wrap.style.display = 'none';
        wrap.style.opacity = '0';
      }
      // Keep the springs parked so the reveal starts from the right place.
      scale.x = 0.62;
      scale.v = 0;
      rise.x = 26;
      rise.v = 0;
      rot.x = -9;
      rot.v = 0;
      return;
    }
    if (wrap.style.display === 'none') wrap.style.display = '';
    wrap.style.opacity = Math.min(1, target * 1.6).toFixed(3);

    // Drive the spring toward a target rather than integrating from zero, so
    // scrubbing backwards rewinds the reveal cleanly.
    springStep(scale, 0.62 + target * 0.38, reduced ? 14 : 8.4, dt);
    springStep(rise, 26 - target * 26, reduced ? 14 : 9, dt);
    springStep(rot, -9 + target * 9, reduced ? 14 : 7.6, dt);

    // Cursor tilt, damped so it trails the pointer like a heavy object.
    const wantX = reduced ? 0 : -pointer.y * 11;
    const wantY = reduced ? 0 : pointer.x * 14;
    tilts.x = damp(tilts.x, wantX, 3.4, dt);
    tilts.y = damp(tilts.y, wantY, 3.4, dt);

    const wantGlow = (hovered ? 0.85 : 0.34) * target;
    glow = damp(glow, wantGlow, 3.6, dt);

    // Gentle float once revealed; its amplitude fades in with the reveal so it
    // does not wobble while still scaling up.
    const float = reduced ? 0 : 1;
    const fy = Math.sin(t * 0.82) * 6 * target * float;
    const fz = Math.sin(t * 0.58 + 1.2) * 0.7 * target * float;
    const breathe = 1 + (reduced ? 0 : Math.sin(t * 0.7) * 0.008 * target);

    const s = scale.x * breathe;
    const sig = `${s.toFixed(4)}|${rise.x.toFixed(3)}|${rot.x.toFixed(3)}|${tilts.x.toFixed(2)}|${tilts.y.toFixed(2)}|${glow.toFixed(3)}|${fy.toFixed(2)}|${fz.toFixed(3)}|${target.toFixed(3)}`;
    if (sig === writeSig) return;
    writeSig = sig;

    tilt.style.transform =
      `translate3d(0, ${(rise.x + fy).toFixed(2)}px, 0) ` +
      `rotateX(${tilts.x.toFixed(2)}deg) rotateY(${tilts.y.toFixed(2)}deg) ` +
      `rotateZ(${(rot.x + fz).toFixed(2)}deg) scale(${s.toFixed(4)})`;
    bloom.style.opacity = glow.toFixed(3);
    bloom.style.transform = `scale(${(0.86 + glow * 0.38).toFixed(3)})`;
    plaque.style.setProperty('--badge-glow', glow.toFixed(3));
    wrap.style.setProperty('--badge-in', target.toFixed(3));
    // Sweep position rides the reveal; its STRENGTH peaks mid-transition
    // (x*(1-x)*4 → 0 → 1 → 0) so the light crosses once and rests at zero.
    wrap.style.setProperty('--badge-sweep', target.toFixed(3));
    wrap.style.setProperty('--badge-sweep-a', (target * (1 - target) * 4).toFixed(3));
  }

  function dispose() {
    if (wrap._cleanup) wrap._cleanup();
    wrap.remove();
  }

  return { wrapper: wrap, update, dispose, get revealed() { return revealed; } };
}
