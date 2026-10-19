import { Fragment, useCallback, useEffect, useState } from 'react'
import { ago, api, ApiError, type ApiKey, type Role, type User } from '../api'

interface Member extends User { created_at: string; active_keys: number }
interface Invite { email: string; role: Role; expires_at: string }

export default function Members({ user }: { user: User }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [inviteUrl, setInviteUrl] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await api<{ users: Member[]; pending_invites: Invite[] }>('/users')
    setMembers(r.users)
    setInvites(r.pending_invites)
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try { await fn(); await load() } catch (e) { setError(e instanceof ApiError ? e.message : String(e)) }
  }

  const invite = () => act(async () => {
    const r = await api<{ invite_url: string }>('/invites', { body: { email, role } })
    setInviteUrl(r.invite_url)
    setEmail('')
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="sub">Admins manage servers and members. Members use tools, and only the ones their role allows.</p>
        </div>
      </div>
      {error && <div className="alert bad">{error}</div>}

      <section className="panel stack">
        <h2>Invite a teammate</h2>
        <div className="row">
          <input style={{ maxWidth: 280 }} placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="inline" style={{ padding: '7px 8px' }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="primary" onClick={invite} disabled={!email}>Create invite link</button>
        </div>
        {inviteUrl && (
          <div className="stack">
            <div className="alert ok">Send this one-time link to your teammate (valid 7 days):</div>
            <div className="secret">{inviteUrl}</div>
          </div>
        )}
        {invites.length > 0 && (
          <p className="sub">Pending: {invites.map((i) => `${i.email} (${i.role})`).join(', ')}</p>
        )}
      </section>

      <section className="panel">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active keys</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <Fragment key={m.id}>
                <tr>
                  <td>{m.name || '—'}{m.id === user.id && <span className="sub"> (you)</span>}</td>
                  <td>{m.email}</td>
                  <td>
                    <select className="inline" value={m.role} disabled={m.id === user.id}
                      onChange={(e) => act(() => api(`/users/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>{m.active_keys}</td>
                  <td>{ago(m.created_at)}</td>
                  <td className="row">
                    <button className="small" onClick={() => setOpen(open === m.id ? null : m.id)}>Keys</button>
                    {m.id !== user.id && (
                      <button className="small danger" onClick={() => confirm(`Remove ${m.email}? Their keys stop working immediately.`) && act(() => api(`/users/${m.id}`, { method: 'DELETE' }))}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
                {open === m.id && (
                  <tr><td colSpan={6}><MemberKeys member={m} onChange={load} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

function MemberKeys({ member, onChange }: { member: Member; onChange: () => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [fresh, setFresh] = useState('')
  const load = useCallback(async () => setKeys(await api<ApiKey[]>(`/keys?user_id=${member.id}`)), [member.id])
  useEffect(() => { load() }, [load])

  const issue = async () => {
    const r = await api<{ key: string }>('/keys', { body: { name: 'issued-by-admin', user_id: member.id } })
    setFresh(r.key)
    load(); onChange()
  }
  const revoke = async (id: number) => {
    await api(`/keys/${id}`, { method: 'DELETE' })
    load(); onChange()
  }

  return (
    <div className="stack" style={{ background: '#fafafa', padding: 12, borderRadius: 8 }}>
      <div className="row"><strong>{member.email}'s keys</strong><span className="spacer" /><button className="small" onClick={issue}>Issue a key</button></div>
      {fresh && <div className="secret">{fresh}</div>}
      <table>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name}</td>
              <td className="mono">{k.key_prefix}…</td>
              <td>last used {ago(k.last_used_at)}</td>
              <td>{k.revoked_at ? <span className="badge bad">revoked</span> : <button className="small danger" onClick={() => revoke(k.id)}>Revoke</button>}</td>
            </tr>
          ))}
          {keys.length === 0 && <tr><td className="sub">No keys.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
