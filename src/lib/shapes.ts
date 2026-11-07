import type { RGB } from './color'
import { HEART_KEYS } from './compose'
import { center, type Board } from './layout'

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
