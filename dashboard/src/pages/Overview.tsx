import { useCallback, useEffect, useState } from 'react'
import { ago, api, type AuditEntry, type Config, type Server, type Stat, type User } from '../api'

const STATUS_CLS: Record<string, string> = { connected: 'ok', unreachable: 'bad', disabled: '', unknown: 'warn' }
const OUTCOME_CLS: Record<string, string> = { success: 'ok', denied: 'warn', rejected: 'bad', error: 'bad', timeout: 'bad', unreachable: 'bad' }

export default function Overview({ user, go }: { user: User; go: (page: 'servers' | 'audit' | 'keys' | 'chat') => void }) {
  const [servers, setServers] = useState<Server[]>([])
  const [stats, setStats] = useState<Stat[]>([])
  const [recent, setRecent] = useState<AuditEntry[]>([])
  const [cfg, setCfg] = useState<Config | null>(null)

  const load = useCallback(async () => {
    const [s, st, a] = await Promise.all([api<Server[]>('/servers'), api<Stat[]>('/stats'), api<AuditEntry[]>('/audit?limit=8')])
    setServers(s); setStats(st); setRecent(a)
  }, [])

  useEffect(() => {
    load()
    api<Config>('/config').then(setCfg)
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load])

  const live = servers.filter((s) => s.enabled && s.status === 'connected' && !s.quarantined)
  const tools = live.reduce((n, s) => n + s.tools.length, 0)
  const calls = stats.reduce((n, s) => n + s.calls, 0)
  const failures = stats.reduce((n, s) => n + s.failures, 0)
  const statBy = Object.fromEntries(stats.map((s) => [s.server_slug, s]))
  const maxCalls = Math.max(1, ...stats.map((s) => s.calls))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome back{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <p className="sub">One MCP endpoint for every tool your team uses: <code>{cfg?.mcp_url ?? '…'}</code></p>
        </div>
        <div className="row">
          <button onClick={() => go('keys')}>Connect a client</button>
          <button className="primary" onClick={() => go('chat')}>Open chat agent</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Servers online" value={`${live.length}/${servers.filter((s) => s.enabled).length}`}
          tone={live.length === servers.filter((s) => s.enabled).length ? 'ok' : 'bad'} onClick={() => go('servers')} />
        <Kpi label={user.role === 'admin' ? 'Tools available' : 'Tools available to you'} value={String(tools)} onClick={() => go('servers')} />
        <Kpi label="Tool calls · 24h" value={String(calls)} onClick={() => go('audit')} />
        <Kpi label="Failed calls · 24h" value={String(failures)} tone={failures ? 'warn' : 'ok'}
          hint={calls ? `${Math.round((100 * failures) / calls)}% of calls` : undefined} onClick={() => go('audit')} />
      </div>

      <div className="grid-main">
        <section className="panel">
          <div className="panel-head"><h2>Upstream servers</h2><span className="spacer" /><button className="small" onClick={() => go('servers')}>Manage</button></div>
          <table>
            <thead><tr><th>Server</th><th>Status</th><th>Tools</th><th>Calls · 24h</th><th>p50 / p95</th></tr></thead>
            <tbody>
              {servers.map((s) => {
                const st = statBy[s.slug]
                const status = s.quarantined ? 'quarantined' : s.status
                return (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="sub mono">{s.slug}__*</div></td>
                    <td>
                      <span className={`badge ${s.quarantined ? 'bad' : STATUS_CLS[s.status]}`}><span className="dot" />{status}</span>
                      {s.status === 'unreachable' && s.last_error && <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>{s.last_error}</div>}
                    </td>
                    <td>{s.tools.length}</td>
                    <td style={{ minWidth: 120 }}>
                      <div className="bar"><span style={{ width: `${((st?.calls ?? 0) / maxCalls) * 100}%` }} /></div>
                      <span className="sub" style={{ fontSize: 12 }}>{st?.calls ?? 0} calls{st?.failures ? ` · ${st.failures} failed` : ''}</span>
                    </td>
                    <td className="mono">{st ? `${st.p50_ms} / ${st.p95_ms} ms` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Recent activity</h2><span className="spacer" /><button className="small" onClick={() => go('audit')}>Audit log</button></div>
          <div className="feed">
            {recent.map((r) => (
              <div key={r.id} className="feed-row">
                <span className={`badge ${OUTCOME_CLS[r.outcome] ?? ''}`}>{r.outcome}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="mono ellipsis">{r.tool_name}</div>
                  <div className="sub" style={{ fontSize: 12 }}>{r.user_email} · {r.via === 'chat' ? 'chat agent' : 'MCP client'} · {ago(r.ts)}</div>
                </div>
              </div>
            ))}
            {recent.length === 0 && <p className="sub">No tool calls yet. Connect a client or ask the chat agent something.</p>}
          </div>
        </section>
      </div>
    </>
  )
}

function Kpi({ label, value, tone, hint, onClick }: { label: string; value: string; tone?: string; hint?: string; onClick?: () => void }) {
  return (
    <button className={`kpi ${tone ?? ''}`} onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </button>
  )
}
