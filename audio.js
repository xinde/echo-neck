const clips = ['up', 'down', 'left', 'right', 'ready', 'close', 'paused', 'end'];
const notes = { up: 523.25, down: 261.63, left: 329.63, right: 392 };
export class Sound {
  constructor() {
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
  tone(hz, at, length, volume, { end = hz, type = 'sine', pan = 0 } = {}) {
    const osc = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, at);
    osc.frequency.exponentialRampToValueAtTime(end, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.009);
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
  direction(dir, at) {
    this.say(dir, at);
    const f = notes[dir],
      pan = dir === 'left' ? -0.7 : dir === 'right' ? 0.7 : 0;
    this.tone(f, at + 0.05, 0.28, 0.1, { pan });
    this.tone(f * (dir === 'down' ? 0.75 : dir === 'up' ? 1.5 : 1.25), at + 0.23, 0.31, 0.08, {
      pan,
    });
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
      this.direction(n.dir, n.cue);
      this.tone(620, n.cue + round.beat, 0.085, 0.16, { type: 'triangle' });
      this.tone(174, n.at, 0.25, 0.67, { end: 53 });
      this.tone(920, n.at, 0.065, 0.16);
      this.tone(440, n.cue + 3 * round.beat, 0.085, 0.13, { type: 'triangle' });
    }
  }
}
