import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
// The app's own keyboard, drawn from the same layout and colour code as Keylight itself.
import { Keyboard, type Motion, type SideView } from '../../src/components/Keyboard'
import { Segmented } from '../../src/components/controls'
import { Tip } from '../../src/components/Page'
import { OFF, isOff, type RGB } from '../../src/lib/color'
import { baseFrame, compose } from '../../src/lib/compose'
import { decode, DEFAULT_LAYERS, matrixIndex } from '../../src/lib/keycodes'
import { BOARDS, keyName, type Key } from '../../src/lib/layout'

/** The site shows the ANSI board. */
const BOARD = BOARDS.ansi
const { byId: BY_ID, keyLeds: KEY_LEDS } = BOARD
import { PRESETS } from '../../src/lib/shapes'

type Scene = {
  id: string
  label: string
  caption: string
  frame: RGB[]
  side: SideView
  motion?: Motion
  hyper?: boolean
  /** The keyboard animates these itself, so per-key colours don't apply. */
  animated?: boolean
}

const WARM: RGB = [255, 170, 110]
const CYAN: RGB = [0, 230, 255]
const PINK: RGB = [255, 0, 180]
const PURPLE: RGB = [150, 0, 255]

/** What Hyper does in the demo, as Tinycast shortcuts would have it. */
const HYPER: Record<string, string> = {
  c: 'Clipboard history',
  d: 'Dismiss notifications',
  e: 'Search emoji',
  n: 'Show notes',
  t: 'Toggle dark mode',
}

/** What fits on a keycap, as the app shortens them. */
const SHORT: Record<string, string> = { c: 'Clipboard', d: 'Dismiss', e: 'Emoji', n: 'Notes', t: 'Dark mode', rcmd: 'Hyper' }

function hyperFrame(): RGB[] {
  const frame: RGB[] = Array.from({ length: KEY_LEDS }, () => OFF)
  for (const id of Object.keys(HYPER)) frame[BY_ID.get(id)!.led] = CYAN
  frame[BY_ID.get('rcmd')!.led] = PURPLE
  return frame
}

const side = (color: RGB, mode = 2, brightness = 70): SideView => ({ mode, brightness, speed: 2, color })

const slashes = PRESETS.find((p) => p.id === 'slashes')!.build(BOARD)

const SCENES: Scene[] = [
  { id: 'warm', label: 'Solid', caption: 'Solid, in Warm. One colour on every key.', frame: baseFrame({ name: 'solid', color: WARM }, BOARD), side: side(WARM, 2, 55) },
  {
    id: 'gradient',
    label: 'Gradient',
    caption: 'A gradient from cyan on the left to pink on the right.',
    frame: baseFrame({ name: 'gradient', color: CYAN, color2: PINK }, BOARD),
    side: side(PURPLE),
  },
  { id: 'rainbow', label: 'Rainbow', caption: 'Rainbow, with the side lights on neon.', frame: baseFrame({ name: 'rainbow' }, BOARD), side: side(PINK, 1, 80) },
  { id: 'stripes', label: 'Stripes', caption: 'One colour per row. Each row can be any colour.', frame: baseFrame({ name: 'stripes' }, BOARD), side: side([255, 255, 255], 3, 60) },
  {
    id: 'wave',
    label: 'Effect',
    caption: "Wave, one of the keyboard's 19 built-in effects. The keyboard runs it, and the drawing hints at it.",
    frame: baseFrame({ name: 'effect', rgb: true }, BOARD),
    side: side(CYAN, 1, 70),
    motion: { look: 'wave', seconds: 3.2 },
    animated: true,
  },
  {
    id: 'shape',
    label: 'Shapes',
    caption: 'A painted shape on top of a dim theme. This one is the Slashes preset.',
    frame: compose({ name: 'solid', color: WARM, level: 14 }, [{ name: 'Slashes', visible: true, leds: slashes }], BOARD),
    side: side([200, 0, 0], 2, 60),
  },
  { id: 'hyper', label: 'Hyper held', caption: 'Right ⌘ held. Only the keys with a Hyper shortcut stay lit.', frame: hyperFrame(), side: side(PURPLE, 4), hyper: true },
]

const SECONDS = 3.6

/** Names for the stock function row that read better than the raw keycode names. */
const STOCK: Record<string, string> = {
  f1: 'Display brightness down',
  f2: 'Display brightness up',
  f4: 'Spotlight',
  screenshot: 'Area screenshot',
  bksp: 'Backspace',
}

/** Keys Keylight has something to say about. */
const SPECIAL: Record<string, string> = {
  rcmd: 'Hold it for Hyper. Only your shortcut keys light up.',
  caps: 'Hold for Control, tap twice for Caps Lock. A Karabiner rule Keylight adds for you.',
  lshift: 'Press both Shifts together to toggle Caps Lock.',
  rshift: 'Press both Shifts together to toggle Caps Lock.',
  fn: 'Holds the Fn layer. Remap any key on it, too.',
  ins: 'Insert on the stock layout. Remap it to anything.',
}

function stockName(k: Key) {
  if (STOCK[k.id]) return STOCK[k.id]
  const w = DEFAULT_LAYERS[0][matrixIndex(k.id)]
  return w === undefined ? keyName(k) : decode(w >> 8, w & 0xff).name
}

/** A plain colour word for an LED, since gradients rarely land on a palette colour. */
function hueName(c: RGB) {
  const [r, g, b] = c.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 0.12) return max > 0.6 ? 'white' : 'dim white'
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360) % 360
  const names: [number, string][] = [
    [12, 'red'],
    [38, 'orange'],
    [55, 'amber'],
    [75, 'yellow'],
    [150, 'green'],
    [175, 'teal'],
    [200, 'cyan'],
    [235, 'blue'],
    [265, 'indigo'],
    [295, 'purple'],
    [330, 'magenta'],
    [345, 'pink'],
    [360, 'red'],
  ]
  const name = names.find(([limit]) => h < limit)![1]
  return max < 0.3 ? `dim ${name}` : name
}

export function Hero() {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState(false)
  const [hovering, setHovering] = useState(false)
  const scene = SCENES[index]

  // Cycle through the scenes until someone picks one. Hovering the board holds the current one.
  useEffect(() => {
    if (reduce || chosen || hovering) return
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % SCENES.length), SECONDS * 1000)
    return () => window.clearTimeout(t)
  }, [index, reduce, chosen, hovering])

  const badges = scene.hyper ? SHORT : undefined
  const focus = useMemo(() => (scene.hyper ? new Set([...Object.keys(HYPER), 'rcmd']) : undefined), [scene])

  const tip = (k: Key) => {
    if (scene.hyper) {
      if (k.id === 'rcmd') return <Tip title="Right ⌘ is Hyper">⌃ ⌥ ⇧ ⌘ together, while you hold it</Tip>
      if (HYPER[k.id]) return <Tip title={`Hyper ${k.label}`}>{HYPER[k.id]}</Tip>
      return <Tip title={keyName(k)}>No Hyper shortcut, so it stays dark</Tip>
    }
    if (SPECIAL[k.id]) return <Tip title={keyName(k)}>{SPECIAL[k.id]}</Tip>
    const c = scene.frame[k.led]
    const light = scene.animated ? 'animated by the keyboard' : isOff(c) ? 'off' : `lit ${hueName(c)}`
    const plain = k.row > 0 && k.label.length === 1
    return (
      <Tip title={keyName(k)}>
        {plain ? light.charAt(0).toUpperCase() + light.slice(1) : `${stockName(k)} · ${light}`}
      </Tip>
    )
  }

  return (
    <div className="hero-board">
      <div className="hero-kb" onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
        <Keyboard frame={scene.frame} side={scene.side} motion={scene.motion} badges={badges} focus={focus} tip={tip} />
      </div>
      <div className="hero-controls">
        <Segmented
          value={scene.id}
          options={SCENES.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(id) => {
            setChosen(true)
            setIndex(SCENES.findIndex((s) => s.id === id))
          }}
        />
        <p className="hero-caption" aria-live="polite">
          {scene.caption} <span className="hint-hover">Hover a key to see what it does.</span>
          <span className="hint-touch">Tap a key to see what it does.</span>
        </p>
      </div>
    </div>
  )
}
