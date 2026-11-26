const NEG = [45, 125, 255], ZERO = [196, 128, 66], POS = [255, 70, 55];
export function voltageRGB(x: number): [number, number, number] {
  const a = Math.min(1, Math.abs(x)), to = x < 0 ? NEG : POS;
  return [0, 1, 2].map((k) => ZERO[k] + (to[k] - ZERO[k]) * a) as [number, number, number];
}
export function mapRGB(x: number): [number, number, number] {
  const a = Math.min(1, Math.abs(x)), to = x < 0 ? NEG : POS, base = [18, 24, 33];
  return [0, 1, 2].map((k) => base[k] + (to[k] - base[k]) * a) as [number, number, number];
}
