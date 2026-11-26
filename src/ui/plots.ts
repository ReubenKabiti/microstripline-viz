import { HISTORY, COLS, type TraceSim } from '../model';
import { mapRGB } from './color';
import type { FieldSolution } from '../physics/field';

const INK = '#dfe7f2', QUIET = '#8393aa', GRID = '#243042';
export const SERIES = ['#ffb347', '#6ee7ff', '#ff7ab6'];

export function prep(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const r = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
  const g = c.getContext('2d')!; g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  g.font = '11px system-ui, Segoe UI, sans-serif'; g.lineWidth = 1;
  return { g, w, h };
}
interface Box { x: number; y: number; w: number; h: number; }
function axes(g: CanvasRenderingContext2D, b: Box, yMax: number, unit: string, xLabels: string[]) {
  g.strokeStyle = GRID; g.fillStyle = QUIET; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const f of [-1, -0.5, 0, 0.5, 1]) {
    const y = b.y + b.h / 2 - (f * b.h) / 2;
    g.beginPath(); g.moveTo(b.x, y); g.lineTo(b.x + b.w, y); g.stroke();
    if (f === -1 || f === 0 || f === 1) g.fillText((f * yMax).toFixed(yMax < 10 ? 2 : 0), b.x - 4, y);
  }
  g.textAlign = 'left'; g.fillText(unit, b.x + 4, b.y + 8);
  g.textBaseline = 'top';
  xLabels.forEach((t, k) => { g.textAlign = k === 0 ? 'left' : k === xLabels.length - 1 ? 'right' : 'center'; g.fillText(t, b.x + (b.w * k) / (xLabels.length - 1), b.y + b.h + 3); });
}
function line(g: CanvasRenderingContext2D, b: Box, n: number, y: (k: number) => number, yMax: number, color: string, width = 1.8) {
  g.strokeStyle = color; g.lineWidth = width; g.beginPath();
  for (let k = 0; k < n; k++) {
    const px = b.x + (b.w * k) / (n - 1), py = b.y + b.h / 2 - (Math.max(-1, Math.min(1, y(k) / yMax)) * b.h) / 2;
    if (k) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.stroke(); g.lineWidth = 1;
}
const niceMax = (v: number) => { const p = 10 ** Math.floor(Math.log10(v)); return [1, 1.5, 2, 3, 5, 7.5, 10].map((m) => m * p).find((m) => m >= v)!; };

export function drawAlongLine(c: HTMLCanvasElement, s: TraceSim, amp: number) {
  const { g, w, h } = prep(c), net = s.net;
  let top = amp;
  if (s.envReady) for (let k = 0; k < COLS; k++) top = Math.max(top, s.envMax[k], -s.envMin[k]);
  const vMax = niceMax(top * 1.05), iMax = niceMax((top / 40) * 1000);
  const ph = (h - 40) / 2, bv = { x: 38, y: 4, w: w - 48, h: ph }, bi = { x: 38, y: ph + 22, w: w - 48, h: ph };
  const len = net.length * 1000;
  axes(g, bv, vMax, 'voltage (V)', ['', '', '']);
  axes(g, bi, iMax, 'current (mA), + toward load', ['source 0 mm', `${(len / 2).toFixed(0)} mm`, `load ${len.toFixed(0)} mm`]);
  if (s.envReady) {
    g.fillStyle = 'rgba(255,179,71,0.13)'; g.beginPath();
    const px = (k: number) => bv.x + (bv.w * k) / (COLS - 1), py = (v: number) => bv.y + bv.h / 2 - ((v / vMax) * bv.h) / 2;
    for (let k = 0; k < COLS; k++) g.lineTo(px(k), py(s.envMax[k]));
    for (let k = COLS - 1; k >= 0; k--) g.lineTo(px(k), py(s.envMin[k]));
    g.fill();
  }
  // Section boundaries, stub junction and probe.
  let x = 0;
  for (const b of [bv, bi]) {
    x = 0; g.setLineDash([4, 4]); g.strokeStyle = '#61738f';
    s.trace.spec.sections.slice(0, -1).forEach((sec) => { x += sec.len / net.length; g.beginPath(); g.moveTo(b.x + x * b.w, b.y); g.lineTo(b.x + x * b.w, b.y + b.h); g.stroke(); });
    g.setLineDash([]); g.strokeStyle = SERIES[1]; g.beginPath(); g.moveTo(b.x + s.probe * b.w, b.y); g.lineTo(b.x + s.probe * b.w, b.y + b.h); g.stroke();
  }
  line(g, bv, COLS, (k) => net.vAt(k / (COLS - 1)), vMax, SERIES[0]);
  line(g, bi, COLS, (k) => net.iAt(k / (COLS - 1)) * 1000, iMax, '#ffe45c');
}

export function drawScope(c: HTMLCanvasElement, s: TraceSim, amp: number) {
  const { g, w, h } = prep(c), b = { x: 38, y: 18, w: w - 48, h: h - 36 };
  const n = Math.min(s.count, HISTORY), start = s.count - n;
  let top = amp;
  for (const a of s.scope) for (let k = 0; k < n; k++) top = Math.max(top, Math.abs(a[k]));
  const vMax = niceMax(top * 1.05), span = s.sampleDt * (HISTORY - 1), t0 = start * s.sampleDt;
  const ns = (t: number) => `${(t * 1e9).toFixed(span < 1e-8 ? 2 : 0)} ns`;
  axes(g, b, vMax, 'V', [ns(t0), ns(t0 + span / 2), ns(t0 + span)]);
  s.scope.forEach((a, j) => {
    if (n < 2) return;
    line(g, { ...b, w: (b.w * (n - 1)) / (HISTORY - 1) }, n, (k) => a[(start + k) % HISTORY], vMax, SERIES[j]);
  });
  g.textBaseline = 'top'; g.textAlign = 'left';
  let lx = 40;
  ['source', 'probe', 'load'].forEach((t, j) => { g.fillStyle = SERIES[j]; g.fillText(`■ ${t}`, lx, 3); lx += g.measureText(`■ ${t}`).width + 14; });
}

const buffer = document.createElement('canvas'); buffer.width = COLS; buffer.height = HISTORY;
export function drawSpaceTime(c: HTMLCanvasElement, s: TraceSim, amp: number) {
  const { g, w, h } = prep(c), b = { x: 38, y: 4, w: w - 48, h: h - 22 };
  const bg = buffer.getContext('2d')!, img = bg.createImageData(COLS, HISTORY);
  const n = Math.min(s.count, HISTORY), start = s.count - n;
  for (let row = 0; row < HISTORY; row++) {
    const src = ((start + row) % HISTORY) * COLS;
    for (let col = 0; col < COLS; col++) {
      const [r, gg, bb] = mapRGB(row < n ? s.spaceTime[src + col] / amp : 0), o = (row * COLS + col) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255;
    }
  }
  bg.putImageData(img, 0, 0); g.drawImage(buffer, b.x, b.y, b.w, b.h);
  g.fillStyle = QUIET; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillText('source', b.x, b.y + b.h + 3);
  g.textAlign = 'right'; g.fillText('load', b.x + b.w, b.y + b.h + 3); g.fillText(`${(start * s.sampleDt * 1e9).toFixed(1)}`, b.x - 4, b.y);
  g.fillText(`${((start + HISTORY) * s.sampleDt * 1e9).toFixed(1)}`, b.x - 4, b.y + b.h - 12); g.fillText('t (ns)', b.x - 4, b.y + b.h / 2 - 6); g.fillText('↓', b.x - 14, b.y + b.h / 2 + 8);
}

/** Pre-computed field-line and contour geometry, in metres. */
export interface FieldArt { f: FieldSolution; eLines: [number, number][][]; hLines: [number, number][][]; }
export function fieldArt(f: FieldSolution): FieldArt {
  const { xs, ys, w, h, t } = f, nx = xs.length;
  const find = (a: number[], v: number) => { let lo = 0, hi = a.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m; else hi = m; } return lo; };
  const grad = (x: number, y: number): [number, number] => {
    const i = find(xs, x), j = find(ys, y), dx = xs[i + 1] - xs[i], dy = ys[j + 1] - ys[j];
    const u = (x - xs[i]) / dx, v = (y - ys[j]) / dy, p = (a: number, b: number) => f.phi[b * nx + a];
    return [((p(i + 1, j) - p(i, j)) * (1 - v) + (p(i + 1, j + 1) - p(i, j + 1)) * v) / dx,
      ((p(i, j + 1) - p(i, j)) * (1 - u) + (p(i + 1, j + 1) - p(i + 1, j)) * u) / dy];
  };
  const seeds: [number, number][] = [], d = h * 0.02;
  for (let k = 0; k < 9; k++) { const x = -w / 2 + (w * (k + 0.5)) / 9; seeds.push([x, h - d], [x, h + t + d]); }
  for (const side of [-1, 1]) for (const y of [h + t * 0.2, h + t * 0.8]) seeds.push([side * (w / 2 + d), y]);
  const eLines = seeds.map(([x, y]) => {
    const pts: [number, number][] = [[x, y]];
    for (let k = 0; k < 900; k++) {
      const [gx, gy] = grad(x, y), m = Math.hypot(gx, gy); if (!m) break;
      const ds = h * 0.025; x -= (gx / m) * ds; y -= (gy / m) * ds;
      if (y <= 0 || Math.abs(x) >= xs[nx - 1] || y >= ys[ys.length - 1]) { pts.push([x, Math.max(y, 0)]); break; }
      pts.push([x, y]);
    }
    return pts;
  });
  const hLines: [number, number][][] = [];
  for (const level of [0.12, 0.25, 0.4, 0.55, 0.72, 0.88]) {
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], cut: [number, number][] = [];
      for (let e = 0; e < 4; e++) {
        const [a, b] = corners[e], [c, dd] = corners[(e + 1) % 4], p = f.phiAir[b * nx + a], q = f.phiAir[dd * nx + c];
        if ((p < level) !== (q < level)) { const u = (level - p) / (q - p); cut.push([xs[a] + (xs[c] - xs[a]) * u, ys[b] + (ys[dd] - ys[b]) * u]); }
      }
      if (cut.length >= 2) hLines.push([cut[0], cut[1]]);
    }
  }
  return { f, eLines, hLines };
}

function arrowHead(g: CanvasRenderingContext2D, x: number, y: number, ang: number, color: string) {
  g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = color; g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, 3.5); g.lineTo(-4, -3.5); g.fill(); g.restore();
}

export function drawCross(c: HTMLCanvasElement, art: FieldArt, v: number, i: number, amp: number) {
  const { g, w, h: H } = prep(c), f = art.f;
  const halfView = Math.max(f.w * 1.6, f.h * 3.2), scale = Math.min(w / (2 * halfView), (H - 62) / (f.h * 3.4));
  const X = (x: number) => w / 2 + x * scale, ground = H - 44, Y = (y: number) => ground - y * scale;
  const ev = Math.min(1, Math.abs(v) / amp * 1.4), hi = Math.min(1, (Math.abs(i) * 100) / amp);
  g.fillStyle = '#12402f'; g.fillRect(0, Y(f.h), w, Y(0) - Y(f.h));
  // Magnetic field: contours of the air-filled potential. Clockwise/anticlockwise follows the current sign.
  g.strokeStyle = `rgba(190,140,255,${0.12 + 0.8 * hi})`; g.lineWidth = 1.3; g.beginPath();
  for (const [a, b] of art.hLines) { g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); }
  g.stroke();
  if (hi > 0.05) for (const [x, y, ang] of hArrows(art)) arrowHead(g, X(x), Y(y), i > 0 ? ang : ang + Math.PI, `rgba(190,140,255,${0.2 + 0.8 * hi})`);
  // Electric field: from the positive conductor to the negative one.
  const eColor = v >= 0 ? `rgba(255,110,90,${0.08 + 0.92 * ev})` : `rgba(80,150,255,${0.08 + 0.92 * ev})`;
  g.strokeStyle = eColor; g.lineWidth = 1.4;
  for (const l of art.eLines) {
    g.beginPath(); l.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke();
    if (ev > 0.05 && l.length > 6) {
      const k = Math.floor(l.length * 0.45), a = l[k], b = l[k + 2];
      arrowHead(g, X(a[0]), Y(a[1]), Math.atan2(Y(b[1]) - Y(a[1]), X(b[0]) - X(a[0])) + (v >= 0 ? 0 : Math.PI), eColor);
    }
  }
  g.fillStyle = '#d9924d'; g.fillRect(X(-f.w / 2), Y(f.h + f.t), f.w * scale, Math.max(3, f.t * scale));
  g.fillRect(0, ground, w, 3);
  // Signal current direction through the page, and return-current density on the plane.
  const sx = X(0), sy = Y(f.h + f.t) - 13, r = 3 + 7 * hi;
  if (hi > 0.03) {
    g.strokeStyle = '#ffe45c'; g.fillStyle = '#ffe45c'; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.stroke();
    g.beginPath();
    if (i > 0) { const q = r * 0.65; g.moveTo(sx - q, sy - q); g.lineTo(sx + q, sy + q); g.moveTo(sx + q, sy - q); g.lineTo(sx - q, sy + q); g.stroke(); }
    else { g.arc(sx, sy, r * 0.3, 0, 7); g.fill(); }
  }
  g.fillStyle = `rgba(92,242,214,${0.15 + 0.75 * hi})`; g.beginPath(); g.moveTo(X(f.groundX[0]), ground + 4);
  f.groundX.forEach((x, k) => g.lineTo(X(x), ground + 4 + f.groundJ[k] * hi * 26)); g.lineTo(X(f.groundX[f.groundX.length - 1]), ground + 4); g.fill();
  g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = INK;
  g.fillText(`v = ${v.toFixed(3)} V    i = ${(i * 1000).toFixed(2)} mA`, 8, 5);
  const p = v * i;
  g.fillStyle = QUIET; g.fillText(Math.abs(p) < 1e-6 ? 'power ≈ 0 at this instant' : p > 0 ? 'power → load' : 'power → source', 8, 19);
  g.textAlign = 'right'; g.fillStyle = v >= 0 ? '#ff6e5a' : '#5096ff'; g.fillText('━ E field', w - 8, H - 26); g.fillStyle = '#be8cff'; g.fillText('━ H field', w - 8, H - 13); g.textAlign = 'left';
  g.fillStyle = '#5cf2d6'; g.fillText('return-current density on L2', 8, H - 13);
}
const cache = new WeakMap<FieldArt, [number, number, number][]>();
/** Arrow positions on H contours: on the vertical axis above and below the strip, and to each side. */
function hArrows(art: FieldArt): [number, number, number][] {
  let out = cache.get(art); if (out) return out;
  out = [];
  const { w, h } = art.f;
  for (const [a, b] of art.hLines) {
    const crossesAxis = (a[0] <= 0 && b[0] > 0) || (b[0] <= 0 && a[0] > 0);
    // Seen from the source with current into the page, H circulates clockwise.
    if (crossesAxis) { const y = (a[1] + b[1]) / 2; if (y < h * 2.6) out.push([0, y, y > h ? 0 : Math.PI]); }
    const crossesLevel = (a[1] <= h && b[1] > h) || (b[1] <= h && a[1] > h);
    if (crossesLevel) { const x = (a[0] + b[0]) / 2; if (Math.abs(x) > w / 2 && Math.abs(x) < w * 1.5 + h * 2) out.push([x, h, x > 0 ? Math.PI / 2 : -Math.PI / 2]); }
  }
  cache.set(art, out); return out;
}
