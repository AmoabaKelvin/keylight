import type { Base, DaemonState, Layer } from './api'
import { OFF, STRIPES, type RGB } from './color'
import { BY_ID, KEY_LEDS } from './layout'

/** The firmware heart (shape 0), the only built-in shape whose LEDs we know. */
const HEART = new Set([23, 24, 26, 27, 37, 38, 39, 40, 41, 42, 52, 53, 54, 55, 56, 67, 68, 69, 77])

/** LED ranges per physical row, as the engine has them. */
const ROW_START = [0, 15, 30, 45, 59, 73, 84]

function hsv(h: number): RGB {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const q = 1 - f
  const rgb = [
    [1, f, 0],
    [q, 1, 0],
    [0, 1, f],
    [0, q, 1],
    [f, 0, 1],
    [1, 0, q],
  ][i % 6]
  return rgb.map((v) => Math.floor(v * 255)) as RGB
}

/** The theme on its own, the same way the engine works it out. */
export function baseFrame(base: Base): RGB[] {
  const frame: RGB[] = Array.from({ length: KEY_LEDS }, () => OFF)
  const level = Math.max(0, Math.min(100, base.level ?? 100)) / 100
  for (let r = 0; r < 6; r++) {
    const start = ROW_START[r]
    const end = r === 5 ? 84 : ROW_START[r + 1]
    for (let led = start; led < end; led++) {
      const t = (led - start) / Math.max(1, end - start - 1)
      let c: RGB
      switch (base.name) {
        case 'solid':
          c = base.color ?? [255, 255, 255]
          break
        case 'stripes': {
          const colors = base.colors ?? STRIPES
          c = colors[r % colors.length]
          break
        }
        case 'rainbow':
          c = hsv(t * 0.83)
          break
        case 'effect':
          c = base.rgb === false ? (base.color ?? [255, 170, 110]) : hsv(t * 0.83)
          break
        case 'shape':
          c = (base.shape ?? 0) === 0 && HEART.has(led) ? (base.color ?? [255, 0, 0]) : (base.color2 ?? OFF)
          break
        case 'gradient': {
          const a = base.color ?? [255, 170, 110]
          const b = base.color2 ?? [150, 0, 255]
          c = a.map((x, i) => Math.floor(x + (b[i] - x) * t)) as RGB
          break
        }
        default:
          continue
      }
      frame[led] = c.map((v) => Math.floor(v * level)) as RGB
    }
  }
  return frame
}

/** Effects and firmware shapes are drawn by the keyboard; per-key shapes can't show over them. */
export function ownsKeys(base: Base) {
  return base.name === 'effect' || base.name === 'shape'
}

/** Theme plus visible layers, bottom to top: what the keyboard shows when Hyper isn't held. */
export function compose(base: Base, layers: Layer[]): RGB[] {
  const frame = baseFrame(base)
  if (ownsKeys(base)) return frame
  for (const layer of layers) {
    if (!layer.visible) continue
    for (const [led, c] of Object.entries(layer.leds)) frame[+led] = c
  }
  return frame
}

/** What holding Hyper shows: only the keys that do something, everything else dark. */
export function hyperFrame(state: DaemonState): RGB[] {
  const frame: RGB[] = Array.from({ length: KEY_LEDS }, () => OFF)
  for (const id of state.hyper_keys) {
    const k = BY_ID.get(id)
    if (k) frame[k.led] = state.hyper_style.bound
  }
  frame[BY_ID.get('rcmd')!.led] = state.hyper_style.key
  return frame
}
