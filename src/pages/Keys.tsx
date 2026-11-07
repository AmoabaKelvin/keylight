import { useCallback, useEffect, useState } from 'react'
import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Toggle } from '../components/controls'
import { installKarabinerRules, karabinerRules, openKarabiner, setKarabinerRule, type Rule, type Rules } from '../lib/api'
import { keyName } from '../lib/layout'

/** What each of our Karabiner rules does, in plain words, and which keys it's about. */
const KNOWN: { match: RegExp; title: string; body: string; keys: string[]; badge: Record<string, string> }[] = [
  {
    match: /right command to hyper/i,
    title: 'Right ⌘ is Hyper',
    body: 'Holding it presses ⌃ ⌥ ⇧ ⌘ together, so apps like Tinycast can use it, and lights up your Hyper shortcuts.',
    keys: ['rcmd'],
    badge: { rcmd: 'Hyper' },
  },
  {
    match: /caps lock: hold/i,
    title: 'Caps Lock is Control',
    body: 'Hold it for ⌃. Tap it twice quickly for real Caps Lock; the side lights show when it’s on.',
    keys: ['caps'],
    badge: { caps: '⌃ · ⇪⇪' },
  },
  {
    match: /both shifts/i,
    title: 'Both Shifts toggle Caps Lock',
    body: 'Press the two Shift keys together to turn Caps Lock on or off.',
    keys: ['lshift', 'rshift'],
    badge: { lshift: '+ ⇧ = ⇪', rshift: '+ ⇧ = ⇪' },
  },
]

function describe(rule: Rule) {
  return KNOWN.find((k) => k.match.test(rule.description))
}

export function KeysPage({ ctx }: { ctx: Ctx }) {
  const { state } = ctx
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [profile, setProfile] = useState<string | null>(null)
  const [info, setInfo] = useState<Rules | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(() => {
    karabinerRules()
      .then((r) => {
        setRules(r.rules)
        setProfile(r.profile)
        setInfo(r)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(load, [load])

  const install = async () => {
    setInstalling(true)
    try {
      await installKarabinerRules()
    } catch (e) {
      setError(String(e))
    }
    setInstalling(false)
    load()
  }

  const toggle = async (rule: Rule, enabled: boolean) => {
    setRules((rs) => rs?.map((r) => (r.description === rule.description ? { ...r, enabled } : r)) ?? rs)
    try {
      await setKarabinerRule(rule.description, enabled)
    } catch (e) {
      setError(String(e))
    }
    load()
  }

  const rings: Record<string, string> = {}
  const badges: Record<string, string> = {}
  for (const rule of rules ?? []) {
    const d = describe(rule)
    if (!d || !rule.enabled) continue
    for (const k of d.keys) rings[k] = 'var(--accent)'
    Object.assign(badges, d.badge)
  }

  const ruleForKey = (id: string) => (rules ?? []).find((r) => describe(r)?.keys.includes(id))

  return (
    <Page
      title="Karabiner"
      meta={<>Mac-side remaps that run through Karabiner-Elements{profile ? <> (profile “{profile}”)</> : null}. Click a highlighted key to find its rule.</>}
      state={state}
      actions={
        <button className="button" onClick={() => openKarabiner()}>
          Open Karabiner
        </button>
      }
      board={
        <Keyboard
          frame={state.frame}
          side={state.side}
          focus={new Set(Object.keys(rings))}
          rings={rings}
          badges={badges}
          onKeyDown={(k) => {
            const r = ruleForKey(k.id)
            if (!r) return
            setFlash(r.description)
            document.getElementById(`rule-${r.description}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            window.setTimeout(() => setFlash(null), 1200)
          }}
          tip={(k) => {
            const r = ruleForKey(k.id)
            return <Tip title={keyName(k)}>{r ? (describe(r)!.title + (r.enabled ? '' : ' (off)')) : 'not remapped'}</Tip>
          }}
        />
      }
    >
      {error && <p className="row-error">{error}</p>}
      {info && !info.installed && (
        <div className="setup">
          <p>
            <strong>Remaps need Karabiner-Elements.</strong> It’s free. Install it, open it once to allow its keyboard driver, then come back here.
          </p>
          <button className="button" onClick={() => openKarabiner()}>
            Get Karabiner
          </button>
        </div>
      )}
      {info?.installed && (info.missing.length > 0 || info.outdated) && (
        <div className="setup">
          <p>
            {info.outdated && info.missing.length === 0 ? (
              <>
                <strong>Your rules call an older helper.</strong> Point them at Keylight so Hyper lights up from here.
              </>
            ) : (
              <>
                <strong>{info.missing.length === 3 ? 'Set up the remaps.' : `${info.missing.length} remap${info.missing.length === 1 ? ' is' : 's are'} missing.`}</strong> Keylight adds the rules
                below to your Karabiner profile; nothing else changes, and a backup is kept.
              </>
            )}
          </p>
          <button className="button primary" disabled={installing} onClick={install}>
            {installing ? 'Adding…' : info.outdated && info.missing.length === 0 ? 'Update rules' : 'Add rules'}
          </button>
        </div>
      )}
      <ul className="rule-list">
        {(rules ?? []).map((rule) => {
          const d = describe(rule)
          return (
            <li key={rule.description} id={`rule-${rule.description}`} className={`rule${flash === rule.description ? ' flash' : ''}${rule.enabled ? '' : ' off'}`}>
              <div className="rule-main">
                <h3>{d?.title ?? rule.description}</h3>
                <p>{d?.body ?? 'A Karabiner rule.'}</p>
              </div>
              <Toggle on={rule.enabled} onChange={(on) => toggle(rule, on)} label={d?.title ?? rule.description} />
            </li>
          )
        })}
      </ul>
      {rules && rules.length === 0 && <p className="row-help">No rules in this Karabiner profile.</p>}
    </Page>
  )
}
