/**
 * Advanced keys: SOCD pairs, Tap Dance and Toggle (docs/KEYMAP.md §5).
 *
 * Each type has a table on the keyboard, a Mac half then a Windows half of 32 entries, multi-byte
 * fields big-endian:
 *   SOCD       0xB5/0xB6  256 B  entry at 128m + 4s  [codeHi, codeLo, partnerSlot, priority]
 *   Tap Dance  0xB8/0xB9  512 B  entry at 256m + 8s  [tap, double tap, hold, delay ms] as u16s
 *   Toggle     0xBB/0xBC  128 B  entry at  64m + 2s  [codeHi, codeLo]
 * A key holds one with the word [0x7F, id]: SOCD id = s, Tap Dance 64 + s, Toggle 128 + s. The id
 * has no OS-mode offset; the keyboard picks the half from its current mode.
 *
 * A slot is free when no key word in that mode references it, whatever the entry holds. Entries
 * are written one at a time at their own offset, and cleared with zeros when nothing uses them.
 */
import { backupOnce, daemon } from './api'
import { advancedCode, decode, KEYCODES, keycode, type AdvancedType, type KeyCode } from './keycodes'
import { BOARDS } from './layout'

export type Os = 0 | 1
export type { AdvancedType }
export const SLOTS = 32
export const TYPES: AdvancedType[] = ['socd', 'tapdance', 'tgl']

export const TABLES: Record<AdvancedType, { total: number; entry: number }> = {
  socd: { total: 256, entry: 4 },
  tapdance: { total: 512, entry: 8 },
  tgl: { total: 128, entry: 2 },
}

export const TYPE_NAMES: Record<AdvancedType, { short: string; name: string; plural: string }> = {
  socd: { short: 'SOCD', name: 'SOCD pair', plural: 'SOCD pairs' },
  tapdance: { short: 'TD', name: 'Tap Dance', plural: 'Tap Dance keys' },
  tgl: { short: 'TGL', name: 'Toggle', plural: 'Toggle keys' },
}

/** The three tables as read with the `advanced` op, both OS modes each. */
export type Tables = Record<AdvancedType, number[]>

/** A key position: layer within the mode (0 base, 1-3 Fn) and matrix index. */
export type Ref = { sub: number; index: number }

/** One OS mode's four layers (with their stock words) and the tables. */
export type Mode = { layers: number[][]; defaults: number[][]; tables: Tables }

export type Op = { op: 'key_set'; layer: number; index: number; word: number } | { op: 'advanced_write'; table: AdvancedType; offset: number; bytes: number[] }

// ---- entries ---------------------------------------------------------------------------------

export function entryOffset(type: AdvancedType, os: Os, slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) throw new Error(`slot ${slot} is outside 0–31`)
  const t = TABLES[type]
  return os * (t.total / 2) + slot * t.entry
}

export function entryBytes(tables: Tables, type: AdvancedType, os: Os, slot: number): number[] {
  const at = entryOffset(type, os, slot)
  return tables[type].slice(at, at + TABLES[type].entry)
}

const u16 = (b: number[], i: number) => ((b[i] << 8) | b[i + 1]) & 0xffff
const be = (v: number) => [(v >> 8) & 0xff, v & 0xff]

export type Socd = { code: number; partner: number; prio: 0 | 1 }
export type TapDance = { tap: number; double: number; hold: number; delay: number }
export type Toggle = { code: number }

export const readSocd = (b: number[]): Socd => ({ code: u16(b, 0), partner: b[2], prio: b[3] ? 1 : 0 })
export const readTapDance = (b: number[]): TapDance => ({ tap: u16(b, 0), double: u16(b, 2), hold: u16(b, 4), delay: u16(b, 6) })
export const readToggle = (b: number[]): Toggle => ({ code: u16(b, 0) })

export const socdAt = (t: Tables, os: Os, slot: number) => readSocd(entryBytes(t, 'socd', os, slot))
export const tapDanceAt = (t: Tables, os: Os, slot: number) => readTapDance(entryBytes(t, 'tapdance', os, slot))
export const toggleAt = (t: Tables, os: Os, slot: number) => readToggle(entryBytes(t, 'tgl', os, slot))

export function encodeSocd(e: Socd): number[] {
  if (!socdOutput(e.code)) throw new Error(`An SOCD key can’t send ${actionName(e.code, 0)}.`)
  if (!Number.isInteger(e.partner) || e.partner < 0 || e.partner >= SLOTS) throw new Error('An SOCD partner must be in slot 0–31.')
  return [...be(e.code), e.partner, e.prio ? 1 : 0]
}

/** The keyboard treats anything up to 100 ms as 100. */
export const MIN_DELAY = 100
export const MAX_DELAY = 1000
export const DEFAULT_DELAY = 170

export function encodeTapDance(e: TapDance, os: Os): number[] {
  const why = tapDanceProblem(e, os)
  if (why) throw new Error(why)
  return [...be(e.tap), ...be(e.double), ...be(e.hold), ...be(e.delay)]
}

export function encodeToggle(e: Toggle, os: Os): number[] {
  if (!actionOk(e.code, os) || e.code === 0) throw new Error(`A Toggle key can’t send ${actionName(e.code, os)}.`)
  return be(e.code)
}

export function tapDanceProblem(e: TapDance, os: Os): string | null {
  if (!e.tap) return 'Pick what a tap does.'
  for (const [what, c] of [['tap', e.tap], ['double tap', e.double], ['hold', e.hold]] as const)
    if (!actionOk(c, os)) return `A Tap Dance ${what} can’t send ${actionName(c, os)}.`
  if (!e.double && !e.hold) return 'Add a double tap or a hold. With only a tap, it’s a plain key.'
  if (!Number.isInteger(e.delay) || e.delay < MIN_DELAY || e.delay > MAX_DELAY) return `The hold time must be ${MIN_DELAY}–${MAX_DELAY} ms.`
  return null
}

// ---- what each type can send ------------------------------------------------------------------

/** The firmware keeps only the low byte of an SOCD output, so only one-byte keys work. */
export function socdOutput(code: number): boolean {
  const k = keycode(code)
  return code >= 0x04 && code <= 0xe7 && !!k && !k.hidden
}

/** This mode's Fn layers as MO(n), the absolute layer number the keymap uses. */
export const fnLayers = (os: Os) => [1, 2, 3].map((n) => 0x5220 | (os * 4 + n))

/**
 * Tap Dance and Toggle outputs: one-byte keys, MO(n) for this mode's Fn layers, and NuPhy's own
 * functions (0x7Exx). Macros, other advanced keys and other 16-bit codes aren't handled; the
 * firmware would send their low byte as a plain key. 0 means nothing.
 */
export function actionOk(code: number, os: Os): boolean {
  if (code === 0) return true
  if (fnLayers(os).includes(code)) return true
  const k = keycode(code)
  if (!k || k.hidden || k.danger) return false
  if (code >= 0x04 && code <= 0xe7) return true
  return code >= 0x7e00 && code <= 0x7e5b
}

const PICK_CATEGORIES = ['letter', 'number', 'symbol', 'fkey', 'modifier', 'navigation', 'editing', 'keypad', 'international', 'media', 'system', 'mouse', 'special', 'lighting', 'sidelight']

/** The Fn layers as picker entries, named the way the Keymap page names them. */
export function layerKeys(os: Os): KeyCode[] {
  return fnLayers(os).map((code, i) => ({ code, label: ['Fn', 'Fn 2', 'Fn 3'][i], name: `${['Fn', 'Fn 2', 'Fn 3'][i]} layer`, category: 'layer' }))
}

/** What a Tap Dance or Toggle can send, for the pickers. */
export function actionKeys(os: Os): KeyCode[] {
  return [...KEYCODES.filter((k) => k.code > 1 && PICK_CATEGORIES.includes(k.category) && actionOk(k.code, os)), ...layerKeys(os)]
}

/** The keys an SOCD pair can send. */
export const SOCD_KEYS: KeyCode[] = KEYCODES.filter((k) => socdOutput(k.code))

export function actionLabel(code: number, os: Os): { label: string; name: string } {
  if (code === 0) return { label: '—', name: 'Nothing' }
  const layer = layerKeys(os).find((k) => k.code === code)
  if (layer) return { label: layer.label, name: layer.name }
  const d = decode(code >> 8, code & 0xff)
  return { label: d.label || '—', name: d.name }
}

export const actionName = (code: number, os: Os) => actionLabel(code, os).name

// ---- who uses which slot ----------------------------------------------------------------------

export type Refs = Record<AdvancedType, Map<number, Ref[]>>

/** Keymap positions that are a key on any layout. A slot used only by an ISO or JIS key still counts as taken. */
const REAL = new Set(Object.values(BOARDS).flatMap((b) => b.matrix.flatMap((id, i) => (id ? [i] : []))))

/** Advanced key words on this mode's four layers, by type and slot. */
export function references(layers: number[][]): Refs {
  const out: Refs = { socd: new Map(), tapdance: new Map(), tgl: new Map() }
  layers.forEach((keys, sub) =>
    keys.forEach((w, index) => {
      const a = advancedOf(w)
      if (!a || !REAL.has(index)) return
      const list = out[a.type].get(a.slot) ?? []
      list.push({ sub, index })
      out[a.type].set(a.slot, list)
    }),
  )
  return out
}

export function advancedOf(word: number): { type: AdvancedType; slot: number } | null {
  if (word >> 8 !== 0x7f) return null
  const d = decode(0x7f, word & 0xff)
  if (d.kind !== 'advanced' || d.index === undefined || d.index >= SLOTS) return null
  return { type: d.advanced!, slot: d.index }
}

/** The first `n` slots no key in the mode references. */
export function freeSlots(refs: Refs, type: AdvancedType, n: number): number[] {
  const out: number[] = []
  for (let s = 0; s < SLOTS && out.length < n; s++) if (!refs[type].has(s)) out.push(s)
  if (out.length < n) throw new Error(`All 32 ${TYPE_NAMES[type].name} slots are in use in this mode.`)
  return out
}

// ---- plans: the writes for each change, in a safe order ---------------------------------------

const keyWrite = (os: Os, r: Ref, word: number): Op => ({ op: 'key_set', layer: os * 4 + r.sub, index: r.index, word })
const entryWrite = (type: AdvancedType, os: Os, slot: number, bytes: number[]): Op => ({ op: 'advanced_write', table: type, offset: entryOffset(type, os, slot), bytes })

export type Priority = 'last' | 'a' | 'b' | 'none'
export const PRIORITY_BITS: Record<Priority, [0 | 1, 0 | 1]> = { last: [1, 1], a: [1, 0], b: [0, 1], none: [0, 0] }

export function priorityOf(a: 0 | 1, b: 0 | 1): Priority {
  return a && b ? 'last' : a ? 'a' : b ? 'b' : 'none'
}

/** A new SOCD pair: each key's entry at its own offset, then both key words. */
export function planSocd(os: Os, refs: Refs, keys: [Ref, Ref], codes: [number, number], prio: Priority): { ops: Op[]; slots: [number, number] } {
  const [sa, sb] = freeSlots(refs, 'socd', 2)
  const [pa, pb] = PRIORITY_BITS[prio]
  return {
    slots: [sa, sb],
    ops: [
      entryWrite('socd', os, sa, encodeSocd({ code: codes[0], partner: sb, prio: pa })),
      entryWrite('socd', os, sb, encodeSocd({ code: codes[1], partner: sa, prio: pb })),
      keyWrite(os, keys[0], advancedCode('socd', sa)),
      keyWrite(os, keys[1], advancedCode('socd', sb)),
    ],
  }
}

/** A new Tap Dance or Toggle on one key: the entry, then the key word. */
export function planSingle(os: Os, refs: Refs, type: 'tapdance' | 'tgl', key: Ref, bytes: number[]): { ops: Op[]; slot: number } {
  const [slot] = freeSlots(refs, type, 1)
  return { slot, ops: [entryWrite(type, os, slot, bytes), keyWrite(os, key, advancedCode(type, slot))] }
}

/** Changes an existing entry in place; the keys keep pointing at it. */
export const planEdit = (os: Os, type: AdvancedType, slot: number, bytes: number[]): Op[] => [entryWrite(type, os, slot, bytes)]

/**
 * After keys that held `oldWords` were given something else (`mode` already shows that): clears
 * the entries nothing references any more. An SOCD key left without its other half goes back to
 * typing its own key, so it can't pair up with whatever takes the freed slot next.
 */
export function planCleanup(os: Os, mode: Mode, oldWords: number[]): Op[] {
  const refs = references(mode.layers)
  const keys: Op[] = []
  const clear = new Map<string, Op>()
  const zero = (type: AdvancedType, slot: number) => {
    if (entryBytes(mode.tables, type, os, slot).some((b) => b !== 0)) clear.set(`${type}:${slot}`, entryWrite(type, os, slot, new Array(TABLES[type].entry).fill(0)))
  }
  for (const w of oldWords) {
    const a = advancedOf(w)
    if (!a || refs[a.type].has(a.slot)) continue
    if (a.type === 'socd') {
      const p = socdAt(mode.tables, os, a.slot).partner
      if (p < SLOTS && p !== a.slot && socdAt(mode.tables, os, p).partner === a.slot) {
        const back = socdAt(mode.tables, os, p).code
        for (const r of refs.socd.get(p) ?? []) keys.push(keyWrite(os, r, socdOutput(back) ? back : mode.defaults[r.sub][r.index]))
        zero('socd', p)
      }
    }
    zero(a.type, a.slot)
  }
  const zeros = [...clear.values()] as Extract<Op, { op: 'advanced_write' }>[]
  return [...keys, ...zeros.sort((x, y) => x.table.localeCompare(y.table) || x.offset - y.offset)]
}

/** Removes an advanced key: its keys go back to `restore`, then its entries are cleared. */
export function planRemove(os: Os, mode: Mode, keys: { ref: Ref; word: number; restore: number }[]): Op[] {
  const ops = keys.map((k) => keyWrite(os, k.ref, k.restore))
  const after = withOps(os, mode, ops)
  return [...ops, ...planCleanup(os, after, keys.map((k) => k.word))]
}

/** `mode` as it will be once `ops` are written. */
export function withOps(os: Os, mode: Mode, ops: Op[]): Mode {
  const layers = mode.layers.map((l) => [...l])
  const tables = { socd: [...mode.tables.socd], tapdance: [...mode.tables.tapdance], tgl: [...mode.tables.tgl] }
  for (const o of ops) {
    if (o.op === 'key_set' && Math.floor(o.layer / 4) === os) layers[o.layer % 4][o.index] = o.word
    if (o.op === 'advanced_write') tables[o.table].splice(o.offset, o.bytes.length, ...o.bytes)
  }
  return { layers, defaults: mode.defaults, tables }
}

// ---- talking to the keyboard ------------------------------------------------------------------

export async function readTables(): Promise<Tables> {
  const t = await daemon<Tables>({ op: 'advanced' })
  for (const type of TYPES) if (t[type]?.length !== TABLES[type].total) throw new Error(`The ${TYPE_NAMES[type].name} table came back the wrong size.`)
  return t
}

export async function readMode(os: Os): Promise<Mode> {
  const layers: number[][] = []
  const defaults: number[][] = []
  for (let sub = 0; sub < 4; sub++) {
    const r = await daemon<{ keys: number[]; defaults: number[] | null }>({ op: 'keymap', layer: os * 4 + sub })
    layers.push(r.keys)
    defaults.push(r.defaults ?? r.keys)
  }
  return { layers, defaults, tables: await readTables() }
}

/**
 * Backs up (once per run), sends the writes in order, then reads everything back and checks it
 * landed. Returns the mode as the keyboard now has it.
 */
export async function apply(os: Os, ops: Op[]): Promise<Mode> {
  for (const o of ops) if (o.op === 'advanced_write') checkWrite(o)
  if (ops.length) await backupOnce()
  for (const o of ops) await daemon(o)
  const now = await readMode(os)
  for (const o of ops) {
    const ok =
      o.op === 'key_set'
        ? Math.floor(o.layer / 4) !== os || now.layers[o.layer % 4][o.index] === o.word
        : o.bytes.every((b, i) => now.tables[o.table][o.offset + i] === b)
    if (!ok) throw new Error('The keyboard didn’t keep every change. Its current state is shown.')
  }
  return now
}

/** The same rules the Rust side enforces, so a bad write fails before anything is sent. */
export function checkWrite(o: Extract<Op, { op: 'advanced_write' }>) {
  const t = TABLES[o.table]
  const half = t.total / 2
  if (o.bytes.length !== t.entry || o.offset % t.entry || o.offset < 0 || o.offset + t.entry > t.total || Math.floor(o.offset / half) !== Math.floor((o.offset + t.entry - 1) / half))
    throw new Error('Keylight built a write outside one entry, so it didn’t send it.')
  if (o.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) throw new Error('Keylight built a malformed entry, so it didn’t send it.')
}

// ---- words ------------------------------------------------------------------------------------

export const PRIORITIES: { value: Priority; label: (a: string, b: string) => string; help: (a: string, b: string) => string }[] = [
  { value: 'last', label: () => 'Last pressed wins', help: (a, b) => `Hold ${a}, then press ${b}: ${b} types. Let go of ${b} and ${a} types again.` },
  { value: 'a', label: (a) => `${a} wins`, help: (a, b) => `While ${a} is down, ${b} does nothing.` },
  { value: 'b', label: (_, b) => `${b} wins`, help: (a, b) => `While ${b} is down, ${a} does nothing.` },
  { value: 'none', label: () => 'Neither', help: () => 'Hold both and neither types.' },
]

/** "tap Esc · hold Ctrl", for lists and tooltips. */
export function describeTapDance(e: TapDance, os: Os): string {
  const parts = [`tap ${actionLabel(e.tap, os).label}`]
  if (e.double) parts.push(`double tap ${actionLabel(e.double, os).label}`)
  if (e.hold) parts.push(`hold ${actionLabel(e.hold, os).label}`)
  return parts.join(' · ')
}

export function describeToggle(e: Toggle, os: Os): string {
  return fnLayers(os).includes(e.code) ? `toggles the ${actionLabel(e.code, os).name}` : `toggles ${actionLabel(e.code, os).name}`
}

/**
 * What an advanced key word does, given the tables: a keycap legend, the type's short name for a
 * badge, a sentence for tooltips, and the part after the type ("tap Esc · hold Ctrl").
 */
export function describeWord(word: number, tables: Tables | null, os: Os): { label: string; badge: string; name: string; detail: string } | null {
  const a = advancedOf(word)
  if (!a) return null
  const badge = TYPE_NAMES[a.type].short
  const type = TYPE_NAMES[a.type].name
  if (!tables) return { label: badge, badge, name: type, detail: '' }
  if (a.type === 'socd') {
    const e = socdAt(tables, os, a.slot)
    const other = e.partner < SLOTS && e.partner !== a.slot ? socdAt(tables, os, e.partner) : null
    const detail = other && other.partner === a.slot ? `${actionLabel(e.code, os).label} paired with ${actionLabel(other.code, os).label}` : `${actionLabel(e.code, os).label}, other key missing`
    return { label: actionLabel(e.code, os).label, badge, name: `${type}: ${detail}`, detail }
  }
  if (a.type === 'tapdance') {
    const e = tapDanceAt(tables, os, a.slot)
    const detail = describeTapDance(e, os)
    return { label: actionLabel(e.tap, os).label, badge, name: `${type}: ${detail}`, detail }
  }
  const e = toggleAt(tables, os, a.slot)
  const detail = describeToggle(e, os)
  return { label: actionLabel(e.code, os).label, badge, name: `${type}: ${detail}`, detail }
}
