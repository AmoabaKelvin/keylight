import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Segmented } from '../components/controls'
import { daemon } from '../lib/api'
import { OFF, type RGB } from '../lib/color'
import { decode, DEFAULT_LAYERS, KEYCODES, KNOB_IDS, layerOf, macroCode, MATRIX, matrixIndex, offeredIn, TRANSPARENT, type KeyCode } from '../lib/keycodes'
import { BY_ID, KEY_LEDS, keyName } from '../lib/layout'

type Layer = { keys: number[]; defaults: number[] }

const LAYERS: { value: 0 | 1 | 2 | 3; label: string; hint: string }[] = [
  { value: 0, label: 'Base', hint: 'What each key types normally.' },
  { value: 1, label: 'Fn', hint: 'While you hold Fn. Empty keys fall through to the base layer.' },
  { value: 2, label: 'Fn 2', hint: 'NuPhy’s side-light layer (hold Fn+M on the stock layout).' },
  { value: 3, label: 'Fn 3', hint: 'NuPhy’s extras layer (hold Fn+X on the stock layout).' },
]

/** How the picker groups codes, in the order people look for them. */
const GROUPS: { id: string; label: string; categories: string[] }[] = [
  { id: 'basic', label: 'Letters & numbers', categories: ['letter', 'number', 'symbol'] },
  { id: 'mods', label: 'Modifiers & editing', categories: ['modifier', 'editing', 'navigation'] },
  { id: 'fkeys', label: 'F-keys', categories: ['fkey'] },
  { id: 'media', label: 'Media & Mac', categories: ['media', 'system', 'app'] },
  { id: 'light', label: 'Lighting', categories: ['lighting', 'sidelight'] },
  { id: 'layers', label: 'Layers', categories: ['layer', 'none'] },
  { id: 'wireless', label: 'Wireless', categories: ['connection'] },
  { id: 'more', label: 'More', categories: ['mouse', 'keypad', 'international', 'special'] },
  { id: 'macros', label: 'Macros', categories: [] },
]

const MACROS: KeyCode[] = Array.from({ length: 32 }, (_, i) => ({ code: macroCode(i), label: `M${i + 1}`, name: `Macro ${i + 1}`, category: 'macro' }))
/** macOS reads F14/F15 as screen brightness, which is how the stock Mac layer uses them. */
const MAC_NAMES: Record<number, { label: string; name: string }> = {
  0x69: { label: 'Bright−', name: 'Screen brightness down (sent as F14)' },
  0x6a: { label: 'Bright+', name: 'Screen brightness up (sent as F15)' },
}
const label = (w: number) => ({ ...decode(w >> 8, w & 0xff), ...MAC_NAMES[w] })

export function KeymapPage({ ctx }: { ctx: Ctx }) {
  const { state } = ctx
  const [os, setOs] = useState<0 | 1>(state.device.os === 'windows' ? 1 : 0)
  const [sub, setSub] = useState<0 | 1 | 2 | 3>(0)
  const [layers, setLayers] = useState<Record<number, Layer>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [group, setGroup] = useState('basic')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<{ code: number; warning: string } | null>(null)
  const [backup, setBackup] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const layer = layerOf(os, sub)
  const live = layers[layer]
  const stock = { keys: [...DEFAULT_LAYERS[layer]], defaults: [...DEFAULT_LAYERS[layer]] }
  const data = live ?? stock
  const editable = state.connected && !!live

  const load = useCallback(
    async (l: number) => {
      if (!state.connected) return
      try {
        const r = await daemon<{ keys: number[]; defaults: number[] | null }>({ op: 'keymap', layer: l })
        setLayers((ls) => ({ ...ls, [l]: { keys: r.keys, defaults: r.defaults ?? [...DEFAULT_LAYERS[l]] } }))
        setError(null)
      } catch (e) {
        setError(String(e))
      }
    },
    [state.connected],
  )

  useEffect(() => {
    if (!layers[layer]) load(layer)
  }, [layer, layers, load])

  const index = selected ? matrixIndex(selected) : -1
  const current = index >= 0 ? data.keys[index] : null
  const original = index >= 0 ? data.defaults[index] : null

  /** What would go wrong with this assignment, if anything; the user can still go ahead. */
  const warningFor = (code: number): string | null => {
    const k = KEYCODES.find((c) => c.code === code)
    if (k?.danger) return k.danger
    const base = layers[layerOf(os, 0)]?.keys ?? DEFAULT_LAYERS[layerOf(os, 0)]
    const isLayerKey = (w: number) => w >= 0x5220 && w <= 0x523f
    if (sub === 0 && current !== null && isLayerKey(current) && !isLayerKey(code) && base.filter(isLayerKey).length <= 1)
      return 'This is the last Fn key on the base layer. Without one, the Fn layers (Bluetooth, lighting keys) can’t be reached until you map one again.'
    if (isLayerKey(code) && (code & 0x1f) !== layer) {
      const target = layers[code & 0x1f]?.keys ?? DEFAULT_LAYERS[code & 0x1f]
      if (target[index] !== TRANSPARENT && target[index] !== code)
        return `On the layer it opens, this same key is mapped to something else, so releasing it may not work as expected. NuPhy suggests keeping that key empty there.`
    }
    return null
  }

  const write = async (code: number) => {
    if (index < 0 || !live) return
    setBusy(true)
    setPending(null)
    try {
      if (!backup) {
        const b = await daemon<{ path: string }>({ op: 'backup' })
        setBackup(b.path)
      }
      await daemon({ op: 'key_set', layer, index, word: code })
      setLayers((ls) => ({ ...ls, [layer]: { ...ls[layer], keys: ls[layer].keys.map((w, i) => (i === index ? code : w)) } }))
      setError(null)
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  const assign = (code: number) => {
    if (code === current) return
    const warning = warningFor(code)
    if (warning) setPending({ code, warning })
    else write(code)
  }

  const resetLayer = async () => {
    if (!live) return
    setBusy(true)
    try {
      if (!backup) setBackup((await daemon<{ path: string }>({ op: 'backup' })).path)
      for (let i = 0; i < live.keys.length; i++) {
        if (live.keys[i] !== live.defaults[i]) await daemon({ op: 'key_set', layer, index: i, word: live.defaults[i] })
      }
      await load(layer)
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  const changed = data.keys.reduce((n, w, i) => n + (MATRIX[i] && w !== data.defaults[i] ? 1 : 0), 0)

  // The board shows what each key does on this layer; changed keys get a ring.
  const legends: Record<string, { label: string; faint?: boolean }> = {}
  const rings: Record<string, string> = {}
  data.keys.forEach((w, i) => {
    const id = MATRIX[i]
    if (!id) return
    const d = label(w)
    legends[id] = { label: w === TRANSPARENT ? '' : d.label || '—', faint: w === TRANSPARENT || w === 0 }
    if (w !== data.defaults[i]) rings[id] = 'var(--accent)'
  })
  if (selected) rings[selected] = 'var(--text)'

  // A plain board, so legends read clearly; the selected and changed keys glow.
  const frame: RGB[] = useMemo(() => Array.from({ length: KEY_LEDS }, () => OFF), [])

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = [...KEYCODES.filter((k) => offeredIn(k, os) || k.code === TRANSPARENT), ...MACROS]
    if (q) return all.filter((k) => k.label.toLowerCase().includes(q) || k.name.toLowerCase().includes(q)).slice(0, 80)
    if (group === 'macros') return MACROS
    const cats = GROUPS.find((g) => g.id === group)!.categories
    return all.filter((k) => cats.includes(k.category))
  }, [group, query, os])

  const knobLabel = (id: string) => {
    const i = matrixIndex(id)
    return i >= 0 ? label(data.keys[i]).label || '—' : '—'
  }

  return (
    <Page
      title="Keymap"
      meta={
        !state.connected ? (
          'This is the stock layout. Plug in the USB cable to see and change yours.'
        ) : changed ? (
          <>
            {changed} {changed === 1 ? 'key differs' : 'keys differ'} from stock on this layer. Click a key to change what it does.
          </>
        ) : (
          'Click a key to change what it does. Changes save on the keyboard and work on every connection.'
        )
      }
      state={state}
      actions={
        <div className="row-actions">
          <Segmented value={os} options={[{ value: 0, label: 'Mac' }, { value: 1, label: 'Windows' }]} onChange={(v) => { setOs(v); setSelected(null) }} />
        </div>
      }
      board={
        <>
          <div className="layer-tabs">
            <Segmented value={sub} options={LAYERS.map((l) => ({ value: l.value, label: l.label }))} onChange={(v) => { setSub(v); setSelected(null) }} />
            <span className="row-note">{LAYERS[sub].hint}</span>
          </div>
          <Keyboard
            frame={frame}
            legends={legends}
            rings={rings}
            onKeyDown={(k) => setSelected(selected === k.id ? null : k.id)}
            tip={(k) => {
              const i = matrixIndex(k.id)
              const d = label(data.keys[i])
              return <Tip title={keyName(k)}>{data.keys[i] === TRANSPARENT ? 'falls through to the base layer' : d.name}</Tip>
            }}
          />
          <div className="knob-slots">
            <span className="row-note">Knob</span>
            {KNOB_IDS.map((id) => (
              <button key={id} className={`chip${selected === id ? ' on' : ''}`} onClick={() => setSelected(selected === id ? null : id)}>
                {id === 'knob-left' ? '⟲ turn left' : id === 'knob-right' ? 'turn right ⟳' : 'press'} · {knobLabel(id)}
              </button>
            ))}
          </div>
        </>
      }
    >
      {error && <p className="row-error">{error}</p>}
      {backup && <p className="row-help">Backed up your keymap and macros before the first change: <code>{backup.replace(/^.*\/Library/, '~/Library')}</code></p>}

      <AnimatePresence mode="wait">
        {selected && current !== null ? (
          <motion.div key={`${layer}-${selected}`} className="picker" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="picker-head">
              <div>
                <h3>{selected === 'knob-press' ? 'Knob, pressed' : selected.startsWith('knob') ? `Knob, turned ${selected.slice(5)}` : keyName(BY_ID.get(selected)!)}</h3>
                <p className="row-help">
                  Now: <strong>{current === TRANSPARENT ? 'Falls through' : label(current).name}</strong>
                  {original !== null && original !== current && <> · stock: {original === TRANSPARENT ? 'falls through' : label(original).name}</>}
                </p>
              </div>
              <div className="row-actions">
                {original !== null && original !== current && (
                  <button className="button" disabled={!editable || busy} onClick={() => write(original)}>
                    Reset to stock
                  </button>
                )}
                <input className="field search" placeholder="Search keys" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>

            {pending && (
              <div className="setup warn">
                <p>
                  <strong>Are you sure?</strong> {pending.warning}
                </p>
                <button className="button" onClick={() => setPending(null)}>
                  Cancel
                </button>
                <button className="button primary" onClick={() => write(pending.code)}>
                  Assign anyway
                </button>
              </div>
            )}

            {!query && (
              <div className="chips picker-groups">
                {GROUPS.map((g) => (
                  <button key={g.id} className={`chip${group === g.id ? ' on' : ''}`} onClick={() => setGroup(g.id)}>
                    {g.label}
                  </button>
                ))}
              </div>
            )}
            <div className="code-grid">
              {choices.map((k) => (
                <button
                  key={k.code}
                  className={`code${k.code === current ? ' on' : ''}${k.danger ? ' danger' : ''}`}
                  title={k.name}
                  disabled={!editable || busy}
                  onClick={() => assign(k.code)}
                >
                  <span className="code-label">{k.code === TRANSPARENT ? '▽' : k.label || '∅'}</span>
                  {(k.name !== k.label || k.code === TRANSPARENT || k.code === 0) && (
                    <span className="code-name">{k.code === TRANSPARENT ? 'Falls through' : k.code === 0 ? 'Nothing' : k.name}</span>
                  )}
                </button>
              ))}
            </div>
            {!editable && <p className="row-help">{state.connected ? 'Reading your keymap…' : 'Plug in the USB cable to change keys.'}</p>}
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="keymap-foot">
              <p className="row-help">
                Keys with a blue ring differ from NuPhy’s stock layout. Each OS mode has its own four layers; the keyboard switches between Mac and Windows with its own key combo.
              </p>
              {changed > 0 && editable && (
                <button className="button" disabled={busy} onClick={resetLayer}>
                  Reset this layer
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  )
}
