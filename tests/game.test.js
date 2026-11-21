import test from 'node:test';
import assert from 'node:assert/strict';
import { Motion, Round, Calibration, readFace, chart, DIRECTIONS } from '../engine.js';

function round() {
  const r = new Round(['right', 'up', 'left'], 60);
  r.schedule(10);
  return r;
}
test('a queued touch uses its original time even if the last frame predates the hit', () => {
  const r = round();
  assert.equal(r.expire(12.93, true), null);
  assert.equal(r.strike('right', 12.04).grade, 'perfect');
  assert.equal(r.results.length, 1);
});
test('waiting for queued touches does not widen the timing window or overrun the next cue', () => {
  const late = round();
  assert.equal(late.expire(12.93, true), null);
  assert.equal(late.strike('right', 12.35).grade, 'late');
  const r = round();
  assert.equal(r.expire(14, true).grade, 'miss');
  assert.equal(r.note.dir, 'up');
});
function rest(m, t) {
  m.sample(0, 0, t);
  m.sample(0.003, -0.002, t + 0.06);
  m.sample(0, 0, t + 0.12);
}
test('each chart balances four directions and does not repeat between groups', () => {
  for (let i = 0; i < 300; i++) {
    const c = chart();
    assert.equal(c.length, 12);
    for (const d of DIRECTIONS) assert.equal(c.filter((x) => x === d).length, 3);
    assert.ok(c.every((v, j) => v !== c[j - 1]));
  }
});
for (const [offset, direction, expected] of [
  [-0.321, 'right', 'early'],
  [-0.32, 'right', 'good'],
  [-0.135, 'right', 'perfect'],
  [0, 'right', 'perfect'],
  [0.135, 'right', 'perfect'],
  [0.136, 'right', 'good'],
  [0.32, 'right', 'good'],
  [0.321, 'right', 'late'],
  [0, 'left', 'wrong'],
])
  test('timing ' + offset + ' ' + direction + ' → ' + expected, () => {
    const r = round();
    assert.equal(r.strike(direction, 12 + offset).grade, expected);
    assert.equal(r.strike('right', 12.33), null);
    assert.equal(r.results.length, 1);
  });
test('only announced notes can be hit, and expired notes are counted once', () => {
  const r = round();
  assert.equal(r.strike('right', 9.99), null);
  assert.equal(r.expire(12.42), null);
  assert.equal(r.expire(12.53).grade, 'miss');
  assert.equal(r.expire(12.6), null);
  r.strike('up', 16.2);
  r.schedule(30);
  assert.equal(r.note.dir, 'left');
  assert.equal(r.note.at, 32);
  r.strike('left', 32);
  assert.equal(r.score, 170);
  assert.equal(r.hits, 2);
  assert.equal(r.note, undefined);
});
for (const [x, y, dir] of [
  [-0.12, 0, 'left'],
  [0.12, 0, 'right'],
  [0, -0.12, 'up'],
  [0, 0.12, 'down'],
]) {
  test('two stable samples confirm ' + dir + ' using initial crossing time', () => {
    const m = new Motion();
    rest(m, 0);
    assert.equal(m.sample(x, y, 0.18), null);
    assert.deepEqual(m.sample(x, y, 0.24), { dir, time: 0.18 });
    for (let n = 1; n < 45; n++) assert.equal(m.sample(x, y, 0.24 + n * 0.04), null);
  });
}
test('noise, partial return, single-frame spikes and diagonal swipes do not add hits', () => {
  const m = new Motion();
  rest(m, 0);
  m.sample(0.14, 0, 0.15);
  m.sample(0.06, 0, 0.18);
  m.sample(0.14, 0, 0.21);
  assert.equal(m.sample(0.14, 0, 0.245), null);
  assert.ok(m.sample(0.14, 0, 0.27));
  m.sample(0, 0, 0.3);
  m.sample(-0.12, 0, 0.35);
  assert.equal(m.sample(-0.15, 0, 0.41), null);
  rest(m, 0.46);
  m.sample(0.14, 0.13, 0.62);
  m.sample(0.15, 0, 0.66);
  assert.equal(m.sample(0.18, 0, 0.72), null);
  rest(m, 0.77);
  for (let i = 0; i < 30; i++)
    assert.equal(m.sample(0.035 * Math.sin(i), 0.04 * Math.cos(i), 0.93 + i * 0.03), null);
});
test('reacquisition or lost frames while held require a fresh center dwell', () => {
  const m = new Motion();
  rest(m, 0);
  m.sample(0.12, 0, 0.16);
  assert.equal(m.sample(0.13, 0, 0.46), null);
  assert.equal(m.sample(0.13, 0, 0.53), null);
  rest(m, 0.6);
  m.reset();
  assert.equal(m.sample(0.12, 0, 0.76), null);
  assert.equal(m.sample(0.12, 0, 0.84), null);
});
test('stable calibration restarts on motion or lost face', () => {
  const c = new Calibration();
  const f = { x: 200, y: 150, width: 100 };
  for (let i = 0; i < 8; i++) assert.equal(c.sample(f, i * 0.1), null);
  assert.equal(c.sample(null, 0.8), null);
  assert.equal(c.sample({ ...f, x: 240 }, 0.85), null);
  let o;
  for (let i = 0; i <= 10; i++) o = c.sample(f, 1 + i * 0.1);
  assert.deepEqual(o, f);
});
test('camera mirrors horizontal position, uses actual frame aspect and requires both eyes closed', () => {
  const p = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  p[234] = { x: 0.35, y: 0.53 };
  p[454] = { x: 0.65, y: 0.53 };
  for (const [e, f, a, b, c, d] of [
    [362, 263, 386, 374, 385, 380],
    [33, 133, 159, 145, 158, 153],
  ]) {
    p[e] = { x: 0.2, y: 0.4 };
    p[f] = { x: 0.3, y: 0.4 };
    p[a] = p[c] = { x: 0.23, y: 0.36 };
    p[b] = p[d] = { x: 0.23, y: 0.44 };
  }
  const r = (scores) => ({
    faceLandmarks: [p],
    faceBlendshapes: [
      {
        categories: scores.map((score, i) => ({
          categoryName: ['eyeBlinkLeft', 'eyeBlinkRight'][i],
          score,
        })),
      },
    ],
  });
  const base = readFace(r([0.9, 0.1]), 640, 480);
  assert.equal(base.closed, false);
  assert.equal(readFace(r([0.9, 0.9]), 640, 480).closed, true);
  p.forEach((point, i) => {
    p[i] = { x: point.x - 0.035, y: point.y + 0.04 };
  });
  const shifted = readFace(r([0, 0]), 640, 480);
  assert.ok(Math.abs(shifted.x - base.x - 22.4) < 1e-6);
  assert.ok(Math.abs(shifted.y - base.y - 19.2) < 1e-6);
});
