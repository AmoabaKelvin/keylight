/**
 * Keymap vocabulary for the NuPhy Air75 V3 (ANSI, firmware 1.0.23.6), recovered from NuPhy IO
 * (drive.nuphy.io) and the firmware image. See docs/KEYMAP.md for sources and confidence.
 *
 * A key word on the wire (0xB1/0xB2/0xB3) is 2 bytes, high byte first:
 *   [0x77, id]                 macro id 0..31 (of the current OS mode)
 *   [0x7F, id]                 advanced key: SOCD 0..63, Tap Dance 64..127, Toggle (TGL) 128..191
 *   0x5220 | n                 MO(n): hold for layer n (absolute layer 0..7)
 *   anything else              a 16-bit QMK-style keycode ("self-dev" code in NuPhy IO)
 * `code` in KEYCODES is always that 16-bit wire word.
 */

export type KeyCode = {
  /** 16-bit wire word, as stored in the keymap. */
  code: number
  /** Short keycap legend, at most 6 characters. */
  label: string
  /** Longer human name for tooltips and lists. */
  name: string
  category: string
  /** NuPhy IO does not offer this code for the Air75 V3 (it only appears in defaults or the converter). */
  hidden?: boolean
  /** Why assigning this needs a confirmation. */
  danger?: string
}

export type Category =
  | 'letter' | 'number' | 'symbol' | 'fkey' | 'modifier' | 'navigation' | 'editing' | 'keypad'
  | 'international' | 'media' | 'system' | 'app' | 'lighting' | 'sidelight' | 'layer' | 'connection'
  | 'mouse' | 'special' | 'none'

type Row = [code: number, label: string, name: string, category: Category, extra?: { hidden?: true; danger?: string }]

const ROWS: Row[] = [
  // Nothing / pass-through
  [0x0000, '', 'No action (KC_NO)', 'none'],
  [0x0001, '▽', 'Transparent: use the key from the layer below (KC_TRNS)', 'none', { hidden: true }],

  // Letters
  [0x04, 'A', 'A', 'letter'], [0x05, 'B', 'B', 'letter'], [0x06, 'C', 'C', 'letter'], [0x07, 'D', 'D', 'letter'],
  [0x08, 'E', 'E', 'letter'], [0x09, 'F', 'F', 'letter'], [0x0a, 'G', 'G', 'letter'], [0x0b, 'H', 'H', 'letter'],
  [0x0c, 'I', 'I', 'letter'], [0x0d, 'J', 'J', 'letter'], [0x0e, 'K', 'K', 'letter'], [0x0f, 'L', 'L', 'letter'],
  [0x10, 'M', 'M', 'letter'], [0x11, 'N', 'N', 'letter'], [0x12, 'O', 'O', 'letter'], [0x13, 'P', 'P', 'letter'],
  [0x14, 'Q', 'Q', 'letter'], [0x15, 'R', 'R', 'letter'], [0x16, 'S', 'S', 'letter'], [0x17, 'T', 'T', 'letter'],
  [0x18, 'U', 'U', 'letter'], [0x19, 'V', 'V', 'letter'], [0x1a, 'W', 'W', 'letter'], [0x1b, 'X', 'X', 'letter'],
  [0x1c, 'Y', 'Y', 'letter'], [0x1d, 'Z', 'Z', 'letter'],

  // Number row
  [0x1e, '1', '1 !', 'number'], [0x1f, '2', '2 @', 'number'], [0x20, '3', '3 #', 'number'], [0x21, '4', '4 $', 'number'],
  [0x22, '5', '5 %', 'number'], [0x23, '6', '6 ^', 'number'], [0x24, '7', '7 &', 'number'], [0x25, '8', '8 *', 'number'],
  [0x26, '9', '9 (', 'number'], [0x27, '0', '0 )', 'number'],

  // Editing / whitespace
  [0x28, 'Enter', 'Return / Enter', 'editing'],
  [0x29, 'Esc', 'Escape', 'editing'],
  [0x2a, 'Bksp', 'Backspace (Delete on Mac)', 'editing'],
  [0x2b, 'Tab', 'Tab', 'editing'],
  [0x2c, 'Space', 'Space', 'editing'],
  [0x39, 'Caps', 'Caps Lock', 'editing'],
  [0x46, 'PrtSc', 'Print Screen', 'editing'],
  [0x47, 'ScrLk', 'Scroll Lock', 'editing'],
  [0x48, 'Pause', 'Pause / Break', 'editing'],
  [0x49, 'Ins', 'Insert', 'editing'],
  [0x4c, 'Del', 'Forward Delete', 'editing'],
  [0x65, 'Menu', 'Application / context menu', 'editing'],

  // Symbols
  [0x2d, '-', '- _', 'symbol'], [0x2e, '=', '= +', 'symbol'], [0x2f, '[', '[ {', 'symbol'], [0x30, ']', '] }', 'symbol'],
  [0x31, '\\', '\\ |', 'symbol'], [0x33, ';', '; :', 'symbol'], [0x34, "'", '\' "', 'symbol'], [0x35, '`', '` ~', 'symbol'],
  [0x36, ',', ', <', 'symbol'], [0x37, '.', '. >', 'symbol'], [0x38, '/', '/ ?', 'symbol'],

  // Function keys
  [0x3a, 'F1', 'F1', 'fkey'], [0x3b, 'F2', 'F2', 'fkey'], [0x3c, 'F3', 'F3', 'fkey'], [0x3d, 'F4', 'F4', 'fkey'],
  [0x3e, 'F5', 'F5', 'fkey'], [0x3f, 'F6', 'F6', 'fkey'], [0x40, 'F7', 'F7', 'fkey'], [0x41, 'F8', 'F8', 'fkey'],
  [0x42, 'F9', 'F9', 'fkey'], [0x43, 'F10', 'F10', 'fkey'], [0x44, 'F11', 'F11', 'fkey'], [0x45, 'F12', 'F12', 'fkey'],
  [0x68, 'F13', 'F13', 'fkey'],
  [0x69, 'F14', 'F14 (macOS: display brightness down)', 'fkey'],
  [0x6a, 'F15', 'F15 (macOS: display brightness up)', 'fkey'],
  [0x6b, 'F16', 'F16', 'fkey'], [0x6c, 'F17', 'F17', 'fkey'], [0x6d, 'F18', 'F18', 'fkey'], [0x6e, 'F19', 'F19', 'fkey'],
  [0x6f, 'F20', 'F20', 'fkey'], [0x70, 'F21', 'F21', 'fkey'], [0x71, 'F22', 'F22', 'fkey'], [0x72, 'F23', 'F23', 'fkey'],
  [0x73, 'F24', 'F24', 'fkey'],

  // Navigation
  [0x4a, 'Home', 'Home', 'navigation'], [0x4b, 'PgUp', 'Page Up', 'navigation'], [0x4d, 'End', 'End', 'navigation'],
  [0x4e, 'PgDn', 'Page Down', 'navigation'], [0x4f, '→', 'Right arrow', 'navigation'], [0x50, '←', 'Left arrow', 'navigation'],
  [0x51, '↓', 'Down arrow', 'navigation'], [0x52, '↑', 'Up arrow', 'navigation'],

  // Keypad
  [0x53, 'Num', 'Num Lock', 'keypad'], [0x54, 'P/', 'Keypad /', 'keypad'], [0x55, 'P*', 'Keypad *', 'keypad'],
  [0x56, 'P-', 'Keypad -', 'keypad'], [0x57, 'P+', 'Keypad +', 'keypad'], [0x58, 'PEnt', 'Keypad Enter', 'keypad'],
  [0x59, 'P1', 'Keypad 1 / End', 'keypad'], [0x5a, 'P2', 'Keypad 2 / ↓', 'keypad'], [0x5b, 'P3', 'Keypad 3 / PgDn', 'keypad'],
  [0x5c, 'P4', 'Keypad 4 / ←', 'keypad'], [0x5d, 'P5', 'Keypad 5', 'keypad'], [0x5e, 'P6', 'Keypad 6 / →', 'keypad'],
  [0x5f, 'P7', 'Keypad 7 / Home', 'keypad'], [0x60, 'P8', 'Keypad 8 / ↑', 'keypad'], [0x61, 'P9', 'Keypad 9 / PgUp', 'keypad'],
  [0x62, 'P0', 'Keypad 0 / Ins', 'keypad'], [0x63, 'P.', 'Keypad . / Del', 'keypad'],

  // International (non-US / JIS / Korean)
  [0x32, 'NUHS', 'Non-US # ~ (ISO key left of Enter)', 'international'],
  [0x64, 'NUBS', 'Non-US \\ | (ISO key right of left Shift)', 'international'],
  [0x87, 'Ro', 'JIS Ro (\\ _)', 'international'],
  [0x88, 'Kana', 'JIS Katakana/Hiragana', 'international'],
  [0x89, '¥', 'JIS Yen (¥ |)', 'international'],
  [0x8a, 'Henk', 'JIS Henkan (convert)', 'international'],
  [0x8b, 'Mhen', 'JIS Muhenkan (no convert)', 'international'],
  [0x90, '한영', 'Korean Han/Yeong (LANG1)', 'international'],
  [0x91, '漢字', 'Korean Hanja (LANG2)', 'international'],

  // Modifiers
  [0xe0, 'Ctrl', 'Left Control', 'modifier'], [0xe1, 'Shift', 'Left Shift', 'modifier'],
  [0xe2, 'Opt', 'Left Option / Alt', 'modifier'], [0xe3, 'Cmd', 'Left Command / Windows', 'modifier'],
  [0xe4, 'RCtrl', 'Right Control', 'modifier'], [0xe5, 'RShift', 'Right Shift', 'modifier'],
  [0xe6, 'ROpt', 'Right Option / Alt', 'modifier'], [0xe7, 'RCmd', 'Right Command / Windows', 'modifier'],

  // Media / consumer
  [0xa8, 'Mute', 'Mute', 'media'], [0xa9, 'Vol+', 'Volume up', 'media'], [0xaa, 'Vol-', 'Volume down', 'media'],
  [0xab, 'Next', 'Next track', 'media'], [0xac, 'Prev', 'Previous track', 'media'], [0xad, 'Stop', 'Stop', 'media'],
  [0xae, 'Play', 'Play / Pause', 'media'], [0xaf, 'Player', 'Open media player', 'media'],
  [0xb0, 'Eject', 'Eject', 'media'], [0xb1, 'Mail', 'Open mail', 'media'], [0xb2, 'Calc', 'Open calculator', 'media'],
  [0xb3, 'PC', 'Open My Computer / This PC', 'media'], [0xb4, 'WSrch', 'Browser search', 'media'],
  [0xb5, 'WHome', 'Browser home', 'media'], [0xb6, 'WBack', 'Browser back', 'media'], [0xb7, 'WFwd', 'Browser forward', 'media'],
  [0xb8, 'WStop', 'Browser stop', 'media'], [0xb9, 'WRef', 'Browser refresh', 'media'], [0xba, 'WFav', 'Browser favourites', 'media'],
  [0xbd, 'Bri+', 'Screen brightness up', 'media'], [0xbe, 'Bri-', 'Screen brightness down', 'media'],

  // System shortcuts (NuPhy custom codes, QMK QK_KB_n / QK_USER_n range)
  [0x7e06, 'MsnCtl', 'Mission Control', 'system'],
  [0x7e07, 'Search', 'Spotlight / global search', 'system'],
  [0x7e08, 'Siri', 'Dictation (long press: Siri)', 'system'],
  [0x7e09, 'LPad', 'Launchpad', 'system'],
  [0x7e0a, 'Shot', 'Full-screen screenshot (macOS or Windows shortcut per OS mode)', 'system'],
  [0x7e0b, 'Snip', 'Area screenshot (macOS or Windows shortcut per OS mode)', 'system'],
  [0x7e0c, 'Globe', 'Globe / fn key (macOS only, cannot be combined)', 'system'],
  [0x7e16, 'DND', 'Do Not Disturb', 'system'],
  [0x7e40, 'WinLck', 'Lock screen (Windows)', 'system'],
  [0x7e41, 'Lock', 'Lock screen (macOS)', 'system'],
  [0x7e42, 'Find', 'Finder search (macOS)', 'system'],
  [0x7e43, 'FQuit', 'Force Quit (macOS)', 'system'],
  [0x7e44, 'Emoji', 'Emoji picker (macOS)', 'system'],
  [0x7e45, 'Desk', 'Show desktop (Windows)', 'system'],
  [0x7e46, 'TaskMg', 'Task Manager (Windows)', 'system'],
  [0x7e53, 'Desk', 'Show desktop (macOS)', 'system'],
  [0x7e54, 'Input', 'Switch input source (macOS)', 'system'],
  [0x7e55, 'Dict', 'Dictation (Windows)', 'system'],
  [0x7e48, 'Desk←', 'Previous desktop (Windows)', 'system', { hidden: true }],
  [0x7e49, 'Desk→', 'Next desktop (Windows)', 'system', { hidden: true }],
  [0x7e4a, 'Desk←', 'Previous desktop (macOS)', 'system', { hidden: true }],
  [0x7e4b, 'Desk→', 'Next desktop (macOS)', 'system', { hidden: true }],
  [0x7e50, 'TaskV', 'Task View (Windows)', 'system', { hidden: true }],
  [0x7e51, 'Snap←', 'Snap window left (Windows)', 'system', { hidden: true }],
  [0x7e52, 'Snap→', 'Snap window right (Windows)', 'system', { hidden: true }],

  // App shortcuts (NuPhy IO "Media" tab, appHotKey feature)
  [0x7e28, 'PsRulr', 'Photoshop: show/hide rulers', 'app'],
  [0x7e29, 'PsDup', 'Photoshop: duplicate layer', 'app'],
  [0x7e2a, 'PsMrg', 'Photoshop: merge layers', 'app'],
  [0x7e2b, 'PsFill', 'Photoshop: fill', 'app'],
  [0x7e2c, 'PsLvl', 'Photoshop: levels', 'app'],
  [0x7e2d, 'PsZm+', 'Photoshop: zoom in', 'app'],
  [0x7e2e, 'PsZm-', 'Photoshop: zoom out', 'app'],
  [0x7e2f, 'AiSave', 'Illustrator: save for web', 'app'],
  [0x7e30, 'AiUndo', 'Illustrator: undo', 'app'],
  [0x7e31, 'AiGuid', 'Illustrator: lock/unlock guides', 'app'],
  [0x7e32, 'AiZm+', 'Illustrator: zoom in', 'app'],
  [0x7e33, 'AiZm-', 'Illustrator: zoom out', 'app'],
  [0x7e34, 'FgUI', 'Figma: show/hide UI', 'app'],
  [0x7e35, 'FgGrid', 'Figma: pixel grid', 'app'],
  [0x7e36, 'FgAlgn', 'Figma: align left', 'app'],
  [0x7e37, 'FgFlat', 'Figma: flatten selection', 'app'],
  [0x7e38, 'FgStrk', 'Figma: strikethrough', 'app'],
  [0x7e39, 'FgZm+', 'Figma: zoom in', 'app'],
  [0x7e3a, 'FgZm-', 'Figma: zoom out', 'app'],

  // Backlight (QMK RGB_* codes and NuPhy extras)
  [0x7821, 'RGB+', 'Next backlight effect', 'lighting'],
  [0x7822, 'RGB-', 'Previous backlight effect', 'lighting'],
  [0x7823, 'Hue+', 'Backlight hue up (NuPhy "COLOR +")', 'lighting'],
  [0x7824, 'Hue-', 'Backlight hue down (NuPhy "COLOR -")', 'lighting'],
  [0x7827, 'Lum+', 'Backlight brighter', 'lighting'],
  [0x7828, 'Lum-', 'Backlight dimmer', 'lighting'],
  [0x7829, 'Spd+', 'Backlight effect faster', 'lighting'],
  [0x782a, 'Spd-', 'Backlight effect slower', 'lighting'],
  [0x7e18, 'LtOff', 'Backlight on/off', 'lighting'],
  [0x7e19, 'LtTest', 'Lighting self-test', 'lighting'],
  [0x7e1b, 'Color', 'Cycle backlight colour', 'lighting'],
  [0x7e1c, 'Lum', 'Cycle backlight brightness (up then down)', 'lighting'],
  [0x7e1d, 'Spd', 'Cycle backlight speed', 'lighting'],
  [0x7e1f, 'Dir←', 'Backlight direction left', 'lighting'],
  [0x7e20, 'Dir→', 'Backlight direction right', 'lighting'],
  [0x7e21, 'Dir', 'Toggle backlight direction', 'lighting'],
  [0x7e3b, 'CapsLt', 'Caps Lock indicator light on/off', 'lighting'],

  // Side light
  [0x7e0d, 'Side+', 'Side light brighter', 'sidelight'],
  [0x7e0e, 'Side-', 'Side light dimmer', 'sidelight'],
  [0x7e0f, 'SdMode', 'Next side light effect', 'sidelight'],
  [0x7e10, 'SdHue', 'Cycle side light colour', 'sidelight'],
  [0x7e11, 'SdSpd+', 'Side light faster', 'sidelight'],
  [0x7e12, 'SdSpd-', 'Side light slower', 'sidelight'],
  [0x7e3c, 'SideLt', 'Side light on/off', 'sidelight', { hidden: true }],

  // Connection
  [0x7e01, 'USB', 'Switch to wired USB', 'connection', { hidden: true }],
  [0x7e02, '2.4G', 'Switch to / pair 2.4 GHz dongle', 'connection'],
  [0x7e03, 'BT1', 'Switch to / pair Bluetooth 1', 'connection'],
  [0x7e04, 'BT2', 'Switch to / pair Bluetooth 2', 'connection'],
  [0x7e05, 'BT3', 'Switch to / pair Bluetooth 3', 'connection'],

  // Mouse
  [0xd1, 'LClick', 'Mouse left button', 'mouse'], [0xd2, 'RClick', 'Mouse right button', 'mouse'],
  [0xd3, 'MClick', 'Mouse middle button', 'mouse'], [0xd4, 'MBack', 'Mouse back button', 'mouse'],
  [0xd5, 'MFwd', 'Mouse forward button', 'mouse'], [0xd9, 'Whl↑', 'Scroll up', 'mouse'],
  [0xda, 'Whl↓', 'Scroll down', 'mouse'], [0xdb, 'Whl←', 'Scroll left', 'mouse'], [0xdc, 'Whl→', 'Scroll right', 'mouse'],

  // Keyboard functions
  [0x7e3d, 'FnLock', 'Swap F1-F12 between F-keys and media keys', 'special'],
  [0x7e1e, 'WinLk', 'Disable / enable the Windows key', 'special'],
  [0x7e14, 'Sleep', 'Auto-sleep on/off', 'special'],
  [0x7e15, 'Batt', 'Battery level display on/off', 'special'],
  [0x7e56, '\\Shft', 'Tap for \\, hold for Shift', 'special'],
  [0x7e57, '6KRO', 'Toggle full-key / 6-key rollover (Windows mode)', 'special'],
  [0x7c59, 'KeyLk', 'Key lock: holds the next key until pressed again (QK_LOCK)', 'special',
    { danger: 'Keys can appear stuck until the lock is released.' }],
  [0x7e13, 'Reset', 'Reset the keyboard (NuPhy "RESET")', 'special',
    { danger: 'Resets the keyboard; on-board keymaps, macros and lighting may be wiped.' }],
  [0x7e00, 'Boot', 'Enter bootloader / firmware update mode (RF_DFU)', 'special',
    { danger: 'The keyboard stops typing and waits for a firmware flash; replug to recover.' }],
  [0x7e27, 'Debug', 'Debug status (factory)', 'special', { hidden: true, danger: 'Factory debug function, behaviour unknown.' }],
  [0x7e3f, 'SRT', 'MAC_SRT (unknown, not offered for this board)', 'special', { hidden: true }],
  [0x7e47, 'Touch', 'Node touch bar on/off (no effect on Air75 V3)', 'special', { hidden: true }],
]

/** Layer keys MO(0)..MO(7). Mac layers are 0-3, Windows 4-7; NuPhy IO only offers the current mode's four. */
const LAYER_ROWS: Row[] = Array.from({ length: 8 }, (_, n): Row => [
  0x5220 | n,
  n % 4 === 0 ? 'Base' : `Fn${n % 4}`,
  `Hold for layer ${n} (${n < 4 ? 'Mac' : 'Windows'} ${n % 4 === 0 ? 'base' : `Fn${n % 4}`})`,
  'layer',
])

export const KEYCODES: KeyCode[] = [...ROWS, ...LAYER_ROWS].map(([code, label, name, category, extra]) => ({
  code,
  label,
  name,
  category,
  ...(extra ?? {}),
}))

const BY_CODE = new Map(KEYCODES.map((k) => [k.code, k]))

export function keycode(code: number): KeyCode | undefined {
  return BY_CODE.get(code)
}

/** Codes found in the stock Fn layer (Fn+H/J/K/L) that NuPhy IO does not know (QK_USER_24..27). */
const UNKNOWN_DEFAULTS = new Set([0x7e58, 0x7e59, 0x7e5a, 0x7e5b])

export type AdvancedType = 'socd' | 'tapdance' | 'tgl'

export type Decoded = {
  kind: 'key' | 'macro' | 'advanced' | 'layer' | 'unknown'
  /** The full 16-bit word, so encode(decoded.code) round-trips. */
  code: number
  label: string
  name: string
  /** Macro id (0..31), layer number, or the slot inside the advanced table (0..31). */
  index?: number
  advanced?: AdvancedType
  danger?: string
}

const ADV_BASE: Record<AdvancedType, number> = { socd: 0, tapdance: 64, tgl: 128 }
const ADV_LABEL: Record<AdvancedType, [string, string]> = {
  socd: ['SOCD', 'SOCD pair'],
  tapdance: ['TD', 'Tap Dance'],
  tgl: ['TGL', 'Toggle key'],
}

const hex = (w: number) => '0x' + w.toString(16).padStart(4, '0')

/** Decode one key word read with 0xB1/0xB2 (hi = first byte). */
export function decode(hi: number, lo: number): Decoded {
  const code = ((hi & 0xff) << 8) | (lo & 0xff)
  if (hi === 0x77) {
    return { kind: 'macro', code, index: lo, label: `M${lo + 1}`, name: `Macro ${lo + 1}` }
  }
  if (hi === 0x7f) {
    const type: AdvancedType | null = lo <= 63 ? 'socd' : lo <= 127 ? 'tapdance' : lo <= 191 ? 'tgl' : null
    if (type) {
      const slot = lo - ADV_BASE[type]
      const [label, name] = ADV_LABEL[type]
      return { kind: 'advanced', code, advanced: type, index: slot, label, name: `${name} #${slot}` }
    }
    return { kind: 'unknown', code, label: hex(code), name: `Unknown advanced id ${lo}` }
  }
  const known = BY_CODE.get(code)
  if (known) {
    const kind = known.category === 'layer' ? 'layer' : 'key'
    return {
      kind,
      code,
      label: known.label,
      name: known.name,
      ...(kind === 'layer' ? { index: code & 0x1f } : {}),
      ...(known.danger ? { danger: known.danger } : {}),
    }
  }
  const qmk = describeQmk(code)
  if (qmk) {
    return qmk.layer === undefined
      ? { kind: 'unknown', code, label: qmk.label, name: qmk.name }
      : { kind: 'layer', code, label: qmk.label, name: qmk.name, index: qmk.layer }
  }
  if (UNKNOWN_DEFAULTS.has(code)) {
    return { kind: 'unknown', code, label: 'Fn' + 'HJKL'[code - 0x7e58], name: `Stock Fn function ${hex(code)} (unknown to NuPhy IO; keep as is)` }
  }
  return { kind: 'unknown', code, label: hex(code).slice(2).toUpperCase(), name: `Unknown keycode ${hex(code)}` }
}

/** QMK ranges NuPhy IO never writes. Firmware support is unverified, so they decode for display only. */
function describeQmk(w: number): { label: string; name: string; layer?: number } | null {
  const n = w & 0x1f
  if (w >= 0x5200 && w <= 0x521f) return { label: `TO ${n}`, name: `Switch to layer ${n} (TO, not offered by NuPhy IO)`, layer: n }
  if (w >= 0x5220 && w <= 0x523f) return { label: `MO ${n}`, name: `Hold for layer ${n}`, layer: n }
  if (w >= 0x5240 && w <= 0x525f) return { label: `DF ${n}`, name: `Set default layer ${n} (DF, not offered by NuPhy IO)`, layer: n }
  if (w >= 0x5260 && w <= 0x527f) return { label: `TG ${n}`, name: `Toggle layer ${n} (TG, not offered by NuPhy IO)`, layer: n }
  if (w >= 0x5280 && w <= 0x529f) return { label: `OSL ${n}`, name: `One-shot layer ${n} (not offered by NuPhy IO)`, layer: n }
  if (w >= 0x52c0 && w <= 0x52df) return { label: `TT ${n}`, name: `Tap-toggle layer ${n} (not offered by NuPhy IO)`, layer: n }
  if (w >= 0x0100 && w <= 0x1fff) return { label: ('M+' + (BY_CODE.get(w & 0xff)?.label ?? '?')).slice(0, 6), name: `QMK modifier combo ${hex(w)} (not offered by NuPhy IO)` }
  if (w >= 0x2000 && w <= 0x3fff) return { label: 'MT', name: `QMK mod-tap ${hex(w)} (not offered by NuPhy IO)` }
  if (w >= 0x4000 && w <= 0x4fff) return { label: `LT ${(w >> 8) & 0xf}`, name: `QMK layer-tap ${hex(w)} (not offered by NuPhy IO)`, layer: (w >> 8) & 0xf }
  return null
}

/** Encode a 16-bit word into the 2 bytes written with 0xB3. */
export function encode(code: number): [number, number] {
  return [(code >> 8) & 0xff, code & 0xff]
}

export const macroCode = (id: number) => 0x7700 | (id & 0x1f)
export const layerCode = (layer: number) => 0x5220 | (layer & 0x1f)
export const advancedCode = (type: AdvancedType, slot: number) => 0x7f00 | (ADV_BASE[type] + (slot & 0x1f))
export const TRANSPARENT = 0x0001
export const NO_KEY = 0x0000

/** True when NuPhy IO would offer this code in the given OS mode (0 = Mac, 1 = Windows). */
export function offeredIn(k: KeyCode, mode: 0 | 1): boolean {
  if (k.hidden) return false
  if (k.category === 'layer') return Math.floor((k.code & 0x1f) / 4) === mode
  return true
}

/**
 * Keymap position (data index) -> key id from layout.ts. Index = row * 16 + col for the 6 x 16 matrix,
 * then 96 / 97 = the knob's two rotation slots. null = no switch at that matrix position (always 0x0000).
 */
export const MATRIX: readonly (string | null)[] = [
  // row 0
  'esc', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'screenshot', 'ins', null,
  // row 1
  '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'bksp', null, 'pgup',
  // row 2
  'tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\', null, 'pgdn',
  // row 3 (col 12 is the knob push switch)
  'caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'knob-press', 'enter', null, 'home',
  // row 4
  'lshift', null, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'rshift', null, 'up', 'end',
  // row 5
  'lctrl', 'lopt', 'lcmd', null, null, null, 'space', null, null, null, 'rcmd', 'fn', 'rctrl', 'left', 'down', 'right',
  // extra keys: knob turned left (counter-clockwise, stock Vol-) and right (clockwise, stock Vol+)
  'knob-left', 'knob-right',
]

export const KEYS_PER_LAYER = 98
export const LAYER_BYTES = 196
export const KNOB_IDS = ['knob-left', 'knob-press', 'knob-right'] as const

/** Data index for a key id, or -1. */
export function matrixIndex(id: string): number {
  return MATRIX.indexOf(id)
}

/** Layer number for (OS mode, layer within mode). Mode 0 = Mac, 1 = Windows. */
export const layerOf = (mode: 0 | 1, sub: 0 | 1 | 2 | 3) => mode * 4 + sub

/** Byte address for 0xB2/0xB3 (bank 0): layer * 196 + 2 * index. */
export const keyAddress = (layer: number, index: number) => layer * LAYER_BYTES + 2 * index

/**
 * Stock keymap of firmware 1.0.23.6 (flash table at .bin 0x42828, knob table at 0x42808), as 0xB1 returns it.
 * Prefer reading 0xB1 on the device; this copy is for offline display and diffing.
 */
export const DEFAULT_LAYERS: readonly (readonly number[])[] = [
  // layer 0 (Mac base)
  [
    0x0029, 0x0069, 0x006a, 0x7e06, 0x7e07, 0x7e08, 0x7e16, 0x00ac, 0x00ae, 0x00ab, 0x00a8, 0x00aa, 0x00a9, 0x7e0b, 0x0049, 0x0000,
    0x0035, 0x001e, 0x001f, 0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, 0x002d, 0x002e, 0x002a, 0x0000, 0x004b,
    0x002b, 0x0014, 0x001a, 0x0008, 0x0015, 0x0017, 0x001c, 0x0018, 0x000c, 0x0012, 0x0013, 0x002f, 0x0030, 0x0031, 0x0000, 0x004e,
    0x0039, 0x0004, 0x0016, 0x0007, 0x0009, 0x000a, 0x000b, 0x000d, 0x000e, 0x000f, 0x0033, 0x0034, 0x00a8, 0x0028, 0x0000, 0x004a,
    0x00e1, 0x0000, 0x001d, 0x001b, 0x0006, 0x0019, 0x0005, 0x0011, 0x0010, 0x0036, 0x0037, 0x0038, 0x00e5, 0x0000, 0x0052, 0x004d,
    0x00e0, 0x00e2, 0x00e3, 0x0000, 0x0000, 0x0000, 0x002c, 0x0000, 0x0000, 0x0000, 0x00e7, 0x5221, 0x00e4, 0x0050, 0x0051, 0x004f,
    0x00aa, 0x00a9,
  ],
  // layer 1 (Mac Fn1)
  [
    0x0001, 0x003a, 0x003b, 0x003c, 0x003d, 0x003e, 0x003f, 0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x7e0a, 0x0001, 0x0000,
    0x0001, 0x7e03, 0x7e04, 0x7e05, 0x7e02, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x7e18, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x7e3b, 0x7e13, 0x7e14, 0x7e15, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x7e58, 0x7e59, 0x7e5a, 0x7e5b, 0x0001, 0x0001, 0x00a8, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0000, 0x0001, 0x5223, 0x7e19, 0x0001, 0x0001, 0x0001, 0x5222, 0x782a, 0x7829, 0x0001, 0x0001, 0x0000, 0x7827, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0001, 0x5221, 0x7821, 0x7828, 0x7823,
    0x00aa, 0x00a9,
  ],
  // layer 2 (Mac Fn2)
  [
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x7e27, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x00a8, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0000, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x7e12, 0x7e11, 0x7e3c, 0x0001, 0x0000, 0x7e0d, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0001, 0x5222, 0x7e0f, 0x7e0e, 0x7e10,
    0x00aa, 0x00a9,
  ],
  // layer 3 (Mac Fn3)
  [
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x7e44, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0001, 0x7e3d, 0x0001, 0x7e53, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x00a8, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0000, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x004b, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x7e54, 0x0000, 0x0000, 0x0000, 0x0001, 0x0001, 0x0001, 0x004a, 0x004e, 0x004d,
    0x00aa, 0x00a9,
  ],
  // layer 4 (Win base)
  [
    0x0029, 0x003a, 0x003b, 0x003c, 0x003d, 0x003e, 0x003f, 0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x7e0b, 0x0049, 0x0000,
    0x0035, 0x001e, 0x001f, 0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, 0x002d, 0x002e, 0x002a, 0x0000, 0x004b,
    0x002b, 0x0014, 0x001a, 0x0008, 0x0015, 0x0017, 0x001c, 0x0018, 0x000c, 0x0012, 0x0013, 0x002f, 0x0030, 0x0031, 0x0000, 0x004e,
    0x0039, 0x0004, 0x0016, 0x0007, 0x0009, 0x000a, 0x000b, 0x000d, 0x000e, 0x000f, 0x0033, 0x0034, 0x00a8, 0x0028, 0x0000, 0x004a,
    0x00e1, 0x0000, 0x001d, 0x001b, 0x0006, 0x0019, 0x0005, 0x0011, 0x0010, 0x0036, 0x0037, 0x0038, 0x00e5, 0x0000, 0x0052, 0x004d,
    0x00e0, 0x00e3, 0x00e2, 0x0000, 0x0000, 0x0000, 0x002c, 0x0000, 0x0000, 0x0000, 0x00e6, 0x5225, 0x00e4, 0x0050, 0x0051, 0x004f,
    0x00aa, 0x00a9,
  ],
  // layer 5 (Win Fn1)
  [
    0x0001, 0x00be, 0x00bd, 0x003c, 0x003d, 0x003e, 0x003f, 0x00ac, 0x00ae, 0x00ab, 0x00a8, 0x00aa, 0x00a9, 0x7e0a, 0x0001, 0x0000,
    0x0001, 0x7e03, 0x7e04, 0x7e05, 0x7e02, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x7e18, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x7e3b, 0x7e13, 0x7e14, 0x7e15, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x7e58, 0x7e59, 0x7e5a, 0x7e5b, 0x0001, 0x0001, 0x00a8, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0000, 0x0001, 0x5227, 0x7e19, 0x0001, 0x0001, 0x7e57, 0x5226, 0x782a, 0x7829, 0x0001, 0x0001, 0x0000, 0x7827, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0001, 0x5225, 0x7821, 0x7828, 0x7823,
    0x00aa, 0x00a9,
  ],
  // layer 6 (Win Fn2)
  [
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x7e27, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x00a8, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0000, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x7e12, 0x7e11, 0x7e3c, 0x0001, 0x0000, 0x7e0d, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0000, 0x0000, 0x0000, 0x0001, 0x0001, 0x5222, 0x7e0f, 0x7e0e, 0x7e10,
    0x00aa, 0x00a9,
  ],
  // layer 7 (Win Fn3)
  [
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000,
    0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x7e44, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0001, 0x7e3d, 0x0001, 0x7e53, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x00a8, 0x0001, 0x0000, 0x0001,
    0x0001, 0x0000, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0000, 0x004b, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x7e54, 0x0000, 0x0000, 0x0000, 0x0001, 0x0001, 0x0001, 0x004a, 0x004e, 0x004d,
    0x00aa, 0x00a9,
  ],
]
