export type Shape = 'sine' | 'square' | 'pulse' | 'step';
export interface Generator { shape: Shape; freq: number; amp: number; rise: number; rs: number; }
export const MIN_RISE = 30e-12;

const edge = (t: number, tr: number) => (t <= 0 ? 0 : t >= tr ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * t) / tr));

export function effectiveRise(g: Generator): number {
  const lim = g.shape === 'step' ? Infinity : 0.4 / g.freq;
  return Math.min(Math.max(g.rise, MIN_RISE), lim);
}

export function sourceVoltage(g: Generator, t: number): number {
  if (t < 0) return 0;
  if (g.shape === 'sine') return g.amp * Math.sin(2 * Math.PI * g.freq * t);
  const tr = effectiveRise(g), T = 1 / g.freq;
  if (g.shape === 'step') return g.amp * edge(t, tr);
  const tt = g.shape === 'square' ? t % T : t;
  return g.amp * (edge(tt, tr) - edge(tt - T / 2, tr));
}
