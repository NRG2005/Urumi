import { useCallback, useEffect, useState } from 'react'
import { ago, api, ApiError, type Role, type Server, type Stat, type User } from '../api'
import type { Nav } from '../App'
import { colorFor, Empty, Icon, Menu, Modal, Segmented, Status, Switch, useToast } from '../ui'

export default function Servers({ user, nav }: { user: User; nav: Nav }) {
  const isAdmin = user.role === 'admin'
  const [servers, setServers] = useState<Server[] | null>(null)
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [editing, setEditing] = useState<Server | 'new' | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setServers(await api<Server[]>('/servers'))
    const s = await api<Stat[]>('/stats')
    setStats(Object.fromEntries(s.map((x) => [x.server_slug, x])))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 3000) // a killed pod shows up as Unreachable within seconds
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (nav.intent === 'add-server' && isAdmin) { setEditing('new'); nav.clearIntent() }
  }, [nav, isAdmin])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast(done); await load() } catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'bad') }
  }

  const total = (servers ?? []).reduce((n, s) => n + (s.enabled && s.status === 'connected' && !s.quarantined ? s.tools.length : 0), 0)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>MCP servers</h1>
          <p>Connected once, here. Every enabled server's tools reach your whole team through one endpoint as <code className="inline">server__tool</code>. {total} tools live right now.</p>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={14} />Add server</button>}
      </div>

      {servers?.length === 0 && (
        <div className="card"><Empty icon="servers" title="No MCP servers yet" action={isAdmin && <button className="btn primary" onClick={() => setEditing('new')}>Add your first server</button>}>
          Add a Streamable HTTP MCP server and its tools become available to everyone on your team.
        </Empty></div>
      )}

      {(servers ?? []).map((s) => {
        const st = stats[s.slug]
        const status = s.quarantined ? 'quarantined' : s.enabled ? s.status : 'disabled'
        const adminOnly = s.tools.filter((t) => t.min_role === 'admin').length
        return (
          <section key={s.id} className={`server-card${s.enabled ? '' : ' off'}`}>
            <div className="server-main">
              <div className="server-logo" style={{ background: colorFor(s.slug) }}>{s.name[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 10 }}>
                  <h2 style={{ fontSize: 15 }}>{s.name}</h2>
                  <code className="inline tiny">{s.slug}__*</code>
                </div>
                <div style={{ marginTop: 3 }}><Status status={status} /></div>
              </div>
              {isAdmin && (
                <div className="row" style={{ gap: 4 }}>
                  <span className="small muted" style={{ marginRight: 6 }}>{s.enabled ? 'Enabled' : 'Disabled'}</span>
                  <Switch on={s.enabled} label={`Enable ${s.name}`}
                    onChange={(v) => act(() => api(`/servers/${s.id}`, { method: 'PATCH', body: { enabled: v } }), `${s.name} ${v ? 'enabled' : 'disabled'}`)} />
                  <Menu trigger={(toggle) => <button className="btn ghost icon" onClick={toggle} aria-label="More actions"><Icon name="more" /></button>}>
                    <button onClick={() => act(() => api(`/servers/${s.id}/check`, { method: 'POST' }), 'Health check complete')}><Icon name="refresh" />Check now</button>
                    <button onClick={() => setEditing(s)}><Icon name="edit" />Edit server</button>
                    <hr />
                    <button className="danger" onClick={() => confirm(`Remove ${s.name}? Its tools disappear for everyone.`) && act(() => api(`/servers/${s.id}`, { method: 'DELETE' }), `${s.name} removed`)}>
                      <Icon name="trash" />Remove
                    </button>
                  </Menu>
                </div>
              )}
            </div>

            <div className="server-meta">
              <span className="mono ellipsis" style={{ maxWidth: 380 }}>{s.url}</span>
              {s.has_credential && <span className="row" style={{ gap: 5 }}><Icon name="lock" size={13} /><b>{s.auth_type === 'bearer' ? 'Bearer token' : `${s.auth_header} header`}</b>, injected server-side</span>}
              <span>Checked {ago(s.last_checked_at)}</span>
              {st && <span><b>{st.calls}</b> calls · <b>{st.p50_ms} ms</b> p50 · {st.p95_ms} ms p95 (24h)</span>}
            </div>

            {s.status === 'unreachable' && s.enabled && s.last_error && (
              <div style={{ padding: '0 18px 14px' }}><div className="alert bad"><Icon name="alert" /><span><b>Unreachable:</b> {s.last_error}. Its tools are hidden and calls fail fast until it recovers; other servers are unaffected.</span></div></div>
            )}
            {s.quarantined && (
              <div style={{ padding: '0 18px 14px' }}>
                <div className="alert bad" style={{ flexDirection: 'column', gap: 8 }}>
                  <div className="row"><Icon name="shield" /><b>Quarantined: tool definitions changed {ago(s.tools_changed_at)}</b></div>
                  <span>Tool descriptions are read by AI models, so a changed description can smuggle in instructions. This server's tools are hidden from everyone and calls are refused until an admin reviews the new definitions below.</span>
                  {isAdmin && (
                    <div className="row">
                      <button className="btn sm" onClick={() => act(() => api(`/servers/${s.id}/ack-changes`, { method: 'POST' }), 'New definitions approved')}>Approve new definitions</button>
                      <button className="btn sm danger" onClick={() => act(() => api(`/servers/${s.id}`, { method: 'PATCH', body: { enabled: false } }), `${s.name} disabled`)}>Disable server</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {s.tools.length > 0 && (
              <details className="server-tools" open={s.quarantined}>
                <summary><Icon name="chevron" size={13} />{s.tools.length} tools{adminOnly ? ` · ${adminOnly} admin-only` : ''}</summary>
                <table>
                  <thead><tr><th>Tool</th><th>Description</th><th>Kind</th>{isAdmin && <th>Who can use it</th>}</tr></thead>
                  <tbody>
                    {s.tools.map((t) => (
                      <tr key={t.name}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{t.gateway_name}</td>
                        <td className="tool-desc">{t.description.length > 140 ? t.description.slice(0, 140) + '…' : t.description}</td>
                        <td>{t.read_only ? <span className="badge">Read</span> : <span className="badge warn">Write</span>}</td>
                        {isAdmin && (
                          <td>
                            <Segmented<Role> value={t.min_role}
                              options={[{ value: 'member', label: 'Everyone' }, { value: 'admin', label: 'Admins' }]}
                              onChange={(v) => act(() => api(`/servers/${s.id}/policies`, { method: 'PUT', body: { tool_name: t.name, min_role: v } }),
                                `${t.gateway_name}: ${v === 'admin' ? 'admins only' : 'everyone'}`)} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </section>
        )
      })}

      {editing && <ServerForm server={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); toast(msg); load() }} />}
    </div>
  )
}

function ServerForm({ server, onClose, onSaved }: { server: Server | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({
    name: server?.name ?? '', slug: server?.slug ?? '', url: server?.url ?? '',
    auth_type: server?.auth_type ?? 'none', auth_header: server?.auth_header ?? '', credential: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value
    setF((p) => ({ ...p, [k]: v, ...(k === 'name' && !server ? { slug: v.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) } : {}) }))
  }

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    const body: Record<string, unknown> = { name: f.name, url: f.url, auth_type: f.auth_type, auth_header: f.auth_header || null }
    if (f.credential) body.credential = f.credential
    try {
      if (server) await api(`/servers/${server.id}`, { method: 'PATCH', body })
      else await api('/servers', { body: { ...body, slug: f.slug } })
      onSaved(server ? `${f.name} updated` : `${f.name} added; checking its tools now`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={server ? `Edit ${server.name}` : 'Add an MCP server'} subtitle="Any server that speaks MCP over Streamable HTTP." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => save()} disabled={busy || !f.name || !f.url || !f.slug}>{busy ? 'Connecting…' : server ? 'Save changes' : 'Add server'}</button></>}>
      <form className="col" onSubmit={save}>
        {error && <div className="alert bad"><Icon name="alert" />{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
          <label className="field"><span>Name</span><input value={f.name} onChange={set('name')} placeholder="GitHub" autoFocus /></label>
          <label className="field"><span>Tool prefix</span><input value={f.slug} onChange={set('slug')} disabled={!!server} placeholder="github" className="mono" /></label>
        </div>
        <label className="field"><span>Server URL</span><input value={f.url} onChange={set('url')} placeholder="https://example.com/mcp" className="mono" /></label>
        <label className="field"><span>Authentication</span>
          <select value={f.auth_type} onChange={set('auth_type')}>
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
        </label>
        {f.auth_type === 'header' && <label className="field"><span>Header name</span><input value={f.auth_header} onChange={set('auth_header')} placeholder="X-API-Key" className="mono" /></label>}
        {f.auth_type !== 'none' && (
          <label className="field"><span>{server?.has_credential ? 'Replace credential' : 'Credential'} {server?.has_credential && <span className="hint">· leave empty to keep the current one</span>}</span>
            <input type="password" value={f.credential} onChange={set('credential')} autoComplete="off" />
          </label>
        )}
        <div className="alert"><Icon name="lock" /><span>Credentials are encrypted at rest and only sent from the gateway to this URL. Nobody can read them back, admins included.</span></div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
