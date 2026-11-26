import './style.css';
import { Simulation } from './model';
import { MIN_RISE, effectiveRise, type Shape } from './physics/waveform';
import { widthForZ0 } from './physics/microstrip';
import { BoardView } from './ui/board';
import { Popup } from './ui/popup';
import { el, slider, select, fmtFreq, fmtTime } from './ui/dom';

const sim = new Simulation();
const app = document.getElementById('app')!;
const side = el('nav', { class: 'side', 'aria-label': 'Controls' });
const stage = el('main', { class: 'stage' });
app.append(side, stage);

const popup = new Popup(stage, sim);
const apply = () => { sim.reset(); popup.refresh(); };
let board: BoardView | null = null;
try { board = new BoardView(stage, sim, (k) => popup.open(k)); }
catch (e) { stage.append(el('p', { class: 'error' }, `3D view could not start (WebGL unavailable): ${e}. The trace buttons on the left still work.`)); }

const clock = el('div', { class: 'clock' });
const playBtn = el('button', { class: 'primary' }, 'Pause');
const stepBtn = el('button', {}, 'Step');
const restartBtn = el('button', {}, 'Restart');
const toggle = () => { sim.running = !sim.running; playBtn.textContent = sim.running ? 'Pause' : 'Play'; };
playBtn.addEventListener('click', toggle);
stepBtn.addEventListener('click', () => { sim.singleStep(); playBtn.textContent = 'Play'; });
restartBtn.addEventListener('click', () => sim.reset());

const section = (title: string, ...kids: HTMLElement[]) => el('section', {}, el('h3', {}, title), ...kids);
const check = (text: string, key: 'wave' | 'current' | 'ret' | 'exploded') => {
  const i = el('input', { type: 'checkbox' }); i.checked = board?.show[key] ?? true;
  i.addEventListener('change', () => { if (board) board.show[key] = i.checked; });
  return el('label', { class: 'check' }, i, text);
};

function buildSide(): void {
  const g = sim.gen;
  const traceButtons = sim.traces.map((t, k) => { const b = el('button', { class: 'trace' }, el('b', {}, t.id), ` ${t.name}`); b.addEventListener('click', () => popup.open(k)); return b; });
  const camera = el('button', {}, 'Reset view'); camera.addEventListener('click', () => board?.resetCamera());
  const defaults = el('button', {}, 'Restore demo defaults'); defaults.addEventListener('click', () => location.reload());
  const about = el('details', {}, el('summary', {}, 'About this model'), el('ul', {},
    ...['Each trace is a 1D transmission line solved in the time domain (FDTD on the telegrapher’s equations).',
      'Z0 and εeff come from the Hammerstad–Jensen formulas, without solder mask. A fab calculator will differ somewhat.',
      'Conductor and dielectric loss are evaluated at the generator frequency only, also for square, pulse and step signals.',
      'Not modelled: dispersion, radiation, bends, crosstalk, vias, surface roughness.',
      'Each trace has its own copy of the source and does not affect the others.',
      'Sine swings ±amplitude; other shapes go from 0 to amplitude. Amplitude is the open-circuit source voltage.',
      'Colour is voltage; yellow arrows are signal current and teal arrows are return current. The wave moves near c/√εeff; individual electrons barely drift.',
      'Board drawing: trace widths ×6, layer spacing exaggerated. Changed lengths keep the drawn route.',
    ].map((t) => el('li', {}, t))));
  side.replaceChildren(
    el('h1', {}, 'Microstrip Lab'),
    el('div', { class: 'transport' }, playBtn, stepBtn, restartBtn), clock,
    slider({ label: 'Screen time per period', min: 0.5, max: 120, log: true, value: sim.secondsPerPeriod, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => (sim.secondsPerPeriod = v) }),
    section('Signal generator',
      select<Shape>('Waveform', [['sine', 'Sine'], ['square', 'Square'], ['pulse', 'Single pulse'], ['step', 'Step']], g.shape, (v) => { g.shape = v; apply(); }),
      slider({ label: 'Frequency', min: 1e7, max: 6e9, log: true, value: g.freq, format: fmtFreq, onInput: (v) => { g.freq = v; apply(); } }),
      slider({ label: 'Amplitude', min: 0.1, max: 3.3, value: g.amp, format: (v) => `${v.toFixed(2)} V`, onInput: (v) => { g.amp = v; apply(); } }),
      slider({ label: 'Rise time (not sine)', min: MIN_RISE, max: 500e-12, log: true, value: g.rise, format: (v) => { const used = effectiveRise({ ...g, rise: v }); return used < v * 0.999 ? `${fmtTime(used)} (limited)` : fmtTime(v); }, onInput: (v) => { g.rise = v; apply(); } }),
      slider({ label: 'Source resistance', min: 1, max: 300, log: true, value: g.rs, format: (v) => `${v.toFixed(0)} Ω`, onInput: (v) => { g.rs = v; apply(); } })),
    section('Traces (or click one on the board)', ...traceButtons),
    section('Stack-up, L1 over L2',
      slider({ label: 'Dielectric constant εr', min: 2.2, max: 10, value: sim.stack.er, format: (v) => `${v.toFixed(2)} · 50 Ω width ${(widthForZ0(50, { ...sim.stack, er: v }) * 1000).toFixed(3)} mm`, onInput: (v) => { sim.stack.er = v; apply(); } }),
      slider({ label: 'Height h', min: 0.08e-3, max: 0.5e-3, value: sim.stack.h, format: (v) => `${(v * 1000).toFixed(3)} mm`, onInput: (v) => { sim.stack.h = v; apply(); } }),
      slider({ label: 'Loss tangent', min: 0, max: 0.03, value: sim.stack.tanD, format: (v) => v.toFixed(4), onInput: (v) => { sim.stack.tanD = v; apply(); } }),
      el('p', { class: 'note' }, 'Trace widths stay fixed when these change, so impedances change. Use “Set all widths to 50 Ω” in a trace view to re-match.')),
    section('View', check('Voltage wave height', 'wave'), check('Signal current', 'current'), check('Return current on L2', 'ret'), check('Exploded layers', 'exploded'), camera, defaults),
    el('div', { class: 'legend' }, el('span', {}, '−V'), el('i'), el('span', {}, '+V')),
    about);
}
buildSide();

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') popup.close();
  if ((e.target as HTMLElement).matches('input, select, button, summary')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'Period') { sim.singleStep(); playBtn.textContent = 'Play'; }
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.max(0, (now - last) / 1000); last = now;
  sim.frame(dt);
  if (popup.index === null) board?.render(dt);
  popup.draw();
  const slow = sim.slowFactor;
  clock.textContent = `t = ${fmtTime(sim.t)} · slowed ${slow.toExponential(1).replace('e+', ' × 10^')} times${sim.limited ? ' · speed limited' : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
