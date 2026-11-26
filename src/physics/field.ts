import { C0 } from './microstrip';
import type { Stackup } from './microstrip';

export interface FieldSolution {
  xs: number[]; ys: number[];          
  phi: Float64Array;                   
  phiAir: Float64Array;                
  z0: number; eeff: number; w: number; h: number; t: number;
  groundX: number[]; groundJ: number[];
}

function mesh(lo: number, hi: number, must: number[], fine: number, grow: number): number[] {
  const pts = [...new Set([lo, ...must, hi])].sort((p, q) => p - q);
  const dist = (x: number) => Math.min(...must.map((m) => Math.abs(m - x)));
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const raw = [a]; let x = a;
    while (x < b - 1e-15) { x += fine + (grow - 1) * dist(x); raw.push(x); }
    const scale = (b - a) / (x - a);
    for (let j = 1; j < raw.length; j++) out.push(a + (raw[j] - a) * scale);
    out[out.length - 1] = b;
  }
  return out;
}

export function solveField(w: number, s: Stackup, quality = 1): FieldSolution {
  const { h, t } = s;
  const half = w / 2, W = Math.max(10 * w, 20 * h), H = 20 * h;
  const fine = Math.min(w / 16, h / 12, t / 2) / quality;
  const xr = mesh(0, W, [0, half], fine, 1.14);           // right half only (symmetry)
  const ys = mesh(0, H, [0, h, h + t], fine, 1.14);
  const nx = xr.length, ny = ys.length;
  const fixed = new Float64Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (j === 0 || j === ny - 1 || i === nx - 1) fixed[j * nx + i] = 0;
    else if (xr[i] <= half + 1e-12 && ys[j] >= h - 1e-12 && ys[j] <= h + t + 1e-12) fixed[j * nx + i] = 1;
  }
  const solve = (er: number) => {
    const aE = new Float64Array(nx * ny), aN = new Float64Array(nx * ny);
    const eps = (j: number) => ((ys[j] + ys[j + 1]) / 2 < h ? er : 1); // cell row j
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i < nx - 1) {
        let c = 0;
        if (j > 0) c += (eps(j - 1) * (ys[j] - ys[j - 1])) / 2;
        if (j < ny - 1) c += (eps(j) * (ys[j + 1] - ys[j])) / 2;
        aE[k] = c / (xr[i + 1] - xr[i]);
      }
      if (j < ny - 1) {
        let width = 0;
        if (i > 0) width += (xr[i] - xr[i - 1]) / 2;
        if (i < nx - 1) width += (xr[i + 1] - xr[i]) / 2;
        aN[k] = (eps(j) * width) / (ys[j + 1] - ys[j]);
      }
    }
    const p = new Float64Array(nx * ny);
    for (let k = 0; k < p.length; k++) if (!Number.isNaN(fixed[k])) p[k] = fixed[k];
    const omega = 2 / (1 + Math.PI / Math.max(nx, ny));
    for (let it = 0; it < 20000; it++) {
      let worst = 0;
      for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!Number.isNaN(fixed[k])) continue;
        const e = aE[k], we = i > 0 ? aE[k - 1] : 0, n = aN[k], so = aN[k - nx];
        const next = (e * p[k + 1] + (i > 0 ? we * p[k - 1] : 0) + n * p[k + nx] + so * p[k - nx]) / (e + we + n + so);
        const d = next - p[k];
        p[k] += omega * d;
        if (Math.abs(d) > worst) worst = Math.abs(d);
      }
      if (worst < 1e-7) break;
    }
    let energy = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i < nx - 1) energy += aE[k] * (p[k + 1] - p[k]) ** 2;
      if (j < ny - 1) energy += aN[k] * (p[k + nx] - p[k]) ** 2;
    }
    return { p, cap: 2 * 8.8541878128e-12 * energy }; // F/m, both halves
  };
  const die = solve(s.er), air = solve(1);
  const xs = [...xr.slice(1).reverse().map((x) => -x), ...xr];
  const mirror = (p: Float64Array) => {
    const m = new Float64Array(xs.length * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < xs.length; i++) m[j * xs.length + i] = p[j * nx + Math.abs(i - (nx - 1))];
    return m;
  };
  const phi = mirror(die.p), phiAir = mirror(air.p);
  const raw = xs.map((_, i) => phiAir[xs.length + i] / ys[1]);
  const peak = Math.max(...raw);
  return {
    xs, ys, phi, phiAir, w, h, t,
    z0: 1 / (C0 * Math.sqrt(die.cap * air.cap)), eeff: die.cap / air.cap,
    groundX: xs, groundJ: raw.map((v) => v / peak),
  };
}
