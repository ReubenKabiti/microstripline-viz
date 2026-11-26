import { describe, it, expect } from 'vitest';
import { DEFAULT_STACKUP as S, microstrip, widthForZ0, lineParams, C0 } from '../src/physics/microstrip';
import { Network, type TraceSpec, type LoadKind } from '../src/physics/network';
import { steadyState } from '../src/physics/phasor';
import { sourceVoltage, type Generator } from '../src/physics/waveform';
import { solveField } from '../src/physics/field';

const w50 = widthForZ0(50, S);
const step: Generator = { shape: 'step', freq: 1e9, amp: 1, rise: 50e-12, rs: 50 };
const uni = (kind: LoadKind, len = 0.1, r = 50, c = 2e-12): TraceSpec => ({ sections: [{ len, w: w50 }], load: { kind, r, c } });
const run = (n: Network, until: number) => { while (n.t < until) n.step(); };
const flight = (len: number) => len / (C0 / Math.sqrt(microstrip(w50, S).eeff));

describe('line parameters', () => {
  it('matches the roadmap widths', () => {
    expect(w50 * 1e3).toBeCloseTo(0.372, 3);
    expect(widthForZ0(75, S) * 1e3).toBeCloseTo(0.157, 3);
    const p = lineParams(w50, S, 1e9, false);
    expect(Math.sqrt(p.L / p.C)).toBeCloseTo(50, 3);
    expect(1 / Math.sqrt(p.L * p.C)).toBeCloseTo(p.v, 0);
  });
});

describe('time domain', () => {
  it('delay within 1% of theory', () => {
    const n = new Network(uni('matched'), S, step, false);
    const out = n.main.at(-1)!;
    while (n.v[out] < 0.25) n.step();
    const delay = n.t - 25e-12; // half-amplitude point of the 50 ps edge
    expect(Math.abs(delay / flight(0.1) - 1)).toBeLessThan(0.01);
  });
  it.each([
    ['matched', 50, 0.5], ['open', 50, 1.0], ['short', 50, 0], ['resistor', 150, 0.75], ['resistor', 25, 1 / 3],
  ] as const)('step into %s load (%d ohm) settles correctly', (kind, r, vFirst) => {
    const n = new Network(uni(kind, 0.1, r), S, step, false);
    run(n, flight(0.1) * 1.8);
    expect(n.vAt(1)).toBeCloseTo(vFirst, 2);
  });
  it('bounces with a mismatched source follow the lattice diagram', () => {
    const g = { ...step, rs: 10 }, n = new Network(uni('open'), S, g, false);
    const first = 50 / 60, gs = (10 - 50) / 60, T = flight(0.1);
    run(n, 1.8 * T); expect(n.vAt(1)).toBeCloseTo(2 * first, 2);
    run(n, 3.8 * T); expect(n.vAt(1)).toBeCloseTo(2 * first * (1 + gs), 2);
  });
  it('stays bounded over long runs with steps, a stub and a capacitive load', () => {
    const spec: TraceSpec = {
      sections: [{ len: 0.02, w: w50 }, { len: 0.013, w: widthForZ0(90, S) }, { len: 0.02, w: widthForZ0(40, S) }],
      stub: { after: 0, len: 0.014, w: w50 }, load: { kind: 'open', r: 50, c: 0 } };
    const n = new Network(spec, S, { ...step, rs: 50 }, false);
    for (let k = 0; k < 200000; k++) n.step();
    expect(Math.max(...n.v.map(Math.abs))).toBeLessThan(1.2);
    expect(n.vAt(1)).toBeCloseTo(1, 2);
  });
});

describe('time domain agrees with the ABCD steady state', () => {
  const g: Generator = { shape: 'sine', freq: 3e9, amp: 1, rise: 50e-12, rs: 50 };
  const w75 = widthForZ0(75, S);
  const cases: [string, TraceSpec][] = [
    ['open', uni('open', 0.06)], ['100 ohm', uni('resistor', 0.06, 100)], ['chip', uni('chip', 0.06, 10000)],
    ['width step', { sections: [{ len: 0.025, w: w50 }, { len: 0.02, w: w75 }, { len: 0.025, w: w50 }], load: { kind: 'matched', r: 50, c: 0 } }],
    ['stub', { sections: [{ len: 0.03, w: w50 }, { len: 0.03, w: w50 }], stub: { after: 0, len: 0.01, w: w50 }, load: { kind: 'matched', r: 50, c: 0 } }],
  ];
  for (const lossy of [false, true]) it.each(cases)(`%s (lossy=${lossy})`, (_, spec) => {
    const n = new Network(spec, S, g, lossy);
    run(n, 30e-9);
    let vl = 0, vi = 0;
    while (n.t < 32e-9) { n.step(); vl = Math.max(vl, Math.abs(n.vAt(1))); vi = Math.max(vi, Math.abs(n.vAt(0))); }
    const s = steadyState(spec, S, g.freq, 1, 50, lossy);
    expect(Math.abs(vl - s.vLoad)).toBeLessThan(0.02);
    expect(Math.abs(vi - s.vIn)).toBeLessThan(0.02);
  });
  it('measured VSWR within 2% of formula', () => {
    const spec = uni('resistor', 0.1, 100), n = new Network(spec, S, g, false);
    run(n, 30e-9);
    const peak = new Float64Array(n.main.length);
    while (n.t < 31e-9) { n.step(); n.main.forEach((id, k) => (peak[k] = Math.max(peak[k], Math.abs(n.v[id])))); }
    const vswr = Math.max(...peak) / Math.min(...peak);
    expect(Math.abs(vswr / steadyState(spec, S, g.freq, 1, 50, false).vswrLoad - 1)).toBeLessThan(0.02);
  });
  it('quarter-wave open stub notches the output', () => {
    const q = C0 / Math.sqrt(microstrip(w50, S).eeff) / g.freq / 4;
    const spec: TraceSpec = { sections: [{ len: 0.03, w: w50 }, { len: 0.03, w: w50 }], stub: { after: 0, len: q, w: w50 }, load: { kind: 'matched', r: 50, c: 0 } };
    expect(steadyState(spec, S, g.freq, 1, 50, false).vLoad).toBeLessThan(0.01);
  });
});

describe('waveforms', () => {
  it('square wave is 0..amp and periodic', () => {
    const g: Generator = { shape: 'square', freq: 1e9, amp: 2, rise: 50e-12, rs: 50 };
    expect(sourceVoltage(g, 0.25e-9)).toBeCloseTo(2);
    expect(sourceVoltage(g, 0.75e-9)).toBeCloseTo(0);
    expect(sourceVoltage(g, 1.25e-9)).toBeCloseTo(2);
  });
});

describe('cross-section field solver', () => {
  it.each([40, 50, 75, 90])('field vs closed form, %d ohm', (z) => {
    const w = widthForZ0(z, S), f = solveField(w, S), m = microstrip(w, S);
    console.log(z, 'ohm: field', f.z0.toFixed(2), f.eeff.toFixed(3), 'closed', m.z0.toFixed(2), m.eeff.toFixed(3), f.xs.length, f.ys.length);
    expect(Math.abs(f.z0 / m.z0 - 1)).toBeLessThan(0.03);
  }, 60000);
});
