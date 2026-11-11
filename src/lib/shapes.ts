import type { RGB } from './color'
import { HEART_KEYS } from './compose'
import { center, type Board, type Key } from './layout'

export type Leds = Record<string, RGB>

export type Preset = {
  id: string
  name: string
  /** Shown under the name in the gallery. */
  hint: string
  build: (board: Board) => Leds
}

const RED: RGB = [200, 0, 0]

/** The keys that exist on this board, in one colour. Presets are by key, so they fit every layout. */
function keys(board: Board, ids: string[], c: RGB): Leds {
  const out: Leds = {}
  for (const id of ids) {
    const k = board.byId.get(id)
    if (k) out[k.led] = c
  }
  return out
}

/** Every key whose centre passes the test, in one colour. */
function where(board: Board, test: (x: number, y: number) => boolean, c: RGB): Leds {
  const out: Leds = {}
  for (const k of board.keys) {
    const { cx, cy } = center(k)
    if (test(cx, cy)) out[k.led] = c
  }
  return out
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB
const narrow = (k: Key) => k.w <= 1.5
const dim = (c: RGB, f: number): RGB => c.map((v) => Math.round(v * f)) as RGB

/** A colour along several stops, t in [0, 1]. */
function ramp(stops: RGB[], t: number): RGB {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  return mix(stops[i], stops[i + 1], t - i)
}

/** A fully saturated colour at hue h in [0, 1). */
function hue(h: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 6) % 6
    return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))))
  }
  return [f(5), f(3), f(1)]
}

/** Every key, coloured by where its centre sits (key units: x 0-16, y 0-6). */
function fill(board: Board, color: (x: number, y: number) => RGB | null): Leds {
  const out: Leds = {}
  for (const k of board.keys) {
    const { cx, cy } = center(k)
    const c = color(cx, cy)
    if (c) out[k.led] = c
  }
  return out
}

/** The keys (no wide ones) whose centres lie within `width` of a path drawn in key units. */
function stroke(board: Board, path: [number, number][], c: RGB, width = 0.5): Leds {
  const out: Leds = {}
  for (const k of board.keys) {
    if (!narrow(k)) continue
    const { cx, cy } = center(k)
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i]
      const [bx, by] = path[i + 1]
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(cx - ax - t * dx, cy - ay - t * dy) < width) {
        out[k.led] = c
        break
      }
    }
  }
  return out
}

export const PRESETS: Preset[] = [
  {
    id: 'slashes',
    name: 'Slashes',
    hint: 'Three red stripes each side',
    build: (b) => ({
      ...keys(b, ['f12', 'screenshot', 'ins', '-', '=', 'bksp', 'p', '[', ']', 'l', ';', "'", ',', '.', '/'], RED),
      ...keys(b, ['f1', 'f2', 'f3', '2', '3', '4', 'w', 'e', 'r', 'd', 'f', 'g', 'c', 'v', 'b'], RED),
    }),
  },
  {
    id: 'heart',
    name: 'Heart',
    hint: 'The one NuPhy shipped',
    build: (b) => keys(b, HEART_KEYS, [195, 0, 0]),
  },
  {
    id: 'ka',
    name: 'KA',
    hint: 'Two letters, two colours',
    build: (b) => ({
      ...keys(b, ['f1', '1', 'q', 'a', 'z', 'w', '3', 'f4', 'd', 'c'], [0, 200, 255]),
      ...keys(b, ['f8', 'f9', '7', '0', 'y', 'u', 'i', 'o', 'p', 'h', ';', 'b', '/'], [255, 0, 150]),
    }),
  },
  {
    id: 'arrows',
    name: 'Arrows',
    hint: 'WASD and the arrow keys',
    build: (b) => keys(b, ['w', 'a', 's', 'd', 'up', 'left', 'down', 'right'], [0, 230, 255]),
  },
  {
    id: 'home-row',
    name: 'Home row',
    hint: 'Where your fingers rest',
    build: (b) => ({ ...keys(b, ['a', 's', 'd', 'k', 'l', ';'], [255, 170, 110]), ...keys(b, ['f', 'j'], [255, 90, 0]) }),
  },
  {
    id: 'frame',
    name: 'Frame',
    hint: 'A ring around the edge',
    build: (b) => {
      const out: Leds = {}
      for (const k of b.keys) {
        const row = b.keys.filter((o) => o.row === k.row)
        if (k.row === 0 || k.row === 5 || k === row[0] || k === row[row.length - 1]) out[k.led] = [150, 0, 255]
      }
      return out
    },
  },
  {
    id: 'diamond',
    name: 'Diamond',
    hint: 'Centred on G and H',
    build: (b) => where(b, (x, y) => Math.abs(Math.abs(x - 7.6) / 1.6 + Math.abs(y - 3) - 2.2) < 0.55, [0, 255, 60]),
  },
  {
    id: 'ripple',
    name: 'Ripple',
    hint: 'Rings out from the space bar',
    build: (b) => {
      const rings: RGB[] = [[0, 90, 255], [0, 230, 255], [150, 0, 255]]
      const out: Leds = {}
      for (const k of b.keys) {
        const { cx, cy } = center(k)
        const d = Math.hypot((cx - 7.25) / 1.7, cy - 5.5)
        const ring = Math.floor(d)
        if (d - ring < 0.55 && ring < 6) out[k.led] = rings[ring % rings.length]
      }
      return out
    },
  },
  {
    id: 'checker',
    name: 'Checker',
    hint: 'Every other key',
    build: (b) => {
      const out: Leds = {}
      b.keys.forEach((k) => {
        const i = b.keys.filter((o) => o.row === k.row).indexOf(k)
        if ((i + k.row) % 2 === 0) out[k.led] = [255, 0, 180]
      })
      return out
    },
  },
  {
    id: 'lambda',
    name: 'Lambda',
    hint: 'For the functional crowd',
    build: (b) => ({ ...stroke(b, [[5.6, 0.5], [6.6, 0.5], [10.4, 4.5]], [150, 0, 255]), ...stroke(b, [[8, 2], [5.6, 4.5]], [150, 0, 255]) }),
  },
  {
    id: 'stack',
    name: 'Stack',
    hint: 'Rows that narrow to the top',
    build: (b) => {
      const out: Leds = {}
      for (const k of b.keys) if (narrow(k) && k.row <= 4 && Math.abs(center(k).cx - 7.9) <= 0.6 + k.row * 1.1) out[k.led] = mix([150, 0, 255], [0, 230, 255], k.row / 4)
      return out
    },
  },
  {
    id: 'split',
    name: 'Split',
    hint: 'One colour per hand',
    build: (b) => {
      const out: Leds = {}
      for (const k of b.keys) if (k.row >= 1 && k.row <= 4) out[k.led] = center(k).cx < 8.1 - (k.row - 1) * 0.25 ? [0, 230, 255] : [255, 0, 180]
      return out
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    hint: 'Green into teal into violet',
    build: (b) => fill(b, (x, y) => ramp([[0, 255, 90], [0, 220, 200], [0, 110, 255], [150, 0, 255]], (x + (5.5 - y) * 0.9) / 20)),
  },
  {
    id: 'ember',
    name: 'Ember',
    hint: 'Heat rising from the space bar',
    build: (b) => fill(b, (x, y) => ramp([[255, 210, 80], [255, 110, 0], [220, 20, 0], [70, 0, 0]], (5.5 - y) / 5 + Math.abs(x - 8) / 40)),
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    hint: 'White in the middle, blue at the edges',
    build: (b) =>
      fill(b, (x, y) => {
        const d = Math.hypot((x - 8) / 2.3, y - 2.5) / 3.3
        return dim(ramp([[255, 255, 255], [0, 230, 255], [0, 90, 255], [40, 0, 160]], d), Math.max(0.25, 1 - d * 0.55))
      }),
  },
  {
    id: 'spectrum',
    name: 'Spectrum',
    hint: 'Every hue, corner to corner',
    build: (b) => fill(b, (x, y) => hue(((x + y * 1.4) / 23) % 1)),
  },
  {
    id: 'dusk',
    name: 'Dusk',
    hint: 'Night sky above, the last light below',
    build: (b) => fill(b, (_, y) => ramp([[20, 0, 90], [110, 0, 200], [255, 0, 120], [255, 110, 0]], y / 5.5)),
  },
  {
    id: 'vignette',
    name: 'Vignette',
    hint: 'Glowing corners, a dark centre',
    build: (b) =>
      fill(b, (x, y) => {
        const d = Math.hypot((x - 8) / 8, (y - 2.8) / 3)
        return d > 0.6 ? dim(mix([150, 0, 255], [255, 0, 180], x / 16), Math.min(1, (d - 0.55) * 2.6)) : null
      }),
  },
  {
    id: 'sunset',
    name: 'Sunset',
    hint: 'Warm rows fading to violet',
    build: (b) => {
      const rows: RGB[] = [[150, 0, 255], [255, 0, 120], [255, 40, 0], [255, 110, 0], [255, 170, 60], [255, 200, 120]]
      return Object.fromEntries(b.keys.map((k) => [k.led, rows[k.row]]))
    },
  },
]

export function uniqueName(base: string, taken: string[]) {
  const lower = new Set(taken.map((t) => t.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}
