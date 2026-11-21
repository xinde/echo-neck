const clips = ['up', 'down', 'left', 'right', 'ready', 'close', 'paused', 'end'];
export const motifLabels = {
  up: '铃音上行',
  down: '琴音下行',
  left: '木块两短',
  right: '陶笛长音',
};
const signals = {
  close: { pitches: [392, 587.33], length: 0.8 },
  paused: { pitches: [220, 246.94], length: 0.45 },
  end: { pitches: [261.63, 329.63, 392, 523.25], length: 1.3 },
};
export class Sound {
  constructor() {
    this.mode = 'music';
    this.sources = new Set();
    this.buffers = new Map();
  }
  async unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
      });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.65;
      this.master.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    if (this.ctx.state !== 'running') throw Error('audio suspended');
    if (this.mode === 'music') return;
    this.loading ??= Promise.all(
      clips.map(async (name) => {
        const res = await fetch(new URL('./assets/voice/' + name + '.wav', import.meta.url));
        if (!res.ok) throw Error('voice');
        this.buffers.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      }),
    ).catch((e) => {
      this.loading = null;
      throw e;
    });
    await this.loading;
    if (this.ctx.state !== 'running') throw Error('audio suspended');
  }
  audioTime(perf = performance.now()) {
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp?.performanceTime > 0 && Math.abs(performance.now() - stamp.performanceTime) < 500) {
      return stamp.contextTime + (perf - stamp.performanceTime) / 1000;
    }
    return this.ctx.currentTime + (perf - performance.now()) / 1000 - (this.ctx.outputLatency || 0);
  }
  track(src, ...nodes) {
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      src.disconnect();
      nodes.forEach((n) => n.disconnect());
    };
  }
  clear() {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {}
    }
    this.sources.clear();
  }
  say(name, at = this.ctx.currentTime + 0.025) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name);
    src.connect(this.master);
    this.track(src);
    src.start(at);
    return at + src.buffer.duration;
  }
  tone(hz, at, length, volume, { end = hz, type = 'sine', pan = 0, hold = 0, attack = 0.009 } = {}) {
    const osc = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, at);
    osc.frequency.exponentialRampToValueAtTime(end, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + attack);
    if (hold) gain.gain.setValueAtTime(volume, at + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    const panner = pan && this.ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = pan;
      gain.connect(panner).connect(this.master);
      this.track(osc, gain, panner);
    } else {
      gain.connect(this.master);
      this.track(osc, gain);
    }
    osc.start(at);
    osc.stop(at + length + 0.005);
  }
  signal(name, at = this.ctx.currentTime + 0.025) {
    if (this.mode === 'voice') return this.buffers.has(name) ? this.say(name, at) : at;
    const { pitches, length } = signals[name];
    for (const hz of pitches)
      this.tone(hz, at, length, 0.24 / pitches.length, { hold: length * 0.22 });
    return at + length;
  }
  countIn(beat) {
    if (this.mode === 'voice') return this.say('ready') + 0.5;
    const at = this.ctx.currentTime + 0.08;
    for (const time of [at, at + beat]) this.tone(740, time, 0.08, 0.14, { type: 'triangle' });
    return at + 2 * beat;
  }
  direction(dir, at, beat) {
    if (this.mode === 'voice') this.say(dir, at);
    const level = this.mode === 'voice' ? 0.42 : 1;
    // Make every phrase identifiable in mono. Panning is only a secondary cue.
    if (dir === 'left') {
      for (const time of [at, at + 0.46 * beat]) {
        this.tone(740, time, 0.1, 0.36 * level, { end: 510, type: 'triangle', pan: -0.45 });
        this.tone(1170, time, 0.055, 0.14 * level, { end: 910, pan: -0.45 });
      }
    } else if (dir === 'right') {
      // An ocarina-like D4, with a soft onset and just a trace of the octave.
      const length = 0.84 * beat;
      const breath = { pan: 0.3, hold: 0.6 * beat, attack: 0.065 };
      this.tone(293.66, at, length, 0.138 * level, breath);
      this.tone(587.32, at, length, 0.006 * level, breath);
    } else {
      const rising = dir === 'up';
      const pitches = rising ? [523.25, 659.25, 783.99] : [392, 329.63, 261.63];
      pitches.forEach((hz, i) => {
        const time = at + i * 0.25 * beat;
        this.tone(hz, time, 0.36 * beat, 0.34 * level, { type: rising ? 'sine' : 'triangle' });
        if (rising) this.tone(hz * 2.4, time, 0.08, 0.07 * level);
      });
    }
  }
  feedback(hit) {
    const t = this.ctx.currentTime + 0.018;
    if (hit) {
      this.tone(660, t, 0.14, 0.15);
      this.tone(880, t + 0.09, 0.24, 0.13);
    } else this.tone(174.6, t, 0.23, 0.18, { end: 110, type: 'triangle' });
  }
  schedule(round) {
    for (const n of round.timeline) {
      this.direction(n.dir, n.cue, round.beat);
      this.tone(620, n.cue + round.beat, 0.085, 0.16, { type: 'triangle' });
      this.tone(174, n.at, 0.25, 0.67, { end: 53 });
      this.tone(920, n.at, 0.065, 0.16);
      this.tone(440, n.cue + 3 * round.beat, 0.085, 0.13, { type: 'triangle' });
    }
  }
}
