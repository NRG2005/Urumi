import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// ---------------- icons (Lucide-style 24px strokes, inline: no icon dependency) ----------------

const PATHS = {
  overview: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  servers: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 15a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M7 7h.01', 'M7 17h.01'],
  key: ['M2.6 18.4A2 2 0 0 0 2 19.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4z', 'M16.5 7.5h.01'],
  team: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  audit: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  plus: ['M12 5v14', 'M5 12h14'],
  copy: ['M8 8h12v12H8z', 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'],
  check: ['M20 6 9 17l-5-5'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  chevron: ['M9 18l6-6-6-6'],
  refresh: ['M21 12a9 9 0 0 1-15.5 6.3L3 16', 'M3 12a9 9 0 0 1 15.5-6.3L21 8', 'M21 3v5h-5', 'M3 21v-5h5'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 1 1 8 0v4'],
  bolt: ['M13 2 3 14h9l-1 8 10-12h-9z'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
  terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
  userPlus: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'],
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.8 0'],
  scan: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 12h10'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z'],
  sparkle: ['M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, stroke = 1.75 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

/** The mark: many connections converging into one endpoint. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Urumi">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <g stroke="var(--inverse)" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M8 9c5 0 6 7 11 7" /><path d="M8 16h11" /><path d="M8 23c5 0 6-7 11-7" />
      </g>
      <circle cx="22.5" cy="16" r="3.2" fill="var(--inverse)" />
    </svg>
  )
}

// ---------------- avatars + colours ----------------

const HUES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']
export const colorFor = (s: string) => HUES[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]
export const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter((w) => /^[a-z]/i.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return <span className={`avatar${large ? ' lg' : ''}`} style={{ background: colorFor(name) }}>{initials(name)}</span>
}

// ---------------- toasts ----------------

type Toast = { id: number; text: string; tone: 'ok' | 'bad' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}><Icon name={t.tone === 'ok' ? 'check' : 'alert'} />{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------------- copy ----------------

export function CopyButton({ text, label, className = 'btn ghost icon' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const toast = useToast()
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setDone(true)
    toast(label ? `${label} copied` : 'Copied to clipboard')
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <button className={`${className} copy`} onClick={copy} title="Copy" aria-label="Copy">
      <Icon name={done ? 'check' : 'copy'} size={14} />
    </button>
  )
}

export function Code({ text, secret, label }: { text: string; secret?: boolean; label?: string }) {
  return <div className={`code${secret ? ' secret' : ''}`}>{text}<CopyButton text={text} label={label} /></div>
}

export function CopyInline({ text, label }: { text: string; label?: string }) {
  return <span className="copy-inline"><span>{text}</span><CopyButton text={text} label={label} className="btn ghost icon sm" /></span>
}

// ---------------- overlays ----------------

export function Modal({ title, subtitle, children, footer, onClose }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head"><h2 style={{ fontSize: 16 }}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Menu({ trigger, children, className = 'right' }: { trigger: (open: () => void) => ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className={`menu ${className}`} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  )
}

// ---------------- small controls ----------------

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  )
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p className="small" style={{ maxWidth: 360 }}>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}

export const STATUS: Record<string, { tone: string; label: string }> = {
  connected: { tone: 'ok', label: 'Connected' },
  unreachable: { tone: 'bad', label: 'Unreachable' },
  disabled: { tone: '', label: 'Disabled' },
  unknown: { tone: 'warn', label: 'Checking' },
  quarantined: { tone: 'bad', label: 'Quarantined' },
}

export function Status({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.unknown
  return <span className={`badge ${s.tone} plain`} style={{ border: 0, padding: 0, background: 'none' }}><span className={`dot ${s.tone}${status === 'connected' ? ' pulse' : ''}`} />{s.label}</span>
}

// ---------------- theme ----------------

export type Theme = 'light' | 'dark'

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('urumi-theme') as Theme | null
      if (saved) return saved
    } catch { /* storage unavailable */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('urumi-theme', theme) } catch { /* ignore */ }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}
