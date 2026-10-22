import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type Config, type Server, type User } from '../api'
import { Markdown } from '../markdown'
import { colorFor, Icon, type IconName } from '../ui'

// OpenAI-format messages, kept in the browser and sent back each turn.
interface Msg { role: 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string }

/** One thing the agent did, shown live while it happens. */
interface Step {
  id: string
  kind: 'search' | 'tool'
  tool: string
  server: string
  arguments: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  preview?: string
  ms?: number
}

interface Turn {
  user: string
  steps: Step[]
  draft: string        // answer text streaming in
  reasoning: string    // the model's thinking, streaming in (shown faintly while it works)
  reply?: string       // final answer, once done
  notice?: string      // e.g. rate-limit retry
  error?: string
  live: boolean
  ms?: number
}

/** Events from POST /api/chat/stream (newline-delimited JSON). */
type AgentEvent =
  | { t: 'step' }
  | { t: 'reasoning' | 'delta'; text: string }
  | { t: 'search'; id: string; arguments: Record<string, unknown>; result_preview: string }
  | { t: 'tool_start'; id: string; tool: string; server: string; arguments: Record<string, unknown> }
  | { t: 'tool_end'; id: string; is_error: boolean; result_preview: string; ms: number }
  | { t: 'retry'; seconds: number }
  | { t: 'done'; messages: Msg[]; reply: string }
  | { t: 'error'; message: string }

const PROMPTS: { icon: IconName; title: string; prompt: string; admin?: boolean }[] = [
  { icon: 'activity', title: 'Today’s orders', prompt: 'What orders came in today? Who placed them and what did they buy?' },
  { icon: 'plus', title: 'Launch a product', prompt: 'Create a product called "Urumi Mug" priced 20% below the cheapest product in the store, then give me its link.', admin: true },
  { icon: 'search', title: 'Merchandising check', prompt: 'Which products are on sale right now, and what are their regular and sale prices?' },
  { icon: 'bolt', title: 'Two systems, one ask', prompt: 'Summarise today’s orders and open a GitHub issue titled "Daily order summary" in NRG2005/Urumi with that summary.' },
]

function apply(turn: Turn, e: AgentEvent): Turn {
  switch (e.t) {
    case 'step': return { ...turn, draft: '', reasoning: '', notice: undefined }
    case 'reasoning': return { ...turn, reasoning: turn.reasoning + e.text }
    case 'delta': return { ...turn, draft: turn.draft + e.text, notice: undefined }
    case 'search': return { ...turn, steps: [...turn.steps, { id: e.id, kind: 'search', tool: 'search_tools', server: 'gateway', arguments: e.arguments, status: 'ok', preview: e.result_preview }] }
    case 'tool_start': return { ...turn, steps: [...turn.steps, { id: e.id, kind: 'tool', tool: e.tool, server: e.server, arguments: e.arguments, status: 'running' }] }
    case 'tool_end': return { ...turn, steps: turn.steps.map((s) => s.id === e.id ? { ...s, status: e.is_error ? 'error' : 'ok', preview: e.result_preview, ms: e.ms } : s) }
    case 'retry': return { ...turn, notice: `The model provider asked us to slow down. Retrying in ${e.seconds}s…` }
    case 'done': return { ...turn, reply: e.reply, live: false }
    case 'error': return { ...turn, error: e.message, live: false }
  }
}

export default function Chat({ user }: { user: User }) {
  const [history, setHistory] = useState<Msg[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [servers, setServers] = useState<Server[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    api<Config>('/config').then(setCfg)
    api<Server[]>('/servers').then((s) => setServers(s.filter((x) => x.enabled && x.status === 'connected' && !x.quarantined)))
    return () => abortRef.current?.abort()
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTo({ top: el.scrollHeight })
  }, [turns])
  useEffect(() => {
    const el = inputRef.current
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px` }
  }, [input])

  const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])])

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const msgs: Msg[] = [...history, { role: 'user', content: text }]
    setTurns((t) => [...t, { user: text, steps: [], draft: '', reasoning: '', live: true }])
    setInput('')
    setBusy(true)
    const started = performance.now()
    const abort = new AbortController()
    abortRef.current = abort
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))

    try {
      const resp = await fetch('/api/chat/stream', {
        method: 'POST', credentials: 'same-origin', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs }),
      })
      if (!resp.ok || !resp.body) {
        const d = await resp.json().catch(() => ({}))
        throw new ApiError(resp.status, d.detail || resp.statusText)
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          const event = JSON.parse(line) as AgentEvent
          if (event.t === 'done') setHistory([...msgs, ...event.messages])
          patch((t) => ({ ...apply(t, event), ms: event.t === 'done' ? performance.now() - started : t.ms }))
        }
      }
      patch((t) => (t.live ? { ...t, live: false, error: t.error ?? 'The connection closed before the agent finished.' } : t))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patch((t) => ({ ...t, live: false, error: e instanceof ApiError ? e.message : String(e) }))
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
          <button className="btn ghost sm" disabled={busy} onClick={() => { setTurns([]); setHistory([]) }}><Icon name="plus" size={13} />New chat</button>
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

        {turns.map((t, i) => {
          const text = t.reply ?? t.draft
          const working = t.live && !t.draft && !t.steps.some((st) => st.status === 'running')
          return (
            <div key={i} className="col" style={{ gap: 14 }}>
              <div className="msg-user">{t.user}</div>
              <div className="msg-assistant">
                <span className={`bot${t.live ? ' live' : ''}`}><Icon name="sparkle" size={14} /></span>
                <div className="msg-body">
                  {t.steps.length > 0 && <Steps steps={t.steps} live={t.live} ms={t.ms} />}
                  {working && <Working reasoning={t.reasoning} notice={t.notice} hasSteps={t.steps.length > 0} />}
                  {text && <div className={t.live ? 'streaming' : ''}><Markdown text={text} /></div>}
                  {!t.live && !text && !t.error && <p className="muted">(no text reply)</p>}
                  {t.error && <div className="alert bad"><Icon name="alert" />{t.error}</div>}
                </div>
              </div>
            </div>
          )
        })}
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
          {busy
            ? <button className="send" type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop"><span className="stop-square" /></button>
            : <><span className="kbd">↵</span><button className="send" type="submit" disabled={!input.trim()} aria-label="Send"><Icon name="arrowUp" size={15} stroke={2.2} /></button></>}
        </div>
      </form>
    </div>
  )
}

/** "Thinking…" line while the model works and before any answer text arrives. */
function Working({ reasoning, notice, hasSteps }: { reasoning: string; notice?: string; hasSteps: boolean }) {
  const tail = reasoning.replace(/\s+/g, ' ').trim().slice(-160)
  return (
    <div className="working">
      <div className="row" style={{ gap: 8 }}>
        <span className="spinner" />
        <span className="shimmer-text">{notice ?? (hasSteps ? 'Working with the results…' : 'Thinking…')}</span>
      </div>
      {tail && !notice && <div className="reasoning">{tail}</div>}
    </div>
  )
}

function Steps({ steps, live, ms }: { steps: Step[]; live: boolean; ms?: number }) {
  const calls = steps.filter((s) => s.kind === 'tool')
  const servers = [...new Set(calls.map((c) => c.server))]
  const failed = steps.some((s) => s.status === 'error')
  const list = steps.map((s) => <StepRow key={s.id} step={s} />)

  if (live) return <div className="steps live">{list}</div>
  return (
    <details className="steps">
      <summary>
        <Icon name="wrench" size={13} />
        Used {calls.length} tool{calls.length === 1 ? '' : 's'}{servers.length ? ` across ${servers.join(', ')}` : ''}
        {failed && <span className="badge bad" style={{ height: 18 }}>error</span>}
        <span className="spacer" />
        {ms && <span className="faint">{(ms / 1000).toFixed(1)}s</span>}
        <Icon name="chevron" size={13} />
      </summary>
      {list}
    </details>
  )
}

function StepRow({ step: s }: { step: Step }) {
  const search = s.kind === 'search'
  const found = (s.preview ?? '').split(', ').filter(Boolean)
  return (
    <div className={`step${s.status === 'running' ? ' running' : ''}`}>
      <span className="step-icon" style={{ color: s.status === 'error' ? 'var(--bad-strong)' : search ? 'var(--faint)' : 'var(--ok)' }}>
        {s.status === 'running' ? <span className="spinner" /> : <Icon name={s.status === 'error' ? 'alert' : search ? 'search' : 'check'} size={14} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          {search
            ? <span className="muted">Searched tools for “{String(s.arguments.query ?? '')}”</span>
            : <>
                <span className="badge" style={{ height: 19 }}><span className="dot" style={{ background: colorFor(s.server) }} />{s.server}</span>
                <code>{s.tool.split('__').slice(1).join('__')}</code>
                {s.status === 'running' ? <span className="faint tiny shimmer-text">running…</span> : s.ms !== undefined && <span className="faint tiny">{s.ms} ms</span>}
              </>}
        </div>
        {search
          ? <div className="tiny faint" style={{ marginTop: 3 }}>{found.length ? `loaded ${found.slice(0, 4).join(', ')}${found.length > 4 ? ` +${found.length - 4} more` : ''}` : 'no matching tools'}</div>
          : <pre>{JSON.stringify(s.arguments)}{s.preview ? `\n→ ${s.preview}` : ''}</pre>}
      </div>
    </div>
  )
}
