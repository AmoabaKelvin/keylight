import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard, MiniBoard } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Row, Swatches, Toggle } from '../components/controls'
import type { Layer } from '../lib/api'
import { colorName, css, hex, same, type RGB } from '../lib/color'
import { compose } from '../lib/compose'
import { keyName, mirror, type Key } from '../lib/layout'
import { PRESETS, uniqueName, type Leds, type Preset } from '../lib/shapes'
import { useThrottle } from '../lib/useDaemon'
import { useLayout } from '../lib/useLayout'

export function ShapesPage({ ctx }: { ctx: Ctx }) {
  const { state, send, pause } = ctx
  const board = useLayout()
  const [editing, setEditing] = useState<string | null>(null)
  /** The shape being edited, as drawn here; the daemon catches up a few times a second. */
  const [draft, setDraft] = useState<Leds | null>(null)
  const [brush, setBrush] = useState<RGB | null>([200, 0, 0])
  const [symmetric, setSymmetric] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  /** Which of the shape's colours the Shape colour row changes. */
  const [target, setTarget] = useState<RGB | null>(null)
  const stroke = useRef<{ erase: boolean } | null>(null)
  const previewTimer = useRef<number | null>(null)

  const layers: Layer[] = useMemo(
    () => state.layers.map((l) => (l.name === editing && draft ? { ...l, leds: draft, visible: true } : l)),
    [state.layers, editing, draft],
  )
  const frame = state.hyper ? state.frame : compose(state.base, layers, board)

  const push = useThrottle((name: string, leds: Leds) => send({ op: 'layer', name, leds }), 70)

  const startEditing = (name: string) => {
    const layer = state.layers.find((l) => l.name === name)
    if (!layer) return
    setEditing(name)
    setDraft({ ...layer.leds })
    if (!layer.visible) send({ op: 'layer', name, visible: true })
  }

  const stopEditing = () => {
    setEditing(null)
    setDraft(null)
  }

  useEffect(() => {
    const end = () => {
      if (!stroke.current) return
      stroke.current = null
      // Let the last throttled write land before polling again.
      setTimeout(() => pause(false), 150)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stopEditing()
    window.addEventListener('pointerup', end)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('keydown', onKey)
    }
  }, [pause])

  // Leaving the page drops any preview still on the keyboard.
  useEffect(() => () => void send({ op: 'preview', leds: null }), [send])

  const paint = (k: Key) => {
    if (!editing || !draft || !stroke.current) return
    const next = { ...draft }
    for (const key of symmetric ? [k, mirror(k, board.keys, board.width)] : [k]) {
      if (stroke.current.erase) delete next[key.led]
      else next[key.led] = brush!
    }
    setDraft(next)
    push(editing, next)
  }

  /** The colours in the shape being edited, in key order. */
  const colours = useMemo(() => {
    const out: RGB[] = []
    for (const c of Object.values(draft ?? {})) if (!out.some((o) => same(o, c))) out.push(c)
    return out
  }, [draft])
  const current = colours.find((c) => same(c, target)) ?? colours[0] ?? null

  /** Every key in `from` turns `to`; the brush follows, so new keys match. */
  const recolour = (from: RGB, to: RGB) => {
    if (!editing || !draft) return
    const next = Object.fromEntries(Object.entries(draft).map(([l, c]) => [l, same(c, from) ? to : c]))
    setDraft(next)
    push(editing, next) // throttled: the custom picker fires on every drag
    setTarget(to)
    setBrush(to)
  }

  const onKeyDown = (k: Key, e: React.PointerEvent) => {
    if (!editing || !draft) return
    e.preventDefault()
    if (e.shiftKey) {
      if (draft[k.led] && brush) recolour(draft[k.led], brush)
      return
    }
    pause(true)
    // Clicking a key already in the brush colour clears it, like a pixel editor's toggle.
    const erase = e.altKey || brush === null || same(draft[k.led], brush)
    stroke.current = { erase }
    paint(k)
  }

  const onKeyEnter = (k: Key, e: React.PointerEvent) => {
    if (stroke.current && e.buttons & 1) paint(k)
  }

  const setAll = (leds: Leds) => {
    if (!editing) return
    setDraft(leds)
    send({ op: 'layer', name: editing, leds })
  }

  const addLayer = (name: string, leds: Leds, edit = false) => {
    const unique = uniqueName(name, state.layers.map((l) => l.name))
    send({ op: 'preview', leds: null })
    send({ op: 'layer', name: unique, leds }, (s) => ({ ...s, layers: [...s.layers, { name: unique, leds, visible: true }] })).then(() => {
      if (edit) {
        setEditing(unique)
        setDraft({ ...leds })
      }
    })
  }

  const previewPreset = (p: Preset | null) => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    previewTimer.current = null
    if (!p) {
      if (state.preview) send({ op: 'preview', leds: null })
      return
    }
    // Only after a short rest, so sweeping the mouse across the gallery doesn't flood the keyboard.
    previewTimer.current = window.setTimeout(() => send({ op: 'preview', leds: p.build(board) }), 350)
  }

  const whoLights = (k: Key) => {
    for (let i = layers.length - 1; i >= 0; i--) if (layers[i].visible && layers[i].leds[k.led]) return layers[i]
    return null
  }

  return (
    <Page
      title="Shapes"
      meta={editing ? <>Drawing <strong>{editing}</strong>. Click or drag across keys. ⇧-click recolours every key of that colour, ⌥ erases, Esc finishes.</> : 'Patterns drawn on top of the theme. Pick one to edit it, or start from a preset.'}
      state={state}
      actions={
        editing ? (
          <button className="button primary" onClick={stopEditing}>
            Done
          </button>
        ) : (
          <button className="button" onClick={() => addLayer('Shape', {}, true)}>
            New shape
          </button>
        )
      }
      board={
        <Keyboard
          frame={frame}
          side={state.side}
          painting={editing ? { color: brush } : undefined}
          onKeyDown={onKeyDown}
          onKeyEnter={onKeyEnter}
          tip={(k) => {
            const layer = whoLights(k)
            return <Tip title={keyName(k)}>{layer ? `${layer.name} · ${colorName(layer.leds[k.led])}` : 'theme'}</Tip>
          }}
        />
      }
    >
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div key="brush" className="brush-bar" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
            {current && (
              <Row title="Shape colour">
                {colours.length > 1 && (
                  <>
                    <p className="row-help">This shape has {colours.length} colours. Pick the one to change:</p>
                    <div className="swatches shape-colours">
                      {colours.map((c) => (
                        <button key={hex(c)} className={`swatch${same(c, current) ? ' on' : ''}`} title={colorName(c)} style={{ '--c': css(c) } as React.CSSProperties} onClick={() => setTarget(c)} />
                      ))}
                    </div>
                  </>
                )}
                <Swatches value={current} onChange={(c) => c && recolour(current, c)} />
              </Row>
            )}
            <Row title="Brush">
              <p className="row-help">Paints the keys you click.</p>
              <Swatches value={brush} onChange={setBrush} allowNone />
            </Row>
            <Row title="Mirror" aside={<Toggle on={symmetric} onChange={setSymmetric} label="Mirror" />}>
              <p className="row-help">Paint the matching key on the other half too, so the shape stays symmetric.</p>
            </Row>
            <div className="row-actions inline">
              <button className="button" onClick={() => brush && setAll(Object.fromEntries(Array.from({ length: board.keyLeds }, (_, i) => [i, brush])))}>
                Fill every key
              </button>
              <button className="button" onClick={() => setAll({})}>
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <h2 className="section-label">Your shapes</h2>
      {state.layers.length === 0 && <p className="row-help">Nothing drawn yet. Start from a preset below, or make a new shape.</p>}
      <ul className="layer-list">
        <AnimatePresence initial={false}>
          {state.layers.map((l) => (
            <motion.li
              key={l.name}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
              className={`layer${editing === l.name ? ' editing' : ''}${l.visible ? '' : ' hidden'}`}
            >
              <button className="layer-thumb" onClick={() => (editing === l.name ? stopEditing() : startEditing(l.name))} title={editing === l.name ? 'Finish editing' : 'Edit'}>
                <MiniBoard leds={editing === l.name && draft ? draft : l.leds} />
              </button>
              <div className="layer-main">
                {renaming === l.name ? (
                  <input
                    className="layer-rename"
                    autoFocus
                    defaultValue={l.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      setRenaming(null)
                      if (v && v !== l.name) {
                        send({ op: 'layer', name: l.name, rename: v })
                        if (editing === l.name) setEditing(v)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="layer-name" onDoubleClick={() => setRenaming(l.name)} title="Double-click to rename">
                    {l.name}
                  </span>
                )}
                <span className="layer-meta">
                  {Object.keys(l.leds).length} keys{l.visible ? '' : ' · hidden'}
                </span>
              </div>
              <div className="layer-actions">
                <button className="icon-button" title={editing === l.name ? 'Finish editing' : 'Edit'} onClick={() => (editing === l.name ? stopEditing() : startEditing(l.name))}>
                  <PencilIcon />
                </button>
                <button
                  className="icon-button"
                  title={l.visible ? 'Hide' : 'Show'}
                  onClick={() => send({ op: 'layer', name: l.name, visible: !l.visible }, (s) => ({ ...s, layers: s.layers.map((x) => (x.name === l.name ? { ...x, visible: !x.visible } : x)) }))}
                >
                  <EyeIcon open={l.visible} />
                </button>
                <button
                  className="icon-button danger"
                  title="Delete"
                  onClick={() => {
                    if (editing === l.name) stopEditing()
                    send({ op: 'layer', name: l.name, delete: true }, (s) => ({ ...s, layers: s.layers.filter((x) => x.name !== l.name) }))
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <h2 className="section-label">
        Presets <span>hover to try one on the keyboard, click to add it</span>
      </h2>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="preset" onPointerEnter={() => previewPreset(p)} onPointerLeave={() => previewPreset(null)} onClick={() => addLayer(p.name, p.build(board))}>
            <MiniBoard leds={p.build(board)} />
            <span className="preset-name">{p.name}</span>
            <span className="preset-hint">{p.hint}</span>
          </button>
        ))}
      </div>
    </Page>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M10.5 2.5l3 3-8 8H2.5v-3z" />
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
      {open ? <circle cx="8" cy="8" r="2" /> : <path d="M3 13L13 3" />}
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
    </svg>
  )
}
