import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Keyboard } from './components/Keyboard'
import { Page } from './components/Page'
import { pendingBoard, type DaemonState } from './lib/api'
import { css } from './lib/color'
import { useDaemon } from './lib/useDaemon'
import { boardFor, LayoutContext } from './lib/useLayout'
import { AdvancedPage, type AdvancedFocus } from './pages/Advanced'
import { DevicePage } from './pages/Device'
import { HyperPage } from './pages/Hyper'
import { KeymapPage } from './pages/Keymap'
import { KeysPage } from './pages/Keys'
import { LightingPage } from './pages/Lighting'
import { MacrosPage } from './pages/Macros'
import { ShapesPage } from './pages/Shapes'
import { SidePage } from './pages/Side'

export type Ctx = {
  state: DaemonState
  send: (msg: Record<string, unknown>, local?: (s: DaemonState) => DaemonState) => Promise<void>
  pause: (on: boolean) => void
}

const PAGES = [
  { id: 'lighting', label: 'Lighting' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'side', label: 'Side lights' },
  { id: 'keymap', label: 'Keymap' },
  { id: 'macros', label: 'Macros' },
  { id: 'advanced', label: 'Advanced keys' },
  { id: 'hyper', label: 'Hyper' },
  { id: 'keys', label: 'Karabiner' },
  { id: 'device', label: 'Device' },
] as const

type PageId = (typeof PAGES)[number]['id']

const highlight = { type: 'spring', stiffness: 500, damping: 38 } as const

export default function App() {
  const { state, offline, send, pause } = useDaemon()
  const [page, setPage] = useState<PageId>(() => (localStorage.getItem('page') as PageId) || 'lighting')
  /** A macro on its way from the Macros page to a key on the Keymap page. */
  const [assign, setAssign] = useState<{ os: 0 | 1; id: number } | null>(null)
  /** An advanced key on its way from the Keymap page to its editor. */
  const [advanced, setAdvanced] = useState<AdvancedFocus | null>(null)

  useEffect(() => {
    localStorage.setItem('page', page)
    if (page !== 'keymap') setAssign(null)
  }, [page])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const n = +e.key
      if (n >= 1 && n <= PAGES.length) {
        e.preventDefault()
        setPage(PAGES[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ctx = state ? { state, send, pause } : null

  return (
    <div className="app">
      <aside className="sidebar-wrap">
        <div className="sidebar">
          <div className="brand" data-tauri-drag-region>
            keylight
          </div>
          <ul className="nav">
            {PAGES.map((p) => (
              <li key={p.id}>
                <button className={page === p.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(p.id)}>
                  {page === p.id && <motion.span layoutId="nav-highlight" className="nav-highlight" transition={highlight} />}
                  <span className="nav-label">{p.label}</span>
                  <span className="nav-meta">{state && <NavMeta id={p.id} state={state} />}</span>
                </button>
              </li>
            ))}
          </ul>
          <Connection state={state} offline={offline} />
          <div className="hints">
            <span>
              <kbd>⌘1–{PAGES.length}</kbd> pages
            </span>
            <span>
              <kbd>Right ⌘</kbd> Hyper
            </span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="toolbar" data-tauri-drag-region />
        <div className="scroll">
          {ctx && (
            <LayoutContext value={boardFor(ctx.state)}>
              {boardFor(ctx.state).status !== 'supported' && (page === 'keymap' || page === 'macros' || page === 'advanced') ? (
                <NotYetPage ctx={ctx} title={PAGES.find((p) => p.id === page)!.label} />
              ) : page === 'lighting' ? (
                <LightingPage ctx={ctx} />
              ) : page === 'shapes' ? (
                <ShapesPage ctx={ctx} />
              ) : page === 'side' ? (
                <SidePage ctx={ctx} />
              ) : page === 'keymap' ? (
                <KeymapPage
                  ctx={ctx}
                  assign={assign}
                  onAssignEnd={() => setAssign(null)}
                  onBack={() => setPage('macros')}
                  onEditAdvanced={(f) => {
                    setAdvanced(f)
                    setPage('advanced')
                  }}
                />
              ) : page === 'macros' ? (
                <MacrosPage
                  ctx={ctx}
                  onAssign={(os, id) => {
                    setAssign({ os, id })
                    setPage('keymap')
                  }}
                />
              ) : page === 'advanced' ? (
                <AdvancedPage ctx={ctx} focus={advanced} onFocusEnd={() => setAdvanced(null)} />
              ) : page === 'hyper' ? (
                <HyperPage ctx={ctx} />
              ) : page === 'keys' ? (
                <KeysPage ctx={ctx} />
              ) : (
                <DevicePage ctx={ctx} />
              )}
            </LayoutContext>
          )}
        </div>
      </main>
    </div>
  )
}

/** Keymaps, macros and advanced keys need each board's key matrix, which only the Air75 V3 has so far. */
function NotYetPage({ ctx, title }: { ctx: Ctx; title: string }) {
  const { state } = ctx
  const board = boardFor(state)
  return (
    <Page title={title} meta={`Not on the ${board.title} yet.`} state={state} board={<Keyboard frame={state.frame} side={state.side} />}>
      <p className="row-help">
        Keylight can only change keymaps, macros and advanced keys on the Air75 V3 for now. The {board.title} uses the same commands, but its key matrix hasn’t been checked yet. Copy the
        diagnostics on the Device page and send them to us to help.
      </p>
    </Page>
  )
}

/** The little thing at the end of each sidebar row. */
function NavMeta({ id, state }: { id: PageId; state: DaemonState }) {
  switch (id) {
    case 'lighting':
      return state.base.name === 'off' ? <span>off</span> : <span className="nav-dot" style={{ background: themeSwatch(state) }} />
    case 'shapes': {
      const shown = state.layers.filter((l) => l.visible).length
      return shown ? <span>{shown}</span> : null
    }
    case 'side':
      return state.side.mode === 4 || state.side.brightness === 0 ? <span>off</span> : <span className={`nav-dot${state.side.mode === 3 ? ' breathe' : ''}`} style={{ background: css(state.side.color) }} />
    case 'hyper':
      return state.hyper ? <span className="nav-live">held</span> : <span>{state.hyper_keys.length}</span>
    default:
      return null
  }
}

export function themeSwatch(state: DaemonState) {
  const b = state.base
  if (b.name === 'solid') return css(b.color ?? [255, 255, 255])
  if (b.name === 'gradient') return `linear-gradient(90deg, ${css(b.color ?? [255, 170, 110])}, ${css(b.color2 ?? [150, 0, 255])})`
  if (b.name === 'shape') return css(b.color ?? [200, 0, 0])
  if (b.name === 'effect' && b.rgb === false) return css(b.color ?? [255, 170, 110])
  if (b.name === 'rainbow' || b.name === 'effect') return 'conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
  return 'linear-gradient(180deg, #f00 0 17%, #ff5a00 0 34%, #ffc800 0 50%, #00dc3c 0 67%, #005aff 0 84%, #9600ff 0)'
}

function Connection({ state, offline }: { state: DaemonState | null; offline: boolean }) {
  const [kind, text] = offline
    ? ['bad', 'Keylight isn’t running']
    : !state
      ? ['wait', 'Connecting…']
      : state.connected
        ? [state.read_only ? 'warn' : 'ok', `${state.device.board_name ?? 'Keyboard'} · ${state.read_only ? 'read-only' : 'cable'}`]
        : pendingBoard(state)
          ? ['warn', pendingBoard(state)!.why === 'waiting' ? 'Not connected yet' : 'Disconnected']
          : state.error === 'dongle'
          ? ['warn', 'Plug in the cable']
          : ['warn', 'Not plugged in']
  return (
    <div className={`connection ${kind}`} title={kind === 'warn' ? 'Settings travel over the USB cable only. Changes are saved and applied when it’s plugged in.' : undefined}>
      <span className="connection-dot" />
      {text}
    </div>
  )
}
