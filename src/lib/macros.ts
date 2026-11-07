/**
 * The keyboard's macro area: one 2048-byte block per OS mode (docs/KEYMAP.md §5).
 *
 *   bytes 0-63   32 little-endian u16 pointers, one per macro. A pointer <= 63 means empty.
 *   at a pointer 4-byte actions [delayLo, delayHi, flags, keycode] until one has the end flag.
 *                delay = ms to wait after this action; flags bit 6 = press (else release), bit 7 = last.
 *
 * Capacity is (2048 - 64) / 4 = 496 actions, shared by the 32 macros. The keyboard (and NuPhy IO)
 * read a macro whose first action already has the end flag as empty, so a one-action macro can't
 * be stored: `problems` refuses it and the editor offers to add the release.
 */
import { KEYCODES, keycode, type KeyCode } from './keycodes'

export const AREA_BYTES = 2048
export const HEADER_BYTES = 64
export const MACRO_COUNT = 32
export const CAPACITY = (AREA_BYTES - HEADER_BYTES) / 4
export const MAX_DELAY = 0xffff
/** Wait between actions when the recorder isn't keeping your timing, in ms. */
export const DEFAULT_DELAY = 10

const PRESS = 0x40
const END = 0x80

export type Action = { down: boolean; code: number; delay: number }
export type Macro = Action[]

/** Why a slot was read as empty although its pointer looked used. */
export type Issue = { id: number; reason: string }

export type Area = { macros: Macro[]; issues: Issue[] }

/** Reads a macro area the way the keyboard plays it. Slots that point at leftover data come back empty, with an issue. */
export function decodeArea(bytes: ArrayLike<number>): Area {
  if (bytes.length !== AREA_BYTES) throw new Error(`a macro area is ${AREA_BYTES} bytes, got ${bytes.length}`)
  const ptr = (id: number) => bytes[2 * id] | (bytes[2 * id + 1] << 8)
  const pointers = Array.from({ length: MACRO_COUNT }, (_, id) => ptr(id))
  const macros: Macro[] = []
  const issues: Issue[] = []
  for (let id = 0; id < MACRO_COUNT; id++) {
    const p = pointers[id]
    macros.push([])
    if (p < HEADER_BYTES || p === 0xffff) continue
    // NuPhy points every empty slot at the first free block. Real macros never share a block.
    if (pointers.some((q, other) => other !== id && q === p)) continue
    if (p + 4 > AREA_BYTES) {
      issues.push({ id, reason: 'points outside the macro area' })
      continue
    }
    const actions: Macro = []
    let bad: string | null = null
    for (let at = p; ; at += 4) {
      if (at + 4 > AREA_BYTES) {
        bad = 'has no end'
        break
      }
      const flags = bytes[at + 2]
      if (flags & ~(PRESS | END)) {
        bad = 'holds data that isn’t a macro'
        break
      }
      actions.push({ delay: bytes[at] | (bytes[at + 1] << 8), down: !!(flags & PRESS), code: bytes[at + 3] })
      if (flags & END) break
    }
    if (bad) issues.push({ id, reason: bad })
    // The reader quirk: an end flag on the first action means empty.
    else if (actions.length > 1) macros[id] = actions
  }
  return { macros, issues }
}

/** What stops these macros from being saved, if anything. */
export function problems(macros: Macro[]): string[] {
  const out: string[] = []
  if (macros.length !== MACRO_COUNT) out.push(`expected ${MACRO_COUNT} macros`)
  macros.forEach((m, id) => {
    if (m.length === 1) out.push(`M${id + 1} has one action, which won’t save.`)
    for (const a of m) {
      if (!Number.isInteger(a.code) || a.code < 0 || a.code > 0xff) out.push(`M${id + 1} has a key the keyboard can’t store.`)
      if (!Number.isInteger(a.delay) || a.delay < 0 || a.delay > MAX_DELAY) out.push(`M${id + 1} has a wait outside 0–${MAX_DELAY} ms.`)
    }
  })
  const used = usedActions(macros)
  if (used > CAPACITY) out.push(`${used - CAPACITY} actions over the keyboard’s ${CAPACITY}.`)
  return [...new Set(out)]
}

export const usedActions = (macros: Macro[]) => macros.reduce((n, m) => n + m.length, 0)

/**
 * Lays macros out as NuPhy IO does: packed from byte 64 in slot order, an end marker at the first
 * free byte, and every empty slot pointing at it. The rest is zero. Throws if `problems` finds any.
 */
export function encodeArea(macros: Macro[]): number[] {
  const why = problems(macros)
  if (why.length) throw new Error(why[0])
  const out = new Array<number>(AREA_BYTES).fill(0)
  const pointers: (number | null)[] = []
  let at = HEADER_BYTES
  macros.forEach((m) => {
    if (!m.length) return pointers.push(null)
    pointers.push(at)
    m.forEach((a, i) => {
      out[at] = a.delay & 0xff
      out[at + 1] = (a.delay >> 8) & 0xff
      out[at + 2] = (a.down ? PRESS : 0) | (i === m.length - 1 ? END : 0)
      out[at + 3] = a.code
      at += 4
    })
  })
  const free = at < AREA_BYTES ? at : 0xffff
  if (free !== 0xffff) out[free + 2] = END
  pointers.forEach((p, id) => {
    const v = p ?? free
    out[2 * id] = v & 0xff
    out[2 * id + 1] = (v >> 8) & 0xff
  })
  return out
}

/** Encodes and checks the result decodes back to exactly these macros. The bytes are safe to send. */
export function encodeChecked(macros: Macro[]): number[] {
  const bytes = encodeArea(macros)
  if (bytes.length !== AREA_BYTES || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) throw new Error('The macro data came out malformed.')
  const back = decodeArea(bytes)
  if (back.issues.length || !sameMacros(back.macros, macros)) throw new Error('The macro data didn’t read back the same, so Keylight didn’t send it.')
  return bytes
}

export const sameMacro = (a: Macro, b: Macro) => a.length === b.length && a.every((x, i) => x.down === b[i].down && x.code === b[i].code && x.delay === b[i].delay)
export const sameMacros = (a: Macro[], b: Macro[]) => a.length === b.length && a.every((m, i) => sameMacro(m, b[i]))
export const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (x: number, i: number) => x === b[i])

/** Total time a macro takes to play, in ms (the last wait doesn't count). */
export const duration = (m: Macro) => m.slice(0, -1).reduce((n, a) => n + a.delay, 0)

// ---- keys a macro can send ---------------------------------------------------------------

/** NuPhy IO allows keyboard keys, modifiers, mouse buttons and the wheel in macros (one byte each). */
const MACRO_CATEGORIES = ['letter', 'number', 'symbol', 'fkey', 'modifier', 'navigation', 'editing', 'keypad', 'international', 'mouse']

export const MACRO_KEYS: KeyCode[] = KEYCODES.filter((k) => k.code > 1 && k.code <= 0xff && !k.hidden && MACRO_CATEGORIES.includes(k.category))

export const MODIFIERS = new Set([0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7])

export function keyLabel(code: number): { label: string; name: string } {
  const k = keycode(code)
  if (k && code > 1) return { label: k.label, name: k.name }
  return { label: '0x' + code.toString(16).padStart(2, '0'), name: `Keycode 0x${code.toString(16).padStart(2, '0')}` }
}

/** `KeyboardEvent.code` -> HID usage, for the recorder. */
const BY_EVENT: Record<string, number> = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f,
  BracketRight: 0x30, Backslash: 0x31, IntlHash: 0x32, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36,
  Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Help: 0x49,
  Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51,
  ArrowUp: 0x52, NumLock: 0x53, NumpadClear: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56,
  NumpadAdd: 0x57, NumpadEnter: 0x58, NumpadDecimal: 0x63, IntlBackslash: 0x64, ContextMenu: 0x65, IntlRo: 0x87,
  KanaMode: 0x88, IntlYen: 0x89, Convert: 0x8a, NonConvert: 0x8b, Lang1: 0x90, Lang2: 0x91,
  ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
}

export function codeFromEvent(code: string): number | null {
  let m: RegExpMatchArray | null
  if ((m = code.match(/^Key([A-Z])$/))) return 0x04 + m[1].charCodeAt(0) - 65
  if ((m = code.match(/^Digit(\d)$/))) return m[1] === '0' ? 0x27 : 0x1e + +m[1] - 1
  if ((m = code.match(/^Numpad(\d)$/))) return m[1] === '0' ? 0x62 : 0x59 + +m[1] - 1
  if ((m = code.match(/^F(\d+)$/))) {
    const n = +m[1]
    if (n >= 1 && n <= 12) return 0x3a + n - 1
    if (n >= 13 && n <= 24) return 0x68 + n - 13
  }
  return BY_EVENT[code] ?? null
}

// ---- names, kept on this Mac (the keyboard has nowhere to store them) ------------------------

const NAMES_KEY = 'macro-names'

function readNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) || '{}')
  } catch {
    return {}
  }
}

export function macroName(os: 0 | 1, id: number): string {
  return readNames()[`${os}:${id}`] ?? ''
}

export function setMacroName(os: 0 | 1, id: number, name: string) {
  const all = readNames()
  if (name.trim()) all[`${os}:${id}`] = name.trim()
  else delete all[`${os}:${id}`]
  localStorage.setItem(NAMES_KEY, JSON.stringify(all))
}

/** "M3 · Hyper 3", or just "M3". */
export function macroTitle(os: 0 | 1, id: number) {
  const n = macroName(os, id)
  return n ? `M${id + 1} · ${n}` : `M${id + 1}`
}
