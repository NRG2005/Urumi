import { useEffect, useState } from 'react'
import { api, ApiError, type User } from './api'
import Audit from './pages/Audit'
import Chat from './pages/Chat'
import Keys from './pages/Keys'
import Members from './pages/Members'
import Overview from './pages/Overview'
import Servers from './pages/Servers'

type Page = 'overview' | 'chat' | 'servers' | 'keys' | 'members' | 'audit'

// Icons: 24x24 stroke paths (Lucide-style), drawn inline so the bundle has no icon dependency.
const ICONS: Record<Page, string> = {
  overview: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  servers: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  keys: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v-3l2-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7z',
  members: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2M9 12h6M9 16h6',
}

const NAV: { id: Page; label: string; admin?: boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat agent' },
  { id: 'servers', label: 'MCP servers' },
  { id: 'keys', label: 'API keys & connect' },
  { id: 'members', label: 'Team', admin: true },
  { id: 'audit', label: 'Audit log' },
]

function Icon({ d }: { d: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'overview')
  const inviteToken = location.pathname.startsWith('/invite/') ? location.pathname.split('/')[2] : null

  useEffect(() => {
    api<User>('/me').then(setUser).catch(() => setUser(null))
  }, [])

  useEffect(() => {
    location.hash = page
  }, [page])

  if (user === undefined) return null
  if (inviteToken && !user) return <AcceptInvite token={inviteToken} onDone={setUser} />
  if (!user) return <Login onDone={setUser} />

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">U</div>
          <div>Urumi<div className="brand-sub">MCP Gateway</div></div>
        </div>
        {NAV.filter((n) => !n.admin || user.role === 'admin').map((n) => (
          <button key={n.id} className={`nav ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            <Icon d={ICONS[n.id]} />
            {n.label}
          </button>
        ))}
        <div className="sidebar-foot">
          <div className="who">{user.name || user.email}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="badge accent">{user.role}</span>
            <span className="spacer" />
            <button className="small" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main">
        {page === 'overview' && <Overview user={user} go={setPage} />}
        {page === 'chat' && <Chat user={user} />}
        {page === 'servers' && <Servers user={user} />}
        {page === 'keys' && <Keys user={user} />}
        {page === 'members' && user.role === 'admin' && <Members user={user} />}
        {page === 'audit' && <Audit user={user} />}
      </main>
    </div>
  )
}

function Login({ onDone }: { onDone: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      onDone(await api<User>('/auth/login', { body: { email, password } }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'sign-in failed')
    }
  }

  return (
    <div className="center">
      <form className="card stack" onSubmit={submit}>
        <div className="brand-mark" style={{ color: 'white' }}>U</div>
        <h1>Sign in to Urumi Gateway</h1>
        <p className="sub">One MCP endpoint for every tool your team uses.</p>
        {error && <div className="alert bad">{error}</div>}
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  )
}

function AcceptInvite({ token, onDone }: { token: string; onDone: (u: User) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const user = await api<User>('/auth/accept-invite', { body: { token, name, password } })
      history.replaceState(null, '', '/')
      onDone(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not accept invite')
    }
  }

  return (
    <div className="center">
      <form className="card stack" onSubmit={submit}>
        <h1>Join your team on Urumi</h1>
        <p className="sub">Choose a name and password to finish setting up your account.</p>
        {error && <div className="alert bad">{error}</div>}
        <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Password (8+ characters)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="primary" type="submit">Create account</button>
      </form>
    </div>
  )
}
