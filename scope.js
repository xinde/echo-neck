const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const glyphs = { up: '↑', down: '↓', left: '←', right: '→' };
const TAU = Math.PI * 2;
export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.base = document.createElement('canvas');
  }
  background(w, h, dpr) {
    const c = this.base.getContext('2d');
    this.base.width = w * dpr;
    this.base.height = h * dpr;
    c.scale(dpr, dpr);
    c.fillStyle = '#1c1926';
    c.fillRect(0, 0, w, h);
    const cx = w / 2,
      cy = h * 0.46,
      r = Math.min(h * 0.33, w * 0.25);
    const radial = c.createRadialGradient(cx, cy, 4, cx, cy, w * 0.6);
    radial.addColorStop(0, '#30283d');
    radial.addColorStop(0.58, '#211c2c');
    radial.addColorStop(1, '#1c1926');
    c.fillStyle = radial;
    c.fillRect(0, 0, w, h);
    for (let j = 10; j < h; j += 17)
      for (let i = 10; i < w; i += 17) {
        c.fillStyle = 'rgba(196,174,214,' + (0.09 + (0.07 * (1 + Math.sin(i * j * 1.3))) / 2) + ')';
        c.fillRect(i, j, 1, 1);
      }
    const line = (x, y, X, Y) => {
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(X, Y);
      c.stroke();
    };
    c.lineWidth = 0.7;
    c.strokeStyle = '#514352';
    c.setLineDash([2, 5]);
    line(14, cy, w - 14, cy);
    line(cx, 8, cx, h - 9);
    c.setLineDash([]);
    // A wire terrain rises on both sides of the listening field.
    const cols = 64,
      rows = 17,
      terrain = [];
    for (let z = 0; z <= rows; z++) {
      const depth = z / rows,
        row = [];
      for (let col = 0; col <= cols; col++) {
        const u = col / cols,
          edge = Math.pow(Math.abs(2 * u - 1), 0.75);
        const ridge =
          0.38 +
          0.28 * Math.sin(u * 17 + depth * 4.3) +
          0.13 * Math.cos(u * 35 - depth * 3) +
          0.17 * Math.sin(depth * 6 - u * 8);
        const peak = h * 0.35 * edge * ridge * Math.sin(Math.PI * (0.08 + depth * 0.84));
        row.push([u * w, h * (0.66 + 0.42 * depth ** 1.4) - peak + 0.8 * Math.sin(col * 2.9 + z)]);
      }
      terrain.push(row);
    }
    for (let z = 0; z < rows; z++) {
      const a = terrain[z],
        b = terrain[z + 1],
        depth = z / rows;
      c.beginPath();
      c.moveTo(...a[0]);
      a.slice(1).forEach((p) => c.lineTo(...p));
      for (let i = cols; i >= 0; i--) c.lineTo(...b[i]);
      c.closePath();
      c.fillStyle = '#231e2d';
      c.fill();
      const tint = c.createLinearGradient(0, 0, w, 0);
      tint.addColorStop(0, 'rgba(245,152,116,' + (0.3 + depth * 0.35) + ')');
      tint.addColorStop(0.48, 'rgba(156,133,187,' + (0.13 + depth * 0.22) + ')');
      tint.addColorStop(1, 'rgba(198,164,244,' + (0.33 + depth * 0.35) + ')');
      c.strokeStyle = tint;
      c.lineWidth = 0.75;
      c.beginPath();
      a.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      for (let i = 0; i <= cols; i += 2) {
        c.moveTo(...a[i]);
        c.lineTo(...b[i]);
      }
      c.stroke();
    }
    c.strokeStyle = '#7c6b87';
    c.lineWidth = 0.8;
    for (const [x, s] of [
      [12, 1],
      [w - 12, -1],
    ])
      for (const [y, t] of [
        [12, 1],
        [h - 12, -1],
      ]) {
        c.beginPath();
        c.moveTo(x + s * 9, y);
        c.lineTo(x, y);
        c.lineTo(x, y + t * 9);
        c.stroke();
      }
    for (const [mult, dash] of [
      [1.19, [1, 5]],
      [1, []],
      [0.72, [2, 5]],
      [0.48, []],
    ]) {
      c.beginPath();
      c.arc(cx, cy, r * mult, 0, TAU);
      c.setLineDash(dash);
      c.strokeStyle = mult === 1 ? '#897694' : '#5d506b';
      c.stroke();
    }
    c.setLineDash([]);
    for (let i = 0; i < 72; i++) {
      const a = (i * TAU) / 72,
        s = i % 6 === 0 ? 5 : 2;
      c.strokeStyle = i % 6 === 0 ? '#ad97bc' : '#706078';
      line(
        cx + Math.cos(a) * (r - s),
        cy + Math.sin(a) * (r - s),
        cx + Math.cos(a) * r,
        cy + Math.sin(a) * r,
      );
    }
    if (w > 470) {
      c.font = '9px ui-monospace, monospace';
      c.fillStyle = '#a596a9';
      c.fillText('FIELD / XY', 23, 24);
      c.textAlign = 'right';
      c.fillText('STEREO', w - 23, 24);
      c.textAlign = 'left';
    }
  }
  draw({ dir, phase = 0, point, mode }, time) {
    const canvas = this.canvas,
      c = this.ctx,
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      this.background(w, h, dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(this.base, 0, 0, w, h);
    const cx = w / 2,
      cy = h * 0.46,
      r = Math.min(h * 0.33, w * 0.25);
    const t = this.reduce.matches ? 0 : time;
    const ring = (x, y, rad, stroke, width = 1) => {
      c.beginPath();
      c.arc(x, y, rad, 0, TAU);
      c.lineWidth = width;
      c.strokeStyle = stroke;
      c.stroke();
    };
    for (const [name, [dx, dy]] of Object.entries(vectors)) {
      const x = cx + dx * r,
        y = cy + dy * r,
        active = name === dir;
      const coral = name === 'down' || name === 'right';
      const accent = coral ? '#ffb095' : '#cbb1ff';
      if (active) {
        c.fillStyle = coral ? '#ffac8840' : '#b69be840';
        c.beginPath();
        c.arc(x, y, 17, 0, TAU);
        c.fill();
        ring(x, y, 17 + Math.min(1, Math.abs(phase)) * 13, accent, 1.5);
      }
      c.fillStyle = active ? accent : '#292331';
      c.beginPath();
      c.arc(x, y, active ? 12 : 10, 0, TAU);
      c.fill();
      ring(x, y, active ? 12 : 10, accent, 0.9);
      c.fillStyle = active ? '#24202d' : accent;
      c.font = 'bold 13px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(glyphs[name], x, y);
    }
    const inner = r * 0.31,
      idle = mode === 'home';
    // Modulate a closed waveform around the reticle like a circular oscilloscope.
    c.beginPath();
    for (let i = 0; i <= 320; i++) {
      const a = (i * TAU) / 320;
      const amp = Math.sin(a * 2 + 0.7) ** 4;
      const radius = inner + (1 + Math.sin(a * 26 + t * 1.2)) * (1.6 + amp * 3.6);
      const x = cx + Math.cos(a) * radius,
        y = cy + Math.sin(a) * radius;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
    c.strokeStyle = '#c4a8ee';
    c.lineWidth = 1.15;
    c.stroke();
    ring(cx, cy, inner * 0.85, '#675774');
    const px = cx + Math.max(-1, Math.min(1, point?.x || 0)) * r,
      py = cy + Math.max(-1, Math.min(1, point?.y || 0)) * r;
    const rr = idle ? 4.7 + Math.sin(t * 1.7) * 0.8 : 5;
    c.fillStyle = '#ffd1ae';
    c.beginPath();
    c.arc(px, py, rr, 0, TAU);
    c.fill();
    ring(px, py, rr + 4, '#d9a48d', 0.8);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  }
}
