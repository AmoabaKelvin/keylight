import { motion } from 'motion/react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { css, fromHex, hex, PALETTE, same, type RGB } from '../lib/color'

const pill = { type: 'spring', stiffness: 500, damping: 38 } as const

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={id} className="segmented-pill" transition={pill} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** A slider that moves freely and reports while dragging; the caller throttles what it sends. */
export function Slider({ value, min = 0, max = 100, onChange, format, color }: { value: number; min?: number; max?: number; onChange: (v: number) => void; format?: (v: number) => string; color?: RGB }) {
  const [local, setLocal] = useState(value)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) setLocal(value)
  }, [value, dragging])
  const pct = ((local - min) / (max - min)) * 100
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        value={local}
        style={{ '--pct': `${pct}%`, '--fill': color ? css(color) : 'var(--accent)' } as React.CSSProperties}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onChange={(e) => {
          const v = +e.target.value
          setLocal(v)
          onChange(v)
        }}
      />
      <span className="slider-value">{format ? format(local) : local}</span>
    </div>
  )
}

/** The palette, plus a custom colour from the system colour picker. */
export function Swatches({ value, onChange, allowNone, palette = PALETTE }: { value: RGB | null; onChange: (c: RGB | null) => void; allowNone?: boolean; palette?: typeof PALETTE }) {
  const custom = value && !palette.some((p) => same(p.rgb, value))
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none${value === null ? ' on' : ''}`} title="Eraser" onClick={() => onChange(null)}>
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M3 13 13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {palette.map((p) => (
        <button key={p.name} className={`swatch${same(p.rgb, value) ? ' on' : ''}`} title={p.name} style={{ '--c': css(p.rgb) } as React.CSSProperties} onClick={() => onChange(p.rgb)} />
      ))}
      <label className={`swatch custom${custom ? ' on' : ''}`} title="Custom colour" style={custom ? ({ '--c': css(value!) } as React.CSSProperties) : undefined}>
        <input type="color" value={value ? hex(value) : '#ffffff'} onChange={(e) => onChange(fromHex(e.target.value))} />
      </label>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span className="toggle-knob" layout transition={pill} />
    </button>
  )
}

export function Row({ icon, title, children, aside }: { icon?: string; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="row">
      {icon && <span className={`row-icon icon-${icon}`} />}
      <div className="row-main">
        <div className="row-head">
          <h3>{title}</h3>
          {aside}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>
}
