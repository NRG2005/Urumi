import { useEffect, useState } from 'react'
import { api, ApiError, type User } from './api'
import Audit from './pages/Audit'
import Chat from './pages/Chat'
import Keys from './pages/Keys'
import Members from './pages/Members'
import Servers from './pages/Servers'

type Page = 'chat' | 'servers' | 'keys' | 'members' | 'audit'

const NAV: { id: Page; label: string; admin?: boolean }[] = [
  { id: 'chat', label: 'Chat agent' },
  { id: 'servers', label: 'MCP servers' },
  { id: 'keys', label: 'API keys & connect' },
  { id: 'members', label: 'Team', admin: true },
  { id: 'audit', label: 'Audit log' },
]

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'chat')
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
          Urumi Gateway
        </div>
        {NAV.filter((n) => !n.admin || user.role === 'admin').map((n) => (
          <button key={n.id} className={`nav ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
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
