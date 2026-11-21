import test from 'node:test';
import assert from 'node:assert/strict';
import { Sound } from '../audio.js';
import { Round, DIRECTIONS } from '../engine.js';

function record(mode) {
  const sound = new Sound();
  const tones = [],
    words = [];
  sound.ctx = { currentTime: 1 };
  sound.mode = mode;
  sound.tone = (hz, at, length, volume, options = {}) => tones.push({ hz, at, length, ...options });
  sound.say = (word, at = 1) => {
    words.push(word);
    return at + 1;
  };
  return { sound, tones, words };
}

test('music mode uses no speech during calibration, count-in, feedback, pause or finish', () => {
  const { sound, words, tones } = record('music');
  for (const name of ['close', 'paused', 'end']) assert.ok(sound.signal(name) > 1);
  assert.equal(sound.countIn(0.8), 2.68);
  for (const dir of DIRECTIONS) sound.direction(dir, 4, 0.8);
  sound.feedback(true);
  sound.feedback(false);
  assert.ok(tones.length > 20);
  assert.deepEqual(words, []);
});

test('each mono phrase fits inside the first beat and has its own pitch or onset pattern', () => {
  for (const bpm of [60, 75, 90]) {
    const beat = 60 / bpm;
    const parts = {};
    for (const dir of DIRECTIONS) {
      const { sound, tones } = record('music');
      sound.direction(dir, 0, beat);
      assert.ok(tones.every((n) => n.at >= 0 && n.at + n.length < beat));
      parts[dir] = tones.filter((n, i) => !i || tones[i - 1].at !== n.at);
    }
    const pitches = (dir) => parts[dir].map((n) => n.hz);
    assert.deepEqual(pitches('up'), [523.25, 659.25, 783.99]);
    assert.deepEqual(pitches('down'), [392, 329.63, 261.63]);
    assert.equal(parts.left.length, 2);
    assert.ok(parts.left[1].at - parts.left[0].length > 0.15);
    assert.equal(parts.right.length, 1);
    assert.ok(parts.right[0].hold >= beat * 0.6);
  }
});

test('preview and scheduled cues match and both modes put the kick on the scoring beat', () => {
  const round = new Round(DIRECTIONS, 90);
  round.schedule(2);
  for (const mode of ['music', 'voice']) {
    const { sound, tones, words } = record(mode);
    sound.schedule(round);
    assert.deepEqual(words, mode === 'voice' ? DIRECTIONS : []);
    for (const n of round.timeline) {
      const preview = record(mode);
      preview.sound.direction(n.dir, n.cue, round.beat);
      assert.deepEqual(
        tones.filter((t) => t.at >= n.cue && t.at < n.cue + round.beat),
        preview.tones,
      );
      assert.ok(tones.some((t) => t.hz === 174 && t.at === n.at));
    }
  }
});
