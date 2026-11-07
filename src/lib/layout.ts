/**
 * The Air75 V3 (ANSI) as drawn on screen: every key's place in key units (1u = one alpha key),
 * its LED index, and the name the engine uses for it. 16u wide, 6 rows.
 */
export type Key = {
  id: string
  led: number
  label: string
  /** A second, smaller legend (shifted symbol or function). */
  sub?: string
  /** An icon printed on the cap (see components/icons.tsx). */
  icon?: string
  x: number
  y: number
  w: number
  row: number
}

export const WIDTH = 16
export const HEIGHT = 6
export const KEY_LEDS = 84

type Spec = [id: string, label: string, w?: number, sub?: string] | number

// As printed on the stock keycaps. The top-right corner is the knob, which has no light.
const ROWS: Spec[][] = [
  [
    ['esc', 'esc', 1, '@dot'],
    ['f1', 'F1', 1, '@sun-small'], ['f2', 'F2', 1, '@sun-large'], ['f3', 'F3', 1, '@mission'], ['f4', 'F4', 1, '@search'],
    ['f5', 'F5', 1, '@mic'], ['f6', 'F6', 1, '@bell'], ['f7', 'F7', 1, '@rewind'], ['f8', 'F8', 1, '@play-pause'],
    ['f9', 'F9', 1, '@forward'], ['f10', 'F10', 1, '@mute'], ['f11', 'F11', 1, '@vol-down'], ['f12', 'F12', 1, '@vol-up'],
    ['screenshot', '', 1, '@screenshot'], ['ins', '', 1, '@dot'],
  ],
  [
    ['`', '`', 1, '~'], ['1', '1', 1, '!'], ['2', '2', 1, '@'], ['3', '3', 1, '#'], ['4', '4', 1, '$'], ['5', '5', 1, '%'],
    ['6', '6', 1, '^'], ['7', '7', 1, '&'], ['8', '8', 1, '*'], ['9', '9', 1, '('], ['0', '0', 1, ')'], ['-', '–', 1, '_'],
    ['=', '=', 1, '+'], ['bksp', 'BACKSPACE', 2], ['pgup', 'PGUP'],
  ],
  [
    ['tab', 'TAB', 1.5], ['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'],
    ['o', 'O'], ['p', 'P'], ['[', '[', 1, '{'], [']', ']', 1, '}'], ['\\', '\\', 1.5, '|'], ['pgdn', 'PGDN'],
  ],
  [
    ['caps', 'CAPS', 1.75], ['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'],
    ['l', 'L'], [';', ';', 1, ':'], ["'", "'", 1, '"'], ['enter', 'ENTER', 2.25], ['home', 'HOME'],
  ],
  [
    ['lshift', 'SHIFT', 2.25], ['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M'],
    [',', ',', 1, '<'], ['.', '.', 1, '>'], ['/', '/', 1, '?'], ['rshift', 'SHIFT', 1.75], ['up', '↑'], ['end', 'END'],
  ],
  [
    ['lctrl', 'CTRL', 1.25], ['lopt', 'OPT', 1.25], ['lcmd', 'CMD', 1.25], ['space', '', 6.25],
    ['rcmd', 'CMD'], ['fn', 'FN'], ['rctrl', 'CTRL'], ['left', '←'], ['down', '↓'], ['right', '→'],
  ],
]

/** The knob in the top-right corner: no LED, so it's drawn but never lit. */
export const KNOB = { x: 15, y: 0 }

/** Keycaps that come in an accent colour on the stock board. */
export const ACCENT: Record<string, string> = { esc: '#5fd3a6', ins: '#f4c84a' }

function build(): Key[] {
  const keys: Key[] = []
  let led = 0
  ROWS.forEach((row, y) => {
    let x = 0
    for (const spec of row) {
      if (typeof spec === 'number') {
        x += spec
        continue
      }
      const [id, label, w = 1, sub] = spec
      const icon = sub?.startsWith('@') ? sub.slice(1) : undefined
      keys.push({ id, led: led++, label: id === 'esc' ? '' : label, sub: icon ? undefined : sub, icon, x, y, w, row: y })
      x += w
    }
  })
  return keys
}

export const KEYS = build()
export const BY_ID = new Map(KEYS.map((k) => [k.id, k]))
export const BY_LED = new Map(KEYS.map((k) => [k.led, k]))

/** Plain-language names for tooltips and lists. */
const NAMES: Record<string, string> = {
  esc: 'Escape', screenshot: 'Screenshot', ins: 'Insert', '`': 'Backtick', bksp: 'Backspace', pgup: 'Page Up',
  tab: 'Tab', '\\': 'Backslash', pgdn: 'Page Down', caps: 'Caps Lock', enter: 'Return', home: 'Home',
  lshift: 'Left Shift', rshift: 'Right Shift', up: 'Up', end: 'End', lctrl: 'Left Control', lopt: 'Left Option',
  lcmd: 'Left Command', space: 'Space', rcmd: 'Right Command', fn: 'Fn', rctrl: 'Right Control', left: 'Left',
  down: 'Down', right: 'Right', '-': 'Minus', '=': 'Equals', '[': 'Left Bracket', ']': 'Right Bracket',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
}

export function keyName(k: Key) {
  return NAMES[k.id] ?? k.label
}

export function center(k: Key) {
  return { cx: k.x + k.w / 2, cy: k.y + 0.5 }
}

/** The key in the same row whose centre is nearest the mirror image of this one's. */
export function mirror(k: Key): Key {
  const target = WIDTH - center(k).cx
  let best = k
  let gap = Infinity
  for (const other of KEYS) {
    if (other.row !== k.row) continue
    const d = Math.abs(center(other).cx - target)
    if (d < gap) {
      gap = d
      best = other
    }
  }
  return best
}
