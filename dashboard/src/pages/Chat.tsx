import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type Config, type Server, type User } from '../api'
import { Markdown } from '../markdown'
import { colorFor, Icon, type IconName } from '../ui'

// OpenAI-format messages, kept in the browser and sent back each turn.
interface Msg { role: 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string }
interface Trace { tool: string; server: string; arguments: Record<string, unknown>; is_error: boolean; result_preview: string }
interface Turn { user: string; reply?: string; trace: Trace[]; error?: string; ms?: number }

const PROMPTS: { icon: IconName; title: string; prompt: string; admin?: boolean }[] = [
  { icon: 'activity', title: 'Today’s orders', prompt: 'What orders came in today? Who placed them and what did they buy?' },
  { icon: 'plus', title: 'Launch a product', prompt: 'Create a product called "Urumi Mug" priced 20% below the cheapest product in the store, then give me its link.', admin: true },
  { icon: 'search', title: 'Merchandising check', prompt: 'Which products are on sale right now, and what are their regular and sale prices?' },
  { icon: 'bolt', title: 'Two systems, one ask', prompt: 'Summarise today’s orders and open a GitHub issue titled "Daily order summary" in NRG2005/Urumi with that summary.' },
]

export default function Chat({ user }: { user: User }) {
  const [history, setHistory] = useState<Msg[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api<Config>('/config').then(setCfg)
    api<Server[]>('/servers').then((s) => setServers(s.filter((x) => x.enabled && x.status === 'connected' && !x.quarantined)))
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [turns, busy])
  useEffect(() => {
    const el = inputRef.current
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px` }
  }, [input])

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const msgs: Msg[] = [...history, { role: 'user', content: text }]
    setTurns((t) => [...t, { user: text, trace: [] }])
    setInput('')
    setBusy(true)
    const started = performance.now()
    try {
      const r = await api<{ messages: Msg[]; trace: Trace[]; reply: string }>('/chat', { body: { messages: msgs } })
      setHistory([...msgs, ...r.messages])
      setTurns((t) => [...t.slice(0, -1), { user: text, reply: r.reply, trace: r.trace, ms: performance.now() - started }])
    } catch (e) {
      setTurns((t) => [...t.slice(0, -1), { user: text, trace: [], error: e instanceof ApiError ? e.message : String(e) }])
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const first = user.name?.split(' ')[0] || user.email.split('@')[0]
  const prompts = PROMPTS.filter((p) => !p.admin || user.role === 'admin')

  return (
    <div className="chat-page">
      {turns.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="small muted">Chat agent · acting as {user.email}</span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => { setTurns([]); setHistory([]) }}><Icon name="plus" size={13} />New chat</button>
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="chat-hero">
            <div className="empty-icon" style={{ width: 44, height: 44 }}><Icon name="sparkle" size={20} /></div>
            <h1>What can I do for you, {first}?</h1>
            <p className="muted" style={{ maxWidth: 520 }}>
              Ask in plain English. I use your team's tools through the gateway, with your permissions, and show you every step.
            </p>
            {servers.length > 0 && (
              <div className="chat-servers">
                {servers.map((s) => (
                  <span key={s.id} className="badge"><span className="dot" style={{ background: colorFor(s.slug) }} />{s.name} · {s.tools.length}</span>
                ))}
              </div>
            )}
            {cfg && !cfg.llm_configured && (
              <div className="alert warn" style={{ marginTop: 12 }}><Icon name="alert" />No LLM API key is configured, so I can't answer yet. Set <code>llm.apiKey</code> in the gateway's Helm secrets.</div>
            )}
            <div className="prompt-grid">
              {prompts.map((p) => (
                <button key={p.title} className="prompt-card" onClick={() => send(p.prompt)}>
                  <span className="row" style={{ gap: 8, fontWeight: 500 }}><Icon name={p.icon} size={15} />{p.title}</span>
                  <span className="muted">{p.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="col" style={{ gap: 14 }}>
            <div className="msg-user">{t.user}</div>
            <div className="msg-assistant">
              <span className="bot"><Icon name="sparkle" size={14} /></span>
              <div className="msg-body">
                {t.trace.length > 0 && <Steps trace={t.trace} ms={t.ms} />}
                {t.reply !== undefined && (t.reply ? <Markdown text={t.reply} /> : <p className="muted">(no text reply)</p>)}
                {t.error && <div className="alert bad"><Icon name="alert" />{t.error}</div>}
                {t.reply === undefined && !t.error && <div className="thinking"><span /><span /><span /></div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input) }}>
        <textarea ref={inputRef} rows={1} value={input} autoFocus
          placeholder={busy ? 'Working on it…' : 'Ask about orders, products, issues…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }} />
        <div className="composer-foot">
          <Icon name="shield" size={13} />
          <span className="ellipsis">Acts as {user.email} · every tool call is audited{cfg ? ` · ${cfg.llm_model}` : ''}</span>
          <span className="spacer" />
          <span className="kbd">↵</span>
          <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="Send"><Icon name="arrowUp" size={15} stroke={2.2} /></button>
        </div>
      </form>
    </div>
  )
}

function Steps({ trace, ms }: { trace: Trace[]; ms?: number }) {
  const calls = trace.filter((t) => t.server !== 'gateway')
  const servers = [...new Set(calls.map((c) => c.server))]
  return (
    <details className="steps">
      <summary>
        <Icon name="wrench" size={13} />
        Used {calls.length} tool{calls.length === 1 ? '' : 's'}{servers.length ? ` across ${servers.join(', ')}` : ''}
        {trace.some((t) => t.is_error) && <span className="badge bad" style={{ height: 18 }}>error</span>}
        <span className="spacer" />
        {ms && <span className="faint">{(ms / 1000).toFixed(1)}s</span>}
        <Icon name="chevron" size={13} />
      </summary>
      {trace.map((c, i) => {
        const search = c.server === 'gateway'
        return (
          <div key={i} className="step">
            <span style={{ color: c.is_error ? 'var(--bad-strong)' : search ? 'var(--faint)' : 'var(--ok)' }}>
              <Icon name={c.is_error ? 'alert' : search ? 'search' : 'check'} size={14} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                {search
                  ? <span className="muted">Searched tools for “{String(c.arguments.query ?? '')}”</span>
                  : <><span className="badge" style={{ height: 19 }}><span className="dot" style={{ background: colorFor(c.server) }} />{c.server}</span><code>{c.tool.split('__').slice(1).join('__')}</code></>}
              </div>
              {search
                ? <div className="tiny faint" style={{ marginTop: 3 }}>loaded {c.result_preview.split(', ').slice(0, 4).join(', ')}{c.result_preview.split(', ').length > 4 ? ` +${c.result_preview.split(', ').length - 4} more` : ''}</div>
                : <pre>{JSON.stringify(c.arguments)}{'\n→ '}{c.result_preview}</pre>}
            </div>
          </div>
        )
      })}
    </details>
  )
}
