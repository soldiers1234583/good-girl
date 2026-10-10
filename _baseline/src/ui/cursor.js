/**
 * Cinematic cursor (desktop, fine pointers only).
 *
 * A small glowing dot with a trailing ring. Over anything marked
 * `data-cursor="…"` the ring opens up and a context label fades in beside it.
 *
 * Deliberately restrained: the brief warns against a huge distracting cursor,
 * so the dot is 6px, the ring at rest is 30px, and the label is small
 * uppercase type. The whole thing is skipped entirely on touch devices and
 * under reduced motion, where the native cursor is the correct answer.
 */

import { damp } from '../util/math.js';

export function createCursor(ctx = {}) {
  if (!ctx.enabled) {
    return { update() {}, setTone() {}, dispose() {}, enabled: false };
  }

  const dot = document.createElement('div');
  dot.className = 'cursor-dot';
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  const label = document.createElement('div');
  label.className = 'cursor-label';

  const layer = document.createElement('div');
  layer.className = 'cursor-layer';
  layer.append(dot, ring, label);
  document.body.appendChild(layer);
  document.documentElement.classList.add('has-custom-cursor');

  const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const tip = { x: target.x, y: target.y };
  const follow = { x: target.x, y: target.y };
  let scale = 1;
  let visible = false;
  let currentLabel = '';
  let activeTarget = null;

  const onMove = (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
    if (!visible) {
      visible = true;
      layer.classList.add('is-visible');
      tip.x = follow.x = target.x;
      tip.y = follow.y = target.y;
    }
    // Context: the nearest ancestor that declares a cursor hint.
    const el = e.target && e.target.closest ? e.target.closest('[data-cursor]') : null;
    activeTarget = el;
    const next = el ? el.getAttribute('data-cursor') : '';
    if (next !== currentLabel) {
      currentLabel = next;
      label.textContent = next;
      layer.classList.toggle('has-label', !!next);
    }
  };

  const onLeave = () => {
    visible = false;
    layer.classList.remove('is-visible');
  };
  const onDown = () => layer.classList.add('is-down');
  const onUp = () => layer.classList.remove('is-down');

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('blur', onLeave, { passive: true });

  let sig = '';

  function update(dt, t) {
    // Dot tracks tightly; ring trails, which is what gives it weight.
    tip.x = damp(tip.x, target.x, 34, dt);
    tip.y = damp(tip.y, target.y, 34, dt);
    follow.x = damp(follow.x, target.x, 11, dt);
    follow.y = damp(follow.y, target.y, 11, dt);

    const want = currentLabel ? 2.05 : 1;
    scale = damp(scale, want, 9, dt);
    // A slow breathing pulse so the cursor reads as "magical" without moving.
    const pulse = 1 + Math.sin(t * 2.1) * 0.045;

    const s = `${tip.x.toFixed(2)}|${tip.y.toFixed(2)}|${follow.x.toFixed(2)}|${follow.y.toFixed(2)}|${scale.toFixed(3)}`;
    if (s === sig) return;
    sig = s;

    dot.style.transform = `translate3d(${tip.x.toFixed(2)}px, ${tip.y.toFixed(2)}px, 0) translate(-50%,-50%)`;
    ring.style.transform =
      `translate3d(${follow.x.toFixed(2)}px, ${follow.y.toFixed(2)}px, 0) ` +
      `translate(-50%,-50%) scale(${(scale * pulse).toFixed(3)})`;
    label.style.transform = `translate3d(${(follow.x + 26 * scale).toFixed(2)}px, ${(follow.y - 8).toFixed(2)}px, 0)`;
  }

  /** Re-tint from the palette so the cursor belongs to the current world. */
  function setTone(pal) {
    const c = (v) => Math.round(v * 255);
    document.documentElement.style.setProperty('--cursor-rgb', `${c(pal.mote[0])}, ${c(pal.mote[1])}, ${c(pal.mote[2])}`);
  }

  function dispose() {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('blur', onLeave);
    layer.remove();
    document.documentElement.classList.remove('has-custom-cursor');
  }

  return { update, setTone, dispose, enabled: true };
}
