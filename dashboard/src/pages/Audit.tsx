import { useCallback, useEffect, useState } from 'react'
import { api, fmtTime, type AuditEntry, type User } from '../api'

const OUTCOME_CLS: Record<string, string> = { success: 'ok', denied: 'warn', rejected: 'bad', error: 'bad', timeout: 'bad', unreachable: 'bad' }

export default function Audit({ user }: { user: User }) {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [server, setServer] = useState('')
  const [live, setLive] = useState(true)

  const load = useCallback(async () => {
    setRows(await api<AuditEntry[]>(`/audit?limit=300${server ? `&server=${encodeURIComponent(server)}` : ''}`))
  }, [server])

  useEffect(() => {
    load()
    if (!live) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load, live])

  const servers = [...new Set(rows.map((r) => r.server_slug).filter(Boolean))] as string[]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="sub">{user.role === 'admin' ? 'Every tool call through the gateway, by every user.' : 'Your own tool calls through the gateway.'}</p>
        </div>
        <div className="row">
          <select className="inline" style={{ padding: '6px 8px' }} value={server} onChange={(e) => setServer(e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="row" style={{ flexDirection: 'row' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={live} onChange={(e) => setLive(e.target.checked)} /> live
          </label>
        </div>
      </div>
      <section className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>When</th><th>User</th><th>Via</th><th>Server</th><th>Tool</th><th>Duration</th><th>Outcome</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.ts)}</td>
                <td>{r.user_email}</td>
                <td><span className={`badge ${r.via === 'chat' ? 'accent' : ''}`}>{r.via === 'chat' ? 'chat agent' : 'MCP client'}</span></td>
                <td className="mono">{r.server_slug ?? '—'}</td>
                <td className="mono">{r.tool_name}</td>
                <td>{r.duration_ms} ms</td>
                <td><span className={`badge ${OUTCOME_CLS[r.outcome] ?? ''}`}>{r.outcome}</span></td>
                <td className="desc" style={{ fontSize: 12.5 }}>{r.error}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="sub" style={{ padding: 16 }}>No calls yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  )
}
