import { MotionConfig, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { Hero } from './Hero'
// The same screenshots and recordings the README uses, captured from the app with fixture data.
import device from '../../docs/screenshots/device.png'
import hyperClip from '../../docs/screenshots/hyper.mp4'
import karabiner from '../../docs/screenshots/karabiner.png'
import keymap from '../../docs/screenshots/keymap.png'
import paintClip from '../../docs/screenshots/paint.mp4'
import side from '../../docs/screenshots/side.png'
import themesClip from '../../docs/screenshots/themes.mp4'
import hyperPoster from './assets/posters/hyper.jpg'
import paintPoster from './assets/posters/paint.jpg'
import themesPoster from './assets/posters/themes.jpg'
// The app in dark mode, for visitors in dark mode.
import deviceDark from './assets/dark/device.png'
import hyperClipDark from './assets/dark/hyper.mp4'
import hyperPosterDark from './assets/dark/hyper.jpg'
import karabinerDark from './assets/dark/karabiner.png'
import keymapDark from './assets/dark/keymap.png'
import paintClipDark from './assets/dark/paint.mp4'
import paintPosterDark from './assets/dark/paint.jpg'
import sideDark from './assets/dark/side.png'
import themesClipDark from './assets/dark/themes.mp4'
import themesPosterDark from './assets/dark/themes.jpg'

const REPO = 'https://github.com/AmoabaKelvin/keylight'
const RELEASES = `${REPO}/releases`

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <header className="hero wrap">
          <p className="eyebrow">For the NuPhy Air75 V3 · macOS · Free and open source</p>
          <h1>Lighting, keymaps and Hyper for your Air75&nbsp;V3</h1>
          <p className="lede">
            Keylight is a small Mac app that sets up the keyboard over its USB cable. Pick a theme, paint keys, remap any key on any layer, and hold Right&nbsp;⌘ to light only the keys you
            have Hyper shortcuts on.
          </p>
          <div className="actions">
            <a className="btn primary" href={RELEASES}>
              Download for Mac
            </a>
            <a className="btn" href={REPO}>
              Source on GitHub
            </a>
          </div>
          <p className="fine">macOS 13 or later. Unofficial, and not made by NuPhy.</p>
          <Hero />
        </header>

        <Features />
        <HowItWorks />
        <Download />
        <Faq />
        <Roadmap />
      </main>
      <Footer />
    </MotionConfig>
  )
}

function Nav() {
  return (
    <nav className="site-nav" aria-label="Main">
      <div className="wrap site-nav-inner">
      <a className="site-brand" href="#top">
        <img src="/favicon.svg" alt="" width="18" height="18" />
        keylight
      </a>
      <div className="nav-links">
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
        <a href="#faq">FAQ</a>
        <a href="#roadmap">Roadmap</a>
        <a href={REPO}>GitHub</a>
      </div>
      </div>
    </nav>
  )
}

const darkQuery = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)')

function useDark() {
  return useSyncExternalStore(
    (cb) => {
      darkQuery?.addEventListener('change', cb)
      return () => darkQuery?.removeEventListener('change', cb)
    },
    () => !!darkQuery?.matches,
  )
}

type Media = { src: string; poster: string }

/** A looping clip that plays only while on screen, and not on its own for people who'd rather have less motion. */
function Clip({ light, dark, label }: { light: Media; dark: Media; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()
  const { src, poster } = useDark() ? dark : light
  useEffect(() => {
    const v = ref.current
    if (!v || reduce) return
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.35 })
    io.observe(v)
    return () => io.disconnect()
  }, [reduce, src])
  return (
    <figure className="shot">
      <video key={src} ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" controls={!!reduce} aria-label={label} width={1180} height={800} />
    </figure>
  )
}

function Shot({ src, dark, alt }: { src: string; dark: string; alt: string }) {
  return (
    <figure className="shot">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={dark} />
        <img src={src} alt={alt} width={1180} height={800} loading="lazy" decoding="async" />
      </picture>
    </figure>
  )
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="section wrap">
      <h2>{title}</h2>
      {intro && <p className="section-intro">{intro}</p>}
      {children}
    </section>
  )
}

function Features() {
  return (
    <Section id="features" title="What it does" intro="Seven pages, one per thing you can change. ⌘1 to ⌘7 switch between them.">
      <div className="feature">
        <div className="feature-text">
          <h3>Lighting</h3>
          <p>
            Solid, gradient, rainbow, or one colour per row. Or let the keyboard animate itself with its 19 built-in effects and 8 built-in shapes, with speed, direction and
            brightness.
          </p>
          <p>The keyboard on screen shows what the real one is showing.</p>
        </div>
        <Clip light={{ src: themesClip, poster: themesPoster }} dark={{ src: themesClipDark, poster: themesPosterDark }} label="Switching from a solid colour to a gradient, rainbow, stripes and the Wave effect" />
      </div>

      <div className="feature flip">
        <div className="feature-text">
          <h3>Shapes</h3>
          <p>Click or drag across keys to paint them. Mirror mode paints the matching key on the other half as well.</p>
          <p>Each shape is a layer on top of the theme. Hide it, edit it later, or start from a preset.</p>
        </div>
        <Clip light={{ src: paintClip, poster: paintPoster }} dark={{ src: paintClipDark, poster: paintPosterDark }} label="Painting three rows of keys pink, cyan and amber with mirror mode on" />
      </div>

      <div className="feature">
        <div className="feature-text">
          <h3>Hyper</h3>
          <p>Right&nbsp;⌘ becomes Hyper, which presses ⌃&nbsp;⌥&nbsp;⇧&nbsp;⌘ at once. While you hold it, every key goes dark except the ones you have shortcuts on.</p>
          <p>If you use Tinycast, Keylight finds its Hyper shortcuts by itself. For other apps, click the keys you use.</p>
        </div>
        <Clip light={{ src: hyperClip, poster: hyperPoster }} dark={{ src: hyperClipDark, poster: hyperPosterDark }} label="Holding Right Command: the lit keyboard goes dark except for five shortcut keys and Right Command" />
      </div>

      <div className="cards">
        <article className="card">
          <Shot src={keymap} dark={keymapDark} alt="The Keymap page, with Insert selected and remapped to Forward Delete" />
          <h3>Keymap</h3>
          <p>
            Remap any key on all eight layers, four for Mac mode and four for Windows. The knob's left turn, right turn and press count as keys. Keylight backs up your keymap and
            macros before it changes anything.
          </p>
        </article>
        <article className="card">
          <Shot src={side} dark={sideDark} alt="The Side lights page, with both light bars glowing cyan" />
          <h3>Side lights</h3>
          <p>The two light bars beside the function row. Static, breathe, neon or off, in any colour and brightness.</p>
        </article>
        <article className="card">
          <Shot src={karabiner} dark={karabinerDark} alt="The Karabiner page, with the remapped keys ringed on the keyboard" />
          <h3>Karabiner</h3>
          <p>
            One click adds three Karabiner-Elements rules. Right ⌘ as Hyper, Caps Lock as Control with a double-tap for Caps Lock, and both Shifts together for Caps Lock.
          </p>
        </article>
        <article className="card">
          <Shot src={device} dark={deviceDark} alt="The Device page, showing firmware 1.0.23.6, Mac mode and sleep timers" />
          <h3>Device</h3>
          <p>Sleep timers, the typing filter that stops a key typing twice, open at login, and the firmware version.</p>
        </article>
      </div>

      <div className="feature cli">
        <div className="feature-text">
          <h3>Menu bar and command line</h3>
          <p>Close the window and Keylight stays in the menu bar, keeping the lights and Hyper working.</p>
          <p>The app is also a command. Scripts can send anything the window can.</p>
        </div>
        <pre className="codeblock" aria-label="Command line examples">
          <code>
            <span className="c"># Karabiner runs this while Right ⌘ is held</span>
            {'\n'}keylight hyper on{'\n'}
            {'\n'}
            <span className="c"># switch to the rainbow theme</span>
            {'\n'}keylight send '{'{'}"op":"base","name":"rainbow"{'}'}'{'\n'}
            {'\n'}
            <span className="c"># print the whole state as JSON</span>
            {'\n'}keylight send '{'{'}"op":"state"{'}'}'
          </code>
        </pre>
      </div>
    </Section>
  )
}

function HowItWorks() {
  return (
    <Section id="how" title="How it works">
      <div className="points">
        <div>
          <h3>Over the USB cable</h3>
          <p>
            Keylight talks to the keyboard through its USB cable. The 2.4G dongle and Bluetooth only carry keystrokes, so settings can't travel over them. You can keep typing on
            either. Keylight saves your changes and applies them when the cable is back in.
          </p>
        </div>
        <div>
          <h3>Saved on the keyboard</h3>
          <p>
            Lighting, keymap and sleep settings stay on the keyboard after you unplug it, and work on any computer. Hyper lighting is live, so it needs the cable in while you
            hold the key.
          </p>
        </div>
        <div>
          <h3>Nothing leaves your Mac</h3>
          <p>
            No account and no analytics. Keylight reads and writes the keyboard, your Karabiner config, and a local socket for the command line. It doesn't connect to the
            internet.
          </p>
        </div>
      </div>
    </Section>
  )
}

function Download() {
  return (
    <Section id="download" title="Get Keylight">
      <div className="points two">
        <div>
          <h3>Download</h3>
          <p>
            Get <code>Keylight.app</code> from the <a href={RELEASES}>releases page</a> and move it to Applications. It runs on Apple silicon and Intel Macs, and updates itself from then on. With Homebrew: <code>brew tap amoabakelvin/tap && brew trust amoabakelvin/tap && brew install --cask keylight</code>.
          </p>
          <p>
            Releases aren't signed yet, so macOS blocks the first launch. Open the app once, then click Open Anyway in System Settings › Privacy & Security. Or clear the
            quarantine flag:
          </p>
          <pre className="codeblock">
            <code>xattr -dr com.apple.quarantine /Applications/Keylight.app</code>
          </pre>
        </div>
        <div>
          <h3>Build from source</h3>
          <p>You need Node.js, pnpm, a stable Rust toolchain and the Xcode Command Line Tools.</p>
          <pre className="codeblock">
            <code>
              git clone {REPO}
              {'\n'}cd keylight
              {'\n'}pnpm i
              {'\n'}pnpm app:build
            </code>
          </pre>
          <p>
            The app lands in <code>src-tauri/target/release/bundle/macos/</code>.
          </p>
        </div>
      </div>
    </Section>
  )
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Does it work over the 2.4G dongle or Bluetooth?',
    a: (
      <>
        Not for settings. The dongle and Bluetooth only carry keystrokes, so Keylight needs the USB cable to change anything. You can type over either one. Changes you make while
        unplugged are saved and sent the next time you plug the cable in.
      </>
    ),
  },
  {
    q: 'Can it break my keyboard?',
    a: (
      <>
        Keylight sends only commands from a fixed list of 15: device info, lighting, per-key colour, keymap, macros, typing and sleep settings, and the handshake. It never sends
        the commands for the bootloader, factory reset or wiping keymaps, because they aren't on the list. Before the first keymap change it saves all eight layers and both macro
        banks to <code>~/Library/Application Support/Keylight/backups/</code>.
      </>
    ),
  },
  {
    q: 'Which keyboards does it support?',
    a: (
      <>
        Only the NuPhy Air75 V3 for now, in ANSI, ISO and JIS. It draws ISO and JIS boards with the ANSI layout. Other NuPhy boards are on the <a href="#roadmap">roadmap</a>.
      </>
    ),
  },
  {
    q: 'Do I need Karabiner-Elements?',
    a: <>Only for the Hyper key and the Caps Lock rules. Lighting, shapes, side lights, the keymap and device settings work without it.</>,
  },
  {
    q: 'Does it run on Windows or Linux?',
    a: <>No, it's macOS only. The keymap page can still edit the keyboard's Windows-mode layers.</>,
  },
  {
    q: 'Is it made by NuPhy?',
    a: <>No. Keylight is an unofficial app, not affiliated with or endorsed by NuPhy. NuPhy doesn't publish the protocol, so it was worked out from NuPhy's own configurator and the keyboard's firmware.</>,
  },
  {
    q: 'Does it cost anything?',
    a: (
      <>
        No. It's free and MIT-licensed, and the source is on <a href={REPO}>GitHub</a>.
      </>
    ),
  },
]

function Faq() {
  return (
    <Section id="faq" title="Questions">
      <div className="faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}

const ROADMAP: { title: string; note: string; status: 'Planned' | 'Researching' }[] = [
  { title: 'Firmware updates in the app', note: "Install NuPhy's official firmware from Keylight, without NuPhy IO.", status: 'Researching' },
  { title: 'Custom firmware', note: 'Research first, and a test plan that keeps a way back to stock firmware before anything ships.', status: 'Researching' },
  { title: 'Macro recorder and editor', note: 'Record a sequence of keys and edit it, then put it on any key.', status: 'Planned' },
  { title: 'Advanced key editors', note: 'SOCD, Tap Dance and Toggle keys. Keylight shows them in the keymap today but cannot edit them yet.', status: 'Planned' },
  { title: 'More NuPhy keyboards', note: 'Boards that NuPhy IO configures may use the same commands. Owners can help by opening an issue.', status: 'Researching' },
  { title: 'Signed releases with auto-update', note: 'Signed and notarised builds, so macOS opens them without the extra step, and updates from inside the app.', status: 'Planned' },
]

function Roadmap() {
  return (
    <Section id="roadmap" title="Roadmap" intro="What's next. Nothing here has a date.">
      <ul className="roadmap">
        {ROADMAP.map((r) => (
          <li key={r.title}>
            <div>
              <h3>{r.title}</h3>
              <p>{r.note}</p>
            </div>
            <span className={`status ${r.status.toLowerCase()}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <p>Unofficial. Not affiliated with NuPhy.</p>
        <a href={REPO}>GitHub</a>
      </div>
    </footer>
  )
}
