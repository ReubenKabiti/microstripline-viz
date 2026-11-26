export const C0 = 299_792_458;
export const ETA0 = 376.730313;
export const MU0 = 4e-7 * Math.PI;
export const SIGMA_CU = 5.8e7;

export interface Stackup { h: number; t: number; er: number; tanD: number; }
export const DEFAULT_STACKUP: Stackup = { h: 0.2104e-3, t: 0.035e-3, er: 4.4, tanD: 0.02 };

export function microstrip(w: number, s: Stackup): { z0: number; eeff: number } {
  const u = w / s.h, T = s.t / s.h, er = s.er;
  let du1 = 0;
  if (T > 0) {
    const coth = 1 / Math.tanh(Math.sqrt(6.517 * u));
    du1 = (T / Math.PI) * Math.log(1 + (4 * Math.E) / (T * coth * coth));
  }
  const dur = (du1 * (1 + 1 / Math.cosh(Math.sqrt(er - 1)))) / 2;
  const z01 = (x: number) => {
    const f = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / x, 0.7528));
    return (ETA0 / (2 * Math.PI)) * Math.log(f / x + Math.sqrt(1 + (2 / x) ** 2));
  };
  const ee = (x: number) => {
    const a = 1 + Math.log((x ** 4 + (x / 52) ** 2) / (x ** 4 + 0.432)) / 49 + Math.log(1 + (x / 18.1) ** 3) / 18.7;
    const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053);
    return (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 10 / x, -a * b);
  };
  const u1 = u + du1, ur = u + dur;
  return { z0: z01(ur) / Math.sqrt(ee(ur)), eeff: ee(ur) * (z01(u1) / z01(ur)) ** 2 };
}

export function widthForZ0(z: number, s: Stackup): number {
  let lo = s.h * 0.02, hi = s.h * 30;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (microstrip(m, s).z0 > z) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

export interface LineParams { z0: number; eeff: number; v: number; L: number; C: number; R: number; G: number; }

export function lineParams(w: number, s: Stackup, f: number, lossy: boolean): LineParams {
  const { z0, eeff } = microstrip(w, s);
  const v = C0 / Math.sqrt(eeff);
  let R = 0, G = 0;
  if (lossy) {
    const Rs = Math.sqrt((Math.PI * f * MU0) / SIGMA_CU);
    R = Math.max((2 * Rs) / w, 1 / (SIGMA_CU * w * s.t));
    const k0 = (2 * Math.PI * f) / C0;
    const ad = (k0 * s.er * (eeff - 1) * s.tanD) / (2 * Math.sqrt(eeff) * (s.er - 1));
    G = (2 * ad) / z0;
  }
  return { z0, eeff, v, L: z0 / v, C: 1 / (z0 * v), R, G };
}
