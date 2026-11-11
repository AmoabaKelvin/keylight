#!/usr/bin/env node
/**
 * Writes src/lib/boards.gen.json: every NuPhy IO (S4) board Keylight knows, with its PID, LED counts,
 * key matrix size and, for the boards not drawn by hand, each key's place and LED.
 *
 *   node scripts/gen-boards.mjs <NuPhy IO main.clean.js>
 *
 * Reads the layout arrays in NuPhy IO's web app (the `fe()` map, BOARDS-2026-11.md §6.3) and puts
 * each key's LED where NuPhy's `createLightMapping` does: position p gets LED p, minus `skipSize`
 * past `skipPos`. Only the generated data goes in the repo, never NuPhy's code.
 *
 * Positions are tidied into key units: NuPhy's arrays add about 0.04u of gap per key and per row,
 * so widths are rounded to 0.25u, keys in a row are laid end to end, and only real gaps (0.12u or
 * more) are kept, rounded to 0.25u. As a check, the Air75 V3 layouts are generated too and must give
 * exactly the key ids and LEDs Keylight draws by hand (src/lib/layout.ts, src-tauri/src/layout.rs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/gen-boards.mjs <path to NuPhy IO main.clean.js>')
  process.exit(1)
}
const lines = fs.readFileSync(src, 'utf8').split('\n')
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/boards.gen.json')

/**
 * Every S4 board. `layout` is the NuPhy IO variable and the line it starts on (main.clean.js).
 * keyLeds/sideLeds/skip are NuPhy IO's `lightCount` and `skipPos/skipSize` (RESEARCH-2026-11.md §1.2);
 * `lights` is what 0xD1 returns in NuPhy's current firmware, `matrix` what 0xA0 says (BOARDS §2.2,
 * §2.4); null where we have no firmware for that board. `status`: supported boards are written to as
 * before; experimental ones start read-only. `minFw`: the firmware the research traced for that family
 * (BOARDS §0); older firmware keeps the board read-only, since per-key mode was only confirmed there.
 */
const AIR75 = { family: 'air75', sideLeds: 20, skip: [14, 3], matrix: [6, 16, 2], status: 'supported', minFw: null }
const AIR65 = { family: 'air', sideLeds: 20, matrix: [5, 15, 2], status: 'experimental', minFw: '1.0.5.6' }
const AIR100 = { family: 'air', sideLeds: 20, skip: [12, 2], matrix: [6, 18, 2], status: 'experimental', minFw: '1.0.6.6' }
const KICK = { family: 'kick', sideLeds: 5, skip: [13, 3], matrix: [6, 15, 2], status: 'experimental', layout: ['E', 18739], keyLeds: 80, lights: 85, minFw: '4.0.18.6' }
const NODE75 = { family: 'node', sideLeds: 5, matrix: [6, 16, 5], status: 'experimental', minFw: '1.0.10.6' }
const NODE100 = { family: 'node', sideLeds: 5, matrix: [6, 19, 5], status: 'experimental', minFw: '1.0.7.6' }
const HALO = { family: 'halo', status: 'experimental', skip: null, minFw: '1.0.7.6' }

const BOARDS = [
  // Drawn by hand; generated only to check the generator.
  { id: 'ansi', pid: 0x1028, model: 'Air75 V3', variant: 'ANSI', ...AIR75, layout: ['m', 13914], keyLeds: 84, lights: 104, check: true },
  { id: 'iso', pid: 0x102a, model: 'Air75 V3', variant: 'ISO', ...AIR75, layout: ['g', 14280], keyLeds: 84, lights: 105, check: true },
  { id: 'jis', pid: 0x1029, model: 'Air75 V3', variant: 'JIS', ...AIR75, layout: ['A', 14653], keyLeds: 87, lights: 108, check: true },

  // Air65 ISO: NuPhy IO says 65 + 16 LEDs, but the firmware's 0xD1 says 89, which is the layout's
  // 69 key LEDs (71 positions, skip 2) + 20. NuPhy's light config for it looks wrong (BOARDS §2.2).
  { id: 'air65-v3', pid: 0x102b, model: 'Air65 V3', variant: 'ANSI', ...AIR65, layout: ['v', 12635], keyLeds: 68, skip: [13, 2], lights: 88 },
  { id: 'air65-v3-iso', pid: 0x1040, model: 'Air65 V3', variant: 'ISO', ...AIR65, layout: ['p', 12936], keyLeds: 69, skip: [13, 2], lights: 89 },
  { id: 'air65-v3-jis', pid: 0x1042, model: 'Air65 V3', variant: 'JIS', ...AIR65, layout: ['h', 13241], keyLeds: 72, skip: [14, 2], lights: null },
  { id: 'air100-v3', pid: 0x102d, model: 'Air100 V3', variant: 'ANSI', ...AIR100, layout: ['l', 11064], keyLeds: 99, lights: 119 },
  { id: 'air100-v3-iso', pid: 0x1039, model: 'Air100 V3', variant: 'ISO', ...AIR100, layout: ['d', 11491], keyLeds: 100, lights: null },
  { id: 'air100-v3-jis', pid: 0x103f, model: 'Air100 V3', variant: 'JIS', ...AIR100, layout: ['f', 11925], keyLeds: 103, lights: null },

  { id: 'kick75', pid: 0x1026, model: 'Kick75', variant: 'ANSI', ...KICK },
  { id: 'kick75-high', pid: 0x1027, model: 'Kick75 High', variant: 'ANSI', ...KICK },

  { id: 'node75', pid: 0x1030, model: 'Node75 LP', variant: 'ANSI', ...NODE75, layout: ['z', 21977], keyLeds: 84, skip: [15, 5], lights: 89 },
  // NuPhy IO says skip 14 for the Node75 ISO and 20/4 for the Node100 HP ISO, which leaves Delete
  // without an LED and gives a touch-bar slot one. Their ANSI and JIS siblings, with the same slots in
  // the same places, use 15/5 and 20/5; so do these. A tester's walk test settles it (BOARDS §6.4 d).
  { id: 'node75-iso', pid: 0x1034, model: 'Node75 LP', variant: 'ISO', ...NODE75, layout: ['H', 23507], keyLeds: 86, skip: [15, 5], lights: null },
  { id: 'node75-jis', pid: 0x1032, model: 'Node75 LP', variant: 'JIS', ...NODE75, layout: ['q', 23898], keyLeds: 89, skip: [15, 5], lights: null },
  { id: 'node75-hp', pid: 0x1031, model: 'Node75 HP', variant: 'ANSI', ...NODE75, layout: ['D', 22357], keyLeds: 82, skip: [14, 5], lights: 87 },
  { id: 'node75-hp-iso', pid: 0x1035, model: 'Node75 HP', variant: 'ISO', ...NODE75, layout: ['R', 22728], keyLeds: 83, skip: [14, 5], lights: null },
  { id: 'node75-hp-jis', pid: 0x1033, model: 'Node75 HP', variant: 'JIS', ...NODE75, layout: ['j', 23110], keyLeds: 87, skip: [14, 5], lights: null },
  { id: 'node100', pid: 0x1037, model: 'Node100 LP', variant: 'ANSI', ...NODE100, layout: ['M', 19092], keyLeds: 103, skip: [18, 5], lights: 108 },
  { id: 'node100-iso', pid: 0x103b, model: 'Node100 LP', variant: 'ISO', ...NODE100, layout: ['B', 21032], keyLeds: 104, skip: [18, 5], lights: null },
  { id: 'node100-jis', pid: 0x103c, model: 'Node100 LP', variant: 'JIS', ...NODE100, layout: ['I', 21498], keyLeds: 108, skip: [18, 5], lights: null },
  { id: 'node100-hp', pid: 0x1036, model: 'Node100 HP', variant: 'ANSI', ...NODE100, layout: ['N', 19550], keyLeds: 109, skip: [20, 5], lights: null },
  { id: 'node100-hp-iso', pid: 0x1038, model: 'Node100 HP', variant: 'ISO', ...NODE100, layout: ['O', 20034], keyLeds: 110, skip: [20, 5], lights: null },
  { id: 'node100-hp-jis', pid: 0x103a, model: 'Node100 HP', variant: 'JIS', ...NODE100, layout: ['P', 20525], keyLeds: 114, skip: [20, 5], lights: null },

  { id: 'halo65-v2', pid: 0x102f, model: 'Halo65 V2', variant: 'ANSI', ...HALO, layout: ['K', 16901], keyLeds: 67, sideLeds: 48, matrix: [5, 15, 2], lights: 115 },
  { id: 'halo75-v2', pid: 0x102c, model: 'Halo75 V2', variant: 'ANSI', ...HALO, layout: ['L', 17187], keyLeds: 83, sideLeds: 48, matrix: [6, 16, 2], lights: 131 },
  { id: 'halo75-v2-iso', pid: 0x1043, model: 'Halo75 V2', variant: 'ISO', ...HALO, layout: ['S', 17538], keyLeds: 84, sideLeds: 48, matrix: [6, 16, 2], lights: null },
  { id: 'halo96-v2', pid: 0x102e, model: 'Halo96 V2', variant: 'ANSI', ...HALO, layout: ['F', 17897], keyLeds: 99, sideLeds: 41, matrix: [6, 18, 2], lights: 140 },
  { id: 'halo96-v2-iso', pid: 0x1044, model: 'Halo96 V2', variant: 'ISO', ...HALO, layout: ['T', 18314], keyLeds: 101, sideLeds: 41, matrix: [6, 18, 2], lights: null },
]

/** NuPhy keycode name -> Keylight key id. Ids follow Mac mode: the Win key's place is Option. */
const IDS = {
  ESC: 'esc', ESCAPE: 'esc', FN_MAC_AREA_SCREENSHOT: 'screenshot', FN_WIN_AREA_SCREENSHOT: 'screenshot', INSERT: 'ins',
  DELETE: 'del', DEL: 'del', GRAVE: '`', MINUS: '-', MINS: '-', EQUAL: '=', EQL: '=', BACKSPACE: 'bksp', BSPC: 'bksp',
  PAGE_UP: 'pgup', PGUP: 'pgup', PAGE_DOWN: 'pgdn', PGDN: 'pgdn', TAB: 'tab', LEFT_BRACKET: '[', RIGHT_BRACKET: ']',
  BACKSLASH: '\\', BSLS: '\\', CAPS_LOCK: 'caps', SEMICOLON: ';', SCLN: ';', QUOTE: "'", QUOT: "'", ENTER: 'enter',
  ENT: 'enter', HOME: 'home', END: 'end', LSFT: 'lshift', LEFT_SHIFT: 'lshift', RSFT: 'rshift', RIGHT_SHIFT: 'rshift',
  COMMA: ',', COMM: ',', DOT: '.', SLASH: '/', SLSH: '/', UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right',
  LCTL: 'lctrl', LEFT_CTRL: 'lctrl', LGUI: 'lopt', LEFT_GUI: 'lopt', LALT: 'lcmd', LEFT_ALT: 'lcmd', SPACE: 'space',
  RALT: 'rcmd', RIGHT_ALT: 'rcmd', RGUI: 'ropt', RIGHT_GUI: 'ropt', FN1: 'fn', RCTL: 'rctrl', RIGHT_CTRL: 'rctrl',
  NONUS_BACKSLASH: 'nubs', NUBS: 'nubs', NONUS_HASH: 'nuhs', JYEN: 'yen', RO: 'ro', MHEN: 'mhen', HENK: 'henk', KANA: 'kana',
  NUM: 'numlock', PSLS: 'kp/', PAST: 'kp*', PMNS: 'kp-', PPLS: 'kp+', KP_ENTER: 'kpenter', KP_DOT: 'kp.', CALC: 'calc',
  SCROLL_LOCK: 'scrlk', PAUSE: 'pause', APPLICATION: 'menu', FN_COLOR_LOOP: 'color-loop',
  // Knob slots. On the Air65 and Air100, NuPhy's map gives one of them an LED (BOARDS §3.1).
  VOL_DOWN: 'knob-left', MUTE: 'knob-press', VOL_UP: 'knob-right', FN_FLEXO1: 'flex',
  FN_WIN_BACK_2_DESKTOP: 'desktop', FN_WIN_TASK_MANAGER: 'taskmgr', FN_WIN_CTRL_CENTER: 'ctrlcenter', FN_WIN_LOCK_SCREEN: 'lock',
  FN_WIN_KEY_LOCK: 'winlock', MEDIA_STOP: 'stop', MEDIA_NEXT: 'next', MEDIA_PREV: 'prev', PLAY: 'play', FN_LIGHT_UP: 'light-up',
  FN_LIGHT_DOWN: 'light-down', FN_LIGHT_TOGGLE: 'light',
}
for (let i = 1; i <= 24; i++) IDS[`F${i}`] = `f${i}`
for (let i = 0; i <= 9; i++) {
  IDS[`${i}`] = `${i}`
  IDS[`KP_${i}`] = `kp${i}`
}
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') IDS[c] = c.toLowerCase()

/** The Air75 V3 key order Keylight draws by hand (LED = index), to check the generator against. */
const FN = ['esc', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'screenshot', 'ins']
const NUM = ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=']
const QROW = ['tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']']
const AROW = ['caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"]
const ZROW = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/']
const BOTTOM = ['lctrl', 'lopt', 'lcmd', 'space', 'rcmd', 'fn', 'rctrl', 'left', 'down', 'right']
const EXPECTED = {
  ansi: [...FN, ...NUM, 'bksp', 'pgup', ...QROW, '\\', 'pgdn', ...AROW, 'enter', 'home', 'lshift', ...ZROW, 'rshift', 'up', 'end', ...BOTTOM],
  iso: [...FN, ...NUM, 'bksp', 'pgup', ...QROW, 'enter', 'pgdn', ...AROW, '\\', 'home', 'lshift', 'nubs', ...ZROW, 'rshift', 'up', 'end', ...BOTTOM],
  jis: [...FN, ...NUM, 'yen', 'bksp', 'pgup', ...QROW, 'enter', 'pgdn', ...AROW, 'nuhs', 'home', 'lshift', ...ZROW, 'ro', 'rshift', 'up', 'end', 'lctrl', 'lopt', 'lcmd', 'mhen', 'space', 'henk', 'kana', 'fn', 'rctrl', 'left', 'down', 'right'],
}

/** One NuPhy layout array, as plain objects. */
function parse([name, start]) {
  const first = lines[start - 1]
  if (!new RegExp(`^\\s*${name.replace('$', '\\$')} = \\[\\{$`).test(first)) throw new Error(`${name} isn't at line ${start}: ${first.trim()}`)
  let text = ''
  for (let i = start - 1; ; i++) {
    text += lines[i] + '\n'
    if (/\}\]\.map\(/.test(lines[i])) break
  }
  text = text
    .replace(/^\s*[\w$]+ = /, '')
    .replace(/\]\.map\([^)]*\)[,;]?\s*$/, ']')
    .replace(/s\.A\.(KC_\w+)/g, '"$1"')
    .replace(/!0/g, 'true')
    .replace(/!1/g, 'false')
    .replace(/([\s{,])([A-Za-z_]\w*):/g, '$1"$2":')
    .replace(/(^|[^\d])\.(\d)/g, (_, a, b) => `${a}0.${b}`)
    .replace(/"[\w$]+\.[\w$]+\.(\w+)"|[\w$]+\.[\w$]+\.(\w+)/g, (_, a, b) => `"${a ?? b}"`)
  return JSON.parse(text)
}

const q = (v, step = 0.25) => Math.round(v / step) * step
const round = (v) => Math.round(v * 1000) / 1000

/** What the board's accessory slots are: NuPhy puts them right after skipPos, with no LED. */
function accessory(family) {
  return family === 'node' ? 'touchbar' : family === 'kick' ? 'roundknob' : family === 'halo' ? 'none' : 'knob'
}

function generate(b) {
  const raw = parse(b.layout)
  const [skipPos, skipSize] = b.skip ?? [Infinity, 0]
  const ledOf = (p) => (p <= skipPos ? p : p > skipPos + skipSize ? p - skipSize : null)
  const entries = raw.map((e, p) => {
    const name = e.keyCode.replace(/^KC_/, '')
    const led = ledOf(p)
    const slot = led === null
    let id = slot ? null : IDS[name]
    if (!slot && !id) throw new Error(`${b.id}: no Keylight id for ${e.keyCode} (position ${p})`)
    return { p, name, id, led, x: e.x, y: e.y, w: e.w ?? 1, h: e.h ?? 1, hidden: !!e.hidden || e.x === undefined, tall: (e.h ?? 1) > 1.5 && /enter/i.test(e.keyIconName ?? e.keyBoxBorderIconName ?? '') }
  })
  // NuPhy's spare positions past the last LED, if any, don't light.
  // Every position past the skip has an LED, so the layout says how many key LEDs there are. Where
  // NuPhy IO's light config says more, the extra is a spare (Air75 ANSI paints one); where it says
  // fewer, NuPhy is wrong and the layout wins (Air65 ISO, BOARDS §2.2).
  const fromLayout = raw.length - skipSize
  if (fromLayout > b.keyLeds && !b.check) {
    console.warn(`  ${b.id}: layout has ${fromLayout} key LEDs, NuPhy IO's light config ${b.keyLeds}; using ${fromLayout}`)
    b.keyLeds = fromLayout
  }
  if (b.lights != null && b.lights < b.keyLeds + b.sideLeds) throw new Error(`${b.id}: 0xD1 says ${b.lights}, fewer than ${b.keyLeds} + ${b.sideLeds}`)

  // Rows from NuPhy's y (about 1.04 per row); then each row laid out left to right.
  const drawn = entries.filter((e) => !e.hidden && (e.led !== null || e.id === null))
  for (const e of drawn) {
    e.yu = q(e.y / 1.04)
    e.row = Math.round(e.yu)
  }
  for (const r of new Set(drawn.map((e) => e.row))) {
    const row = drawn.filter((e) => e.row === r && !(e.id === null && b.family === 'node')).sort((a, c) => a.x - c.x)
    let cursor = 0
    let prevEnd = 0
    for (const e of row) {
      const gap = e.x - prevEnd
      if (gap >= 0.12) cursor += q(gap)
      e.xu = cursor
      e.wu = Math.max(0.25, q(e.w))
      cursor += e.wu
      prevEnd = e.x + e.w
    }
  }
  // Tall keys (ISO Enter, keypad Enter and +) keep NuPhy's height in whole rows.
  for (const e of drawn) e.hu = e.h > 1.5 ? Math.round(e.h) : e.h < 0.9 ? q(e.h / 1.04) : 1

  const keys = drawn.filter((e) => e.led !== null)
  const ids = new Map()
  for (const k of keys) {
    const n = ids.get(k.id) ?? 0
    ids.set(k.id, n + 1)
    if (n) k.id = `${k.id}-${n + 1}`
  }

  let acc = null
  const kind = accessory(b.family)
  if (kind === 'touchbar') {
    const bar = raw.find((e) => e.keyCode === 'KC_MUTE' && !e.hidden && e.y < 0)
    if (!bar) throw new Error(`${b.id}: no touch bar`)
    // Centred over the keys it sits above, a little above the top row.
    const above = keys.filter((k) => k.row === 0 && k.x + k.w > bar.x && k.x < bar.x + bar.w)
    const x = above.length ? Math.min(...above.map((k) => k.xu)) : 12.75
    const right = above.length ? Math.max(...above.map((k) => k.xu + k.wu)) : 15.75
    acc = { kind, x: round(x), y: -0.75, w: round(right - x), h: 0.5 }
  } else if (kind !== 'none') {
    // The knob sits where NuPhy draws its first slot. Slots are hidden on some boards, so place it in
    // the row's gap: the first free unit after the keys in that row, at the slot's x if it's free.
    const first = raw[skipPos + 1]
    const row = Math.round(q((first.y ?? 0) / 1.04))
    const inRow = keys.filter((k) => k.row === row)
    const nuphyLeft = inRow.filter((k) => k.x < first.x)
    const x = nuphyLeft.length ? Math.max(...nuphyLeft.map((k) => k.xu + k.wu)) : 0
    const gap = nuphyLeft.length ? first.x - Math.max(...nuphyLeft.map((k) => k.x + k.w)) : 0
    acc = { kind, x: round(x + (gap >= 0.12 ? q(gap) : 0)), y: row, w: 1, h: 1 }
    // Keys right of the knob in the same row move over to make room for it.
    for (const k of inRow) if (k.x > first.x && k.xu < acc.x + 1) k.xu += 1
  }


  const top = Math.min(0, ...(acc ? [acc.y] : []))
  const width = Math.max(...keys.map((k) => k.xu + k.wu), acc ? acc.x + acc.w : 0)
  const height = Math.max(...keys.map((k) => k.yu + k.hu)) - top

  // Row themes paint by LED range, so each row is the run of LEDs from its first key to the next
  // row's. LEDs follow NuPhy's order, which is reading order except for a tall Enter that comes after
  // the key below-left of it (Air100 ISO); it counts with that row. A hidden slot with an LED (the
  // Air65/Air100 knob) counts with the key before it.
  const byPos = new Map(keys.map((k) => [k.p, k]))
  let running = -Infinity
  const themeRow = new Map()
  for (const e of entries.filter((e) => e.led !== null).sort((a, c) => a.led - c.led)) {
    const k = byPos.get(e.p)
    running = Math.max(running, k ? k.row : running)
    themeRow.set(e.led, running === -Infinity ? 0 : running)
  }
  const rows = [...new Set(themeRow.values())].sort((a, c) => a - c)
  const ranges = rows.map((r) => {
    const leds = [...themeRow].filter(([, row]) => row === r).map(([led]) => led)
    return [Math.min(...leds), Math.max(...leds) + 1]
  })
  ranges[ranges.length - 1][1] = b.keyLeds
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] !== ranges[i - 1][1]) throw new Error(`${b.id}: row ${i} LEDs ${ranges[i]} don't follow ${ranges[i - 1]}`)
  }
  if (ranges[0][0] !== 0) throw new Error(`${b.id}: LEDs don't start at 0`)

  if (b.check) {
    const got = keys.slice().sort((a, c) => a.led - c.led).map((k) => k.id)
    const want = EXPECTED[b.id]
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${b.id}: generated keys differ from layout.ts:\n${got}\n${want}`)
    if (keys.some((k, i) => k.led !== keys.slice().sort((a, c) => a.led - c.led).indexOf(k))) throw new Error(`${b.id}: LEDs aren't in order`)
  }

  return {
    width: round(width),
    height: round(height),
    accessory: acc && { ...acc, y: round(acc.y - top) },
    rows: ranges,
    // [id, led, x, y, w, h?, w2?]: h only for keys that aren't 1u tall, w2 for an ISO Enter's lower part
    keys: keys.sort((a, c) => a.led - c.led).map((k) => {
      const out = [k.id, k.led, round(k.xu), round(k.yu - top), round(k.wu)]
      if (k.hu !== 1 || k.tall) out.push(round(k.hu))
      if (k.tall) out.push(1.25)
      return out
    }),
  }
}

const result = []
for (const b of BOARDS) {
  const g = generate(b)
  const { layout, check, skip, matrix, ...meta } = b
  void layout
  console.log(`${b.id.padEnd(16)} ${String(g.keys.length).padStart(3)} keys, ${b.keyLeds} key LEDs, ${g.width} x ${g.height}u, ${g.accessory?.kind ?? 'no accessory'}`)
  if (check) continue
  result.push({ ...meta, skip, matrix: { rows: matrix[0], cols: matrix[1], extra: matrix[2] }, ...g })
}
// The Air75 V3 is drawn by hand; only its numbers go here.
const hand = BOARDS.filter((b) => b.check).map(({ layout, check, matrix, ...meta }) => (void layout, void check, { ...meta, matrix: { rows: matrix[0], cols: matrix[1], extra: matrix[2] } }))
const json = { note: 'Generated by scripts/gen-boards.mjs from NuPhy IO layout data. Do not edit.', boards: [...hand, ...result] }
fs.writeFileSync(out, JSON.stringify(json, null, 0).replace(/\{"id":/g, '\n{"id":').replace(/\]\]\}/g, ']]\n}') + '\n')
console.log(`wrote ${path.relative(process.cwd(), out)}`)
