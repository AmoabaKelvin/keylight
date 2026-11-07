import type { Ctx } from '../App'
import { Keyboard, type Motion } from '../components/Keyboard'
import { Page, Tip } from '../components/Page'
import { Row, Segmented, Slider, Swatches } from '../components/controls'
import type { Base } from '../lib/api'
import { colorName, css, fromHex, hex, isOff, STRIPES, type RGB } from '../lib/color'
import { compose, ownsKeys } from '../lib/compose'
import { EFFECTS, effect, FIRMWARE_SHAPES } from '../lib/effects'
import { keyName } from '../lib/layout'
import { useThrottle } from '../lib/useDaemon'
import { useLayout } from '../lib/useLayout'

const THEMES: { value: Base['name']; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'effect', label: 'Effect' },
  { value: 'shape', label: 'Shape' },
  { value: 'off', label: 'Off' },
]

const ROW_NAMES = ['Function row', 'Numbers', 'Top row', 'Home row', 'Bottom row', 'Space row']
const SPEEDS = ['Slowest', 'Slow', 'Medium', 'Fast', 'Fastest']

/** Speed as the keyboard takes it (0 = fastest) <-> as the slider shows it (0 = slowest). */
const gear = (wire = 2) => 4 - wire

export function LightingPage({ ctx }: { ctx: Ctx }) {
  const { state, send } = ctx
  const base = state.base
  const board = useLayout()

  /** Change the theme: the screen updates now, the keyboard as fast as the daemon allows. */
  const apply = (next: Base) =>
    send({ op: 'base', ...next }, (s) => ({ ...s, base: next, frame: s.hyper ? s.frame : compose(next, s.layers, board) }))
  const applyThrottled = useThrottle(apply, 90)
  // Effects and shapes change light-state settings, which the keyboard keeps: go easier on those.
  const applySlow = useThrottle(apply, 400)

  const theme = (name: Base['name']) => {
    const level = base.level ?? 100
    const next: Base = { name, level }
    if (name === 'solid') next.color = base.color ?? [255, 170, 110]
    if (name === 'gradient') Object.assign(next, { color: base.color ?? [255, 170, 110], color2: base.color2 ?? [150, 0, 255] })
    if (name === 'stripes' && base.colors) next.colors = base.colors
    if (name === 'effect') Object.assign(next, { mode: 6, speed: 2, direction: 0, rgb: true, color: base.color ?? [255, 170, 110] })
    if (name === 'shape') Object.assign(next, { shape: 0, speed: 2, color: [200, 0, 0], color2: [0, 0, 0] })
    apply(next)
  }

  const fx = base.name === 'effect' ? effect(base.mode) : null
  const motion: Motion | undefined =
    base.name === 'effect' && fx && !state.hyper
      ? { look: fx.look, seconds: 1.6 + (base.speed ?? 2) * 0.9, reverse: base.direction === 1 }
      : base.name === 'shape' && !state.hyper
        ? { look: 'breathe', seconds: 1.8 + (base.speed ?? 2) * 0.9 }
        : undefined
  const hiddenShapes = ownsKeys(base) ? state.layers.filter((l) => l.visible).length : 0

  return (
    <Page
      title="Lighting"
      meta="The theme under everything else. Shapes draw on top of it, and Hyper takes over while you hold it."
      state={state}
      board={
        <Keyboard
          frame={state.frame}
          side={state.side}
          motion={motion}
          tip={(k) => {
            const c = state.frame[k.led]
            return <Tip title={keyName(k)}>{ownsKeys(base) ? 'animated by the keyboard' : isOff(c) ? 'off' : colorName(c)}</Tip>
          }}
        />
      }
    >
      <Row title="Theme">
        <Segmented value={base.name} options={THEMES} onChange={theme} />
        {hiddenShapes > 0 && (
          <p className="row-help">
            {base.name === 'effect' ? 'Effects' : 'Built-in shapes'} are drawn by the keyboard itself, so your {hiddenShapes === 1 ? 'shape' : `${hiddenShapes} shapes`} won’t show
            until you pick Solid, Gradient, Rainbow or Stripes. Hyper still works.
          </p>
        )}
      </Row>

      {base.name === 'solid' && (
        <Row title="Colour">
          <Swatches value={base.color ?? null} onChange={(c) => c && apply({ ...base, color: c })} />
        </Row>
      )}

      {base.name === 'gradient' && (
        <>
          <Row title="From" aside={<span className="row-note">left edge</span>}>
            <Swatches value={base.color ?? null} onChange={(c) => c && apply({ ...base, color: c })} />
          </Row>
          <Row title="To" aside={<span className="row-note">right edge</span>}>
            <Swatches value={base.color2 ?? null} onChange={(c) => c && apply({ ...base, color2: c })} />
          </Row>
        </>
      )}

      {base.name === 'stripes' && (
        <Row title="Rows" aside={<span className="row-note">click a row to recolour it</span>}>
          <div className="stripe-list">
            {(base.colors ?? STRIPES).map((c, i) => (
              <label key={i} className="stripe" title={ROW_NAMES[i]}>
                <span className="stripe-chip" style={{ background: css(c) }} />
                <span>{ROW_NAMES[i]}</span>
                <input
                  type="color"
                  value={hex(c)}
                  onChange={(e) => {
                    const colors = [...(base.colors ?? STRIPES)] as RGB[]
                    colors[i] = fromHex(e.target.value)
                    applyThrottled({ ...base, colors })
                  }}
                />
              </label>
            ))}
          </div>
        </Row>
      )}

      {base.name === 'effect' && fx && (
        <>
          <Row title="Effect" aside={<span className="row-note">runs on the keyboard</span>}>
            <div className="chips">
              {EFFECTS.map((e) => (
                <button key={e.mode} className={`chip${e.mode === fx.mode ? ' on' : ''}`} onClick={() => apply({ ...base, mode: e.mode })}>
                  {e.name}
                </button>
              ))}
            </div>
          </Row>
          {fx.color && (
            <Row title="Colour">
              <div className="chips">
                <button className={`chip${base.rgb !== false ? ' on' : ''}`} onClick={() => apply({ ...base, rgb: true })}>
                  Rainbow
                </button>
                <button className={`chip${base.rgb === false ? ' on' : ''}`} onClick={() => apply({ ...base, rgb: false })}>
                  One colour
                </button>
              </div>
              {base.rgb === false && <Swatches value={base.color ?? null} onChange={(c) => c && apply({ ...base, color: c })} />}
            </Row>
          )}
          {fx.direction && (
            <Row title="Direction">
              <Segmented
                value={base.direction ?? 0}
                options={[
                  { value: 0, label: fx.direction[0] },
                  { value: 1, label: fx.direction[1] },
                ]}
                onChange={(direction) => apply({ ...base, direction })}
              />
            </Row>
          )}
          {fx.speed && (
            <Row title="Speed">
              <Slider value={gear(base.speed)} min={0} max={4} format={(v) => SPEEDS[v]} onChange={(g) => applySlow({ ...base, speed: 4 - g })} />
            </Row>
          )}
        </>
      )}

      {base.name === 'shape' && (
        <>
          <Row title="Shape" aside={<span className="row-note">drawn by the keyboard</span>}>
            <div className="chips">
              {FIRMWARE_SHAPES.map((name, i) => (
                <button key={name} className={`chip${(base.shape ?? 0) === i ? ' on' : ''}`} onClick={() => apply({ ...base, shape: i })}>
                  {name}
                </button>
              ))}
            </div>
            {(base.shape ?? 0) !== 0 && <p className="row-help">The board here shows the heart’s outline only; the keyboard draws the {FIRMWARE_SHAPES[base.shape ?? 0].toLowerCase()} itself.</p>}
          </Row>
          <Row title="Shape colour">
            <Swatches value={base.color ?? null} onChange={(c) => c && apply({ ...base, color: c })} />
          </Row>
          <Row title="Background">
            <Swatches value={base.color2 ?? null} onChange={(c) => c && apply({ ...base, color2: c })} palette={[{ name: 'Off', rgb: [0, 0, 0] }, ...PALETTE_DIM]} />
          </Row>
          <Row title="Speed">
            <Slider value={gear(base.speed)} min={0} max={4} format={(v) => SPEEDS[v]} onChange={(g) => applySlow({ ...base, speed: 4 - g })} />
          </Row>
        </>
      )}

      {base.name !== 'off' && (
        <Row title="Brightness" aside={<span className="row-note">{ownsKeys(base) ? 'the whole effect' : 'only the theme; shapes and Hyper stay bright'}</span>}>
          <Slider
            value={base.level ?? 100}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onChange={(level) => (ownsKeys(base) ? applySlow : applyThrottled)({ ...base, level })}
          />
        </Row>
      )}
    </Page>
  )
}

/** Backgrounds look best quiet: the palette at a fifth of its brightness. */
const PALETTE_DIM = [
  { name: 'Dim white', rgb: [50, 50, 50] as RGB },
  { name: 'Dim warm', rgb: [60, 36, 20] as RGB },
  { name: 'Dim blue', rgb: [0, 18, 60] as RGB },
  { name: 'Dim purple', rgb: [30, 0, 55] as RGB },
]
