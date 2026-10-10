import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp,
  lerp,
  smoothstep,
  smootherstep,
  easeInOut,
  easeOutCubic,
  easeOutBack,
  remap,
  damp,
  dampArray,
  springStep,
  noise1,
  fbm1,
  makeRandom,
  rgb,
  mixRgb,
  rgbToCss,
  rgbToHex,
  sampleStops,
  sampleScalar,
} from '../src/util/math.js';

test('clamp holds values inside the interval', () => {
  assert.equal(clamp(-3), 0);
  assert.equal(clamp(4), 1);
  assert.equal(clamp(0.4), 0.4);
  assert.equal(clamp(7, 0, 10), 7);
});

test('interpolation helpers hit their endpoints exactly', () => {
  assert.equal(lerp(2, 8, 0), 2);
  assert.equal(lerp(2, 8, 1), 8);

  // Two-edge eases take (edge0, edge1, x).
  for (const fn of [smoothstep, smootherstep]) {
    assert.equal(fn(0, 1, 0), 0, 'starts at 0');
    assert.equal(fn(0, 1, 1), 1, 'ends at 1');
  }
  // Single-argument eases take (t).
  for (const fn of [easeInOut, easeOutCubic]) {
    assert.equal(fn(0), 0, 'starts at 0');
    assert.equal(fn(1), 1, 'ends at 1');
  }

  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9);
  assert.ok(easeOutBack(0.5) > 0.5, 'overshoots before settling');
});

test('smoothstep has zero slope at both edges (so nothing pops on arrival)', () => {
  const h = 1e-5;
  const leftSlope = (smoothstep(0, 1, h) - smoothstep(0, 1, 0)) / h;
  const rightSlope = (smoothstep(0, 1, 1) - smoothstep(0, 1, 1 - h)) / h;
  assert.ok(Math.abs(leftSlope) < 1e-3, `left slope was ${leftSlope}`);
  assert.ok(Math.abs(rightSlope) < 1e-3, `right slope was ${rightSlope}`);
});

test('smoothstep is monotonic across its edges', () => {
  let prev = -Infinity;
  for (let i = 0; i <= 1000; i++) {
    const v = smoothstep(0.2, 0.8, i / 1000);
    assert.ok(v >= prev - 1e-12, 'never decreases');
    prev = v;
  }
});

test('remap maps ranges and clamps by default', () => {
  assert.equal(remap(5, 0, 10, 0, 100), 50);
  assert.equal(remap(-5, 0, 10, 0, 100), 0);
  assert.equal(remap(15, 0, 10, 0, 100), 100);
  assert.equal(remap(15, 0, 10, 0, 100, false), 150);
  assert.equal(remap(3, 3, 3, 7, 9), 7, 'degenerate input range is safe');
});

test('damp converges toward the target and never overshoots', () => {
  let v = 0;
  for (let i = 0; i < 600; i++) v = damp(v, 1, 4, 1 / 60);
  assert.ok(Math.abs(v - 1) < 1e-3, `settled at ${v}`);

  // Must approach from below without crossing the target.
  v = 0;
  for (let i = 0; i < 60; i++) {
    v = damp(v, 1, 4, 1 / 60);
    assert.ok(v <= 1 + 1e-12, 'no overshoot');
  }
});

test('damp is frame-rate independent within a small tolerance', () => {
  let a = 0;
  for (let i = 0; i < 120; i++) a = damp(a, 1, 5, 1 / 120);
  let b = 0;
  for (let i = 0; i < 60; i++) b = damp(b, 1, 5, 1 / 60);
  assert.ok(Math.abs(a - b) < 5e-3, `120Hz gave ${a}, 60Hz gave ${b}`);
});

test('dampArray smooths in place', () => {
  const arr = [0, 10];
  dampArray(arr, [1, 20], 5, 1 / 60);
  assert.ok(arr[0] > 0 && arr[0] < 1);
  assert.ok(arr[1] > 10 && arr[1] < 20);
});

test('springStep settles on the target and stays stable on a long frame', () => {
  const s = { x: 0, v: 0 };
  for (let i = 0; i < 900; i++) springStep(s, 1, 8, 1 / 60);
  assert.ok(Math.abs(s.x - 1) < 1e-2, `settled at ${s.x}`);
  assert.ok(Math.abs(s.v) < 1e-2, `velocity settled to ${s.v}`);

  // A 0.5s hitch must not explode the integrator. Explicit damping is only
  // stable while omega*h < 1, so a naive implementation diverges to ~1e20
  // here and permanently breaks whatever it was driving. Phones hand out
  // hitches like this constantly, which is why this is tested.
  const hitched = { x: 0, v: 0 };
  for (let i = 0; i < 60; i++) springStep(hitched, 1, 8.4, 0.5);
  assert.ok(Number.isFinite(hitched.x), `stayed finite, got ${hitched.x}`);
  assert.ok(Math.abs(hitched.x - 1) < 0.25, `still converged, got ${hitched.x}`);
});

test('springStep stays stable across a wide range of hitches and stiffnesses', () => {
  for (const omega of [4, 8.4, 14, 30]) {
    for (const dt of [1 / 240, 1 / 60, 1 / 12, 0.25, 0.5, 2]) {
      const s = { x: 0, v: 0 };
      for (let i = 0; i < 120; i++) springStep(s, 1, omega, dt);
      assert.ok(Number.isFinite(s.x), `diverged at omega=${omega} dt=${dt}: ${s.x}`);
      assert.ok(s.x > -2 && s.x < 3, `left a sane range at omega=${omega} dt=${dt}: ${s.x}`);
    }
  }
});

test('springStep overshoots, which is the whole point of using a spring', () => {
  const s = { x: 0, v: 0 };
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    springStep(s, 1, 8.4, 1 / 60);
    peak = Math.max(peak, s.x);
  }
  // A visible but restrained bounce. A critically damped spring would report
  // a peak of exactly 1 and this test would catch that regression.
  assert.ok(peak > 1.03, `expected a visible overshoot, peak was ${peak}`);
  assert.ok(peak < 1.3, `overshoot should be small, peak was ${peak}`);
});

test('noise and fbm stay in range and are stable', () => {
  for (let i = 0; i < 500; i++) {
    const n = noise1(i * 0.37);
    assert.ok(n >= 0 && n <= 1, `noise1 out of range: ${n}`);
    const f = fbm1(i * 0.11, 3);
    assert.ok(f >= 0 && f <= 1, `fbm1 out of range: ${f}`);
  }
  assert.equal(noise1(3.25), noise1(3.25), 'deterministic');
  assert.equal(fbm1(1.5), fbm1(1.5), 'deterministic');
});

test('makeRandom is deterministic and well distributed', () => {
  const a = makeRandom(42);
  const b = makeRandom(42);
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    const x = a();
    assert.equal(x, b(), 'same seed, same sequence');
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.03, `mean was ${sum / 2000}`);
});

test('colour helpers convert and round-trip', () => {
  const c = rgb(0xff8040);
  assert.ok(Math.abs(c[0] - 1) < 1e-9);
  assert.ok(Math.abs(c[1] - 128 / 255) < 1e-9);
  assert.equal(rgbToHex(c), 0xff8040);
  assert.equal(rgbToCss([1, 0, 0]), 'rgb(255,0,0)');
  assert.equal(rgbToCss([1, 0, 0], 0.5), 'rgba(255,0,0,0.5)');
  assert.deepEqual(mixRgb([0, 0, 0], [1, 1, 1], 0.5), [0.5, 0.5, 0.5]);
});

test('sampleStops and sampleScalar interpolate between stops and hold at the ends', () => {
  const stops = [
    { at: 0, value: [0, 0, 0] },
    { at: 1, value: [1, 1, 1] },
  ];
  assert.deepEqual(sampleStops(-5, stops), [0, 0, 0]);
  assert.deepEqual(sampleStops(5, stops), [1, 1, 1]);
  const mid = sampleStops(0.5, stops);
  assert.ok(mid.every((v) => Math.abs(v - 0.5) < 1e-9));

  const scalars = [
    { at: 0, value: 0 },
    { at: 1, value: 10 },
  ];
  assert.equal(sampleScalar(0.5, scalars), 5);
  assert.equal(sampleScalar(-1, scalars), 0);
  assert.equal(sampleScalar(2, scalars), 10);
});
