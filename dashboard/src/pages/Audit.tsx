import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ago, api, fmtTime, type AuditEntry, type User } from '../api'
import { Avatar, colorFor, Empty, Icon, Segmented } from '../ui'

const OUTCOME: Record<string, string> = { success: 'ok', denied: 'warn', rejected: 'bad', error: 'bad', timeout: 'bad', unreachable: 'bad' }
type Filter = 'all' | 'ok' | 'failed'

export default function Audit({ user }: { user: User }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [limit, setLimit] = useState(200)
  const [q, setQ] = useState('')
  const [outcome, setOutcome] = useState<Filter>('all')
  const [via, setVia] = useState('')
  const [server, setServer] = useState('')
  const [live, setLive] = useState(true)
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(async () => setRows(await api<AuditEntry[]>(`/audit?limit=${limit}`)), [limit])
  useEffect(() => {
    load()
    if (!live) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load, live])

  const servers = useMemo(() => [...new Set((rows ?? []).map((r) => r.server_slug).filter(Boolean))] as string[], [rows])
  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (!q || `${r.tool_name} ${r.user_email} ${r.error ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
    (outcome === 'all' || (outcome === 'ok' ? r.outcome === 'success' : r.outcome !== 'success')) &&
    (!via || r.via === via) &&
    (!server || r.server_slug === server)), [rows, q, outcome, via, server])
  const maxMs = Math.max(1, ...filtered.map((r) => r.duration_ms))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>{user.role === 'admin' ? 'Every tool call through the gateway: who, which server and tool, when, how long, and whether it worked.' : 'Every tool call you made through the gateway.'}</p>
        </div>
        <button className={`btn${live ? '' : ' ghost'}`} onClick={() => setLive((l) => !l)}>
          <span className={`dot ${live ? 'ok pulse' : ''}`} />{live ? 'Live' : 'Paused'}
        </button>
      </div>

      <div className="toolbar">
        <div className="search-wrap"><Icon name="search" size={14} /><input placeholder="Search tool, user or error…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Segmented<Filter> value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All' }, { value: 'ok', label: 'Succeeded' }, { value: 'failed', label: 'Failed' }]} />
        <select style={{ width: 'auto' }} value={via} onChange={(e) => setVia(e.target.value)}>
          <option value="">All sources</option><option value="mcp">MCP clients</option><option value="chat">Chat agent</option>
        </select>
        <select style={{ width: 'auto' }} value={server} onChange={(e) => setServer(e.target.value)}>
          <option value="">All servers</option>{servers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <span className="small muted num">{filtered.length} of {rows?.length ?? 0}</span>
      </div>

      <section className="card" style={{ overflow: 'hidden' }}>
        {rows && filtered.length === 0 ? (
          <Empty icon="audit" title={rows.length ? 'No calls match these filters' : 'No tool calls yet'}>
            {rows.length ? 'Try clearing a filter.' : 'Calls from MCP clients and the chat agent appear here the moment they happen.'}
          </Empty>
        ) : (
          <table>
            <thead><tr><th>When</th><th>User</th><th>Source</th><th>Tool</th><th>Duration</th><th>Outcome</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr className={r.error ? 'clickable' : ''} onClick={() => r.error && setOpen(open === r.id ? null : r.id)}>
                    <td className="muted" title={fmtTime(r.ts)} style={{ whiteSpace: 'nowrap' }}>{ago(r.ts)}</td>
                    <td><div className="row" style={{ gap: 8 }}><Avatar name={r.user_email} /><span className="ellipsis" style={{ maxWidth: 180 }}>{r.user_email}</span></div></td>
                    <td><span className={`badge${r.via === 'chat' ? ' accent' : ''}`}>{r.via === 'chat' ? 'Chat agent' : 'MCP client'}</span></td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {r.server_slug && <span className="dot" style={{ background: colorFor(r.server_slug), boxShadow: 'none' }} />}
                        <span className="mono">{r.tool_name}</span>
                      </div>
                    </td>
                    <td><div className="dur"><span className="dur-bar"><span style={{ width: `${Math.max(4, (r.duration_ms / maxMs) * 100)}%` }} /></span><span className="num small">{r.duration_ms} ms</span></div></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className={`badge ${OUTCOME[r.outcome] ?? ''}`}>{r.outcome}</span>
                        {r.error && <Icon name="chevron" size={13} />}
                      </div>
                    </td>
                  </tr>
                  {open === r.id && r.error && (
                    <tr className="detail-row"><td colSpan={6}><div className="row" style={{ alignItems: 'flex-start' }}><Icon name="alert" size={14} /><span>{r.error}</span></div></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {rows && rows.length >= limit && (
        <div style={{ textAlign: 'center', marginTop: 14 }}><button className="btn" onClick={() => setLimit((l) => l + 300)}>Load older calls</button></div>
      )}
    </div>
  )
}
