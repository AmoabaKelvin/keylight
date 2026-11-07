/**
 * The icons printed on the Air75 V3's function row, drawn on a 16-unit grid as strokes so they
 * sit at one size and weight (text symbols render at whatever size their font picks).
 */
const speaker = 'M2.5 6.2h2.3L8.3 3.3v9.4L4.8 9.8H2.5z'

const ICONS: Record<string, React.ReactNode> = {
  'sun-small': (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 3.6v1M8 11.4v1M3.6 8h1M11.4 8h1M4.9 4.9l.7.7M10.4 10.4l.7.7M4.9 11.1l.7-.7M10.4 5.6l.7-.7" />
    </>
  ),
  'sun-large': (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
    </>
  ),
  mission: (
    <>
      <rect x="1.8" y="4" width="7" height="3.6" rx="1" />
      <rect x="1.8" y="9.2" width="7" height="2.8" rx="1" />
      <rect x="10.4" y="4" width="3.8" height="8" rx="1" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="3.8" />
      <path d="M9.8 9.8l3.4 3.4" />
    </>
  ),
  mic: (
    <>
      <rect x="5.8" y="1.8" width="4.4" height="7.6" rx="2.2" />
      <path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8v2.4" />
    </>
  ),
  bell: <path d="M4.3 11V7.4a3.7 3.7 0 0 1 7.4 0V11l1.2 1.2H3.1zM6.8 14h2.4" />,
  rewind: <path d="M7.6 4.2 2.6 8l5 3.8zM13.6 4.2 8.6 8l5 3.8z" />,
  'play-pause': <path d="M2.6 4.2 7.8 8l-5.2 3.8zM10.6 4.2v7.6M13.4 4.2v7.6" />,
  forward: <path d="M8.4 4.2l5 3.8-5 3.8zM2.4 4.2l5 3.8-5 3.8z" />,
  mute: (
    <>
      <path d={speaker} />
      <path d="M2 2l12 12" />
    </>
  ),
  'vol-down': (
    <>
      <path d={speaker} />
      <path d="M10.6 6.1a2.6 2.6 0 0 1 0 3.8" />
    </>
  ),
  'vol-up': (
    <>
      <path d={speaker} />
      <path d="M10.6 6.1a2.6 2.6 0 0 1 0 3.8M12.4 4.2a5.2 5.2 0 0 1 0 7.6" />
    </>
  ),
  screenshot: <path d="M2.2 5.2V2.2h3M10.8 2.2h3v3M13.8 10.8v3h-3M5.2 13.8h-3v-3M8 5.6v4.8M5.6 8h4.8" />,
  dot: <circle cx="8" cy="8" r="4.6" className="icon-fill" />,
}

export function KeyIcon({ name, x, y, size, color }: { name: string; x: number; y: number; size: number; color: string }) {
  const icon = ICONS[name]
  if (!icon) return null
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 16})`} className="key-icon" style={{ stroke: color, color }}>
      {icon}
    </g>
  )
}
