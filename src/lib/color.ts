export type RGB = [number, number, number]

export const OFF: RGB = [0, 0, 0]

/** The colours offered everywhere, in spectrum order. Warm is the default theme. */
export const PALETTE: { name: string; rgb: RGB }[] = [
  { name: 'Warm', rgb: [255, 170, 110] },
  { name: 'White', rgb: [255, 255, 255] },
  { name: 'Red', rgb: [200, 0, 0] },
  { name: 'Orange', rgb: [255, 90, 0] },
  { name: 'Amber', rgb: [255, 200, 0] },
  { name: 'Green', rgb: [0, 255, 60] },
  { name: 'Cyan', rgb: [0, 230, 255] },
  { name: 'Blue', rgb: [0, 90, 255] },
  { name: 'Purple', rgb: [150, 0, 255] },
  { name: 'Pink', rgb: [255, 0, 180] },
]

export const STRIPES: RGB[] = [
  [255, 0, 0],
  [255, 90, 0],
  [255, 200, 0],
  [0, 220, 60],
  [0, 90, 255],
  [150, 0, 255],
]

export function same(a?: readonly number[] | null, b?: readonly number[] | null) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export function isOff(c?: readonly number[] | null) {
  return !c || (c[0] === 0 && c[1] === 0 && c[2] === 0)
}

export function hex(c: readonly number[]) {
  return '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

export function fromHex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function css(c: readonly number[], alpha = 1) {
  return alpha === 1 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`
}

/**
 * How an LED colour looks on screen. LEDs are additive light, so a dim LED should read as a
 * weaker glow of the same hue, not a muddier colour: keep the hue, put the level in alpha.
 */
export function glow(c: readonly number[]) {
  const peak = Math.max(c[0], c[1], c[2])
  if (peak === 0) return { color: 'transparent', strength: 0 }
  const scale = 255 / peak
  const full: RGB = [c[0] * scale, c[1] * scale, c[2] * scale].map(Math.round) as RGB
  return { color: css(full), strength: peak / 255 }
}

export function colorName(c: readonly number[]) {
  return PALETTE.find((p) => same(p.rgb, c))?.name ?? hex(c).toUpperCase()
}
