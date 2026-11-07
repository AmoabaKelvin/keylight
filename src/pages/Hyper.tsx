import { useEffect, useRef, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Row, Swatches } from '../components/controls'
import { hyperFrame } from '../lib/compose'
import { BY_ID, keyName } from '../lib/layout'

/** Short labels that fit on a keycap, for the Tinycast actions we know. */
const SHORT: Record<string, string> = {
  custom: '',
  'clipboard-history': 'Clipboard',
  'dismiss-notifications': 'Dismiss',
  'toggle-system-appearance': 'Dark mode',
  'show-notes': 'Notes',
  'search-emoji': 'Emoji',
}

export function actionName(action: string) {
  const words = action.replace(/[-_.:]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function short(action: string) {
  return SHORT[action] ?? actionName(action).split(' ').slice(-1)[0]
}

export function HyperPage({ ctx }: { ctx: Ctx }) {
  const { state, send } = ctx
  const [showing, setShowing] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current)
        send({ op: 'hyper', on: false })
      }
    },
    [send],
  )

  const showOnKeyboard = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setShowing(true)
    send({ op: 'hyper', on: true })
    timer.current = window.setTimeout(() => {
      timer.current = null
      setShowing(false)
      send({ op: 'hyper', on: false })
    }, 3000)
  }

  const keys = [...state.hyper_keys].sort()
  const extra = new Set(state.extra_hyper ?? [])
  /** Without Tinycast (or for other apps), people mark their Hyper keys by clicking them. */
  const toggleKey = (id: string) => {
    if (id === 'rcmd' || (state.hyper_map[id] && !extra.has(id))) return
    const next = new Set(extra)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    send({ op: 'hyper_extra', keys: [...next] })
  }
  const badges = Object.fromEntries(keys.map((k) => [k, short(state.hyper_map[k] ?? '')]))
  badges.rcmd = 'Hyper'
  const style = (patch: Record<string, unknown>) =>
    send({ op: 'hyper_style', ...patch }, (s) => ({ ...s, hyper_style: { ...s.hyper_style, ...patch } }))

  return (
    <Page
      title="Hyper"
      meta={
        state.hyper ? (
          <span className="live">
            <span className="live-dot" /> Hyper is held right now
          </span>
        ) : (
          <>Hold Right ⌘ and only the keys you use with Hyper light up. Click keys to add or remove them; Tinycast shortcuts are found by themselves.</>
        )
      }
      state={state}
      actions={
        <button className="button" onClick={showOnKeyboard} disabled={showing || !state.connected}>
          {showing ? 'Showing…' : 'Show on keyboard'}
        </button>
      }
      board={
        <Keyboard
          frame={hyperFrame(state)}
          focus={new Set([...keys, 'rcmd'])}
          badges={badges}
          onKeyDown={(k) => toggleKey(k.id)}
          tip={(k) =>
            k.id === 'rcmd' ? (
              <Tip title="Right ⌘ is Hyper">⌃ ⌥ ⇧ ⌘ together</Tip>
            ) : state.hyper_map[k.id] ? (
              <Tip title={`Hyper ${BY_ID.get(k.id)?.label}`}>{extra.has(k.id) ? 'your shortcut · click to remove' : actionName(state.hyper_map[k.id])}</Tip>
            ) : (
              <Tip title={keyName(k)}>click to light it with Hyper</Tip>
            )
          }
        />
      }
    >
      <h2 className="section-label">Shortcuts</h2>
      <ul className="shortcut-list">
        {keys.map((k) => (
          <li key={k}>
            <span className="combo">
              <kbd>✦</kbd>
              <kbd>{BY_ID.get(k)?.label}</kbd>
            </span>
            <span>{extra.has(k) ? 'Your shortcut' : actionName(state.hyper_map[k] ?? 'custom')}</span>
            {extra.has(k) ? (
              <button className="button quiet-plain small" onClick={() => toggleKey(k)}>
                Remove
              </button>
            ) : (
              <span className="row-note">Tinycast</span>
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="row-help">None yet. Click the keys you use with Hyper on the keyboard above.</li>}
      </ul>
      <Row title="Shortcut keys">
        <Swatches value={state.hyper_style.bound} onChange={(c) => c && style({ bound: c })} />
      </Row>
      <Row title="The Hyper key">
        <Swatches value={state.hyper_style.key} onChange={(c) => c && style({ key: c })} />
      </Row>
      <p className="row-help foot">Hyper is Right ⌘ held down (⌃⌥⇧⌘ together); set it up on the Keys page. Shortcuts you add in Tinycast show up here within a minute.</p>
    </Page>
  )
}
