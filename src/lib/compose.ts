import type { Base, DaemonState, Layer } from './api'
import { OFF, STRIPES, type RGB } from './color'
import type { Board } from './layout'

/**
 * The firmware heart (shape 0), the only built-in shape whose LEDs we know (on ANSI). By key, so it
 * lands on the same keys on ISO and JIS; JIS has KANA where ANSI has Right ⌘. What the ISO and JIS
 * firmware draws for it is a guess.
 */
export const HEART_KEYS = ['8', '9', '-', '=', 'u', 'i', 'o', 'p', '[', ']', 'j', 'k', 'l', ';', "'", ',', '.', '/', 'rcmd', 'kana']

function heart(board: Board) {
  return new Set(HEART_KEYS.flatMap((id) => board.byId.get(id)?.led ?? []))
}

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
export function baseFrame(base: Base, board: Board): RGB[] {
  const frame: RGB[] = Array.from({ length: board.keyLeds }, () => OFF)
  const level = Math.max(0, Math.min(100, base.level ?? 100)) / 100
  const hearts = heart(board)
  for (let r = 0; r < board.rows.length; r++) {
    const [start, end] = board.rows[r]
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
          c = (base.shape ?? 0) === 0 && hearts.has(led) ? (base.color ?? [255, 0, 0]) : (base.color2 ?? OFF)
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
export function compose(base: Base, layers: Layer[], board: Board): RGB[] {
  const frame = baseFrame(base, board)
  if (ownsKeys(base)) return frame
  for (const layer of layers) {
    if (!layer.visible) continue
    for (const [led, c] of Object.entries(layer.leds)) if (+led < board.keyLeds) frame[+led] = c
  }
  return frame
}

/** What holding Hyper shows: only the keys that do something, everything else dark. */
export function hyperFrame(state: DaemonState, board: Board): RGB[] {
  const frame: RGB[] = Array.from({ length: board.keyLeds }, () => OFF)
  for (const id of state.hyper_keys) {
    const k = board.byId.get(id)
    if (k) frame[k.led] = state.hyper_style.bound
  }
  const hyper = board.hyperKey && board.byId.get(board.hyperKey)
  if (hyper) frame[hyper.led] = state.hyper_style.key
  return frame
}
