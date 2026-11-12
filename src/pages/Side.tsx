import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page } from '../components/Page'
import { Row, Segmented, Slider, Swatches } from '../components/controls'
import type { Side } from '../lib/api'
import type { Board } from '../lib/layout'
import { useThrottle } from '../lib/useDaemon'
import { useLayout } from '../lib/useLayout'

/**
 * In the Air75 V3's numbers, which the engine turns into each board's own (boards.rs `side_mode`).
 * Node has no Neon. Off is mode 4, which the Air75 V3 shows dark; elsewhere it's brightness 0.
 */
const MODES = [
  { value: 2, label: 'Static' },
  { value: 3, label: 'Breathe' },
  { value: 1, label: 'Neon' },
  { value: 4, label: 'Off' },
]
const modesFor = (b: Board) => (b.family === 'node' ? MODES.filter((m) => m.value !== 1) : MODES)

function where(b: Board) {
  if (b.family === 'air75' || b.family === 'air') return 'The two light bars on the edges of the case: ten lights each side.'
  if (b.family === 'halo') return `The light bars down the sides of the case: ${b.sideLeds} lights.`
  return `The ${b.sideLeds} side lights on the case.`
}
const SPEEDS = ['Slowest', 'Slow', 'Medium', 'Fast', 'Fastest']
/** The Air75 V3 stops taking side speeds after Slowest (engine `side_speed`), so it starts at Slow. */
const slowestGear = (b: Board) => (b.family === 'air75' ? 1 : 0)

export function SidePage({ ctx }: { ctx: Ctx }) {
  const { state, send } = ctx
  const side = state.side
  const board = useLayout()
  const modes = modesFor(board)

  const apply = (patch: Partial<Side>) => send({ op: 'side', ...patch }, (s) => ({ ...s, side: { ...s.side, ...patch } }))
  // Side-light settings are kept by the keyboard, so sliders send a few times a second at most.
  const applySlow = useThrottle(apply, 350)

  return (
    <Page
      title="Side lights"
      meta={where(board)}
      state={state}
      board={<Keyboard frame={state.frame} side={side} sideFocus />}
    >
      <Row title="Mode">
        <Segmented value={modes.some((m) => m.value === side.mode) ? side.mode : 2} options={modes} onChange={(mode) => apply({ mode })} />
        {side.mode === 1 && <p className="row-help">Neon cycles through every colour by itself.</p>}
      </Row>
      {side.mode !== 4 && side.mode !== 1 && (
        <Row title="Colour">
          <Swatches value={side.color} onChange={(c) => c && apply({ color: c })} />
        </Row>
      )}
      {side.mode !== 4 && (
        <Row title="Brightness">
          <Slider value={side.brightness} min={0} max={100} format={(v) => `${v}%`} onChange={(brightness) => applySlow({ brightness })} />
        </Row>
      )}
      {(side.mode === 3 || side.mode === 1) && (
        <Row title="Speed">
          <Slider value={Math.max(4 - side.speed, slowestGear(board))} min={slowestGear(board)} max={4} format={(v) => SPEEDS[v]} onChange={(g) => applySlow({ speed: 4 - g })} />
        </Row>
      )}
      <p className="row-help foot">Caps Lock lights the side bars on its own, whatever is set here, so you can always see when it’s on.</p>
    </Page>
  )
}
