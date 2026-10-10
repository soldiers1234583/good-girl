/**
 * Heads-up display.
 *
 * Kept at the edge of the frame and quiet throughout. It exists to answer
 * three questions the visitor will otherwise ask, and nothing more:
 *
 *   - "is this a normal page?"      -> the title card, at rest, before scroll
 *   - "how long is this?"           -> the chapter rail
 *   - "I want to see that again"    -> the replay control, offered only at the end
 *
 * The rail is also a control: each chapter marker is a link into the story, so
 * a visitor who wants a specific moment can jump straight to it.
 */

import { clamp } from '../util/math.js';

export function createHud(root, ctx = {}) {
  const chapters = ctx.chapters || [];
  const reduced = !!ctx.reducedMotion;

  const el = document.createElement('div');
  el.className = 'hud';

  /* ---------- title card ----------
     Built in index.html, not here. It is the first-paint content, and boot is
     deferred one frame so the browser can paint it before the scene is
     constructed. The HUD only flips its state. */
  const title = root.querySelector('.hud-title');

  /* ---------- chapter rail ---------- */
  const rail = document.createElement('div');
  rail.className = 'rail';
  const railFill = document.createElement('div');
  railFill.className = 'rail__fill';
  const railTrack = document.createElement('div');
  railTrack.className = 'rail__track';
  const markers = chapters.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail__marker';
    b.dataset.cursor = 'Jump here';
    b.style.top = `${(c.at * 100).toFixed(2)}%`;
    b.setAttribute('aria-label', `Jump to ${c.label}`);
    b.title = c.label;
    const dot = document.createElement('span');
    dot.className = 'rail__dot';
    b.appendChild(dot);
    b.addEventListener('click', () => ctx.onSeek && ctx.onSeek(c.at));
    railTrack.appendChild(b);
    return { el: b, at: c.at };
  });
  rail.append(railTrack, railFill);
  railTrack.appendChild(railFill);
  el.appendChild(rail);

  /* ---------- chapter caption ---------- */
  const caption = document.createElement('div');
  caption.className = 'caption';
  el.appendChild(caption);
  let lastCaption = '';

  /* ---------- ending block ---------- */
  const ending = document.createElement('div');
  ending.className = 'ending';
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'replay';
  replay.dataset.cursor = 'Again';
  replay.innerHTML = '<span class="replay__ico" aria-hidden="true">↺</span>Relive it';
  replay.addEventListener('click', () => ctx.onReplay && ctx.onReplay());
  ending.appendChild(replay);
  el.appendChild(ending);
  let lastEnding = -1;

  /* ---------- notices (reduced motion / fallback) ---------- */
  let notice = null;
  if (ctx.notice) {
    notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = ctx.notice;
    el.appendChild(notice);
  }

  root.appendChild(el);

  let sig = '';
  let seekHandler = null;

  function update(ui, rawProgress, dt, t) {
    // Rail fill + marker highlight. Bucketed to 0.2% so we are not writing
    // styles every frame for sub-pixel changes.
    const fill = Math.round(clamp(rawProgress) * 500) / 500;
    const activeIdx = (() => {
      let idx = 0;
      markers.forEach((m, i) => {
        if (rawProgress >= m.at) idx = i;
      });
      return idx;
    })();
    const captionText = ui.chapter || '';
    const endingOn = ui.badgeIn > 0.6 ? 1 : 0;

    const s = `${fill}|${activeIdx}|${captionText}|${endingOn}`;
    if (s === sig) return;
    sig = s;

    railFill.style.transform = `scaleY(${fill.toFixed(3)})`;
    markers.forEach((m, i) => m.el.classList.toggle('is-active', i === activeIdx));
    if (captionText !== lastCaption) {
      lastCaption = captionText;
      caption.textContent = captionText;
      // Re-trigger the caption's entrance by toggling the animation class.
      caption.classList.remove('is-in');
      void caption.offsetWidth;
      caption.classList.add('is-in');
    }
    if (endingOn !== lastEnding) {
      lastEnding = endingOn;
      ending.classList.toggle('is-visible', endingOn === 1);
    }
  }

  /** The title card retreats as soon as the story starts moving. */
  function updateTitle(rawProgress) {
    if (!title) return;
    title.classList.toggle('is-away', rawProgress >= 0.012);
  }

  function dispose() {
    markers.forEach((m) => m.el.removeEventListener('click', seekHandler));
    el.remove();
  }

  return { el, update, updateTitle, dispose };
}

/**
 * DOM-only fallback used when WebGL is unavailable or software-rendered.
 * Tells the same story in the same four beats with CSS transitions, so the
 * visitor still reaches the reward instead of a blank canvas.
 */
export function createFallbackStory(root, ctx = {}) {
  const el = document.createElement('div');
  el.className = 'fallback';
  el.innerHTML = `
    <div class="fallback__glow"></div>
    <div class="fallback__body">
      <div class="fallback__glyph">★</div>
      <div class="fallback__line">A little star…</div>
      <div class="fallback__line">It's waiting for you.</div>
      <div class="fallback__line">You earned something special.</div>
      <div class="fallback__final">You have earned a Good Girl Badge.</div>
      <div class="fallback__badge">GOOD GIRL BADGE</div>
    </div>`;
  root.appendChild(el);

  const onScroll = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = clamp(window.scrollY / max);
    el.style.setProperty('--p', p.toFixed(4));
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  return {
    el,
    dispose() {
      window.removeEventListener('scroll', onScroll);
      el.remove();
    },
  };
}
