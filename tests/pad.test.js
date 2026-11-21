import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDirectionPad } from '../pad.js';

// Give the input handler a 200px pad and dispatch the same event sequence as a browser.
function setup() {
  const element = () =>
    Object.assign(new EventTarget(), {
      classList: { add() {}, remove() {} },
    });
  const controls = Object.fromEntries(
    ['up', 'down', 'left', 'right'].map((dir) => [
      dir,
      Object.assign(element(), { dataset: { dir } }),
    ]),
  );
  const pad = element();
  let captured;
  Object.assign(pad, {
    querySelectorAll: () => Object.values(controls),
    querySelector: () => ({ getBoundingClientRect: () => ({ width: 48 }) }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture: (id) => {
      captured = id;
    },
    hasPointerCapture: (id) => captured === id,
    releasePointerCapture: () => {
      captured = null;
    },
  });
  const hits = [];
  const reset = bindDirectionPad(pad, (dir) => hits.push(dir));
  function pointer(type, x, y, id = 1) {
    pad.dispatchEvent(
      Object.assign(new Event('pointer' + type, { cancelable: true }), {
        clientX: x,
        clientY: y,
        pointerId: id,
        isPrimary: id === 1,
        button: 0,
      }),
    );
  }
  const click = (dir, detail) =>
    controls[dir].dispatchEvent(Object.assign(new Event('click'), { detail }));
  return { hits, pointer, click, reset };
}

test('the rim accepts a press immediately; drifting and the generated click do not strike again', () => {
  const { hits, pointer, click } = setup();
  pointer('down', 9, 127);
  assert.deepEqual(hits, ['left']);
  pointer('move', 100, 15);
  pointer('up', 183, 100);
  click('right', 1);
  pointer('down', 8, 8); // Outside the round edge.
  pointer('up', 8, 8);
  click('down', 0); // Keyboard / assistive activation.
  assert.deepEqual(hits, ['left', 'down']);
});

test('a resting thumb ignores jitter and diagonals, then strikes once on a short directional swipe', () => {
  const { hits, pointer } = setup();
  pointer('down', 107, 102);
  pointer('move', 117, 103);
  pointer('move', 126, 122);
  assert.deepEqual(hits, []);
  pointer('move', 128, 105);
  pointer('move', 60, 102);
  pointer('up', 60, 102);
  pointer('down', 100, 100);
  pointer('up', 100, 80); // Fast swipe with only a terminal sample.
  assert.deepEqual(hits, ['right', 'up']);
});

test('secondary touches, cancellations and a layout reset cannot leak into the next press', () => {
  const { hits, pointer, reset } = setup();
  pointer('down', 100, 100);
  pointer('down', 180, 100, 2);
  pointer('up', 180, 100, 2);
  pointer('cancel', 100, 100);
  pointer('move', 100, 145);
  pointer('down', 100, 100);
  reset();
  pointer('up', 100, 160);
  pointer('down', 100, 194);
  assert.deepEqual(hits, ['down']);
});
