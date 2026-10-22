import { useCallback, useEffect, useState } from 'react'
import { ago, api, type ApiKey, type Config, type User } from '../api'
import type { Nav } from '../App'
import { Code, CopyInline, Empty, Icon, Modal, useConfirm, useToast } from '../ui'

type Client = 'claude' | 'cursor' | 'inspector'

const snippet = (client: Client, url: string, key: string) => {
  if (client === 'claude') return `claude mcp add --transport http urumi ${url} --header "Authorization: Bearer ${key}"`
  if (client === 'cursor') return JSON.stringify({ mcpServers: { urumi: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
  return `npx @modelcontextprotocol/inspector\n# Transport: Streamable HTTP\n# URL: ${url}\n# Header: Authorization = Bearer ${key}`
}

const CLIENTS: { id: Client; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude Code', hint: 'Run this in your terminal. Then type /mcp inside Claude Code to see the tools.' },
  { id: 'cursor', label: 'Cursor', hint: 'Add this to ~/.cursor/mcp.json (or the project’s .cursor/mcp.json).' },
  { id: 'inspector', label: 'MCP Inspector', hint: 'Start the Inspector, choose Streamable HTTP, and add the Authorization header.' },
]

export default function Keys({ user, nav }: { user: User; nav: Nav }) {
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [client, setClient] = useState<Client>('claude')
  const [creating, setCreating] = useState(false)
  const [showRevoked, setShowRevoked] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(async () => setKeys(await api<ApiKey[]>('/keys')), [])
  useEffect(() => { load(); api<Config>('/config').then(setCfg) }, [load])
  useEffect(() => {
    if (nav.intent === 'new-key') { setCreating(true); nav.clearIntent() }
  }, [nav])

  const revoke = async (k: ApiKey) => {
    if (!(await confirm({
      title: `Revoke “${k.name}”?`, danger: true, confirmLabel: 'Revoke key',
      body: <>Any MCP client using this key is rejected on its <b>very next request</b>. This can't be undone; you can always generate a new key.</>,
    }))) return
    await api(`/keys/${k.id}`, { method: 'DELETE' })
    toast(`Key “${k.name}” revoked`)
    load()
  }

  const url = cfg?.mcp_url ?? `${location.origin}/mcp`
  const active = (keys ?? []).filter((k) => !k.revoked_at)
  const shown = (keys ?? []).filter((k) => showRevoked || !k.revoked_at)
  const current = CLIENTS.find((c) => c.id === client)!

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Connect & keys</h1>
          <p>One URL and one personal key give your MCP client every tool you're allowed to use. You never need, or see, the upstream servers' credentials.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} />New API key</button>
      </div>

      <section className="card">
        <div className="card-head"><h2>Connect a client</h2><span className="spacer" /><span className="small muted">about 60 seconds</span></div>
        <div className="card-body col" style={{ gap: 18 }}>
          <Step n={1} title="Your team endpoint" done>
            <CopyInline text={url} label="Endpoint URL" /> <span className="small muted">Streamable HTTP</span>
          </Step>
          <Step n={2} title="Your API key" done={active.length > 0}>
            {active.length > 0
              ? <span className="small muted">You have {active.length} active key{active.length > 1 ? 's' : ''}. Keys are shown only once; make a new one for each device.</span>
              : <span className="small muted">You don't have a key yet.</span>}
            <div><button className="btn sm" onClick={() => setCreating(true)}><Icon name="key" size={13} />Generate a key</button></div>
          </Step>
          <Step n={3} title="Add it to your client" last>
            <div className="tabs" style={{ marginBottom: 10 }}>
              {CLIENTS.map((c) => <button key={c.id} className={`tab${client === c.id ? ' active' : ''}`} onClick={() => setClient(c.id)}>{c.label}</button>)}
            </div>
            <p className="small muted" style={{ marginBottom: 8 }}>{current.hint}</p>
            <Code text={snippet(client, url, '<your API key>')} label="Snippet" />
          </Step>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Your API keys</h2>
          <span className="small muted">{user.email}</span>
          <span className="spacer" />
          <label className="row small muted" style={{ cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto', boxShadow: 'none' }} checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show revoked
          </label>
        </div>
        {keys && shown.length === 0 ? (
          <Empty icon="key" title="No API keys yet" action={<button className="btn primary" onClick={() => setCreating(true)}>Generate your first key</button>}>
            A key lets Claude Code, Cursor or any MCP client use your team's tools as you.
          </Empty>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 500 }}>{k.name}</td>
                  <td className="mono muted">{k.key_prefix}••••</td>
                  <td className="muted">{ago(k.created_at)}</td>
                  <td className="muted">{k.last_used_at ? ago(k.last_used_at) : 'never'}</td>
                  <td>{k.revoked_at ? <span className="badge bad">Revoked</span> : <span className="badge ok">Active</span>}</td>
                  <td style={{ textAlign: 'right' }}>{!k.revoked_at && <button className="btn ghost sm danger" onClick={() => revoke(k)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {creating && <NewKey url={url} onClose={() => { setCreating(false); load() }} />}
    </div>
  )
}

function Step({ n, title, done, last, children }: { n: number; title: string; done?: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 14, position: 'relative' }}>
      {!last && <span style={{ position: 'absolute', left: 11, top: 26, bottom: -14, width: 1, background: 'var(--border)' }} />}
      <span className="check-box" style={done ? { border: 0, background: 'var(--ok-dot)', color: 'white' } : { borderStyle: 'solid', color: 'var(--muted)', fontSize: 11.5, fontWeight: 600 }}>
        {done ? <Icon name="check" size={12} stroke={3} /> : n}
      </span>
      <div className="col" style={{ gap: 8 }}><h3>{title}</h3>{children}</div>
    </div>
  )
}

function NewKey({ url, onClose }: { url: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState<string | null>(null)
  const [client, setClient] = useState<Client>('claude')

  const create = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const r = await api<{ key: string }>('/keys', { body: { name: name.trim() || 'default' } })
    setKey(r.key)
  }

  if (key) {
    return (
      <Modal title="Your new API key" subtitle="Copy it now. It's stored only as a hash, so it can't be shown again." onClose={onClose}
        footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <Code text={key} secret label="API key" />
        <div>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {CLIENTS.map((c) => <button key={c.id} className={`tab${client === c.id ? ' active' : ''}`} onClick={() => setClient(c.id)}>{c.label}</button>)}
          </div>
          <p className="small muted" style={{ marginBottom: 8 }}>Ready to paste, with your key filled in:</p>
          <Code text={snippet(client, url, key)} label="Snippet" />
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="New API key" subtitle="One key per device or client makes revoking painless." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => create()}>Generate key</button></>}>
      <form onSubmit={create}>
        <label className="field"><span>Key name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-code-macbook" /></label>
      </form>
    </Modal>
  )
}
