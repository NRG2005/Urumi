import { useCallback, useEffect, useState } from 'react'
import { ago, api, ApiError, type Role, type Server, type Stat, type User } from '../api'

const STATUS: Record<Server['status'], { cls: string; label: string }> = {
  connected: { cls: 'ok', label: 'Connected' },
  unreachable: { cls: 'bad', label: 'Unreachable' },
  disabled: { cls: '', label: 'Disabled' },
  unknown: { cls: 'warn', label: 'Checking…' },
}

export default function Servers({ user }: { user: User }) {
  const isAdmin = user.role === 'admin'
  const [servers, setServers] = useState<Server[]>([])
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [editing, setEditing] = useState<Server | 'new' | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setServers(await api<Server[]>('/servers'))
    const s = await api<Stat[]>('/stats')
    setStats(Object.fromEntries(s.map((x) => [x.server_slug, x])))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 3000) // status changes (e.g. a killed pod) show up within seconds
    return () => clearInterval(t)
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>MCP servers</h1>
          <p className="sub">Every enabled server's tools are available through the one gateway endpoint as <code>server__tool</code>.</p>
        </div>
        {isAdmin && <button className="primary" onClick={() => setEditing('new')}>Add server</button>}
      </div>
      {error && <div className="alert bad">{error}</div>}
      {editing && (
        <ServerForm
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
      {servers.map((s) => {
        const st = STATUS[s.status]
        const stat = stats[s.slug]
        return (
          <section className="panel" key={s.id}>
            <div className="panel-head">
              <h2>{s.name}</h2>
              <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
              <span className="badge mono">{s.slug}__*</span>
              {s.has_credential && <span className="badge">🔒 {s.auth_type === 'bearer' ? 'Bearer token' : `${s.auth_header} header`} (server-side)</span>}
              <span className="spacer" />
              {isAdmin && (
                <div className="row">
                  <button className="small" onClick={() => act(() => api(`/servers/${s.id}/check`, { method: 'POST' }))}>Check now</button>
                  <button className="small" onClick={() => setEditing(s)}>Edit</button>
                  <button className="small" onClick={() => act(() => api(`/servers/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }))}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="small danger" onClick={() => confirm(`Remove ${s.name}? Its tools disappear for everyone.`) && act(() => api(`/servers/${s.id}`, { method: 'DELETE' }))}>
                    Remove
                  </button>
                </div>
              )}
            </div>
            <div className="row sub" style={{ marginBottom: 10, fontSize: 12.5 }}>
              <span className="mono">{s.url}</span>
              <span>· checked {ago(s.last_checked_at)}</span>
              {stat && <span>· 24h: {stat.calls} calls, {stat.failures} failed, p50 {stat.p50_ms} ms, p95 {stat.p95_ms} ms</span>}
            </div>
            {s.status === 'unreachable' && s.last_error && <div className="alert bad">Why unreachable: {s.last_error}</div>}
            {s.tools_changed_at && (
              <div className="alert warn row">
                ⚠ This server changed its tool names, descriptions or schemas {ago(s.tools_changed_at)}. Tool descriptions are read by the model, so review them before trusting the server.
                <span className="spacer" />
                {isAdmin && <button className="small" onClick={() => act(() => api(`/servers/${s.id}/ack-changes`, { method: 'POST' }))}>Reviewed</button>}
              </div>
            )}
            {s.tools.length > 0 ? (
              <table>
                <thead>
                  <tr><th>Gateway tool name</th><th>Description</th><th>Kind</th><th>{isAdmin ? 'Who can use it' : ''}</th></tr>
                </thead>
                <tbody>
                  {s.tools.map((t) => (
                    <tr key={t.name}>
                      <td className="mono">{t.gateway_name}</td>
                      <td className="desc">{t.description.length > 160 ? t.description.slice(0, 160) + '…' : t.description}</td>
                      <td>{t.read_only ? <span className="badge">read</span> : <span className="badge warn">write</span>}</td>
                      <td>
                        {isAdmin && (
                          <select className="inline" value={t.min_role}
                            onChange={(e) => act(() => api(`/servers/${s.id}/policies`, { method: 'PUT', body: { tool_name: t.name, min_role: e.target.value as Role } }))}>
                            <option value="member">Everyone</option>
                            <option value="admin">Admins only</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="sub">{s.status === 'connected' ? 'No tools exposed.' : 'Tools appear once the server is reachable.'}</p>
            )}
          </section>
        )
      })}
    </>
  )
}

function ServerForm({ server, onClose, onSaved }: { server: Server | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: server?.name ?? '',
    slug: server?.slug ?? '',
    url: server?.url ?? '',
    auth_type: server?.auth_type ?? 'none',
    auth_header: server?.auth_header ?? '',
    credential: '',
  })
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const body: Record<string, unknown> = { name: f.name, url: f.url, auth_type: f.auth_type, auth_header: f.auth_header || null }
    if (f.credential) body.credential = f.credential
    try {
      if (server) await api(`/servers/${server.id}`, { method: 'PATCH', body })
      else await api('/servers', { body: { ...body, slug: f.slug } })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  return (
    <form className="panel stack" onSubmit={save}>
      <h2>{server ? `Edit ${server.name}` : 'Add an MCP server'}</h2>
      {error && <div className="alert bad">{error}</div>}
      <div className="grid2">
        <label>Display name<input value={f.name} onChange={set('name')} required /></label>
        <label>Slug (tool prefix, a–z 0–9)<input value={f.slug} onChange={set('slug')} disabled={!!server} required placeholder="e.g. github" /></label>
      </div>
      <label>Streamable HTTP URL<input value={f.url} onChange={set('url')} required placeholder="https://example.com/mcp" /></label>
      <div className="grid2">
        <label>Credential
          <select value={f.auth_type} onChange={set('auth_type')}>
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
        </label>
        {f.auth_type === 'header' && <label>Header name<input value={f.auth_header} onChange={set('auth_header')} placeholder="X-API-Key" /></label>}
      </div>
      {f.auth_type !== 'none' && (
        <label>
          {server?.has_credential ? 'New credential (leave empty to keep the current one)' : 'Credential'}
          <input type="password" value={f.credential} onChange={set('credential')} autoComplete="off" />
        </label>
      )}
      <p className="sub" style={{ fontSize: 12.5 }}>Credentials are encrypted at rest and only ever sent from the gateway to this URL. Nobody can read them back, including admins.</p>
      <div className="row">
        <button className="primary" type="submit">{server ? 'Save' : 'Add server'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}
