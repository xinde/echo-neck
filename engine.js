export const DIRECTIONS = ['up', 'down', 'left', 'right'];
export const LABEL = { up: '向上', down: '向下', left: '向左', right: '向右' };
export const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
export const PERFECT = 0.135;
export const WINDOW = 0.32;
export const CONFIRM = 0.045;
export const FRAME_GRACE = 0.2;

export function chart(random = Math.random) {
  const notes = [];
  for (let group = 0; group < 3; group++) {
    const block = [...DIRECTIONS];
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    if (block[0] === notes.at(-1)) [block[0], block[1]] = [block[1], block[0]];
    notes.push(...block);
  }
  return notes;
}

export class Round {
  constructor(directions, bpm) {
    this.directions = directions;
    this.beat = 60 / bpm;
    this.results = [];
  }
  schedule(start) {
    const offset = this.results.length;
    this.timeline = this.directions.slice(offset).map((dir, i) => {
      const cue = start + 4 * i * this.beat;
      return { index: i + offset, dir, cue, at: cue + 2 * this.beat };
    });
    this.offset = offset;
  }
  get note() {
    return this.timeline?.[this.results.length - this.offset];
  }
  finish(grade, delta = null) {
    const result = { grade, delta, index: this.results.length };
    this.results.push(result);
    return result;
  }
  strike(dir, time) {
    const n = this.note;
    if (!n || time < n.cue) return null;
    const delta = time - n.at;
    if (delta < -WINDOW - 1e-8) return this.finish('early', delta);
    if (delta > WINDOW + 1e-8) return this.finish('late', delta);
    if (dir !== n.dir) return this.finish('wrong', delta);
    return this.finish(Math.abs(delta) <= PERFECT + 1e-8 ? 'perfect' : 'good', delta);
  }
  expire(now) {
    if (this.note && now > this.note.at + WINDOW + FRAME_GRACE) return this.finish('miss');
    return null;
  }
  get score() {
    return this.results.reduce(
      (sum, { grade }) => sum + (grade === 'perfect' ? 100 : grade === 'good' ? 70 : 0),
      0,
    );
  }
  get hits() {
    return this.results.filter((r) => r.grade === 'perfect' || r.grade === 'good').length;
  }
}

const RANGE = 0.105;
const CENTER = 0.053;
const CENTER_TIME = 0.105;

// All distances are fractions of the calibrated face width. Times are audio seconds.
export class Motion {
  constructor() {
    this.reset();
  }
  reset() {
    this.armed = false;
    this.centerSince = null;
    this.candidate = null;
    this.last = null;
  }
  sample(x, y, now) {
    if (this.last !== null && (now - this.last > FRAME_GRACE || now <= this.last)) this.reset();
    this.last = now;
    const ax = Math.abs(x),
      ay = Math.abs(y);
    if (Math.max(ax, ay) <= CENTER) {
      this.centerSince ??= now;
      if (now - this.centerSince >= CENTER_TIME) this.armed = true;
      this.candidate = null;
      return null;
    }
    this.centerSince = null;
    if (!this.armed) return null;
    if (Math.max(ax, ay) < RANGE) {
      this.candidate = null;
      return null;
    }
    if (Math.max(ax, ay) < Math.min(ax, ay) * 1.32) {
      // An ambiguous excursion cannot turn into a cardinal hit while held.
      this.armed = false;
      this.candidate = null;
      return null;
    }
    const dir = ax > ay ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
    if (!this.candidate || this.candidate.dir !== dir) this.candidate = { dir, time: now };
    if (now - this.candidate.time < CONFIRM) return null;
    const event = this.candidate;
    this.armed = false;
    this.candidate = null;
    return event;
  }
}

export function readFace(result, w, h) {
  const p = result.faceLandmarks?.[0];
  if (!p || !w || !h) return null;
  const dist = (a, b) => Math.hypot((p[a].x - p[b].x) * w, (p[a].y - p[b].y) * h);
  const width = dist(234, 454);
  if (width < w * 0.12) return null;
  const blend = result.faceBlendshapes?.[0]?.categories || [];
  const shut = (name, a, b, c, d, e, f) => {
    const blink = blend.find((v) => v.categoryName === name)?.score || 0;
    const opening = (dist(a, b) + dist(c, d)) / Math.max(1, 2 * dist(e, f));
    return blink >= 0.54 || opening < 0.145;
  };
  return {
    // Use physical pixels on both axes, and mirror X to match the player's body.
    x: (0.64 * (1 - p[1].x) + 0.18 * (2 - p[234].x - p[454].x)) * w,
    y: (0.64 * p[1].y + 0.18 * (p[234].y + p[454].y)) * h,
    width,
    closed:
      shut('eyeBlinkLeft', 386, 374, 385, 380, 362, 263) &&
      shut('eyeBlinkRight', 159, 145, 158, 153, 33, 133),
  };
}

export class Calibration {
  constructor() {
    this.samples = [];
  }
  sample(face, t) {
    const s = this.samples,
      first = s[0];
    if (
      !face ||
      (first &&
        (t - s.at(-1).t > 0.25 ||
          Math.hypot(face.x - first.x, face.y - first.y) > 0.055 * first.width ||
          Math.abs(face.width / first.width - 1) > 0.09))
    )
      s.length = 0;
    if (!face) return null;
    s.push({ ...face, t });
    if (s.length < 7 || t - s[0].t < 0.9) return null;
    const mean = (key) => s.reduce((sum, f) => sum + f[key], 0) / s.length;
    return { x: mean('x'), y: mean('y'), width: mean('width') };
  }
}
