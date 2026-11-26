import { lineParams, type Stackup, type LineParams } from './microstrip';
import { sourceVoltage, type Generator } from './waveform';

export type LoadKind = 'matched' | 'open' | 'short' | 'resistor' | 'chip';
export interface Load { kind: LoadKind; r: number; c: number; }
export interface Section { len: number; w: number; }
export interface Stub { after: number; len: number; w: number; }
export interface TraceSpec { sections: Section[]; stub?: Stub; load: Load; }

export function loadRC(load: Load, z0: number): { r: number; c: number; short: boolean } {
  switch (load.kind) {
    case 'matched': return { r: z0, c: 0, short: false };
    case 'open': return { r: Infinity, c: 0, short: false };
    case 'short': return { r: 0, c: 0, short: true };
    case 'resistor': return { r: Math.max(load.r, 0.1), c: 0, short: false };
    case 'chip': return { r: Math.max(load.r, 0.1), c: load.c, short: false };
  }
}

/**
 * Leapfrog FDTD of the telegrapher's equations on a graph of cells.
 * Voltages live on nodes, currents on cells, so width steps and branches
 * satisfy KCL and voltage continuity automatically.
 */
export class Network {
  readonly v: Float64Array;            
  readonly i: Float64Array;            
  readonly main: number[] = [];        
  readonly mainX: number[] = [];       
  readonly mainEdges: number[] = [];   
  readonly stubNodes: number[] = [];   
  readonly params: LineParams[] = [];  
  readonly length: number;
  readonly dt: number;
  t = 0;

  private a: Int32Array; private b: Int32Array;
  private ci1: Float64Array; private ci2: Float64Array;
  private va1: Float64Array; private va2: Float64Array;
  private sum: Float64Array;
  private shortNode = -1;

  constructor(readonly spec: TraceSpec, stack: Stackup, readonly gen: Generator, lossy = true, dxTarget = 0.5e-3) {
    const A: number[] = [], B: number[] = [], L: number[] = [], R: number[] = [];
    const nodeC: number[] = [0], nodeG: number[] = [0];
    const addRun = (from: number, len: number, p: LineParams, nodes: number[], x0: number, isMain: boolean) => {
      const n = Math.max(1, Math.round(len / dxTarget)), dx = len / n;
      let prev = from;
      for (let k = 1; k <= n; k++) {
        const id = nodeC.length; nodeC.push(0); nodeG.push(0);
        if (isMain) this.mainEdges.push(A.length);
        A.push(prev); B.push(id); L.push(p.L * dx); R.push(p.R * dx);
        for (const m of [prev, id]) { nodeC[m] += (p.C * dx) / 2; nodeG[m] += (p.G * dx) / 2; }
        nodes.push(id);
        if (isMain) this.mainX.push(x0 + k * dx);
        prev = id;
      }
      return prev;
    };
    this.main.push(0); this.mainX.push(0);
    let end = 0, x = 0;
    spec.sections.forEach((sec, s) => {
      const p = lineParams(sec.w, stack, gen.freq, lossy);
      this.params.push(p);
      end = addRun(end, sec.len, p, this.main, x, true);
      x += sec.len;
      if (spec.stub && spec.stub.after === s) {
        this.stubNodes.push(end);
        addRun(end, spec.stub.len, lineParams(spec.stub.w, stack, gen.freq, lossy), this.stubNodes, 0, false);
      }
    });
    this.length = x;

    const invL = new Float64Array(nodeC.length);
    for (let e = 0; e < A.length; e++) { invL[A[e]] += 1 / L[e]; invL[B[e]] += 1 / L[e]; }
    let dt = Infinity;
    for (let n = 0; n < nodeC.length; n++) dt = Math.min(dt, Math.sqrt((2 * nodeC[n]) / invL[n]));
    this.dt = dt * 0.999;

    const zLast = this.params[this.params.length - 1].z0;
    const ld = loadRC(spec.load, zLast);
    if (ld.short) this.shortNode = end;
    else { nodeC[end] += ld.c; nodeG[end] += ld.r === Infinity ? 0 : 1 / ld.r; }
    const gs = 1 / Math.max(gen.rs, 0.1);
    nodeG[0] += gs;
    this.gs = gs;

    const N = nodeC.length, E = A.length;
    this.v = new Float64Array(N); this.i = new Float64Array(E); this.sum = new Float64Array(N);
    this.a = Int32Array.from(A); this.b = Int32Array.from(B);
    this.ci1 = new Float64Array(E); this.ci2 = new Float64Array(E);
    for (let e = 0; e < E; e++) {
      const d = L[e] / this.dt + R[e] / 2;
      this.ci1[e] = (L[e] / this.dt - R[e] / 2) / d; this.ci2[e] = 1 / d;
    }
    this.va1 = new Float64Array(N); this.va2 = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const d = nodeC[n] / this.dt + nodeG[n] / 2;
      this.va1[n] = (nodeC[n] / this.dt - nodeG[n] / 2) / d; this.va2[n] = 1 / d;
    }
  }
  private gs = 0;

  step(): void {
    const { v, i, a, b, sum } = this;
    for (let e = 0; e < i.length; e++) i[e] = this.ci1[e] * i[e] + this.ci2[e] * (v[a[e]] - v[b[e]]);
    sum.fill(0);
    for (let e = 0; e < i.length; e++) { sum[a[e]] -= i[e]; sum[b[e]] += i[e]; }
    sum[0] += this.gs * sourceVoltage(this.gen, this.t + this.dt / 2);
    for (let n = 0; n < v.length; n++) v[n] = this.va1[n] * v[n] + this.va2[n] * sum[n];
    if (this.shortNode >= 0) v[this.shortNode] = 0;
    this.t += this.dt;
  }

  vAt(f: number): number { return this.v[this.main[this.nodeIndex(f)]]; }
  iAt(f: number): number {
    const k = this.nodeIndex(f), n = this.mainEdges.length;
    return (this.i[this.mainEdges[Math.max(0, k - 1)]] + this.i[this.mainEdges[Math.min(n - 1, k)]]) / 2;
  }
  nodeIndex(f: number): number {
    const x = Math.min(Math.max(f, 0), 1) * this.length;
    let lo = 0, hi = this.mainX.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.mainX[m] < x) lo = m; else hi = m; }
    return x - this.mainX[lo] < this.mainX[hi] - x ? lo : hi;
  }
  sectionAt(f: number): number {
    let x = f * this.length;
    for (let s = 0; s < this.spec.sections.length; s++) { x -= this.spec.sections[s].len; if (x <= 1e-12) return s; }
    return this.spec.sections.length - 1;
  }
}
