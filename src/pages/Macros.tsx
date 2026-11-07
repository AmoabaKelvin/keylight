import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Segmented, Toggle } from '../components/controls'
import { backupOnce, daemon } from '../lib/api'
import { OFF, type RGB } from '../lib/color'
import { keyName, type Board } from '../lib/layout'
import { useLayout } from '../lib/useLayout'
import {
  CAPACITY,
  codeFromEvent,
  decodeArea,
  DEFAULT_DELAY,
  duration,
  encodeChecked,
  keyLabel,
  MACRO_COUNT,
  MACRO_KEYS,
  macroName,
  MAX_DELAY,
  MODIFIERS,
  problems,
  sameBytes,
  sameMacro,
  setMacroName,
  usedActions,
  type Action,
  type Issue,
  type Macro,
} from '../lib/macros'

type Os = 0 | 1
/** An action in the editor, with a stable id so rows keep their place (and focus) while edited or dragged. */
type Step = Action & { uid: number }
type Loaded = { bytes: number[]; base: Macro[]; draft: Step[][]; issues: Issue[] }
type Binding = { sub: number; index: number; id: string }

let uid = 1
const steps = (m: Macro): Step[] => m.map((a) => ({ down: a.down, code: a.code, delay: a.delay, uid: uid++ }))

/** Kept while you visit other pages (say, Keymap to bind a macro), so unsaved edits survive. */
const memory: { os: Os | null; selected: number; areas: Partial<Record<Os, Loaded>> } = { os: null, selected: 0, areas: {} }

const SUBS = ['base layer', 'Fn layer', 'Fn 2 layer', 'Fn 3 layer']
const LIT: RGB = [80, 140, 255]
const CAPS = 0x39

const GROUPS: { id: string; label: string; categories: string[] }[] = [
  { id: 'basic', label: 'Letters & numbers', categories: ['letter', 'number', 'symbol'] },
  { id: 'mods', label: 'Modifiers & editing', categories: ['modifier', 'editing', 'navigation'] },
  { id: 'fkeys', label: 'F-keys', categories: ['fkey'] },
  { id: 'mouse', label: 'Mouse', categories: ['mouse'] },
  { id: 'more', label: 'More', categories: ['keypad', 'international'] },
]

const where = (b: Binding, board: Board) => {
  const key = b.id === 'knob-left' ? 'Knob, turned left' : b.id === 'knob-right' ? 'Knob, turned right' : b.id === 'knob-press' ? 'Knob press' : keyName(board.byId.get(b.id)!)
  return b.sub === 0 ? key : `${key} (${SUBS[b.sub]})`
}

const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`)

/** Keys pressed and never released by the end of the macro; the keyboard would leave them held. */
function stuck(m: Macro): number[] {
  const down = new Set<number>()
  for (const a of m) a.down ? down.add(a.code) : down.delete(a.code)
  return [...down]
}

export function MacrosPage({ ctx, onAssign }: { ctx: Ctx; onAssign: (os: Os, id: number) => void }) {
  const { state } = ctx
  const board = useLayout()
  const { matrix: MATRIX, byId: BY_ID, keyLeds: KEY_LEDS } = board
  const [os, setOs] = useState<Os>(memory.os ?? (state.device.os === 'windows' ? 1 : 0))
  const [selected, setSelected] = useState(memory.selected)
  const [areas, setAreas] = useState(memory.areas)
  const [bindings, setBindings] = useState<Partial<Record<Os, Binding[][]>>>({})
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [, rename] = useState(0)

  useEffect(() => {
    memory.os = os
    memory.selected = selected
    memory.areas = areas
  }, [os, selected, areas])

  const area = areas[os]
  const draft = area?.draft
  const macro = draft?.[selected] ?? []

  const load = useCallback(
    async (mode: Os) => {
      if (!state.connected) return
      try {
        const r = await daemon<{ bytes: number[] }>({ op: 'macros', os: mode })
        const { macros, issues } = decodeArea(r.bytes)
        setAreas((a) => ({ ...a, [mode]: { bytes: r.bytes, base: macros, draft: macros.map(steps), issues } }))
        setStale(false)
        setError(null)
      } catch (e) {
        setError(String(e))
      }
    },
    [state.connected],
  )

  /** Which keys play which macro: [0x77, id] words on this mode's four layers. Read on every visit, since Keymap may have changed them. */
  const loadBindings = useCallback(
    async (mode: Os) => {
      if (!state.connected) return
      try {
        const found: Binding[][] = Array.from({ length: MACRO_COUNT }, () => [])
        for (let sub = 0; sub < 4; sub++) {
          const r = await daemon<{ keys: number[] }>({ op: 'keymap', layer: mode * 4 + sub })
          r.keys.forEach((w, index) => {
            const id = MATRIX[index]
            if (id && w >> 8 === 0x77 && (w & 0xff) < MACRO_COUNT) found[w & 0xff].push({ sub, index, id })
          })
        }
        setBindings((b) => ({ ...b, [mode]: found }))
      } catch {
        // The macros still load; the board just can't show where they're bound.
      }
    },
    [state.connected, MATRIX],
  )

  // Read on each visit, unless that would throw away unsaved edits kept from the last one.
  const visited = useRef(new Set<Os>())
  useEffect(() => {
    if (!state.connected) return
    const a = areas[os]
    if (a && visited.current.has(os)) return
    visited.current.add(os)
    if (!a || a.draft.every((m, i) => sameMacro(m, a.base[i]))) load(os)
  }, [os, areas, state.connected, load])

  useEffect(() => {
    if (state.connected && !bindings[os]) loadBindings(os)
  }, [os, bindings, state.connected, loadBindings])

  const setMacro = (id: number, next: Step[]) => {
    setSaved(null)
    setAreas((a) => {
      const cur = a[os]
      return cur ? { ...a, [os]: { ...cur, draft: cur.draft.map((m, i) => (i === id ? next : m)) } } : a
    })
  }
  const edit = (fn: (m: Step[]) => Step[]) => setMacro(selected, fn(macro))

  const dirty = area ? area.draft.map((m, i) => !sameMacro(m, area.base[i])) : []
  const dirtyCount = dirty.filter(Boolean).length
  const used = draft ? usedActions(draft) : 0
  const blockers = draft ? problems(draft) : []

  // ---- recording -------------------------------------------------------------------------
  const [recording, setRecording] = useState(false)
  const [realTiming, setRealTiming] = useState(() => localStorage.getItem('macro-real-timing') === '1')
  const [skipped, setSkipped] = useState<string | null>(null)
  const rec = useRef<{ actions: Step[]; held: number[]; last: number } | null>(null)

  useEffect(() => localStorage.setItem('macro-real-timing', realTiming ? '1' : '0'), [realTiming])

  const room = CAPACITY - (used - macro.length)

  const startRecording = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    rec.current = { actions: [], held: [], last: 0 }
    setSkipped(null)
    setPicker(null)
    setRecording(true)
    setMacro(selected, [])
  }

  const stopRecording = useCallback(() => {
    const r = rec.current
    if (!r) return
    // Let go of anything still held, last pressed first, so the macro never leaves a key down.
    for (const code of [...r.held].reverse()) if (r.actions.length < room) r.actions.push({ down: false, code, delay: DEFAULT_DELAY, uid: uid++ })
    r.held = []
    rec.current = null
    setRecording(false)
    setMacro(selected, [...r.actions])
  }, [selected, room, os])

  useEffect(() => {
    if (!recording) return
    const push = (down: boolean, code: number) => {
      const r = rec.current!
      const now = performance.now()
      const prev = r.actions[r.actions.length - 1]
      if (prev && realTiming) prev.delay = Math.min(MAX_DELAY, Math.max(1, Math.round(now - r.last)))
      r.last = now
      r.actions.push({ down, code, delay: DEFAULT_DELAY, uid: uid++ })
      if (down) r.held.push(code)
      else r.held = r.held.filter((c) => c !== code)
    }
    const commit = () => {
      const r = rec.current!
      // Leave room for the releases of keys still held.
      if (r.actions.length + r.held.length >= room) stopRecording()
      else setMacro(selected, [...r.actions])
    }
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.repeat) return
      if (e.code === 'Escape') return stopRecording()
      const code = codeFromEvent(e.code)
      if (code === null) return setSkipped(e.key && e.key.length === 1 ? e.key.toUpperCase() : e.code || e.key)
      // macOS reports Caps Lock once per press, as a keydown or a keyup; either one is a tap.
      if (code === CAPS) {
        push(true, code)
        push(false, code)
        return commit()
      }
      // While ⌘ is down macOS drops other keys' keyups, so a key can come down again without going up.
      if (rec.current!.held.includes(code)) push(false, code)
      push(true, code)
      commit()
    }
    const onUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      const code = codeFromEvent(e.code)
      if (code === null || e.code === 'Escape') return
      if (code === CAPS) {
        push(true, code)
        push(false, code)
        return commit()
      }
      const r = rec.current!
      if (!r.held.includes(code)) return
      // ⌘ going up: release the keys macOS never sent keyups for, before ⌘ itself.
      if (code === 0xe3 || code === 0xe7) for (const c of [...r.held].reverse()) if (!MODIFIERS.has(c)) push(false, c)
      push(false, code)
      commit()
    }
    const onBlur = () => stopRecording()
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording, realTiming, stopRecording])

  // ---- picking keys ------------------------------------------------------------------------
  const [picker, setPicker] = useState<{ index: number | null } | null>(null)
  const [addAs, setAddAs] = useState<'tap' | 'down' | 'up'>('tap')
  const [group, setGroup] = useState('basic')
  const [query, setQuery] = useState('')

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return MACRO_KEYS.filter((k) => k.label.toLowerCase().includes(q) || k.name.toLowerCase().includes(q)).slice(0, 80)
    const cats = GROUPS.find((g) => g.id === group)!.categories
    return MACRO_KEYS.filter((k) => cats.includes(k.category))
  }, [group, query])

  const pick = (code: number) => {
    if (!picker) return
    if (picker.index !== null) {
      const i = picker.index
      edit((m) => m.map((a, j) => (j === i ? { ...a, code } : a)))
      setPicker(null)
      return
    }
    const add: Step[] =
      addAs === 'tap'
        ? [
            { down: true, code, delay: DEFAULT_DELAY, uid: uid++ },
            { down: false, code, delay: DEFAULT_DELAY, uid: uid++ },
          ]
        : [{ down: addAs === 'down', code, delay: DEFAULT_DELAY, uid: uid++ }]
    edit((m) => [...m, ...add])
  }

  // ---- saving ---------------------------------------------------------------------------
  const save = async () => {
    if (!area || !state.connected) return
    setBusy(true)
    setError(null)
    try {
      const bytes = encodeChecked(area.draft)
      // Someone (NuPhy IO, another Mac) may have changed the macros since they were read.
      const now = await daemon<{ bytes: number[] }>({ op: 'macros', os })
      if (!sameBytes(now.bytes, area.bytes)) {
        setStale(true)
        throw new Error('The macros on the keyboard changed since Keylight read them. Read them again, then redo your edits.')
      }
      await backupOnce()
      await daemon({ op: 'macro_write', os, bytes })
      const back = await daemon<{ bytes: number[] }>({ op: 'macros', os })
      if (!sameBytes(back.bytes, bytes)) throw new Error('The keyboard didn’t keep the macros exactly as sent. Read them again to see what it has.')
      const { macros, issues } = decodeArea(bytes)
      setAreas((a) => ({ ...a, [os]: { bytes, base: macros, draft: a[os]!.draft, issues } }))
      setSaved(`Saved ${dirtyCount === 1 ? 'the macro' : `${dirtyCount} macros`} to the keyboard.`)
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
    }
    setBusy(false)
  }

  const revert = () => {
    if (!area) return
    setAreas((a) => ({ ...a, [os]: { ...area, draft: area.base.map(steps) } }))
    setPicker(null)
    setSaved(null)
  }

  // ---- the board ---------------------------------------------------------------------------
  const bound = bindings[os]
  const mine = bound?.[selected] ?? []
  const { frame, legends, rings, focus } = useMemo(() => {
    const frame: RGB[] = Array.from({ length: KEY_LEDS }, () => OFF)
    const legends: Record<string, { label: string }> = {}
    const rings: Record<string, string> = {}
    const focus = new Set<string>()
    bound?.forEach((list, id) =>
      list.forEach((b) => {
        const key = BY_ID.get(b.id)
        if (!key) return
        // A key can play different macros on different layers; the base layer wins the legend.
        if (!legends[b.id] || b.sub === 0 || id === selected) legends[b.id] = { label: `M${id + 1}` }
        focus.add(b.id)
        if (id === selected) {
          frame[key.led] = LIT
          rings[b.id] = 'var(--accent)'
        }
      }),
    )
    return { frame, legends, rings, focus: focus.size ? focus : undefined }
  }, [bound, selected, BY_ID, KEY_LEDS])

  const keyMacros = (id: string) => (bound ?? []).flatMap((list, m) => list.filter((b) => b.id === id).map((b) => ({ m, sub: b.sub })))

  const issues = area?.issues ?? []
  const modeName = os === 0 ? 'Mac' : 'Windows'
  const editable = !!area && !recording && !busy
  const oneAction = macro.length === 1
  const held = stuck(macro)

  return (
    <Page
      title="Macros"
      meta={
        !area ? (
          state.connected ? (
            'Reading your macros…'
          ) : (
            'Plug in the USB cable to see and change your macros. They live on the keyboard.'
          )
        ) : (
          <>
            {area.base.filter((m) => m.length).length} of 32 macros used in {modeName} mode. Pick a macro to edit it, or an empty slot to record a new one.
          </>
        )
      }
      state={state}
      actions={
        <div className="row-actions">
          <Segmented
            value={os}
            options={[
              { value: 0, label: 'Mac' },
              { value: 1, label: 'Windows' },
            ]}
            onChange={(v) => {
              if (recording) return
              setOs(v)
              setPicker(null)
              setSaved(null)
              setError(null)
            }}
          />
        </div>
      }
      board={
        <Keyboard
          frame={frame}
          legends={legends}
          rings={rings}
          focus={focus}
          onKeyDown={(k) => {
            const on = keyMacros(k.id)
            if (on.length && !recording) setSelected((on.find((x) => x.sub === 0) ?? on[0]).m)
          }}
          tip={(k) => {
            const on = keyMacros(k.id)
            return (
              <Tip title={keyName(k)}>
                {on.length ? on.map(({ m, sub }) => `M${m + 1}${macroName(os, m) ? ` ${macroName(os, m)}` : ''}${sub ? ` on the ${SUBS[sub]}` : ''}`).join(', ') : 'No macro'}
              </Tip>
            )
          }}
        />
      }
    >
      {error && (
        <p className="row-error">
          {error}{' '}
          {stale && (
            <button className="button small" onClick={() => load(os)}>
              Read again
            </button>
          )}
        </p>
      )}

      {!area ? null : (
        <>
          {issues.length > 0 && (
            <div className="setup">
              <p>
                {issues.length === 1 ? `M${issues[0].id + 1} holds` : `${issues.length} slots (${issues.map((i) => `M${i.id + 1}`).join(', ')}) hold`} leftover data instead of a
                macro. Keylight shows {issues.length === 1 ? 'it' : 'them'} as empty, and saving {modeName} macros clears {issues.length === 1 ? 'it' : 'them'}.
              </p>
            </div>
          )}

          <div className="macro-grid">
            {area.draft.map((m, id) => {
              const name = macroName(os, id)
              const on = bound?.[id] ?? []
              return (
                <button key={id} className={`macro-slot${id === selected ? ' on' : ''}${m.length ? '' : ' free'}`} disabled={recording} onClick={() => setSelected(id)}>
                  <span className="macro-slot-head">
                    <span className="macro-slot-id">M{id + 1}</span>
                    {dirty[id] && <span className="macro-dirty" title="Not saved yet" />}
                    {on.length > 0 && <span className="macro-slot-key">{legendFor(on[0], board)}</span>}
                  </span>
                  <span className="macro-slot-name">{name || (m.length ? `${m.length} actions` : 'Empty')}</span>
                </button>
              )
            })}
          </div>

          <section className="macro-editor">
            <div className="macro-head">
              <div className="macro-title">
                <span className="macro-id">M{selected + 1}</span>
                <input
                  key={`${os}-${selected}`}
                  className="macro-name"
                  placeholder="Name this macro"
                  defaultValue={macroName(os, selected)}
                  spellCheck={false}
                  maxLength={40}
                  onChange={(e) => {
                    setMacroName(os, selected, e.target.value)
                    rename((n) => n + 1)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <div className="row-actions">
                <button className="button" disabled={!state.connected || recording || !area.base[selected].length} title={area.base[selected].length ? undefined : 'Save the macro first'} onClick={() => onAssign(os, selected)}>
                  Assign to a key
                </button>
                {recording ? (
                  <button className="button record on" onClick={stopRecording}>
                    <span className="record-dot" /> Stop
                  </button>
                ) : (
                  <button className="button record" disabled={!editable} onClick={startRecording}>
                    <span className="record-dot" /> {macro.length ? 'Record again' : 'Record'}
                  </button>
                )}
              </div>
            </div>
            <p className="row-help macro-meta">
              {macro.length ? (
                <>
                  {macro.length} {macro.length === 1 ? 'action' : 'actions'} · plays in {seconds(duration(macro))} ·{' '}
                </>
              ) : null}
              {mine.length ? <>On {mine.map((b) => where(b, board)).join(', ')}</> : 'Not on a key yet'}
            </p>

            <AnimatePresence initial={false}>
              {recording && (
                <motion.div className="recording" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                  <div className="recording-inner">
                    <span className="live">
                      <span className="live-dot" /> Recording
                    </span>
                    <p>
                      Type the keys for this macro, then press <kbd>esc</kbd> or Stop. Keylight never sees esc itself, or shortcuts that macOS or another app takes first, like
                      ⌘Tab and your Hyper shortcuts. Add those with Add key.
                      {skipped && <> Skipped {skipped}, which a macro can’t send.</>}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {macro.length === 0 && !recording ? (
              <p className="macro-none">Empty. Record the keys, or add them one at a time.</p>
            ) : (
              <Reorder.Group as="ol" axis="y" className="actions" values={macro} onReorder={(next: Step[]) => setMacro(selected, next)}>
                {macro.map((a, i) => (
                  <ActionRow
                    key={a.uid}
                    step={a}
                    index={i}
                    last={i === macro.length - 1}
                    count={macro.length}
                    disabled={!editable}
                    picking={picker?.index === i}
                    onChange={(next) => edit((m) => m.map((x) => (x.uid === a.uid ? { ...x, ...next } : x)))}
                    onMove={(by) =>
                      edit((m) => {
                        const out = [...m]
                        const [it] = out.splice(i, 1)
                        out.splice(i + by, 0, it)
                        return out
                      })
                    }
                    onRemove={() => edit((m) => m.filter((x) => x.uid !== a.uid))}
                    onPick={() => setPicker(picker?.index === i ? null : { index: i })}
                  />
                ))}
              </Reorder.Group>
            )}

            {!recording && (oneAction || held.length > 0) && (
              <div className="setup warn">
                <p>
                  {oneAction ? (
                    <>
                      <strong>One action won’t save.</strong> The keyboard reads a one-action macro back as empty.
                    </>
                  ) : (
                    <>
                      <strong>{held.map((c) => keyLabel(c).label).join(', ')} never released.</strong> The keyboard will hold {held.length === 1 ? 'it' : 'them'} down after the
                      macro ends.
                    </>
                  )}
                </p>
                <button
                  className="button"
                  disabled={!editable}
                  onClick={() =>
                    edit((m) => (m.length === 1 && !m[0].down ? [] : [...m, ...stuck(m).reverse().map((code) => ({ down: false, code, delay: DEFAULT_DELAY, uid: uid++ }))]))
                  }
                >
                  {oneAction && !macro[0].down ? 'Remove it' : 'Add the release'}
                </button>
              </div>
            )}

            <div className="macro-tools">
              <button className={`button${picker?.index === null ? ' on' : ''}`} disabled={!editable} onClick={() => setPicker(picker?.index === null ? null : { index: null })}>
                Add key
              </button>
              {macro.length > 0 && (
                <button className="button quiet-plain" disabled={!editable} onClick={() => edit(() => [])}>
                  Clear
                </button>
              )}
              <label className="timing">
                <Toggle on={realTiming} onChange={setRealTiming} label="Record real timing" />
                <span>
                  Record real timing
                  <span className="row-note"> · otherwise {DEFAULT_DELAY} ms between keys</span>
                </span>
              </label>
            </div>

            <AnimatePresence initial={false}>
              {picker && (
                <motion.div key="picker" className="picker macro-picker" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  <div className="picker-head">
                    <div>
                      <h3>{picker.index === null ? 'Add a key' : `Change action ${picker.index + 1}`}</h3>
                      <p className="row-help">
                        {picker.index === null
                          ? addAs === 'tap'
                            ? 'Adds a press and a release.'
                            : addAs === 'down'
                              ? 'Adds a press only. Add its release later in the macro, or the key stays held.'
                              : 'Adds a release only.'
                          : `Now: ${keyLabel(macro[picker.index]?.code ?? 0).name}`}
                      </p>
                    </div>
                    <div className="row-actions">
                      {picker.index === null && (
                        <Segmented
                          value={addAs}
                          options={[
                            { value: 'tap', label: 'Tap' },
                            { value: 'down', label: 'Press' },
                            { value: 'up', label: 'Release' },
                          ]}
                          onChange={setAddAs}
                        />
                      )}
                      <input className="field search" placeholder="Search keys" value={query} onChange={(e) => setQuery(e.target.value)} />
                      <button className="button quiet-plain" onClick={() => setPicker(null)}>
                        Done
                      </button>
                    </div>
                  </div>
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
                        className={`code${picker.index !== null && macro[picker.index]?.code === k.code ? ' on' : ''}`}
                        title={k.name}
                        disabled={!editable || (picker.index === null && used + (addAs === 'tap' ? 2 : 1) > CAPACITY)}
                        onClick={() => pick(k.code)}
                      >
                        <span className="code-label">{k.label}</span>
                        {k.name !== k.label && <span className="code-name">{k.name}</span>}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <div className="macro-bar">
            <div className="meter" title={`${used} of ${CAPACITY} actions`}>
              <div className="meter-track">
                <motion.div className={`meter-fill${used > CAPACITY ? ' over' : ''}`} animate={{ width: `${Math.min(100, (used / CAPACITY) * 100)}%` }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <span className="meter-text">
                {used > CAPACITY ? (
                  <>
                    <strong>{used - CAPACITY} over</strong> the {CAPACITY} actions {modeName} macros share
                  </>
                ) : (
                  <>
                    <strong>{CAPACITY - used}</strong> of {CAPACITY} actions free in {modeName} mode
                  </>
                )}
              </span>
            </div>
            <div className="row-actions">
              {saved && !dirtyCount && <span className="row-note saved">{saved}</span>}
              {dirtyCount > 0 && (
                <>
                  <span className="row-note">{!state.connected ? 'Plug in the cable to save' : blockers.length ? blockers[0] : `${dirtyCount} not saved`}</span>
                  <button className="button" disabled={busy || recording} onClick={revert}>
                    Revert
                  </button>
                </>
              )}
              <button className="button primary" disabled={!dirtyCount || busy || recording || !state.connected || blockers.length > 0} onClick={save}>
                {busy ? 'Saving…' : 'Save to keyboard'}
              </button>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}

function legendFor(b: Binding, board: Board) {
  const key = board.byId.get(b.id)
  if (!key) return b.id.startsWith('knob') ? 'Knob' : ''
  return (key.label || keyName(key)).slice(0, 6)
}

function ActionRow({
  step,
  index,
  last,
  count,
  disabled,
  picking,
  onChange,
  onMove,
  onRemove,
  onPick,
}: {
  step: Step
  index: number
  last: boolean
  count: number
  disabled: boolean
  picking: boolean
  onChange: (a: Partial<Action>) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
  onPick: () => void
}) {
  const drag = useDragControls()
  const k = keyLabel(step.code)
  const [delay, setDelay] = useState(String(step.delay))
  useEffect(() => setDelay(String(step.delay)), [step.delay])
  return (
    <Reorder.Item as="li" value={step} dragListener={false} dragControls={drag} className={`action${picking ? ' picking' : ''}`} transition={{ duration: 0.2 }}>
      <span className="action-grip" onPointerDown={(e) => !disabled && drag.start(e)} title="Drag to reorder">
        <GripIcon />
      </span>
      <span className="action-n">{index + 1}</span>
      <button className={`action-dir ${step.down ? 'down' : 'up'}`} disabled={disabled} title="Switch between press and release" onClick={() => onChange({ down: !step.down })}>
        {step.down ? '↓ Press' : '↑ Release'}
      </button>
      <button className="action-key" disabled={disabled} title={`${k.name}. Click to change.`} onClick={onPick}>
        <span className="action-cap">{k.label}</span>
        {/* "H" or "0 )" says nothing the cap doesn't. */}
        {k.name !== k.label && !k.name.startsWith(`${k.label} `) && <span className="action-name">{k.name}</span>}
      </button>
      <span className="action-wait">
        {last ? (
          <span className="row-note">end</span>
        ) : (
          <>
            <span className="row-note">then wait</span>
            <input
              className="field action-delay"
              inputMode="numeric"
              value={delay}
              disabled={disabled}
              aria-label="Wait after this action, in milliseconds"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 5)
                setDelay(v)
                const n = +v
                if (v && n >= 1 && n <= MAX_DELAY) onChange({ delay: n })
              }}
              onBlur={() => {
                const n = Math.min(MAX_DELAY, Math.max(1, +delay || 1))
                setDelay(String(n))
                onChange({ delay: n })
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span className="row-note">ms</span>
          </>
        )}
      </span>
      <span className="action-buttons">
        <button className="icon-button" disabled={disabled || index === 0} title="Move up" onClick={() => onMove(-1)}>
          <ArrowIcon up />
        </button>
        <button className="icon-button" disabled={disabled || index === count - 1} title="Move down" onClick={() => onMove(1)}>
          <ArrowIcon />
        </button>
        <button className="icon-button danger" disabled={disabled} title="Remove" onClick={onRemove}>
          <CrossIcon />
        </button>
      </span>
    </Reorder.Item>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      {[4, 8, 12].map((y) => [6, 10].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" />))}
    </svg>
  )
}

function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={up ? undefined : { transform: 'rotate(180deg)' }}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
