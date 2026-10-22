import { useState, type ReactNode } from 'react'
import { api, ApiError, type User } from './api'
import { Icon, Logo } from './ui'

function Story() {
  return (
    <section className="auth-story">
      <div className="row" style={{ gap: 10, color: '#ededef' }}>
        <span style={{ color: '#ededef', ['--inverse' as string]: '#09090b' }}><Logo size={28} /></span>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Urumi</span>
      </div>

      <h1>Every tool your team uses. <em>One MCP endpoint.</em></h1>
      <p className="lede">
        Connect MCP servers once. Your whole team gets them in Claude Code, Cursor and chat, each with their own key,
        role-based permissions and a full audit trail. Upstream credentials never leave the gateway.
      </p>

      <div className="flow" aria-hidden>
        <div className="flow-col">
          {['Claude Code', 'Cursor', 'Chat agent'].map((c) => <div key={c} className="flow-node"><Icon name="terminal" size={13} />{c}</div>)}
        </div>
        <div className="flow-hub"><Icon name="shield" size={18} /><b>Urumi gateway</b>auth · route · audit</div>
        <div className="flow-col">
          {['WooCommerce', 'GitHub', 'Any MCP server'].map((c) => <div key={c} className="flow-node"><span className="dot ok" />{c}</div>)}
        </div>
      </div>

      <div className="auth-points">
        <div><Icon name="lock" /><b>Credentials stay put</b>Encrypted at rest, injected server-side, never shown to anyone.</div>
        <div><Icon name="activity" /><b>Every call audited</b>Who, which tool, how long, and whether it worked.</div>
        <div><Icon name="power" /><b>Revoke in one click</b>A revoked key fails on its very next request.</div>
      </div>
    </section>
  )
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <Story />
      <section className="auth-form"><div className="auth-card">{children}</div></section>
    </div>
  )
}

export default function Login({ onDone }: { onDone: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onDone(await api<User>('/auth/login', { body: { email, password } }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form className="col" style={{ gap: 16 }} onSubmit={submit}>
        <div>
          <h2>Sign in to your workspace</h2>
          <p className="muted" style={{ marginTop: 6 }}>Welcome back. Pick up where your team left off.</p>
        </div>
        {error && <div className="alert bad"><Icon name="alert" />{error}</div>}
        <label className="field"><span>Work email</span>
          <input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary lg" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>
          Urumi is invite-only. Ask your workspace admin for an invite link.
        </p>
      </form>
    </AuthLayout>
  )
}

export function AcceptInvite({ token, onDone }: { token: string; onDone: (u: User) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const user = await api<User>('/auth/accept-invite', { body: { token, name, password } })
      history.replaceState(null, '', '/#overview')
      onDone(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the invite')
    }
  }

  return (
    <AuthLayout>
      <form className="col" style={{ gap: 16 }} onSubmit={submit}>
        <div>
          <span className="badge accent" style={{ marginBottom: 12 }}><Icon name="userPlus" size={13} />You've been invited</span>
          <h2>Join your team on Urumi</h2>
          <p className="muted" style={{ marginTop: 6 }}>Set up your account. In two minutes you'll have every team tool in your MCP client.</p>
        </div>
        {error && <div className="alert bad"><Icon name="alert" />{error}</div>}
        <label className="field"><span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoFocus required />
        </label>
        <label className="field"><span>Password <span className="hint">· at least 8 characters</span></span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <button className="btn primary lg" type="submit">Create account</button>
      </form>
    </AuthLayout>
  )
}
