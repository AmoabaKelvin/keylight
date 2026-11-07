import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Segmented, Slider } from '../components/controls'
import {
  actionKeys,
  actionLabel,
  actionOk,
  advancedOf,
  apply,
  DEFAULT_DELAY,
  describeTapDance,
  describeToggle,
  describeWord,
  encodeSocd,
  encodeTapDance,
  encodeToggle,
  fnLayers,
  layerKeys,
  MAX_DELAY,
  MIN_DELAY,
  planEdit,
  planRemove,
  planSingle,
  planSocd,
  PRIORITIES,
  PRIORITY_BITS,
  priorityOf,
  readMode,
  references,
  SLOTS,
  socdAt,
  socdOutput,
  tapDanceAt,
  tapDanceProblem,
  toggleAt,
  TYPE_NAMES,
  TYPES,
  type AdvancedType,
  type Mode,
  type Op,
  type Os,
  type Priority,
  type Ref,
} from '../lib/advanced'
import { OFF, type RGB } from '../lib/color'
import { backupOnce } from '../lib/api'
import { DEFAULT_LAYERS, matrixIndex, MATRIX, TRANSPARENT } from '../lib/keycodes'
import { BY_ID, KEY_LEDS, keyName } from '../lib/layout'

/** Open the page on this mode and type, and on the advanced key in `slot` if given. */
export type AdvancedFocus = { os: Os; type: AdvancedType; slot?: number }

const LAYERS = [
  { value: 0, label: 'Base' },
  { value: 1, label: 'Fn' },
  { value: 2, label: 'Fn 2' },
  { value: 3, label: 'Fn 3' },
] as const
const SUBS = ['base layer', 'Fn layer', 'Fn 2 layer', 'Fn 3 layer']
const LIT: RGB = [80, 140, 255]
const TAB_LABEL: Record<AdvancedType, string> = { socd: 'SOCD', tapdance: 'Tap Dance', tgl: 'Toggle' }

const INTRO: Record<AdvancedType, string> = {
  socd: 'Pair two keys, like A and D, and choose which one types while you hold both. Handy for strafing in games.',
  tapdance: 'A tap, a double tap and a hold on one key can each do something different.',
  tgl: 'Tap once to switch a layer or key on, tap again to switch it off.',
}

/** An advanced key as the page lists it: one SOCD pair, Tap Dance or Toggle, and the keys holding it. */
type Item = { type: AdvancedType; slots: number[]; refs: Ref[][] }

type Draft =
  | { type: 'socd'; slots: number[] | null; keys: (Ref | null)[]; prio: Priority }
  | { type: 'tapdance'; slot: number | null; key: Ref | null; tap: number; double: number; hold: number; delay: number }
  | { type: 'tgl'; slot: number | null; key: Ref | null; code: number }

const blank = (type: AdvancedType): Draft =>
  type === 'socd'
    ? { type, slots: null, keys: [null, null], prio: 'last' }
    : type === 'tapdance'
      ? { type, slot: null, key: null, tap: 0, double: 0, hold: 0, delay: DEFAULT_DELAY }
      : { type, slot: null, key: null, code: 0 }

const keyAt = (r: Ref) => {
  const id = MATRIX[r.index]
  const k = id ? BY_ID.get(id) : undefined
  return k ? keyName(k) : `key ${r.index}`
}
const where = (r: Ref) => (r.sub ? `${keyAt(r)} (${SUBS[r.sub]})` : keyAt(r))
const sameRef = (a: Ref | null, b: Ref | null) => !!a && !!b && a.sub === b.sub && a.index === b.index

export function AdvancedPage({ ctx, focus, onFocusEnd }: { ctx: Ctx; focus?: AdvancedFocus | null; onFocusEnd?: () => void }) {
  const { state } = ctx
  const [os, setOs] = useState<Os>(focus ? focus.os : state.device.os === 'windows' ? 1 : 0)
  const [sub, setSub] = useState<0 | 1 | 2 | 3>(0)
  const [modes, setModes] = useState<Partial<Record<Os, Mode>>>({})
  const [tab, setTab] = useState<AdvancedType>(focus?.type ?? 'tapdance')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [backup, setBackup] = useState<string | null>(null)
  const [picking, setPicking] = useState<'tap' | 'double' | 'hold' | 'tgl' | null>(null)
  /** Bumped when the editor opens on something else, so it animates in; saving keeps it in place. */
  const [session, setSession] = useState(0)

  const mode = modes[os]

  const load = useCallback(
    async (m: Os) => {
      if (!state.connected) return
      try {
        const r = await readMode(m)
        setModes((ms) => ({ ...ms, [m]: r }))
        setError(null)
      } catch (e) {
        setError(String(e).replace(/^Error: /, ''))
      }
    },
    [state.connected],
  )

  // Read on every visit: the Keymap page or NuPhy IO may have moved keys since.
  useEffect(() => {
    if (state.connected && !modes[os]) load(os)
  }, [os, modes, state.connected, load])

  const layers = mode?.layers ?? DEFAULT_LAYERS.slice(os * 4, os * 4 + 4).map((l) => [...l])
  const refs = useMemo(() => references(layers), [layers])

  const items = useMemo(() => {
    const out: Record<AdvancedType, Item[]> = { socd: [], tapdance: [], tgl: [] }
    if (!mode) return out
    const seen = new Set<number>()
    for (const s of [...refs.socd.keys()].sort((a, b) => a - b)) {
      if (seen.has(s)) continue
      seen.add(s)
      const p = socdAt(mode.tables, os, s).partner
      if (p < SLOTS && p !== s && refs.socd.has(p) && !seen.has(p) && socdAt(mode.tables, os, p).partner === s) {
        seen.add(p)
        out.socd.push({ type: 'socd', slots: [s, p], refs: [refs.socd.get(s)!, refs.socd.get(p)!] })
      } else out.socd.push({ type: 'socd', slots: [s], refs: [refs.socd.get(s)!] })
    }
    for (const type of ['tapdance', 'tgl'] as const)
      for (const s of [...refs[type].keys()].sort((a, b) => a - b)) out[type].push({ type, slots: [s], refs: [refs[type].get(s)!] })
    return out
  }, [mode, refs, os])

  const itemFor = (type: AdvancedType, slot: number) => items[type].find((i) => i.slots.includes(slot))

  /** A draft that edits what an item holds now. */
  const open = (item: Item): Draft => {
    const t = mode!.tables
    if (item.type === 'socd') {
      const [a, b] = item.slots
      return { type: 'socd', slots: item.slots, keys: item.refs.map((r) => r[0]), prio: b === undefined ? 'last' : priorityOf(socdAt(t, os, a).prio, socdAt(t, os, b).prio) }
    }
    if (item.type === 'tapdance') {
      const e = tapDanceAt(t, os, item.slots[0])
      return { type: 'tapdance', slot: item.slots[0], key: item.refs[0][0], ...e, delay: Math.min(MAX_DELAY, Math.max(MIN_DELAY, e.delay || DEFAULT_DELAY)) }
    }
    return { type: 'tgl', slot: item.slots[0], key: item.refs[0][0], code: toggleAt(t, os, item.slots[0]).code }
  }

  const select = (item: Item) => {
    setTab(item.type)
    setDraft(open(item))
    setSession((n) => n + 1)
    setNote(null)
    setSaved(null)
    setPicking(null)
  }

  // Arriving from the Keymap page with an advanced key to edit.
  useEffect(() => {
    if (!focus || !mode || focus.os !== os) return
    const item = focus.slot === undefined ? undefined : itemFor(focus.type, focus.slot)
    if (item) select(item)
    else setTab(focus.type)
    onFocusEnd?.()
  }, [focus, mode, os])

  const selectedItem = draft && (draft.type === 'socd' ? draft.slots && itemFor('socd', draft.slots[0]) : draft.slot !== null ? itemFor(draft.type, draft.slot) : undefined)
  const isNew = !!draft && !selectedItem

  /** What a key types on the layer it's on, looking through to the base layer. */
  const typed = (r: Ref) => {
    const w = layers[r.sub][r.index]
    return w === TRANSPARENT ? layers[0][r.index] : w
  }

  // ---- the board -----------------------------------------------------------------------------
  const onKey = (id: string) => {
    if (busy) return
    const index = matrixIndex(id)
    if (index < 0) return
    const ref: Ref = { sub, index }
    const adv = advancedOf(layers[sub][index])
    setSaved(null)
    if (adv) {
      const item = itemFor(adv.type, adv.slot)
      if (isNew) return setNote(`${keyAt(ref)} is already a ${TYPE_NAMES[adv.type].name}. Pick another key.`)
      if (item) select(item)
      return
    }
    if (!mode) return
    if (!isNew || !draft) return start(tab, ref)
    if (draft.type === 'socd') {
      if (draft.keys.some((k) => sameRef(k, ref))) return setDraft({ ...draft, keys: draft.keys.map((k) => (sameRef(k, ref) ? null : k)) })
      const code = typed(ref)
      if (!socdOutput(code)) return setNote(`SOCD keys must type a single key, like a letter. ${keyAt(ref)} sends ${actionLabel(code, os).name}.`)
      const slot = draft.keys[0] ? (draft.keys[1] ? null : 1) : 0
      if (slot === null) return setNote('Both keys are picked. Click one of them to take it out.')
      setNote(null)
      return setDraft({ ...draft, keys: draft.keys.map((k, i) => (i === slot ? ref : k)) })
    }
    setNote(null)
    return start(draft.type, ref, draft)
  }

  /** A new advanced key on `ref`, keeping what's been chosen in `from`. */
  const start = (type: AdvancedType, ref: Ref, from?: Draft) => {
    setPicking(null)
    setNote(null)
    const d = from && from.type === type ? from : blank(type)
    if (d !== from) setSession((n) => n + 1)
    if (d.type === 'socd') {
      const code = typed(ref)
      if (!socdOutput(code)) {
        setDraft(d)
        return setNote(`SOCD keys must type a single key, like a letter. ${keyAt(ref)} sends ${actionLabel(code, os).name}.`)
      }
      return setDraft({ ...d, keys: [ref, null] })
    }
    if (d.type === 'tapdance') {
      const code = typed(ref)
      return setDraft({ ...d, key: ref, tap: d.tap || (actionOk(code, os) && code > 1 ? code : 0) })
    }
    setDraft({ ...d, key: ref })
  }

  const draftKeys = (d: Draft | null): Ref[] => (!d ? [] : d.type === 'socd' ? (d.keys.filter(Boolean) as Ref[]) : d.key ? [d.key] : [])

  const { frame, legends, badges, rings } = useMemo(() => {
    const frame: RGB[] = Array.from({ length: KEY_LEDS }, () => OFF)
    const legends: Record<string, { label: string }> = {}
    const badges: Record<string, string> = {}
    const rings: Record<string, string> = {}
    layers[sub].forEach((w, i) => {
      const id = MATRIX[i]
      const d = id && describeWord(w, mode?.tables ?? null, os)
      if (!id || !d) return
      legends[id] = { label: d.label }
      badges[id] = d.badge
      rings[id] = 'var(--faint)'
    })
    const lit = selectedItem ? selectedItem.refs.flat() : draftKeys(draft)
    for (const r of lit) {
      const id = MATRIX[r.index]
      if (!id || r.sub !== sub) continue
      rings[id] = 'var(--accent)'
      frame[BY_ID.get(id)!.led] = LIT
    }
    return { frame, legends, badges, rings }
  }, [layers, sub, mode, os, selectedItem, draft])

  const keyTip = (id: string) => {
    const i = matrixIndex(id)
    const d = i >= 0 ? describeWord(layers[sub][i], mode?.tables ?? null, os) : null
    if (d) return d.name
    return isNew ? (draft?.type === 'socd' ? 'Click to add it to the pair' : 'Click to use this key') : `Click to make it a ${TYPE_NAMES[tab].name}`
  }

  // ---- saving --------------------------------------------------------------------------------

  const problem = (d: Draft): string | null => {
    if (d.type === 'socd') {
      if (!d.keys[0] || !d.keys[1]) return d.keys[0] ? 'Click the second key on the board.' : 'Click two keys on the board.'
      return null
    }
    if (!d.key) return 'Click a key on the board.'
    if (d.type === 'tapdance') return tapDanceProblem(d, os)
    if (!d.code) return 'Pick a layer or a key to toggle.'
    return actionOk(d.code, os) ? null : 'A Toggle key can’t send that.'
  }

  const run = async (ops: Op[], done: string, after?: (m: Mode) => void) => {
    if (!mode) return
    setBusy(true)
    setError(null)
    try {
      setBackup(await backupOnce())
      const now = await apply(os, ops)
      setModes((ms) => ({ ...ms, [os]: now }))
      after?.(now)
      setSaved(done)
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
      load(os)
    }
    setBusy(false)
  }

  const save = () => {
    if (!draft || !mode || problem(draft)) return
    setPicking(null)
    try {
      if (draft.type === 'socd') {
        const [a, b] = draft.keys as [Ref, Ref]
        if (selectedItem) {
          const [sa, sb] = selectedItem.slots
          const [pa, pb] = PRIORITY_BITS[draft.prio]
          const ea = socdAt(mode.tables, os, sa)
          const eb = socdAt(mode.tables, os, sb)
          return run([...planEdit(os, 'socd', sa, encodeSocd({ ...ea, prio: pa })), ...planEdit(os, 'socd', sb, encodeSocd({ ...eb, prio: pb }))], 'Saved the pair.')
        }
        const plan = planSocd(os, refs, [a, b], [typed(a), typed(b)], draft.prio)
        return run(plan.ops, `${keyAt(a)} and ${keyAt(b)} are an SOCD pair now.`, () => setDraft({ ...draft, slots: plan.slots }))
      }
      const bytes = draft.type === 'tapdance' ? encodeTapDance(draft, os) : encodeToggle(draft, os)
      if (draft.slot !== null && selectedItem) return run(planEdit(os, draft.type, draft.slot, bytes), `Saved the ${TYPE_NAMES[draft.type].name}.`)
      const plan = planSingle(os, refs, draft.type, draft.key!, bytes)
      return run(plan.ops, `${keyAt(draft.key!)} is a ${TYPE_NAMES[draft.type].name} now.`, () => setDraft({ ...draft, slot: plan.slot }))
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
    }
  }

  const remove = () => {
    if (!selectedItem || !mode) return
    const keys = selectedItem.slots.flatMap((slot, i) =>
      selectedItem.refs[i].map((ref) => {
        const word = mode.layers[ref.sub][ref.index]
        // An SOCD key goes back to typing its own key; the others go back to stock.
        const own = selectedItem.type === 'socd' ? socdAt(mode.tables, os, slot).code : 0
        const stock = mode.defaults[ref.sub][ref.index]
        return { ref, word, restore: socdOutput(own) ? own : advancedOf(stock) ? (ref.sub ? TRANSPARENT : 0) : stock }
      }),
    )
    const names = keys.map((k) => keyAt(k.ref)).join(' and ')
    run(planRemove(os, mode, keys), `Removed. ${names} ${keys.length === 1 ? 'is a plain key' : 'are plain keys'} again.`, () => setDraft(null))
  }

  const cancel = () => {
    setDraft(null)
    setPicking(null)
    setNote(null)
  }

  // ---- render --------------------------------------------------------------------------------
  const modeName = os === 0 ? 'Mac' : 'Windows'
  const editable = state.connected && !!mode && !busy
  const counts = { socd: items.socd.length, tapdance: items.tapdance.length, tgl: items.tgl.length }
  const why = draft ? problem(draft) : null
  const dirty = !!draft && (isNew || (selectedItem ? JSON.stringify(draft) !== JSON.stringify(open(selectedItem)) : false))

  return (
    <Page
      title="Advanced keys"
      meta={
        !state.connected
          ? 'Plug in the USB cable to see and change your advanced keys. They live on the keyboard.'
          : !mode
            ? 'Reading your keymap…'
            : 'Click any key to give it a second job. Keys marked SOCD, TD or TGL already have one; click them to change it.'
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
              setOs(v)
              cancel()
              setSaved(null)
              setError(null)
            }}
          />
        </div>
      }
      board={
        <>
          <div className="layer-tabs">
            <Segmented value={sub} options={LAYERS.map((l) => ({ value: l.value, label: l.label }))} onChange={(v) => setSub(v)} />
            <span className="row-note">{sub === 0 ? 'Most advanced keys go on the base layer.' : `While you hold ${LAYERS[sub].label}.`}</span>
          </div>
          <Keyboard frame={frame} legends={legends} badges={badges} rings={rings} onKeyDown={(k) => editable && onKey(k.id)} tip={(k) => <Tip title={keyName(k)}>{keyTip(k.id)}</Tip>} />
        </>
      }
    >
      {error && <p className="row-error">{error}</p>}
      {backup && (
        <p className="row-help">
          Backed up your keymap, macros and advanced keys before the first change: <code>{backup.replace(/^.*\/Library/, '~/Library')}</code>
        </p>
      )}

      <div className="adv-tabs">
        <Segmented
          value={tab}
          options={TYPES.map((t) => ({ value: t, label: counts[t] ? `${TAB_LABEL[t]} · ${counts[t]}` : TAB_LABEL[t] }))}
          onChange={(t) => {
            setTab(t)
            if (draft && draft.type !== t) cancel()
            setSaved(null)
          }}
        />
        <p className="row-help">{INTRO[tab]}</p>
      </div>

      <ul className="adv-list">
        {items[tab].map((item) => (
          <li key={item.slots.join('-')}>
            <button className={`adv-item${selectedItem === item ? ' on' : ''}`} disabled={!editable} onClick={() => (selectedItem === item ? cancel() : select(item))}>
              <ItemSummary item={item} mode={mode!} os={os} />
            </button>
          </li>
        ))}
        <li>
          <button className={`adv-item add${isNew ? ' on' : ''}`} disabled={!editable} onClick={() => (isNew ? cancel() : (setDraft(blank(tab)), setSession((n) => n + 1), setNote(null), setSaved(null)))}>
            <span className="adv-plus">+</span>
            <span className="adv-item-main">
              <span className="adv-item-title">New {TYPE_NAMES[tab].name}</span>
              <span className="adv-item-sub">
                {counts[tab] >= SLOTS ? 'All 32 slots are in use' : tab === 'socd' ? `${Math.floor((SLOTS - refs.socd.size) / 2)} pairs left in ${modeName} mode` : `${SLOTS - refs[tab].size} of 32 left in ${modeName} mode`}
              </span>
            </span>
          </button>
        </li>
      </ul>

      <AnimatePresence mode="wait" initial={false}>
        {draft && mode && (
          <motion.section
            key={session}
            className="adv-editor"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="adv-editor-head">
              <h3>{selectedItem ? TYPE_NAMES[draft.type].name : `New ${TYPE_NAMES[draft.type].name}`}</h3>
              <p className="row-help">{headline(draft, selectedItem)}</p>
            </div>

            {draft.type === 'socd' && (
              <SocdEditor
                draft={draft}
                caps={selectedItem ? selectedItem.slots.map((s) => actionLabel(socdAt(mode.tables, os, s).code, os).label) : draft.keys.map((k) => (k ? actionLabel(typed(k), os).label : null))}
                fixed={!!selectedItem}
                lone={!!selectedItem && selectedItem.slots.length === 1}
                onChange={setDraft}
              />
            )}
            {draft.type === 'tapdance' && (
              <TapDanceEditor draft={draft} os={os} picking={picking} onPick={setPicking} onChange={(d) => setDraft(d)} disabled={!editable} />
            )}
            {draft.type === 'tgl' && <ToggleEditor draft={draft} os={os} picking={picking === 'tgl'} onPick={(on) => setPicking(on ? 'tgl' : null)} onChange={setDraft} disabled={!editable} />}

            <AnimatePresence initial={false}>
              {note && (
                <motion.p className="adv-note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
                  {note}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="adv-bar">
              {selectedItem && (
                <button className="button quiet-plain danger-text" disabled={!editable} onClick={remove}>
                  Remove
                </button>
              )}
              <span className="row-note adv-why">{saved && !dirty ? <span className="saved">{saved}</span> : why}</span>
              <button className="button" disabled={busy} onClick={cancel}>
                {dirty ? 'Cancel' : 'Close'}
              </button>
              <button className="button primary" disabled={!editable || !!why || !dirty || (selectedItem?.type === 'socd' && selectedItem.slots.length === 1)} onClick={save}>
                {busy ? 'Saving…' : 'Save to keyboard'}
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {!draft && saved && <p className="row-note saved adv-saved">{saved}</p>}
      {!draft && (
        <p className="row-help adv-foot">
          {modeName} mode has its own 32 slots of each kind, separate from {os === 0 ? 'Windows' : 'Mac'}. Advanced keys can’t go on the knob.
        </p>
      )}
    </Page>
  )
}

function headline(d: Draft, item: Item | null | undefined): string {
  const keys = item ? item.refs.flat().map(where) : []
  if (d.type === 'socd') {
    if (item && item.slots.length === 1) return `${keys.join(', ')} lost the other key of its pair, so it types on its own. Remove it to make it a plain key again.`
    return item ? `On ${keys.join(' and ')}.` : d.keys[0] && d.keys[1] ? `${where(d.keys[0])} and ${where(d.keys[1])}.` : 'Click two keys on the board.'
  }
  if (item) return `On ${keys.join(', ')}.`
  return d.key ? `On ${where(d.key)}.` : 'Click a key on the board.'
}

function ItemSummary({ item, mode, os }: { item: Item; mode: Mode; os: Os }) {
  const t = mode.tables
  const on = item.refs.flat()
  const place = on.some((r) => r.sub) ? ` · ${SUBS[on[0].sub]}` : ''
  if (item.type === 'socd') {
    const caps = item.slots.map((s) => actionLabel(socdAt(t, os, s).code, os).label)
    const prio = item.slots.length === 2 ? priorityOf(socdAt(t, os, item.slots[0]).prio, socdAt(t, os, item.slots[1]).prio) : null
    const p = prio && PRIORITIES.find((x) => x.value === prio)!
    return (
      <>
        <span className="adv-caps">
          <span className="action-cap">{caps[0]}</span>
          {caps[1] !== undefined && (
            <>
              <span className="adv-pair">⇄</span>
              <span className="action-cap">{caps[1]}</span>
            </>
          )}
        </span>
        <span className="adv-item-main">
          <span className="adv-item-title">{p ? p.label(caps[0], caps[1]) : 'Other key missing'}</span>
          <span className="adv-item-sub">{on.map(keyAt).join(' and ') + place}</span>
        </span>
      </>
    )
  }
  const slot = item.slots[0]
  const text = item.type === 'tapdance' ? describeTapDance(tapDanceAt(t, os, slot), os) : describeToggle(toggleAt(t, os, slot), os)
  return (
    <>
      <span className="adv-caps">
        <span className="action-cap">{keyCapLabel(on[0])}</span>
      </span>
      <span className="adv-item-main">
        <span className="adv-item-title">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
        <span className="adv-item-sub">{on.map(keyAt).join(', ') + place}</span>
      </span>
    </>
  )
}

/** The printed legend of the key at `r`, short enough for a keycap. */
function keyCapLabel(r: Ref) {
  const id = MATRIX[r.index]
  const k = id ? BY_ID.get(id) : undefined
  if (!k) return '?'
  return (k.label || keyName(k)).slice(0, 6)
}

function SocdEditor({ draft, caps, fixed, lone, onChange }: { draft: Extract<Draft, { type: 'socd' }>; caps: (string | null)[]; fixed: boolean; lone: boolean; onChange: (d: Draft) => void }) {
  const [a, b] = [caps[0] ?? 'the first key', caps[1] ?? 'the second key']
  const prio = PRIORITIES.find((p) => p.value === draft.prio)!
  if (lone) return null
  return (
    <div className="adv-fields">
      <div className="adv-field">
        <span className="adv-label">Keys</span>
        <span className="adv-caps">
          {draft.keys.map((k, i) => (
            <span key={i} className="adv-slot-wrap">
              {i === 1 && <span className="adv-pair">⇄</span>}
              {k ? (
                <button className="action-cap adv-cap-button" disabled={fixed} title={fixed ? keyAt(k) : `${keyAt(k)}. Click to take it out.`} onClick={() => onChange({ ...draft, keys: draft.keys.map((x, j) => (j === i ? null : x)) })}>
                  {caps[i]}
                </button>
              ) : (
                <span className="adv-empty">{i === 0 || draft.keys[0] ? 'Click a key' : 'then another'}</span>
              )}
            </span>
          ))}
        </span>
      </div>
      <div className="adv-field">
        <span className="adv-label">Both held</span>
        <div>
          <Segmented value={draft.prio} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label(caps[0] ?? 'First', caps[1] ?? 'Second') }))} onChange={(v) => onChange({ ...draft, prio: v })} />
          <p className="row-help">{prio.help(a, b)}</p>
        </div>
      </div>
    </div>
  )
}

function TapDanceEditor({
  draft,
  os,
  picking,
  onPick,
  onChange,
  disabled,
}: {
  draft: Extract<Draft, { type: 'tapdance' }>
  os: Os
  picking: 'tap' | 'double' | 'hold' | 'tgl' | null
  onPick: (p: 'tap' | 'double' | 'hold' | null) => void
  onChange: (d: Draft) => void
  disabled: boolean
}) {
  const fields = [
    { id: 'tap', label: 'Tap' },
    { id: 'double', label: 'Double tap' },
    { id: 'hold', label: 'Hold' },
  ] as const
  return (
    <div className="adv-fields">
      {fields.map((f) => {
        const code = draft[f.id]
        const l = actionLabel(code, os)
        return (
          <div key={f.id} className="adv-field">
            <span className="adv-label">{f.label}</span>
            <button className={`adv-action${picking === f.id ? ' on' : ''}${code ? '' : ' none'}`} disabled={disabled} onClick={() => onPick(picking === f.id ? null : f.id)}>
              {code ? <span className="action-cap">{l.label}</span> : null}
              <span className="action-name">{code ? (l.name !== l.label ? l.name : '') : f.id === 'tap' ? 'Pick a key' : 'Nothing'}</span>
            </button>
            {code !== 0 && f.id !== 'tap' && (
              <button className="button small quiet-plain" disabled={disabled} onClick={() => onChange({ ...draft, [f.id]: 0 })}>
                Clear
              </button>
            )}
          </div>
        )
      })}
      <AnimatePresence initial={false}>
        {picking && picking !== 'tgl' && (
          <motion.div key="picker" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, pointerEvents: 'none' }} transition={{ duration: 0.16 }}>
            <CodePicker
              title={`${fields.find((f) => f.id === picking)!.label}: what it sends`}
              os={os}
              current={draft[picking]}
              onPick={(c) => {
                onChange({ ...draft, [picking]: c })
                onPick(null)
              }}
              onClose={() => onPick(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="adv-field">
        <span className="adv-label">Hold time</span>
        <div className="adv-slider">
          <Slider value={draft.delay} min={MIN_DELAY} max={MAX_DELAY} format={(v) => `${v} ms`} onChange={(v) => onChange({ ...draft, delay: Math.round(v / 10) * 10 })} />
          <p className="row-help">Hold longer than this and it counts as a hold. NuPhy’s default is 170 ms.</p>
        </div>
      </div>
    </div>
  )
}

function ToggleEditor({
  draft,
  os,
  picking,
  onPick,
  onChange,
  disabled,
}: {
  draft: Extract<Draft, { type: 'tgl' }>
  os: Os
  picking: boolean
  onPick: (on: boolean) => void
  onChange: (d: Draft) => void
  disabled: boolean
}) {
  const layers = layerKeys(os)
  const isLayer = fnLayers(os).includes(draft.code)
  const [kind, setKind] = useState<'layer' | 'key'>(draft.code && !isLayer ? 'key' : 'layer')
  const l = actionLabel(draft.code, os)
  return (
    <div className="adv-fields">
      <div className="adv-field">
        <span className="adv-label">Toggles</span>
        <Segmented
          value={kind}
          options={[
            { value: 'layer', label: 'A layer' },
            { value: 'key', label: 'A key' },
          ]}
          onChange={(v) => {
            setKind(v)
            onPick(false)
            if ((v === 'layer') !== isLayer) onChange({ ...draft, code: 0 })
          }}
        />
      </div>
      {kind === 'layer' ? (
        <div className="adv-field">
          <span className="adv-label">Layer</span>
          <div className="chips">
            {layers.map((k) => (
              <button key={k.code} className={`chip${draft.code === k.code ? ' on' : ''}`} disabled={disabled} onClick={() => onChange({ ...draft, code: k.code })}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="adv-field">
          <span className="adv-label">Key</span>
          <button className={`adv-action${picking ? ' on' : ''}${draft.code ? '' : ' none'}`} disabled={disabled} onClick={() => onPick(!picking)}>
            {draft.code ? <span className="action-cap">{l.label}</span> : null}
            <span className="action-name">{draft.code ? (l.name !== l.label ? l.name : '') : 'Pick a key'}</span>
          </button>
        </div>
      )}
      <p className="row-help adv-explain">
        {draft.code
          ? isLayer
            ? `Tap it to turn the ${l.name} on. Tap it again to turn it off.`
            : `Tap it to hold down ${l.name}. Tap it again to let go.`
          : kind === 'layer'
            ? 'Pick the layer it switches on and off.'
            : 'Pick the key it holds down, like Shift for typing in capitals.'}
      </p>
      <AnimatePresence initial={false}>
        {picking && kind === 'key' && (
          <motion.div key="picker" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, pointerEvents: 'none' }} transition={{ duration: 0.16 }}>
            <CodePicker
              title="The key it holds down"
              os={os}
              current={draft.code}
              noLayers
              onPick={(c) => {
                onChange({ ...draft, code: c })
                onPick(false)
              }}
              onClose={() => onPick(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const GROUPS: { id: string; label: string; categories: string[] }[] = [
  { id: 'basic', label: 'Letters & numbers', categories: ['letter', 'number', 'symbol'] },
  { id: 'mods', label: 'Modifiers & editing', categories: ['modifier', 'editing', 'navigation'] },
  { id: 'fkeys', label: 'F-keys', categories: ['fkey'] },
  { id: 'media', label: 'Media & Mac', categories: ['media', 'system'] },
  { id: 'layers', label: 'Layers', categories: ['layer'] },
  { id: 'more', label: 'More', categories: ['mouse', 'keypad', 'international', 'special', 'lighting', 'sidelight'] },
]

function CodePicker({ title, os, current, noLayers, onPick, onClose }: { title: string; os: Os; current: number; noLayers?: boolean; onPick: (code: number) => void; onClose: () => void }) {
  const [group, setGroup] = useState('basic')
  const [query, setQuery] = useState('')
  const all = useMemo(() => actionKeys(os).filter((k) => !noLayers || k.category !== 'layer'), [os, noLayers])
  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return all.filter((k) => k.label.toLowerCase().includes(q) || k.name.toLowerCase().includes(q)).slice(0, 80)
    const cats = GROUPS.find((g) => g.id === group)!.categories
    return all.filter((k) => cats.includes(k.category))
  }, [all, group, query])
  return (
    <div className="picker adv-picker">
      <div className="picker-head">
        <div>
          <h3>{title}</h3>
          <p className="row-help">Macros and other advanced keys aren’t listed. The keyboard can’t play them from here.</p>
        </div>
        <div className="row-actions">
          <input className="field search" placeholder="Search keys" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button className="button quiet-plain" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {!query && (
        <div className="chips picker-groups">
          {GROUPS.filter((g) => !noLayers || g.id !== 'layers').map((g) => (
            <button key={g.id} className={`chip${group === g.id ? ' on' : ''}`} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div className="code-grid">
        {choices.map((k) => (
          <button key={k.code} className={`code${k.code === current ? ' on' : ''}`} title={k.name} onClick={() => onPick(k.code)}>
            <span className="code-label">{k.label}</span>
            {k.name !== k.label && <span className="code-name">{k.name}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
