import { useCallback, useEffect, useState } from 'react'
import { ago, api, type ApiKey, type AuditEntry, type Config, type Hour, type Server, type Stat, type User } from '../api'
import type { Nav } from '../App'
import { Avatar, CopyInline, Icon, Status } from '../ui'

const OUTCOME: Record<string, string> = { success: 'ok', denied: 'warn', rejected: 'bad', error: 'bad', timeout: 'bad', unreachable: 'bad' }

const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Overview({ user, nav }: { user: User; nav: Nav }) {
  const [servers, setServers] = useState<Server[] | null>(null)
  const [stats, setStats] = useState<Stat[]>([])
  const [hours, setHours] = useState<Hour[]>([])
  const [recent, setRecent] = useState<AuditEntry[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [teamSize, setTeamSize] = useState(1)
  const [cfg, setCfg] = useState<Config | null>(null)
  const isAdmin = user.role === 'admin'

  const load = useCallback(async () => {
    const [s, st, h, a, k] = await Promise.all([
      api<Server[]>('/servers'), api<Stat[]>('/stats'), api<Hour[]>('/stats/timeseries'),
      api<AuditEntry[]>('/audit?limit=200'), api<ApiKey[]>('/keys'),
    ])
    setServers(s); setStats(st); setHours(h); setRecent(a); setKeys(k)
  }, [])

  useEffect(() => {
    load()
    api<Config>('/config').then(setCfg)
    if (isAdmin) api<{ users: unknown[] }>('/users').then((r) => setTeamSize(r.users.length))
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load, isAdmin])

  const enabled = (servers ?? []).filter((s) => s.enabled)
  const live = enabled.filter((s) => s.status === 'connected' && !s.quarantined)
  const tools = live.reduce((n, s) => n + s.tools.length, 0)
  const calls = hours.reduce((n, h) => n + h.ok + h.failed, 0)
  const failed = hours.reduce((n, h) => n + h.failed, 0)
  const statBy = Object.fromEntries(stats.map((s) => [s.server_slug, s]))
  const mine = recent.filter((r) => r.user_email === user.email)

  const steps = [
    { done: keys.some((k) => !k.revoked_at), title: 'Generate your API key', body: 'Your personal key for the gateway. Shown once, revocable any time.', cta: 'Generate key', run: () => nav.go('keys', 'new-key') },
    { done: keys.some((k) => k.last_used_at), title: 'Connect Claude Code, Cursor or Inspector', body: 'One URL and your key: every team tool appears in your client.', cta: 'Show me how', run: () => nav.go('keys') },
    { done: mine.some((r) => r.via === 'chat'), title: 'Ask the chat agent something', body: 'Try “What orders came in today?”. It uses the same tools, as you.', cta: 'Open chat', run: () => nav.go('chat') },
    ...(isAdmin ? [{ done: teamSize > 1, title: 'Invite a teammate', body: 'They get every tool without ever seeing an upstream credential.', cta: 'Invite', run: () => nav.go('members', 'invite') }] : []),
  ]
  const doneCount = steps.filter((s) => s.done).length
  const max = Math.max(1, ...hours.map((h) => h.ok + h.failed))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting()}, {user.name?.split(' ')[0] || user.email.split('@')[0]}</h1>
          <p>Your team's MCP endpoint{cfg ? ' is ' : ''}{cfg && <CopyInline text={cfg.mcp_url} label="Endpoint URL" />}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => nav.go('keys')}><Icon name="terminal" size={14} />Connect a client</button>
          <button className="btn primary" onClick={() => nav.go('chat')}><Icon name="chat" size={14} />Ask the agent</button>
        </div>
      </div>

      {doneCount < steps.length && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Get started</h2>
              <p className="small muted" style={{ marginTop: 2 }}>{doneCount} of {steps.length} done · about two minutes to your first tool call</p>
            </div>
            <div className="progress" style={{ width: 140 }}><span style={{ width: `${(100 * doneCount) / steps.length}%` }} /></div>
          </div>
          <div className="checklist">
            {steps.map((s) => (
              <div key={s.title} className={`check${s.done ? ' done' : ''}`}>
                <span className="check-box"><Icon name="check" size={12} stroke={3} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="check-title">{s.title}</div>
                  {!s.done && <div className="small muted">{s.body}</div>}
                </div>
                {!s.done && <button className="btn sm" onClick={s.run}>{s.cta}<Icon name="chevron" size={13} /></button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="stats">
        <div className="stat" onClick={() => nav.go('servers')}>
          <div className="stat-label"><span className={`dot ${servers && live.length === enabled.length ? 'ok' : 'bad'}`} />Servers online</div>
          <div className="stat-value">{servers ? `${live.length}/${enabled.length}` : '–'}</div>
          <div className="stat-sub">{servers ? (live.length === enabled.length ? 'All systems normal' : `${enabled.length - live.length} need attention`) : ' '}</div>
        </div>
        <div className="stat" onClick={() => nav.go('servers')}>
          <div className="stat-label">{isAdmin ? 'Tools available' : 'Tools you can use'}</div>
          <div className="stat-value">{tools}</div>
          <div className="stat-sub">through one endpoint</div>
        </div>
        <div className="stat" onClick={() => nav.go('audit')}>
          <div className="stat-label">Tool calls · 24h</div>
          <div className="stat-value">{calls}</div>
          <div className="stat-sub">{isAdmin ? 'across the team' : 'made by you'}</div>
        </div>
        <div className="stat" onClick={() => nav.go('audit')}>
          <div className="stat-label">Success rate · 24h</div>
          <div className="stat-value">{calls ? `${Math.round((100 * (calls - failed)) / calls)}%` : '–'}</div>
          <div className="stat-sub">{failed ? `${failed} failed or denied` : 'no failures'}</div>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <section className="card">
            <div className="card-head">
              <h2>Activity</h2>
              <span className="spacer" />
              <div className="legend"><span><i style={{ background: 'var(--text)' }} />Succeeded</span><span><i style={{ background: 'var(--bad-dot)' }} />Failed</span></div>
            </div>
            <div className="card-body">
              <div className="chart">
                {hours.map((h) => {
                  const t = new Date(h.hour)
                  const tip = `${t.toLocaleTimeString([], { hour: 'numeric' })} · ${h.ok} ok${h.failed ? `, ${h.failed} failed` : ''}`
                  return (
                    <div key={h.hour} className="bar-col" data-tip={tip}>
                      {h.ok + h.failed === 0 ? <div className="seg-empty" /> : <>
                        {h.ok > 0 && <div className="seg-ok" style={{ height: `${(h.ok / max) * 100}%` }} />}
                        {h.failed > 0 && <div className="seg-bad" style={{ height: `${(h.failed / max) * 100}%` }} />}
                      </>}
                    </div>
                  )
                })}
              </div>
              <div className="chart-axis"><span>24h ago</span><span>12h ago</span><span>now</span></div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Upstream servers</h2><span className="spacer" /><button className="btn ghost sm" onClick={() => nav.go('servers')}>Manage<Icon name="chevron" size={13} /></button></div>
            <div className="server-line tiny muted" style={{ cursor: 'default', borderTop: 0, paddingBottom: 4 }}>
              <span>Server</span><span>Tools</span><span>Calls 24h</span><span>p50 latency</span>
            </div>
            {(servers ?? []).map((s) => {
              const st = statBy[s.slug]
              return (
                <div key={s.id} className="server-line" onClick={() => nav.go('servers')}>
                  <div className="row" style={{ minWidth: 0 }}>
                    <span style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 500 }}>{s.name}</div>
                      <Status status={s.quarantined ? 'quarantined' : s.enabled ? s.status : 'disabled'} />
                    </span>
                  </div>
                  <span className="num">{s.tools.length}</span>
                  <span className="num">{st?.calls ?? 0}{st?.failures ? <span className="muted"> · {st.failures}✕</span> : null}</span>
                  <span className="num mono">{st ? `${st.p50_ms} ms` : '—'}</span>
                </div>
              )
            })}
          </section>
        </div>

        <section className="card">
          <div className="card-head"><h2>Recent activity</h2><span className="spacer" /><button className="btn ghost sm" onClick={() => nav.go('audit')}>Audit log<Icon name="chevron" size={13} /></button></div>
          {recent.slice(0, 9).map((r) => (
            <div key={r.id} className="feed-item">
              <Avatar name={r.user_email} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="mono ellipsis" style={{ fontSize: 12.5 }}>{r.tool_name}</span>
                  <span className="spacer" />
                  <span className={`dot ${OUTCOME[r.outcome] ?? ''}`} title={r.outcome} />
                </div>
                <div className="tiny muted ellipsis">{r.user_email.split('@')[0]} · {r.via === 'chat' ? 'chat agent' : 'MCP client'} · {ago(r.ts)}</div>
              </div>
            </div>
          ))}
          {recent.length === 0 && <div className="empty small">No tool calls yet</div>}
        </section>
      </div>
    </div>
  )
}
