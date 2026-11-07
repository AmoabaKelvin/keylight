import type { Ctx } from '../App'
import { Keyboard } from '../components/Keyboard'
import { Page } from '../components/Page'
import { Row, Segmented, Slider, Swatches } from '../components/controls'
import type { Side } from '../lib/api'
import { useThrottle } from '../lib/useDaemon'

const MODES = [
  { value: 2, label: 'Static' },
  { value: 3, label: 'Breathe' },
  { value: 1, label: 'Neon' },
  { value: 4, label: 'Off' },
]
const SPEEDS = ['Slowest', 'Slow', 'Medium', 'Fast', 'Fastest']

export function SidePage({ ctx }: { ctx: Ctx }) {
  const { state, send } = ctx
  const side = state.side

  const apply = (patch: Partial<Side>) => send({ op: 'side', ...patch }, (s) => ({ ...s, side: { ...s.side, ...patch } }))
  // Side-light settings are kept by the keyboard, so sliders send a few times a second at most.
  const applySlow = useThrottle(apply, 350)

  return (
    <Page
      title="Side lights"
      meta="The two light bars on the edges of the case: ten lights each side."
      state={state}
      board={<Keyboard frame={state.frame} side={side} sideFocus />}
    >
      <Row title="Mode">
        <Segmented value={MODES.some((m) => m.value === side.mode) ? side.mode : 2} options={MODES} onChange={(mode) => apply({ mode })} />
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
          <Slider value={4 - side.speed} min={0} max={4} format={(v) => SPEEDS[v]} onChange={(g) => applySlow({ speed: 4 - g })} />
        </Row>
      )}
      <p className="row-help foot">Caps Lock lights the side bars on its own, whatever is set here, so you can always see when it’s on.</p>
    </Page>
  )
}
