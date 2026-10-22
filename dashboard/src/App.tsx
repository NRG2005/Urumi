import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Config, type User } from './api'
import Login, { AcceptInvite } from './Login'
import Audit from './pages/Audit'
import Chat from './pages/Chat'
import Keys from './pages/Keys'
import Members from './pages/Members'
import Overview from './pages/Overview'
import Servers from './pages/Servers'
import { Avatar, Icon, type IconName, Logo, Menu, ToastProvider, useTheme } from './ui'

export type Page = 'overview' | 'chat' | 'servers' | 'keys' | 'members' | 'audit'
/** One-shot requests from the command palette to a page, e.g. "open the new-key dialog". */
export type Intent = 'new-key' | 'add-server' | 'invite' | null
export interface Nav { go: (page: Page, intent?: Intent) => void; intent: Intent; clearIntent: () => void }

const NAV: { id: Page; label: string; icon: IconName; admin?: boolean; group: 'Workspace' | 'Admin' }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Workspace' },
  { id: 'chat', label: 'Chat agent', icon: 'chat', group: 'Workspace' },
  { id: 'keys', label: 'Connect & keys', icon: 'key', group: 'Workspace' },
  { id: 'servers', label: 'MCP servers', icon: 'servers', group: 'Workspace' },
  { id: 'audit', label: 'Audit log', icon: 'audit', group: 'Workspace' },
  { id: 'members', label: 'Team', icon: 'team', admin: true, group: 'Admin' },
]

export default function App() {
  return <ToastProvider><Root /></ToastProvider>
}

function Root() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [theme, toggleTheme] = useTheme()
  const inviteToken = location.pathname.startsWith('/invite/') ? location.pathname.split('/')[2] : null

  useEffect(() => { api<User>('/me').then(setUser).catch(() => setUser(null)) }, [])

  if (user === undefined) return null
  if (inviteToken && !user) return <AcceptInvite token={inviteToken} onDone={setUser} />
  if (!user) return <Login onDone={setUser} />
  return <Shell user={user} theme={theme} toggleTheme={toggleTheme} onSignOut={() => setUser(null)} />
}

function Shell({ user, theme, toggleTheme, onSignOut }: { user: User; theme: string; toggleTheme: () => void; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>(() => {
    const p = location.hash.slice(1) as Page
    return NAV.some((n) => n.id === p) ? p : 'overview'
  })
  const [intent, setIntent] = useState<Intent>(null)
  const [palette, setPalette] = useState(false)
  const [cfg, setCfg] = useState<Config | null>(null)
  const isAdmin = user.role === 'admin'

  useEffect(() => { api<Config>('/config').then(setCfg) }, [])
  useEffect(() => { history.replaceState(null, '', `#${page}`) }, [page])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = useCallback((p: Page, i: Intent = null) => { setPage(p); setIntent(i) }, [])
  const nav: Nav = { go, intent, clearIntent: () => setIntent(null) }

  const signOut = async () => { await api('/auth/logout', { method: 'POST' }); onSignOut() }
  const items = NAV.filter((n) => !n.admin || isAdmin)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="workspace">
          <Logo />
          <span className="workspace-name">Urumi</span>
          {cfg && <span className={`env-pill ${cfg.environment}`}>{cfg.environment === 'production' ? 'Prod' : 'Local'}</span>}
        </div>
        <button className="search-trigger" onClick={() => setPalette(true)}>
          <Icon name="search" size={14} /><span>Search or jump to…</span><span className="spacer" /><span className="kbd">⌘K</span>
        </button>
        {(['Workspace', 'Admin'] as const).map((group) => {
          const groupItems = items.filter((n) => n.group === group)
          if (!groupItems.length) return null
          return (
            <div key={group}>
              <div className="nav-label">{group}</div>
              {groupItems.map((n) => (
                <button key={n.id} className={`nav${page === n.id ? ' active' : ''}`} onClick={() => go(n.id)}>
                  <Icon name={n.icon} />{n.label}
                </button>
              ))}
            </div>
          )
        })}
        <Menu className="up" trigger={(toggle) => (
          <button className="user-chip" onClick={toggle}>
            <Avatar name={user.name || user.email} large />
            <span style={{ minWidth: 0, flex: 1 }}>
              <div className="ellipsis" style={{ fontWeight: 500 }}>{user.name || user.email.split('@')[0]}</div>
              <div className="ellipsis tiny muted">{user.role === 'admin' ? 'Admin' : 'Member'} · {user.email}</div>
            </span>
            <Icon name="more" />
          </button>
        )}>
          <button onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <button onClick={() => setPalette(true)}><Icon name="search" />Command menu<span className="spacer" /><span className="kbd">⌘K</span></button>
          <hr />
          <button className="danger" onClick={signOut}><Icon name="logout" />Sign out</button>
        </Menu>
      </aside>

      <main className="main">
        {page === 'overview' && <Overview user={user} nav={nav} />}
        {page === 'chat' && <Chat user={user} />}
        {page === 'servers' && <Servers user={user} nav={nav} />}
        {page === 'keys' && <Keys user={user} nav={nav} />}
        {page === 'members' && isAdmin && <Members user={user} nav={nav} />}
        {page === 'audit' && <Audit user={user} />}
      </main>

      {palette && (
        <Palette
          onClose={() => setPalette(false)}
          commands={[
            ...items.map((n) => ({ group: 'Go to', label: n.label, icon: n.icon, run: () => go(n.id) })),
            { group: 'Actions', label: 'Generate an API key', icon: 'key' as IconName, run: () => go('keys', 'new-key') },
            { group: 'Actions', label: 'Ask the chat agent', icon: 'chat' as IconName, run: () => go('chat') },
            ...(isAdmin ? [
              { group: 'Actions', label: 'Add an MCP server', icon: 'plus' as IconName, run: () => go('servers', 'add-server') },
              { group: 'Actions', label: 'Invite a teammate', icon: 'userPlus' as IconName, run: () => go('members', 'invite') },
            ] : []),
            { group: 'Preferences', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: (theme === 'dark' ? 'sun' : 'moon') as IconName, run: toggleTheme },
            { group: 'Preferences', label: 'Sign out', icon: 'logout' as IconName, run: signOut },
          ]}
        />
      )}
    </div>
  )
}

interface Command { group: string; label: string; icon: IconName; run: () => void }

function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => terms.every((t) => `${c.group} ${c.label}`.toLowerCase().includes(t)))
  }, [q, commands])

  useEffect(() => setActive(0), [q])
  useEffect(() => { listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }) }, [active])

  const run = (c?: Command) => { if (c) { onClose(); c.run() } }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') run(results[active])
    else if (e.key === 'Escape') onClose()
  }

  let lastGroup = ''
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command menu">
        <input autoFocus placeholder="Type a command or search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="empty small">No matching commands</div>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="palette-group">{c.group}</div> : null
            lastGroup = c.group
            return (
              <div key={c.group + c.label}>
                {header}
                <div className={`palette-item${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => run(c)}>
                  <Icon name={c.icon} />{c.label}
                </div>
              </div>
            )
          })}
        </div>
        <div className="palette-foot"><span><span className="kbd">↑↓</span> navigate</span><span><span className="kbd">↵</span> select</span><span><span className="kbd">esc</span> close</span></div>
      </div>
    </div>
  )
}
