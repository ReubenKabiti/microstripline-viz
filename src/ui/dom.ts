export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
export interface SliderOpts { label: string; min: number; max: number; step?: number; value: number; log?: boolean; format: (v: number) => string; onInput: (v: number) => void; }
export function slider(o: SliderOpts): HTMLElement {
  const toPos = (v: number) => (o.log ? Math.log10(v) : v);
  const out = el('output', {}, o.format(o.value));
  const input = el('input', { type: 'range', min: String(toPos(o.min)), max: String(toPos(o.max)), step: String(o.log ? 0.001 : o.step ?? (o.max - o.min) / 500), 'aria-label': o.label });
  input.value = String(toPos(o.value));
  input.addEventListener('input', () => { const v = o.log ? 10 ** Number(input.value) : Number(input.value); out.textContent = o.format(v); o.onInput(v); });
  return el('label', { class: 'ctl' }, el('span', {}, o.label, out), input);
}
export function select<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const s = el('select', { 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: v }, t)));
  s.value = value; s.addEventListener('change', () => onChange(s.value as T));
  return el('label', { class: 'ctl' }, el('span', {}, label), s);
}
export const fmtFreq = (f: number) => (f >= 1e9 ? `${(f / 1e9).toFixed(2)} GHz` : `${(f / 1e6).toFixed(0)} MHz`);
export const fmtTime = (t: number) => (t >= 1e-6 ? `${(t * 1e6).toFixed(3)} µs` : t >= 1e-9 ? `${(t * 1e9).toFixed(3)} ns` : `${(t * 1e12).toFixed(1)} ps`);
