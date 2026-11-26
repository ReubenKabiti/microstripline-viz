import { DEFAULT_STACKUP, widthForZ0, type Stackup } from './physics/microstrip';
import { Network, type TraceSpec } from './physics/network';
import type { Generator } from './physics/waveform';

export interface Trace { id: string; name: string; blurb: string; path: [number, number][]; spec: TraceSpec; }

const pathLength = (p: [number, number][]) => p.slice(1).reduce((s, q, k) => s + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0) * 1e-3;

export function demoTraces(s: Stackup): Trace[] {
  const w50 = widthForZ0(50, s), w75 = widthForZ0(75, s);
  const t1: [number, number][] = [[-66, -36], [-10, -36], [12, -14], [34, -14]];
  const t2: [number, number][] = [[-66, -18], [-22, -18], [-8, -6], [34, -6]];
  const t3: [number, number][] = [[-66, 6], [34, 6]];
  const t4: [number, number][] = [[-66, 26], [18, 26], [18, 34], [-46, 34], [-46, 42], [28, 42], [28, 14], [34, 14]];
  const L = pathLength;
  return [
    { id: 'T1', name: 'Feed to chip input', blurb: 'Uniform 50 Ω line into a chip pin: 50 Ω in parallel with 2 pF. The capacitance causes reflections at high frequency.', path: t1,
      spec: { sections: [{ len: L(t1), w: w50 }], load: { kind: 'chip', r: 50, c: 2e-12 } } },
    { id: 'T2', name: 'Impedance step', blurb: '50 → 75 → 50 Ω. Each width change reflects part of the wave.', path: t2,
      spec: { sections: [0.35, 0.3, 0.35].map((f, k) => ({ len: L(t2) * f, w: k === 1 ? w75 : w50 })), load: { kind: 'resistor', r: 50, c: 2e-12 } } },
    { id: 'T3', name: 'Open stub', blurb: 'A side branch about a quarter wave long at 3 GHz blocks that frequency.', path: t3,
      spec: { sections: [{ len: L(t3) / 2, w: w50 }, { len: L(t3) / 2, w: w50 }], stub: { after: 0, len: 0.014, w: w50 }, load: { kind: 'resistor', r: 50, c: 2e-12 } } },
    { id: 'T4', name: 'Long serpentine', blurb: 'Several wavelengths long. Change the load to compare open, short and matched.', path: t4,
      spec: { sections: [{ len: L(t4), w: w50 }], load: { kind: 'open', r: 50, c: 2e-12 } } },
  ];
}

export const HISTORY = 400;    
export const COLS = 220;        

export class TraceSim {
  net: Network;
  readonly sampleDt: number;
  next = 0; count = 0;
  readonly time = new Float64Array(HISTORY);
  readonly scope = [new Float32Array(HISTORY), new Float32Array(HISTORY), new Float32Array(HISTORY)]; // source, probe, load
  readonly spaceTime = new Float32Array(HISTORY * COLS);
  envMin = new Float32Array(COLS); envMax = new Float32Array(COLS); envReady = false;
  private curMin = new Float32Array(COLS).fill(Infinity); private curMax = new Float32Array(COLS).fill(-Infinity);
  private cols: Int32Array; private inWindow = 0;
  private readonly perWindow: number;
  probe = 0.5;

  constructor(readonly trace: Trace, stack: Stackup, gen: Generator) {
    this.net = new Network(trace.spec, stack, gen);
    this.cols = Int32Array.from({ length: COLS }, (_, k) => this.net.main[this.net.nodeIndex(k / (COLS - 1))]);
    const flight = this.net.params.reduce((s, p, k) => s + trace.spec.sections[k].len / p.v, 0);
    const periodic = gen.shape === 'sine' || gen.shape === 'square';
    this.sampleDt = periodic ? 1 / gen.freq / 80 : flight / 80;
    this.perWindow = 88; 
  }
  step(): void {
    this.net.step();
    if (this.net.t >= this.next) { this.record(); this.next += this.sampleDt; }
  }
  private record(): void {
    const k = this.count % HISTORY, v = this.net.v;
    this.time[k] = this.net.t;
    this.scope[0][k] = this.net.vAt(0); this.scope[1][k] = this.net.vAt(this.probe); this.scope[2][k] = this.net.vAt(1);
    for (let c = 0; c < COLS; c++) {
      const x = v[this.cols[c]];
      this.spaceTime[k * COLS + c] = x;
      if (x < this.curMin[c]) this.curMin[c] = x;
      if (x > this.curMax[c]) this.curMax[c] = x;
    }
    this.count++;
    if (++this.inWindow >= this.perWindow) {
      this.envMin.set(this.curMin); this.envMax.set(this.curMax); this.envReady = true;
      this.curMin.fill(Infinity); this.curMax.fill(-Infinity); this.inWindow = 0;
    }
  }
}

export class Simulation {
  stack: Stackup = { ...DEFAULT_STACKUP };
  gen: Generator = { shape: 'sine', freq: 3e9, amp: 1, rise: 50e-12, rs: 50 };
  traces = demoTraces(this.stack);
  sims: TraceSim[] = [];
  secondsPerPeriod = 3;
  running = true;
  limited = false;
  t = 0;
  constructor() { this.reset(); }
  reset(): void {
    const probes = this.sims.map((s) => s.probe);
    this.sims = this.traces.map((t) => new TraceSim(t, this.stack, { ...this.gen }));
    this.sims.forEach((s, k) => (s.probe = probes[k] ?? 0.5));
    this.t = 0; this.limited = false;
  }
  get slowFactor(): number { return this.secondsPerPeriod * this.gen.freq; }
  advance(span: number): void {
    this.t += span;
    const MAX = 6000; this.limited = false;
    for (const s of this.sims) {
      let n = 0;
      while (s.net.t + s.net.dt <= this.t && n < MAX) { s.step(); n++; }
      if (n === MAX) this.limited = true;
    }
    if (this.limited) this.t = Math.min(...this.sims.map((s) => s.net.t + s.net.dt));
  }
  frame(wallSeconds: number): void { if (this.running) this.advance(Math.min(wallSeconds, 0.1) / this.slowFactor); }
  singleStep(): void { this.running = false; this.advance(1 / this.gen.freq / 20); }
}
