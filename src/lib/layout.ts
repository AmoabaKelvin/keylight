/**
 * Every keyboard Keylight draws. The Air75 V3 is drawn by hand below, in its three layouts (ANSI,
 * ISO, JIS): every key's place in key units (1u = one alpha key), its LED index, and the name the
 * engine uses for it. 16u wide, 6 rows. The other NuPhy IO boards come from boards.gen.json, which
 * scripts/gen-boards.mjs writes from NuPhy IO's layouts; their legends are borrowed from the Air75 V3
 * by key id.
 *
 * LED indexes count keys in reading order, row by row, skipping the knob (NuPhy IO's
 * `createLightMapping` with skipPos 14 / skipSize 3, docs/KEYMAP.md §2). ISO and JIS come from NuPhy
 * IO's layout arrays for the Air75V3ISO / Air75V3JIS, matched against their stock keymaps the same way.
 *
 * Key ids name the HID usage a key sends on the stock layout, so a key keeps its id across layouts
 * (JIS `[` is the key that sends `[`, printed `@`). Ids only some layouts have: `nubs` (ISO, next to
 * left Shift), `nuhs` (JIS `]`), `yen`, `ro`, `mhen`, `henk`, `kana`.
 */
import { DEFAULT_LAYERS, MATRIX } from './keycodes'
import { ISO_DEFAULT_LAYERS, ISO_MATRIX, JIS_DEFAULT_LAYERS, JIS_MATRIX } from './boards'
import generated from './boards.gen.json'

/** A board id: 'ansi', 'iso', 'jis' for the Air75 V3, else e.g. 'air65-v3' or 'node75-iso'. */
export type LayoutId = string

/** Boards that light and number their modes alike (src-tauri/src/boards.rs). */
export type Family = 'air75' | 'air' | 'kick' | 'node' | 'halo'

/** What sits in the top-right corner, unlit: a knob, Kick75's round knob, or Node's touch bar. */
export type Accessory = { kind: 'knob' | 'roundknob' | 'touchbar'; x: number; y: number; w: number; h: number }

export type Key = {
  id: string
  led: number
  label: string
  /** A second, smaller legend (shifted symbol or function). */
  sub?: string
  /** An icon printed on the cap (see components/icons.tsx). */
  icon?: string
  /** Tooltip name, when it isn't the shared one in NAMES. */
  name?: string
  x: number
  y: number
  w: number
  /** Rows tall (ISO Enter: 2). */
  h?: number
  /** Width of a tall key's lower part, flush right (ISO Enter: 1.25). */
  w2?: number
  row: number
}

export type Board = {
  id: LayoutId
  /** The layout as people say it: "ANSI", "ISO", "JIS". */
  name: string
  /** "Air75 V3", "Node75 LP". */
  model: string
  /** Model and layout, e.g. "Air65 V3 ISO" (just the model for ANSI). */
  title: string
  family: Family
  /** Experimental boards are read until the user turns on experimental lighting. */
  status: 'supported' | 'experimental'
  pid: number
  /** Size in key units. */
  width: number
  height: number
  accessory: Accessory | null
  sideLeds: number
  keys: Key[]
  byId: Map<string, Key>
  byLed: Map<number, Key>
  /** How many key LEDs the frame has (ANSI has one spare after its last key). */
  keyLeds: number
  /** LED range [start, end) of each row, as the engine paints row-based themes. */
  rows: [number, number][]
  /** Keymap data index -> key id (see keycodes.ts MATRIX). Empty where Keylight can't remap keys yet. */
  matrix: readonly (string | null)[]
  /** Stock keymap, 8 layers x 98 words. Empty where Keylight can't remap keys yet. */
  defaults: readonly (readonly number[])[]
  /** The key Karabiner turns into Hyper (Right ⌘). JIS has no Right ⌘. */
  hyperKey: string | null
}

export const WIDTH = 16
export const HEIGHT = 6

type Spec = [id: string, label: string, w?: number, sub?: string] | number
type Tall = { h: number; w2: number }

const FN_ROW: Spec[] = [
  ['esc', 'esc', 1, '@dot'],
  ['f1', 'F1', 1, '@sun-small'], ['f2', 'F2', 1, '@sun-large'], ['f3', 'F3', 1, '@mission'], ['f4', 'F4', 1, '@search'],
  ['f5', 'F5', 1, '@mic'], ['f6', 'F6', 1, '@bell'], ['f7', 'F7', 1, '@rewind'], ['f8', 'F8', 1, '@play-pause'],
  ['f9', 'F9', 1, '@forward'], ['f10', 'F10', 1, '@mute'], ['f11', 'F11', 1, '@vol-down'], ['f12', 'F12', 1, '@vol-up'],
  ['screenshot', '', 1, '@screenshot'], ['ins', '', 1, '@dot'],
]
const LETTERS_Q: Spec[] = [['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P']]
const LETTERS_A: Spec[] = [['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L']]
const LETTERS_Z: Spec[] = [['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M']]
const MAC_MODS: Spec[] = [['lctrl', 'CTRL', 1.25], ['lopt', 'OPT', 1.25], ['lcmd', 'CMD', 1.25]]
const ARROWS: Spec[] = [['left', '←'], ['down', '↓'], ['right', '→']]

/** Number row legends 1-9: [shifted symbol] per layout. */
const digits = (shifted: string) => [...shifted].map((s, i): Spec => [`${i + 1}`, `${i + 1}`, 1, s])

// As printed on the stock keycaps. The top-right corner is the knob, which has no light.
const ANSI_ROWS: Spec[][] = [
  FN_ROW,
  [['`', '`', 1, '~'], ...digits('!@#$%^&*('), ['0', '0', 1, ')'], ['-', '–', 1, '_'], ['=', '=', 1, '+'], ['bksp', 'BACKSPACE', 2], ['pgup', 'PGUP']],
  [['tab', 'TAB', 1.5], ...LETTERS_Q, ['[', '[', 1, '{'], [']', ']', 1, '}'], ['\\', '\\', 1.5, '|'], ['pgdn', 'PGDN']],
  [['caps', 'CAPS', 1.75], ...LETTERS_A, [';', ';', 1, ':'], ["'", "'", 1, '"'], ['enter', 'ENTER', 2.25], ['home', 'HOME']],
  [['lshift', 'SHIFT', 2.25], ...LETTERS_Z, [',', ',', 1, '<'], ['.', '.', 1, '>'], ['/', '/', 1, '?'], ['rshift', 'SHIFT', 1.75], ['up', '↑'], ['end', 'END']],
  [...MAC_MODS, ['space', '', 6.25], ['rcmd', 'CMD'], ['fn', 'FN'], ['rctrl', 'CTRL'], ...ARROWS],
]

// ISO, with UK legends (NuPhy sells ISO-UK and ISO-DE). Enter is two rows tall; the key left of it
// sends Backslash (0x31, printed # ~) and the extra key by left Shift sends Non-US Backslash (0x64).
const ISO_ROWS: Spec[][] = [
  FN_ROW,
  [['`', '`', 1, '¬'], ...digits('!"£$%^&*('), ['0', '0', 1, ')'], ['-', '–', 1, '_'], ['=', '=', 1, '+'], ['bksp', 'BACKSPACE', 2], ['pgup', 'PGUP']],
  [['tab', 'TAB', 1.5], ...LETTERS_Q, ['[', '[', 1, '{'], [']', ']', 1, '}'], ['enter', 'ENTER', 1.5], ['pgdn', 'PGDN']],
  [['caps', 'CAPS', 1.75], ...LETTERS_A, [';', ';', 1, ':'], ["'", "'", 1, '@'], ['\\', '#', 1, '~'], 1.25, ['home', 'HOME']],
  [['lshift', 'SHIFT', 1.25], ['nubs', '\\', 1, '|'], ...LETTERS_Z, [',', ',', 1, '<'], ['.', '.', 1, '>'], ['/', '/', 1, '?'], ['rshift', 'SHIFT', 1.75], ['up', '↑'], ['end', 'END']],
  ANSI_ROWS[5],
]

// JIS, as on NuPhy's Japanese board: 1u Backspace with ¥ beside it, ISO-style Enter, 2u left Shift,
// ろ and a 1u right Shift, and 無変換 / 4.25u space / 変換 / かな with no Right ⌘. Ids follow the
// usage each key sends: the key printed `@` sends `[` (0x2F), `[` sends `]` (0x30), `]` sends 0x32.
const JIS_ROWS: Spec[][] = [
  FN_ROW,
  [['`', 'E/J'], ...digits('!"#$%&\'()'), ['0', '0'], ['-', '–', 1, '='], ['=', '^', 1, '~'], ['yen', '¥', 1, '|'], ['bksp', 'BKSP'], ['pgup', 'PGUP']],
  [['tab', 'TAB', 1.5], ...LETTERS_Q, ['[', '@', 1, '`'], [']', '[', 1, '{'], ['enter', 'ENTER', 1.5], ['pgdn', 'PGDN']],
  [['caps', 'CAPS', 1.75], ...LETTERS_A, [';', ';', 1, '+'], ["'", ':', 1, '*'], ['nuhs', ']', 1, '}'], 1.25, ['home', 'HOME']],
  [['lshift', 'SHIFT', 2], ...LETTERS_Z, [',', ',', 1, '<'], ['.', '.', 1, '>'], ['/', '/', 1, '?'], ['ro', '\\', 1, '_'], ['rshift', 'SHIFT'], ['up', '↑'], ['end', 'END']],
  [['lctrl', 'CTRL', 1.25], ['lopt', 'OPT'], ['lcmd', 'CMD', 1.25], ['mhen', '無変換'], ['space', '', 4.25], ['henk', '変換'], ['kana', 'KANA', 1.25], ['fn', 'FN'], ['rctrl', 'CTRL'], ...ARROWS],
]

/** Plain-language names for tooltips and lists. */
const NAMES: Record<string, string> = {
  esc: 'Escape', screenshot: 'Screenshot', ins: 'Insert', '`': 'Backtick', bksp: 'Backspace', pgup: 'Page Up',
  tab: 'Tab', '\\': 'Backslash', pgdn: 'Page Down', caps: 'Caps Lock', enter: 'Return', home: 'Home',
  lshift: 'Left Shift', rshift: 'Right Shift', up: 'Up', end: 'End', lctrl: 'Left Control', lopt: 'Left Option',
  lcmd: 'Left Command', space: 'Space', rcmd: 'Right Command', fn: 'Fn', rctrl: 'Right Control', left: 'Left',
  down: 'Down', right: 'Right', '-': 'Minus', '=': 'Equals', '[': 'Left Bracket', ']': 'Right Bracket',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
}

const ISO_NAMES: Record<string, string> = { '\\': 'Hash (#)', nubs: 'Backslash (ISO key)' }

const JIS_NAMES: Record<string, string> = {
  '`': 'Hankaku/Zenkaku (E/J)', '-': 'Minus', '=': 'Caret (^)', yen: 'Yen (¥)', '[': 'At (@)', ']': 'Left Bracket',
  "'": 'Colon', nuhs: 'Right Bracket', ro: 'Ro (ろ, \\ _)', mhen: 'Muhenkan (無変換)', henk: 'Henkan (変換)', kana: 'Kana (かな)',
}

/** ISO and JIS Enter: 1.5u on the Tab row, 1.25u on the Caps row. */
const TALL: Record<string, Tall> = { enter: { h: 2, w2: 1.25 } }

/** Keycaps that come in an accent colour on the stock Air75 V3. */
export const ACCENT: Record<string, string> = { esc: '#5fd3a6', ins: '#f4c84a' }

function build(rows: Spec[][], names: Record<string, string>, tall: Record<string, Tall> = {}): Key[] {
  const keys: Key[] = []
  let led = 0
  rows.forEach((row, y) => {
    let x = 0
    for (const spec of row) {
      if (typeof spec === 'number') {
        x += spec
        continue
      }
      const [id, label, w = 1, sub] = spec
      const icon = sub?.startsWith('@') ? sub.slice(1) : undefined
      keys.push({ id, led: led++, label: id === 'esc' ? '' : label, sub: icon ? undefined : sub, icon, name: names[id], x, y, w, ...tall[id], row: y })
      x += w
    }
  })
  return keys
}

type Meta = Omit<Board, 'keys' | 'byId' | 'byLed' | 'rows' | 'matrix' | 'defaults' | 'hyperKey' | 'keyLeds' | 'width' | 'height' | 'accessory'>

function board(meta: Meta, keys: Key[], keyLeds: number, rows: [number, number][], size: Pick<Board, 'width' | 'height' | 'accessory'>, matrix: Board['matrix'] = [], defaults: Board['defaults'] = []): Board {
  const byId = new Map(keys.map((k) => [k.id, k]))
  return { ...meta, ...size, keys, byId, byLed: new Map(keys.map((k) => [k.led, k])), keyLeds, rows, matrix, defaults, hyperKey: byId.has('rcmd') ? 'rcmd' : null }
}

/** LED range [start, end) of each row of a hand-drawn board; the last row runs to keyLeds. */
function rowsOf(keys: Key[], keyLeds: number): [number, number][] {
  return Array.from({ length: HEIGHT }, (_, r): [number, number] => {
    const leds = keys.filter((k) => k.row === r).map((k) => k.led)
    return [Math.min(...leds), r === HEIGHT - 1 ? keyLeds : Math.max(...leds) + 1]
  })
}

type Generated = {
  id: string
  pid: number
  model: string
  variant: string
  family: Family
  status: 'supported' | 'experimental'
  keyLeds: number
  sideLeds: number
  width?: number
  height?: number
  accessory?: Accessory | null
  rows?: [number, number][]
  /** [id, led, x, y, w, h?, w2?] */
  keys?: (string | number)[][]
}

const DATA = (generated as { boards: Generated[] }).boards
const metaOf = (g: Generated): Meta => ({
  id: g.id,
  name: g.variant,
  model: g.model,
  title: g.variant === 'ANSI' ? g.model : `${g.model} ${g.variant}`,
  family: g.family,
  status: g.status,
  pid: g.pid,
  sideLeds: g.sideLeds,
})

/** The Air75 V3, drawn by hand. Its knob sits top right and has no light. */
function air75(id: 'ansi' | 'iso' | 'jis', keys: Key[], matrix: Board['matrix'], defaults: Board['defaults']): Board {
  const g = DATA.find((b) => b.id === id)!
  const size = { width: WIDTH, height: HEIGHT, accessory: { kind: 'knob', x: 15, y: 0, w: 1, h: 1 } as Accessory }
  return board(metaOf(g), keys, g.keyLeds, rowsOf(keys, g.keyLeds), size, matrix, defaults)
}

const AIR75: Board[] = [
  air75('ansi', build(ANSI_ROWS, {}), MATRIX, DEFAULT_LAYERS),
  air75('iso', build(ISO_ROWS, ISO_NAMES, TALL), ISO_MATRIX, ISO_DEFAULT_LAYERS),
  air75('jis', build(JIS_ROWS, JIS_NAMES, TALL), JIS_MATRIX, JIS_DEFAULT_LAYERS),
]

/** Legends for keys the Air75 V3 doesn't have: [label, tooltip name]. */
const EXTRA: Record<string, [string, string]> = {
  del: ['DEL', 'Delete'], ropt: ['OPT', 'Right Option'], numlock: ['NUM', 'Num Lock'], 'kp/': ['/', 'Keypad /'], 'kp*': ['*', 'Keypad *'],
  'kp-': ['–', 'Keypad –'], 'kp+': ['+', 'Keypad +'], kpenter: ['ENTER', 'Keypad Enter'], 'kp.': ['.', 'Keypad .'], calc: ['CALC', 'Calculator'],
  scrlk: ['SCRLK', 'Scroll Lock'], pause: ['PAUSE', 'Pause'], menu: ['MENU', 'Menu'], flex: ['SHIFT', 'Flex key'], desktop: ['DESK', 'Show desktop'],
  ctrlcenter: ['CC', 'Control Center'], taskmgr: ['TASK', 'Task Manager'], lock: ['LOCK', 'Lock screen'], winlock: ['WIN', 'Windows key lock'],
  stop: ['STOP', 'Stop'], next: ['NEXT', 'Next track'], prev: ['PREV', 'Previous track'], play: ['PLAY', 'Play/Pause'],
  'light-up': ['LT+', 'Brighter'], 'light-down': ['LT–', 'Dimmer'], light: ['LT', 'Lights on/off'], 'color-loop': ['RGB', 'Next colour'],
}
for (let i = 0; i <= 9; i++) EXTRA[`kp${i}`] = [`${i}`, `Keypad ${i}`]
for (let i = 13; i <= 24; i++) EXTRA[`f${i}`] = [`F${i}`, `F${i}`]

/** A generated board's key: placed and lit as NuPhy IO says, with the Air75 V3's legend for its id. */
function generatedKey(spec: (string | number)[], rows: [number, number][], legends: Map<string, Key>[]): Key {
  const [id, led, x, y, w, h, w2] = spec as [string, number, number, number, number, number?, number?]
  const base = id.replace(/-\d+$/, '') // a second Space is "space-2"
  const known = legends.map((m) => m.get(base)).find(Boolean)
  const extra = EXTRA[base]
  const row = Math.max(0, rows.findIndex(([a, b]) => led >= a && led < b))
  const label = known ? known.label : (extra?.[0] ?? base.toUpperCase())
  return { id, led, label, sub: known?.sub, icon: known?.icon, name: known?.name ?? extra?.[1], x, y, w, ...(h && h !== 1 ? { h } : {}), ...(w2 ? { w2 } : {}), row }
}

const LEGENDS = { ANSI: AIR75[0].byId, ISO: AIR75[1].byId, JIS: AIR75[2].byId }

const OTHERS: Board[] = DATA.filter((g) => g.keys).map((g) => {
  const rows = g.rows!
  const order = g.variant === 'JIS' ? [LEGENDS.JIS, LEGENDS.ISO, LEGENDS.ANSI] : g.variant === 'ISO' ? [LEGENDS.ISO, LEGENDS.ANSI] : [LEGENDS.ANSI]
  const keys = g.keys!.map((k) => generatedKey(k, rows, order))
  return board(metaOf(g), keys, g.keyLeds, rows, { width: g.width!, height: g.height!, accessory: g.accessory ?? null })
})

export const BOARDS: Record<LayoutId, Board> = Object.fromEntries([...AIR75, ...OTHERS].map((b) => [b.id, b]))

export const isLayout = (v: unknown): v is LayoutId => typeof v === 'string' && v in BOARDS

/** The boards that are the same keyboard in another layout (ANSI, ISO, JIS), this one included. */
export const variants = (b: Board) => Object.values(BOARDS).filter((o) => o.model === b.model)

export function keyName(k: Key) {
  return k.name ?? NAMES[k.id] ?? k.label
}

export function center(k: Key) {
  return { cx: k.x + k.w / 2, cy: k.y + 0.5 }
}

/** The key in the same row whose centre is nearest the mirror image of this one's. */
export function mirror(k: Key, keys: Key[], width = WIDTH): Key {
  const target = width - center(k).cx
  let best = k
  let gap = Infinity
  for (const other of keys) {
    if (other.row !== k.row) continue
    const d = Math.abs(center(other).cx - target)
    if (d < gap) {
      gap = d
      best = other
    }
  }
  return best
}
