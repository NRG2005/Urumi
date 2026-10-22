import { useCallback, useEffect, useState } from 'react'
import { ago, api, ApiError, type ApiKey, type Role, type User } from '../api'
import type { Nav } from '../App'
import { Avatar, Code, Icon, Menu, Modal, Segmented, useToast } from '../ui'

interface Member extends User { created_at: string; active_keys: number }
interface Invite { email: string; role: Role; expires_at: string }

export default function Members({ user, nav }: { user: User; nav: Nav }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviting, setInviting] = useState(false)
  const [keysFor, setKeysFor] = useState<Member | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    const r = await api<{ users: Member[]; pending_invites: Invite[] }>('/users')
    setMembers(r.users)
    setInvites(r.pending_invites)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (nav.intent === 'invite') { setInviting(true); nav.clearIntent() }
  }, [nav])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast(done); await load() } catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'bad') }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>Admins manage servers and people. Members use the tools their role allows, with their own keys, and never see an upstream credential.</p>
        </div>
        <button className="btn primary" onClick={() => setInviting(true)}><Icon name="userPlus" size={14} />Invite teammate</button>
      </div>

      <section className="card">
        <div className="card-head"><h2>Members</h2><span className="small muted">{members.length}</span></div>
        <table>
          <thead><tr><th>Person</th><th>Role</th><th>Active keys</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar name={m.name || m.email} large />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{m.name || m.email.split('@')[0]}{m.id === user.id && <span className="muted"> · you</span>}</div>
                      <div className="small muted">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {m.id === user.id
                    ? <span className="badge accent">Admin</span>
                    : <Segmented<Role> value={m.role} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]}
                        onChange={(v) => act(() => api(`/users/${m.id}`, { method: 'PATCH', body: { role: v } }), `${m.email} is now ${v === 'admin' ? 'an admin' : 'a member'}`)} />}
                </td>
                <td className="num">{m.active_keys}</td>
                <td className="muted">{ago(m.created_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  <Menu trigger={(toggle) => <button className="btn ghost icon" onClick={toggle} aria-label="Member actions"><Icon name="more" /></button>}>
                    <button onClick={() => setKeysFor(m)}><Icon name="key" />Manage API keys</button>
                    {m.id !== user.id && <>
                      <hr />
                      <button className="danger" onClick={() => confirm(`Remove ${m.email}? Their keys stop working immediately.`) && act(() => api(`/users/${m.id}`, { method: 'DELETE' }), `${m.email} removed`)}>
                        <Icon name="trash" />Remove from team
                      </button>
                    </>}
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invites.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Pending invites</h2><span className="small muted">{invites.length}</span></div>
          <table>
            <tbody>
              {invites.map((i) => (
                <tr key={i.email}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={i.email} /><span>{i.email}</span></div></td>
                  <td><span className="badge">{i.role}</span></td>
                  <td className="muted small" style={{ textAlign: 'right' }}>expires {new Date(i.expires_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {inviting && <InviteModal onClose={() => { setInviting(false); load() }} />}
      {keysFor && <KeysModal member={keysFor} onClose={() => { setKeysFor(null); load() }} />}
    </div>
  )
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  const create = async (e?: React.FormEvent) => {
    e?.preventDefault()
    try {
      const r = await api<{ invite_url: string }>('/invites', { body: { email, role } })
      setLink(r.invite_url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  if (link) {
    return (
      <Modal title="Invite link ready" subtitle={`Send this one-time link to ${email}. It expires in 7 days.`} onClose={onClose}
        footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <Code text={link} label="Invite link" />
        <p className="small muted">They'll choose a password, then generate their own API key. They get every tool their role allows and never see an upstream credential.</p>
      </Modal>
    )
  }
  return (
    <Modal title="Invite a teammate" subtitle="They'll join as the role you pick. You can change it later." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!email} onClick={() => create()}>Create invite link</button></>}>
      <form className="col" onSubmit={create}>
        {error && <div className="alert bad"><Icon name="alert" />{error}</div>}
        <label className="field"><span>Email</span><input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" /></label>
        <div className="field">
          <span>Role</span>
          <Segmented<Role> value={role} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} onChange={setRole} />
          <span className="hint">{role === 'admin' ? 'Can manage servers, members, keys and tool permissions.' : 'Can use the tools members are allowed and manage their own keys.'}</span>
        </div>
      </form>
    </Modal>
  )
}

function KeysModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [fresh, setFresh] = useState('')
  const toast = useToast()
  const load = useCallback(async () => setKeys(await api<ApiKey[]>(`/keys?user_id=${member.id}`)), [member.id])
  useEffect(() => { load() }, [load])

  const issue = async () => {
    const r = await api<{ key: string }>('/keys', { body: { name: 'issued-by-admin', user_id: member.id } })
    setFresh(r.key)
    load()
  }
  const revoke = async (k: ApiKey) => {
    await api(`/keys/${k.id}`, { method: 'DELETE' })
    toast(`Revoked “${k.name}”. It's rejected on its next request.`)
    load()
  }

  return (
    <Modal title={`${member.name || member.email}'s API keys`} subtitle="Revoking a key takes effect on the very next request." onClose={onClose}
      footer={<><button className="btn" onClick={issue}><Icon name="plus" size={13} />Issue a key</button><button className="btn primary" onClick={onClose}>Done</button></>}>
      {fresh && <><Code text={fresh} secret label="API key" /><p className="small muted">Shown once. Send it to {member.email} securely.</p></>}
      {keys.length === 0 && !fresh && <p className="muted small">No keys yet.</p>}
      {keys.map((k) => (
        <div key={k.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{k.name}</div>
            <div className="tiny muted mono">{k.key_prefix}•••• · last used {k.last_used_at ? ago(k.last_used_at) : 'never'}</div>
          </div>
          {k.revoked_at ? <span className="badge bad">Revoked</span> : <button className="btn sm danger" onClick={() => revoke(k)}>Revoke</button>}
        </div>
      ))}
    </Modal>
  )
}
