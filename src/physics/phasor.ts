import { lineParams, type Stackup } from './microstrip';
import { loadRC, type TraceSpec } from './network';

export interface Cx { re: number; im: number; }
export const cx = (re: number, im = 0): Cx => ({ re, im });
export const add = (a: Cx, b: Cx) => cx(a.re + b.re, a.im + b.im);
export const sub = (a: Cx, b: Cx) => cx(a.re - b.re, a.im - b.im);
export const mul = (a: Cx, b: Cx) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const div = (a: Cx, b: Cx) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
export const mag = (a: Cx) => Math.hypot(a.re, a.im);
export const csqrt = (a: Cx) => { const m = mag(a); return cx(Math.sqrt((m + a.re) / 2), Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (m - a.re) / 2))); };
const cexp = (a: Cx) => cx(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));

export interface Steady {
  zin: Cx;           
  vIn: number;       
  vLoad: number;     
  gammaLoad: number; 
  vswrLoad: number;  
}

export function steadyState(spec: TraceSpec, stack: Stackup, f: number, amp: number, rs: number, lossy = true): Steady {
  const w = 2 * Math.PI * f;
  type M = [Cx, Cx, Cx, Cx];
  const mm = (p: M, q: M): M => [
    add(mul(p[0], q[0]), mul(p[1], q[2])), add(mul(p[0], q[1]), mul(p[1], q[3])),
    add(mul(p[2], q[0]), mul(p[3], q[2])), add(mul(p[2], q[1]), mul(p[3], q[3]))];
  const line = (width: number, len: number) => {
    const p = lineParams(width, stack, f, lossy);
    const z = cx(p.R, w * p.L), y = cx(p.G, w * p.C);
    const g = csqrt(mul(z, y)), zc = csqrt(div(z, y));
    const ep = cexp(mul(g, cx(len))), em = cexp(mul(g, cx(-len)));
    const ch = mul(add(ep, em), cx(0.5)), sh = mul(sub(ep, em), cx(0.5));
    return { m: [ch, mul(zc, sh), div(sh, zc), ch] as M, zc, z0: p.z0 };
  };
  let m: M = [cx(1), cx(0), cx(0), cx(1)];
  let last = line(spec.sections[0].w, 0);
  spec.sections.forEach((s, k) => {
    last = line(s.w, s.len);
    m = mm(m, last.m);
    if (spec.stub && spec.stub.after === k) {
      const st = line(spec.stub.w, spec.stub.len).m;
      m = mm(m, [cx(1), cx(0), div(st[2], st[0]), cx(1)]); 
    }
  });
  const ld = loadRC(spec.load, last.z0);
  const yl = ld.short ? null : cx(ld.r === Infinity ? 0 : 1 / ld.r, w * ld.c);
  const v1 = yl ? add(m[0], mul(m[1], yl)) : m[1];
  const i1 = yl ? add(m[2], mul(m[3], yl)) : m[3];
  const den = add(v1, mul(cx(rs), i1));
  const v2 = yl ? div(cx(amp), den) : cx(0);
  const zin = div(v1, i1);
  const vIn = mag(div(mul(cx(amp), v1), den));
  let gammaLoad = 1;
  if (yl) { const a = mul(yl, cx(last.z0)); gammaLoad = mag(div(sub(cx(1), a), add(cx(1), a))); }
  const vswrLoad = gammaLoad > 0.999999 ? Infinity : (1 + gammaLoad) / (1 - gammaLoad);
  return { zin, vIn, vLoad: mag(v2), gammaLoad, vswrLoad };
}
