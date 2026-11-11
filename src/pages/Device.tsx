import { useEffect, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page } from '../components/Page'
import { Row, Slider, Toggle } from '../components/controls'
import { listen } from '@tauri-apps/api/event'
import { autostart, checkForUpdate, daemon, installUpdate, isNative, updateStatus, type Sleep, type UpdateStatus } from '../lib/api'
import { Segmented } from '../components/controls'

type Func = { stabilization: number; disable_win: boolean; disable_alt_f4: boolean; disable_alt_tab: boolean }
import { useThrottle } from '../lib/useDaemon'
import { BOARDS, isLayout, variants, type LayoutId } from '../lib/layout'
import { useLayout } from '../lib/useLayout'

export function DevicePage({ ctx }: { ctx: Ctx }) {
  const { state, send } = ctx
  const [login, setLogin] = useState<boolean | null>(null)
  const [func, setFunc] = useState<Func | null>(null)
  useEffect(() => {
    if (state.connected) daemon<Func>({ op: 'func' }).then(setFunc).catch(() => {})
    else setFunc(null)
  }, [state.connected])
  const setFuncField = (patch: Partial<Func>) => {
    setFunc((f) => f && { ...f, ...patch })
    daemon<Func>({ op: 'func', ...patch }).then(setFunc).catch(() => {})
  }
  useEffect(() => void autostart().then(setLogin).catch(() => {}), [])
  const d = state.device
  const sleep = d.sleep
  const board = useLayout()
  const detected = isLayout(d.board) ? d.board : null
  const plugged = detected ? BOARDS[detected] : board
  const experimental = state.connected && plugged.status === 'experimental'
  const layouts = variants(plugged)
  const override = state.layout_override ?? null
  const setLayout = (v: LayoutId | 'auto') => {
    const layout_override = v === 'auto' ? null : v
    const layout = layout_override ?? detected ?? state.layout
    send({ op: 'layout', layout: layout_override }, (s) => ({ ...s, layout_override, layout }))
  }

  const setSleep = (patch: Partial<Sleep>) =>
    send({ op: 'sleep', ...patch }, (s) => ({ ...s, device: { ...s.device, sleep: s.device.sleep && { ...s.device.sleep, ...patch } } }))
  const setSleepSlow = useThrottle(setSleep, 600)

  const unsupported = !state.connected && state.error?.startsWith('unsupported: ') ? state.error.slice('unsupported: '.length) : null
  const link = !state.connected
    ? state.error === 'dongle'
      ? 'Typing through the 2.4G dongle. NuPhy’s dongle only carries keystrokes, so settings need the USB cable. Plug it in and Keylight connects by itself.'
      : unsupported
        ? `Keylight found a ${unsupported}. That board runs NuPhy’s QMK firmware, which Keylight doesn’t support yet, so it leaves it alone.`
        : 'Not connected. Plug the keyboard in with its USB cable.'
    : experimental
      ? `Connected by USB cable. Support for the ${plugged.title} is new, so Keylight only reads it until you turn on experimental lighting below.`
      : 'Connected by USB cable. Everything you set stays on the keyboard after you unplug; Hyper lighting needs the cable in.'

  return (
    <Page title="Device" meta="Your keyboard, and how Keylight talks to it." state={state} board={<Keyboard frame={state.frame} side={state.side} />}>
      <Row
        icon="keyboard"
        title={
          <>
            {d.board_name ?? plugged.title}
            {plugged.status === 'experimental' && <span className="badge">Experimental</span>}
          </>
        }
        aside={state.connected && <CopyDiagnostics />}
      >
        <p className="row-text">{link}</p>
        {state.connected && (
          <dl className="facts">
            <dt>Firmware</dt>
            <dd>{d.firmware ?? '—'}</dd>
            <dt>Mode</dt>
            <dd>{d.os === 'windows' ? 'Windows' : 'Mac'}</dd>
            <dt>Layout</dt>
            <dd>{detected ? BOARDS[detected].name : 'Unknown'}</dd>
            <dt>USB ID</dt>
            <dd>{d.pid ?? '—'}</dd>
            {experimental && (
              <>
                <dt>LEDs</dt>
                <dd>{d.lights ?? '—'}</dd>
                <dt>Key matrix</dt>
                <dd>{d.matrix ? `${d.matrix[0]} × ${d.matrix[1]}` : '—'}</dd>
              </>
            )}
          </dl>
        )}
      </Row>

      {experimental && <Experimental ctx={ctx} title={plugged.title} />}

      {layouts.length > 1 && (
      <Row
        icon="keyboard"
        title="Layout"
        aside={
          <Segmented
            value={override && layouts.some((b) => b.id === override) ? override : 'auto'}
            options={[{ value: 'auto', label: 'Auto' }, ...layouts.map((b) => ({ value: b.id, label: b.name }))]}
            onChange={setLayout}
          />
        }
      >
        <p className="row-help">
          {override
            ? `Drawn and mapped as ${board.name}, whatever the keyboard reports${detected && detected !== override ? ` (it says ${BOARDS[detected].name})` : ''}. Choose Auto to follow the keyboard again.`
            : state.connected && detected
              ? `${board.name}, as the keyboard reports it. If the keys on screen don’t match yours, pick your layout here.`
              : `Drawn as ${board.name}${state.layout && !state.connected ? ', the last layout Keylight saw' : ''}. Keylight picks the layout up from the keyboard when it’s plugged in.`}
        </p>
      </Row>
      )}

      <Row icon="moon" title="Sleep" aside={sleep && !experimental && <Toggle on={sleep.enabled} onChange={(enabled) => setSleep({ enabled })} label="Auto-sleep" />}>
        {!sleep ? (
          <p className="row-help">Shows up once the keyboard is plugged in with its USB cable.</p>
        ) : experimental ? (
          <p className="row-help">
            {sleep.enabled ? `Lights off after ${sleep.minutes} min, deep sleep after ${sleep.deep_minutes} min.` : 'Auto-sleep is off.'} Keylight can’t change this on the {plugged.title} yet.
          </p>
        ) : sleep.enabled ? (
          <div className="sleep-grid">
            <span>Lights off after</span>
            <Slider value={sleep.minutes} min={5} max={127} format={(v) => `${v} min`} onChange={(minutes) => setSleepSlow({ minutes })} />
            <span>Deep sleep after</span>
            <Slider value={sleep.deep_minutes} min={5} max={127} format={(v) => `${v} min`} onChange={(deep_minutes) => setSleepSlow({ deep_minutes })} />
          </div>
        ) : (
          <p className="row-help">The keyboard stays awake until you switch it off.</p>
        )}
      </Row>

      {!experimental && (
      <Row icon="keyboard" title="Typing" aside={func && <Segmented value={func.stabilization} options={[{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }]} onChange={(stabilization) => setFuncField({ stabilization })} />}>
        <p className="row-help">
          {func
            ? 'Chatter filter: how hard the keyboard works to ignore a switch bouncing (a key typing twice). Raise it if a key double-types.'
            : 'Shows up once the keyboard is plugged in with its USB cable.'}
        </p>
        {func && d.os === 'windows' && (
          <div className="func-toggles">
            <label>
              <Toggle on={func.disable_win} onChange={(disable_win) => setFuncField({ disable_win })} label="Lock the Windows key" /> Lock the Windows key
            </label>
            <label>
              <Toggle on={func.disable_alt_f4} onChange={(disable_alt_f4) => setFuncField({ disable_alt_f4 })} label="Block Alt+F4" /> Block Alt+F4
            </label>
            <label>
              <Toggle on={func.disable_alt_tab} onChange={(disable_alt_tab) => setFuncField({ disable_alt_tab })} label="Block Alt+Tab" /> Block Alt+Tab
            </label>
          </div>
        )}
      </Row>
      )}

      <Row
        icon="power"
        title="Open at login"
        aside={login !== null && <Toggle on={login} onChange={(on) => autostart(on).then(setLogin)} label="Open at login" />}
      >
        <p className="row-help">
          Keylight lives in the menu bar and keeps the lights and Hyper working with its window closed. It has made {state.writes} {state.writes === 1 ? 'change' : 'changes'} on the keyboard since it started, writing only the keys that change.
        </p>
      </Row>

      <Updates />

      <Row icon="terminal" title="From the command line">
        <p className="row-help">
          Karabiner tells Keylight about Hyper with <code>keylight hyper on</code>. Scripts can send anything the app can, e.g. <code>{`keylight send '{"op":"base","name":"rainbow"}'`}</code>. The command lives at <code>/Applications/Keylight.app/Contents/MacOS/keylight</code>.
        </p>
      </Row>

      <Row icon="shield" title="What Keylight sends">
        <p className="row-help">
          Lighting, side lights, sleep and typing settings, keymaps and macros, and nothing else. It never sends the commands for firmware updates, factory reset, or wiping keymaps, and it backs up your keymap before its first change. On experimental boards it sends lighting only, and only once you turn it on.
        </p>
      </Row>
    </Page>
  )
}

/**
 * Read-only until the user says otherwise, and then only if the board answered as Keylight expects
 * (its LED count, key matrix and light state; src-tauri/src/boards.rs `Checks`).
 */
function Experimental({ ctx, title }: { ctx: Ctx; title: string }) {
  const { state, send } = ctx
  const problem = state.check_problem
  const on = !!state.experimental
  const toggle = (next: boolean) => send({ op: 'experimental', on: next }, (s) => ({ ...s, experimental: next, read_only: next ? null : 'Experimental lighting is off' }))
  return (
    <Row icon="shield" title="Experimental lighting" aside={!problem && <Toggle on={on} onChange={toggle} label="Experimental lighting" />}>
      <p className="row-help">
        {problem
          ? `The ${title} didn’t answer the way Keylight expects (${problem}), so it stays read-only. Copy the diagnostics above and send them to us, and we’ll sort it out.`
          : on
            ? `Keylight sets the lights on the ${title}: themes, shapes, effects and side lights. Keymaps, macros and settings stay read-only. If a key lights up in the wrong place, copy the diagnostics and tell us which one.`
            : `Keylight reads the ${title} but doesn’t change it. Turn this on to let it set the lights. The key map comes from NuPhy IO and hasn’t been checked on a real board yet, so some keys may light up in the wrong place. Keymaps, macros and settings stay read-only.`}
      </p>
    </Row>
  )
}

/**
 * Reads the keyboard (device info, LED count, key matrix, light state, stock keymap)
 * and copies it as JSON, for testers to paste into an issue. Shows it too, in case the clipboard says no.
 */
function CopyDiagnostics() {
  const [status, setStatus] = useState<'idle' | 'reading' | 'copied' | 'failed'>('idle')
  const [text, setText] = useState<string | null>(null)
  const copy = () => {
    setStatus('reading')
    const json = daemon<unknown>({ op: 'diagnostics' }).then((d) => JSON.stringify(d, null, 2))
    json.then(setText, () => {})
    // WebKit only lets a click write to the clipboard right away, so hand it the promise.
    const write =
      typeof ClipboardItem !== 'undefined'
        ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': json.then((t) => new Blob([t], { type: 'text/plain' })) })])
        : json.then((t) => navigator.clipboard.writeText(t))
    write.then(
      () => setStatus('copied'),
      () => json.then(() => setStatus('failed'), () => setStatus('failed')),
    )
  }
  return (
    <div className="diagnostics">
      <button className="button small" disabled={status === 'reading'} onClick={copy}>
        {status === 'reading' ? 'Reading…' : status === 'copied' ? 'Copied' : 'Copy diagnostics'}
      </button>
      {status === 'failed' && text && <textarea className="diagnostics-text" readOnly value={text} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  )
}

/** Keylight's own version. The launch check (once a day) runs in the app; this row can check again and install. */
function Updates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState<'checking' | 'installing' | null>(null)
  const [result, setResult] = useState<'latest' | 'failed' | null>(null)
  useEffect(() => {
    if (!isNative) return
    updateStatus().then(setStatus).catch(() => {})
    const off = listen<UpdateStatus>('update', (e) => setStatus(e.payload))
    return () => void off.then((f) => f())
  }, [])
  if (!status) return null

  const check = () => {
    setBusy('checking')
    setResult(null)
    checkForUpdate()
      .then((s) => {
        setStatus(s)
        setResult(s.available ? null : 'latest')
      })
      .catch(() => setResult('failed'))
      .finally(() => setBusy(null))
  }
  const install = () => {
    setBusy('installing')
    setResult(null)
    installUpdate()
      .catch(() => setResult('failed'))
      .finally(() => setBusy(null))
  }

  const { version, available } = status
  const text = available
    ? busy === 'installing'
      ? `Downloading ${available}. Keylight restarts by itself when it's done.`
      : result === 'failed'
        ? `The download didn't finish. Try again in a bit.`
        : `Keylight ${available} is out. You have ${version}.`
    : result === 'failed'
      ? `Couldn't reach GitHub. Try again in a bit.`
      : result === 'latest'
        ? `${version} is the latest version.`
        : `You have ${version}. Keylight looks for a new version once a day when it opens.`

  return (
    <Row
      icon="update"
      title="Updates"
      aside={
        available ? (
          <button className="button small primary" disabled={busy !== null} onClick={install}>
            {busy === 'installing' ? 'Installing…' : 'Install and restart'}
          </button>
        ) : (
          <button className="button small" disabled={busy !== null} onClick={check}>
            {busy === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )
      }
    >
      <p className="row-help">{text}</p>
    </Row>
  )
}
