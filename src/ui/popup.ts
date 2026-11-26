import { COLS, type Simulation, type TraceSim } from '../model';
import { solveField } from '../physics/field';
import { microstrip, widthForZ0, C0 } from '../physics/microstrip';
import { loadRC, type LoadKind } from '../physics/network';
import { steadyState } from '../physics/phasor';
import { el, slider, select } from './dom';
import { drawAlongLine, drawScope, drawSpaceTime, drawCross, fieldArt, type FieldArt } from './plots';

export class Popup {
  index: number | null = null;
  private root = el('div', { class: 'modal', hidden: '', role: 'dialog', 'aria-modal': 'false' });
  private canvases = [0, 1, 2, 3].map(() => el('canvas'));
  private controls = el('div', { class: 'popup-controls' });
  private readout = el('dl', { class: 'readout' });
  private title = el('div');
  private arts = new Map<string, FieldArt>();

  constructor(host: HTMLElement, private sim: Simulation) {
    const close = el('button', { class: 'close', 'aria-label': 'Close trace view' }, '✕');
    close.addEventListener('click', () => this.close());
    const panel = (t: string, hint: string, c: HTMLCanvasElement) => el('figure', {}, el('figcaption', {}, el('b', {}, t), el('span', {}, hint)), c);
    const [a, b, c, d] = this.canvases;
    this.root.append(el('header', {}, this.title, close), el('div', { class: 'popup-body' },
      el('div', { class: 'grid' },
        panel('Along the line', 'band = envelope over about one period', a),
        panel('Cross-section at the probe', 'brightness follows v and i', b),
        panel('Oscilloscope', 'voltage against time', c),
        panel('Space–time map', 'slope = speed; crossings = reflections', d)),
      el('aside', {}, this.controls, this.readout)));
    host.append(this.root);
  }

  open(k: number): void { this.index = k; this.root.hidden = false; this.build(); }
  close(): void { this.index = null; this.root.hidden = true; }
  /** Re-create the controls and readouts after any parameter change. */
  refresh(): void { if (this.index !== null) this.build(); }

  private get current(): TraceSim { return this.sim.sims[this.index!]; }

  private build(): void {
    const k = this.index!, t = this.sim.traces[k], spec = t.spec, S = this.sim.stack;
    this.title.replaceChildren(el('h2', {}, `${t.id} · ${t.name}`), el('p', {}, t.blurb));
    const changed = () => { this.sim.reset(); this.updateReadout(); };
    const items: HTMLElement[] = [
      slider({ label: 'Probe position', min: 0, max: 1, value: this.current.probe, format: (v) => `${(v * this.current.net.length * 1000).toFixed(1)} mm`, onInput: (v) => (this.current.probe = v) }),
    ];
    spec.sections.forEach((sec, j) => {
      const n = spec.sections.length > 1 ? ` (section ${j + 1})` : '';
      items.push(slider({ label: `Width${n}`, min: 0.08e-3, max: 1.2e-3, value: sec.w, log: true,
        format: (w) => `${(w * 1000).toFixed(3)} mm · ${microstrip(w, S).z0.toFixed(1)} Ω`, onInput: (w) => { sec.w = w; changed(); } }));
      items.push(slider({ label: `Length${n}`, min: 5e-3, max: 0.4, value: sec.len, format: (v) => `${(v * 1000).toFixed(1)} mm`, onInput: (v) => { sec.len = v; changed(); } }));
    });
    if (spec.stub) items.push(slider({ label: 'Stub length', min: 1e-3, max: 40e-3, value: spec.stub.len, format: (v) => `${(v * 1000).toFixed(2)} mm`, onInput: (v) => { spec.stub!.len = v; changed(); } }));
    const set50 = el('button', {}, 'Set all widths to 50 Ω');
    set50.addEventListener('click', () => { const w = widthForZ0(50, S); spec.sections.forEach((s) => (s.w = w)); if (spec.stub) spec.stub.w = w; changed(); this.build(); });
    items.push(set50, select<LoadKind>('Load', [['matched', 'Matched to line'], ['open', 'Open circuit'], ['short', 'Short circuit'], ['resistor', 'Resistor'], ['chip', 'Chip pin (R ∥ C)']], spec.load.kind,
      (v) => { spec.load.kind = v; changed(); this.build(); }));
    if (spec.load.kind === 'resistor' || spec.load.kind === 'chip') items.push(slider({ label: 'Load resistance', min: 1, max: 10000, log: true, value: spec.load.r, format: (v) => `${v.toFixed(v < 100 ? 1 : 0)} Ω`, onInput: (v) => { spec.load.r = v; changed(); } }));
    if (spec.load.kind === 'chip') items.push(slider({ label: 'Pin capacitance', min: 0.1e-12, max: 10e-12, log: true, value: spec.load.c, format: (v) => `${(v * 1e12).toFixed(2)} pF`, onInput: (v) => { spec.load.c = v; changed(); } }));
    this.controls.replaceChildren(...items);
    this.updateReadout();
  }

  private updateReadout(): void {
    const s = this.current, spec = s.trace.spec, g = this.sim.gen, net = s.net, S = this.sim.stack;
    const st = steadyState(spec, S, g.freq, g.amp, g.rs);
    const rows: [string, string][] = [];
    net.params.forEach((p, j) => rows.push([net.params.length > 1 ? `Section ${j + 1}` : 'Line', `${p.z0.toFixed(1)} Ω · εeff ${p.eeff.toFixed(2)}`]));
    const delay = net.params.reduce((a, p, j) => a + spec.sections[j].len / p.v, 0);
    const loss = net.params.reduce((a, p, j) => a + 8.6859 * (p.R / (2 * p.z0) + (p.G * p.z0) / 2) * spec.sections[j].len, 0);
    rows.push(['Delay, end to end', `${(delay * 1e12).toFixed(0)} ps`],
      ['Wavelength', `${((C0 / Math.sqrt(net.params[0].eeff) / g.freq) * 1000).toFixed(1)} mm`],
      ['Matched-line loss', `${loss.toFixed(2)} dB`]);
    const zl = net.params[net.params.length - 1].z0, ld = loadRC(spec.load, zl);
    rows.push(['|Γ| at load', st.gammaLoad.toFixed(3)], ['VSWR at load', Number.isFinite(st.vswrLoad) ? st.vswrLoad.toFixed(2) : '∞'],
      ['Input impedance', `${st.zin.re.toFixed(1)} ${st.zin.im < 0 ? '−' : '+'} j${Math.abs(st.zin.im).toFixed(1)} Ω`],
      ['Load peak, formula (sine)', `${st.vLoad.toFixed(3)} V`], ['Load peak, simulated', '…']);
    if (!spec.stub && spec.sections.length === 1 && ld.c === 0) {
      const gS = (g.rs - zl) / (g.rs + zl), gL = ld.short ? -1 : ld.r === Infinity ? 1 : (ld.r - zl) / (ld.r + zl);
      const v1 = (g.amp * zl) / (zl + g.rs) * (1 + gL);
      rows.push(['Γ source / Γ load', `${gS.toFixed(3)} / ${gL.toFixed(3)}`],
        ['Step levels at load (lossless)', [0, 1, 2].map((n) => { let sum = 0; for (let m = 0; m <= n; m++) sum += v1 * (gS * gL) ** m; return sum.toFixed(3); }).join(' → ') + ' V']);
    }
    this.readout.replaceChildren(...rows.flatMap(([a, b]) => [el('dt', {}, a), el('dd', {}, b)]));
  }

  draw(): void {
    if (this.index === null) return;
    const s = this.current, g = this.sim.gen, spec = s.trace.spec;
    const w = spec.sections[s.net.sectionAt(s.probe)].w, key = `${w.toFixed(7)}|${this.sim.stack.h}|${this.sim.stack.er}`;
    let art = this.arts.get(key);
    if (!art) { art = fieldArt(solveField(w, this.sim.stack)); this.arts.set(key, art); if (this.arts.size > 40) this.arts.delete(this.arts.keys().next().value!); }
    drawAlongLine(this.canvases[0], s, g.amp);
    drawCross(this.canvases[1], art, s.net.vAt(s.probe), s.net.iAt(s.probe), g.amp);
    drawScope(this.canvases[2], s, g.amp);
    drawSpaceTime(this.canvases[3], s, g.amp);
    const dd = [...this.readout.querySelectorAll('dt')].find((d) => d.textContent === 'Load peak, simulated')?.nextElementSibling;
    if (dd) dd.textContent = g.shape !== 'sine' ? 'sine only' : s.envReady ? `${Math.max(s.envMax[COLS - 1], -s.envMin[COLS - 1]).toFixed(3)} V` : 'settling…';
  }
}
