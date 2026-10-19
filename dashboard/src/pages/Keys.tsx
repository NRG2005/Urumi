import { useCallback, useEffect, useState } from 'react'
import { ago, api, type ApiKey, type Config, type User } from '../api'

export default function Keys({ user }: { user: User }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [cfg, setCfg] = useState<Config | null>(null)
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)

  const load = useCallback(async () => setKeys(await api<ApiKey[]>('/keys')), [])
  useEffect(() => {
    load()
    api<Config>('/config').then(setCfg)
  }, [load])

  const create = async () => {
    const r = await api<{ key: string }>('/keys', { body: { name: name || 'default' } })
    setFresh(r.key)
    setName('')
    load()
  }

  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke "${k.name}"? Any client using it stops working on its next call.`)) return
    await api(`/keys/${k.id}`, { method: 'DELETE' })
    load()
  }

  const url = cfg?.mcp_url ?? `${location.origin}/mcp`
  const key = fresh ?? '<your API key>'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>API keys &amp; connect</h1>
          <p className="sub">One URL and one key give your MCP client every tool you are allowed to use. You never need the upstream servers' credentials.</p>
        </div>
      </div>

      <section className="panel stack">
        <h2>Create a key</h2>
        <div className="row">
          <input style={{ maxWidth: 280 }} placeholder="Name, e.g. claude-code-laptop" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={create}>Generate key</button>
        </div>
        {fresh && (
          <div className="stack">
            <div className="alert ok">Copy this key now. It is stored only as a hash, so it cannot be shown again.</div>
            <div className="secret">{fresh}</div>
          </div>
        )}
      </section>

      <section className="panel stack">
        <h2>Connect a client</h2>
        <p className="sub">Gateway endpoint (Streamable HTTP): <code>{url}</code></p>
        <div>
          <strong>Claude Code</strong>
          <pre className="snippet">{`claude mcp add --transport http urumi ${url} --header "Authorization: Bearer ${key}"`}</pre>
        </div>
        <div>
          <strong>Cursor</strong> <span className="sub">(~/.cursor/mcp.json)</span>
          <pre className="snippet">{JSON.stringify({ mcpServers: { urumi: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)}</pre>
        </div>
        <div>
          <strong>MCP Inspector</strong>
          <pre className="snippet">{`npx @modelcontextprotocol/inspector\n# Transport: Streamable HTTP · URL: ${url}\n# Authentication > Header: Authorization = Bearer ${key}`}</pre>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Your keys</h2><span className="sub">signed in as {user.email}</span></div>
        <table>
          <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">{k.key_prefix}…</td>
                <td>{ago(k.created_at)}</td>
                <td>{ago(k.last_used_at)}</td>
                <td>{k.revoked_at ? <span className="badge bad">revoked</span> : <span className="badge ok">active</span>}</td>
                <td>{!k.revoked_at && <button className="small danger" onClick={() => revoke(k)}>Revoke</button>}</td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={6} className="sub">No keys yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  )
}
