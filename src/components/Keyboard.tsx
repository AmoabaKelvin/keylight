import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { glow, type RGB } from '../lib/color'
import { ACCENT, HEIGHT, KEYS, KNOB, WIDTH, type Key } from '../lib/layout'
import { KeyIcon } from './icons'

const U = 60 // px per key unit in the drawing
const PAD_X = 26 // case bezel left and right (the side lights sit in it)
const PAD_Y = 22
const GAP = 3 // between keycaps
const W = WIDTH * U + PAD_X * 2
const H = HEIGHT * U + PAD_Y * 2
/** 20 side LEDs: ten in a short bar on each side of the function row. */
const RAIL_SEGMENTS = 10

export type SideView = { mode: number; brightness: number; speed: number; color: RGB }

/** A hint of the keyboard's own animation; the real thing runs on the keyboard. */
export type Motion = { look: 'wave' | 'rise' | 'breathe' | 'twinkle'; seconds: number; reverse?: boolean }

type Props = {
  /** One colour per key LED. */
  frame: RGB[]
  side?: SideView
  /** Keys not in here fade back, to point at the ones that matter on this page. */
  focus?: Set<string>
  /** Outline some keys, e.g. the ones Karabiner remaps. */
  rings?: Record<string, string>
  /** A small caption on the keycap, under its legend. */
  badges?: Record<string, string>
  /** Brings the side lights forward (and the keys back). */
  sideFocus?: boolean
  painting?: { color: RGB | null }
  motion?: Motion
  /** Replace what's printed on keys, e.g. with what they're mapped to. `faint` for pass-through keys. */
  legends?: Record<string, { label: string; faint?: boolean }>
  onKeyDown?: (key: Key, e: React.PointerEvent) => void
  onKeyEnter?: (key: Key, e: React.PointerEvent) => void
  tip?: (key: Key) => ReactNode
}

/** The Air75 V3, drawn to scale with what each LED is showing. */
export function Keyboard({ frame, side, focus, rings, badges, sideFocus, painting, motion: anim, legends, onKeyDown, onKeyEnter, tip }: Props) {
  const [hover, setHover] = useState<Key | null>(null)

  const sideGlow = side && side.mode !== 4 ? glow(side.color.map((v) => (v * side.brightness) / 100)) : null
  const breathe = side?.mode === 3
  const neon = side?.mode === 1
  const breatheSeconds = 1.4 + (side?.speed ?? 2) * 0.7

  const rail = (x: number) =>
    Array.from({ length: RAIL_SEGMENTS }, (_, i) => {
      const top = PAD_Y + GAP + 2
      const seg = (U - GAP * 2 - 4) / RAIL_SEGMENTS
      return (
        <rect
          key={`${x}-${i}`}
          x={x - 2}
          y={top + i * seg + 0.6}
          width={4}
          height={seg - 1.2}
          rx={1.2}
          className="rail-seg"
          style={{ fill: sideGlow ? sideGlow.color : 'var(--kb-rail-off)', opacity: sideGlow ? 0.4 + sideGlow.strength * 0.6 : 1 }}
        />
      )
    })

  const knobX = PAD_X + KNOB.x * U + U / 2
  const knobY = PAD_Y + KNOB.y * U + U / 2

  return (
    <div
      className={`kb${painting ? ' painting' : ''}${sideFocus ? ' side-focus' : ''}${anim ? ` anim anim-${anim.look}${anim.reverse ? ' reverse' : ''}` : ''}`}
      style={anim ? ({ '--anim': `${anim.seconds}s` } as React.CSSProperties) : undefined}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="kb-svg" role="img" aria-label="Air75 V3">
        <defs>
          <filter id="kb-bloom" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id="kb-rail-bloom" x="-300%" y="-50%" width="700%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <linearGradient id="kb-case" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--kb-case-top)" />
            <stop offset="1" stopColor="var(--kb-case-bottom)" />
          </linearGradient>
          <linearGradient id="kb-cap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--kb-cap-top)" />
            <stop offset="1" stopColor="var(--kb-cap)" />
          </linearGradient>
          <radialGradient id="kb-knob" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#ff8a5c" />
            <stop offset="1" stopColor="#e2502a" />
          </radialGradient>
        </defs>

        <rect x={1} y={1} width={W - 2} height={H - 2} rx={22} fill="url(#kb-case)" className="kb-case" />
        <rect x={PAD_X - 4} y={PAD_Y - 4} width={WIDTH * U + 8} height={HEIGHT * U + 8} rx={8} className="kb-well" />

        {/* Side lights: two short bars beside the function row. Bloom first, then the LEDs. */}
        <g className={`rails${breathe ? ' breathe' : ''}${neon ? ' neon' : ''}`} style={{ animationDuration: `${breatheSeconds}s` }}>
          {sideGlow && (
            <g filter="url(#kb-rail-bloom)">
              {rail(PAD_X / 2 - 1)}
              {rail(W - PAD_X / 2 + 1)}
            </g>
          )}
          {rail(PAD_X / 2 - 1)}
          {rail(W - PAD_X / 2 + 1)}
        </g>

        {/* Light spilling out from under the keys, one blur for all of them. */}
        <g filter="url(#kb-bloom)" className="blooms">
          {KEYS.map((k) => {
            const g = glow(frame[k.led] ?? [0, 0, 0])
            const dim = focus && !focus.has(k.id)
            return (
              <rect
                key={k.id}
                x={PAD_X + k.x * U}
                y={PAD_Y + k.y * U}
                width={k.w * U}
                height={U}
                rx={12}
                className="bloom"
                style={{ fill: g.color, opacity: g.strength * (dim ? 0.25 : 1), ...phase(k) }}
              />
            )
          })}
        </g>

        {KEYS.map((key) => {
          const legend = legends?.[key.id]
          const k: Key = legend ? { ...key, label: legend.label, sub: undefined, icon: undefined } : key
          const c = frame[k.led] ?? [0, 0, 0]
          const g = glow(c)
          const x = PAD_X + k.x * U + GAP
          const y = PAD_Y + k.y * U + GAP
          const w = k.w * U - GAP * 2
          const h = U - GAP * 2
          const cx = x + w / 2
          const dim = focus && !focus.has(k.id)
          const ring = rings?.[k.id]
          const badge = badges?.[k.id]
          const lit = g.strength > 0.04
          const words = (k.label.length > 2 && !/^F\d+$/.test(k.label)) || (!!legend && k.label.length > 1)
          const inkColor = lit ? g.color : 'var(--kb-legend)'
          const iconOnly = !!k.icon && !k.label
          const accent = ACCENT[k.id]
          const ink = lit ? { fill: g.color, opacity: 0.6 + g.strength * 0.4 } : undefined
          const twoLine = !!k.sub && !badge
          return (
            <g
              key={k.id}
              className={`key${dim ? ' dim' : ''}${hover?.id === k.id ? ' hover' : ''}${legend?.faint ? ' faint' : ''}`}
              style={phase(k)}
              onPointerDown={(e) => onKeyDown?.(key, e)}
              onPointerEnter={(e) => {
                setHover(key)
                onKeyEnter?.(key, e)
              }}
            >
              <rect x={x} y={y} width={w} height={h} rx={8} className="cap" fill="url(#kb-cap)" />
              {accent && <rect x={x} y={y} width={w} height={h} rx={8} style={{ fill: accent, opacity: lit ? 0.16 : 0.28 }} />}
              <rect x={x} y={y} width={w} height={h} rx={8} className="tint" style={{ fill: g.color, opacity: lit ? 0.04 + g.strength * 0.08 : 0 }} />
              <rect x={x + 4} y={y + 3} width={w - 8} height={h - 10} rx={6} className="face" />
              {twoLine && (
                <text x={cx} y={y + 21} className="legend sub" style={ink}>
                  {k.sub}
                </text>
              )}
              {k.icon && (
                <g style={lit ? { opacity: 0.6 + g.strength * 0.4 } : undefined}>
                  <KeyIcon name={k.icon} x={iconOnly ? cx - 9 : cx - 6.5} y={iconOnly ? y + h / 2 - 11 : y + 9} size={iconOnly ? 18 : 13} color={inkColor} />
                </g>
              )}
              {k.label && (
                <text x={cx} y={k.icon ? y + 39 : twoLine ? y + 39 : badge ? y + 26 : y + 31} className={`legend${words ? ' words' : ''}${k.icon ? ' fkey' : ''}`} style={ink}>
                  {k.label}
                </text>
              )}
              {badge && (
                <text x={cx} y={y + h - 11} className="badge-text">
                  {badge}
                </text>
              )}
              {ring && <rect x={x - 1.5} y={y - 1.5} width={w + 3} height={h + 3} rx={9.5} className="ring" style={{ stroke: ring }} />}
              {painting && hover?.id === k.id && (
                <rect
                  x={x - 1.5}
                  y={y - 1.5}
                  width={w + 3}
                  height={h + 3}
                  rx={9.5}
                  className="ring brush"
                  style={{ stroke: painting.color ? glow(painting.color).color : 'var(--muted)', strokeDasharray: painting.color ? undefined : '4 4' }}
                />
              )}
            </g>
          )
        })}

        {/* The knob: a cap with a dial on it. It has no light under it. */}
        <g className="knob">
          <rect x={knobX - U / 2 + GAP} y={knobY - U / 2 + GAP} width={U - GAP * 2} height={U - GAP * 2} rx={8} fill="url(#kb-cap)" className="cap" />
          <circle cx={knobX} cy={knobY - 2} r={17} fill="url(#kb-knob)" className="knob-dial" />
          <path d={`M${knobX - 7} ${knobY + 5} L${knobX + 7} ${knobY - 9}`} className="knob-line" />
        </g>
      </svg>

      <AnimatePresence>
        {hover && tip && (
          <motion.div
            key={hover.id}
            className="kb-tip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            style={{
              left: `${((PAD_X + (hover.x + hover.w / 2) * U) / W) * 100}%`,
              top: `${((PAD_Y + hover.y * U) / H) * 100}%`,
            }}
          >
            {tip(hover)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Where in an animation cycle each key sits, for the CSS that hints at keyboard effects. */
function phase(k: Key) {
  return { '--x': (k.x + k.w / 2) / WIDTH, '--y': k.y / (HEIGHT - 1), '--r': ((k.led * 37) % 23) / 23 } as React.CSSProperties
}

/** A thumbnail of a set of LEDs, for lists and the preset gallery. */
export function MiniBoard({ leds, base }: { leds: Record<string, RGB>; base?: RGB[] }) {
  const u = 10
  return (
    <svg viewBox={`0 0 ${WIDTH * u + 8} ${HEIGHT * u + 8}`} className="mini">
      {KEYS.map((k) => {
        const c = leds[k.led] ?? base?.[k.led]
        const g = c ? glow(c) : null
        return (
          <rect
            key={k.id}
            x={4 + k.x * u + 1}
            y={4 + k.y * u + 1}
            width={k.w * u - 2}
            height={u - 2}
            rx={2}
            style={g && g.strength > 0 ? { fill: g.color, opacity: 0.35 + g.strength * 0.65 } : undefined}
            className={g && g.strength > 0 ? 'on' : 'off'}
          />
        )
      })}
      <circle cx={4 + KNOB.x * u + u / 2} cy={4 + u / 2} r={3} className="mini-knob" />
    </svg>
  )
}
