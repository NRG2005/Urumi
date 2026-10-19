import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type Config, type User } from '../api'

// OpenAI-format messages, kept in the browser and sent back each turn.
interface Msg { role: 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string }
interface Trace { tool: string; server: string; arguments: Record<string, unknown>; is_error: boolean; result_preview: string }
interface Turn { user: string; reply?: string; trace: Trace[]; error?: string }

const SUGGESTIONS = [
  'Create a product called "Urumi Hoodie" priced at 1499',
  'What orders came in today?',
  'Summarise today\'s orders and open a GitHub issue with the summary',
]

export default function Chat({ user }: { user: User }) {
  const [history, setHistory] = useState<Msg[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<Config | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { api<Config>('/config').then(setCfg) }, [])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [turns, busy])

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const msgs: Msg[] = [...history, { role: 'user', content: text }]
    setTurns((t) => [...t, { user: text, trace: [] }])
    setInput('')
    setBusy(true)
    try {
      const r = await api<{ messages: Msg[]; trace: Trace[]; reply: string }>('/chat', { body: { messages: msgs } })
      setHistory([...msgs, ...r.messages])
      setTurns((t) => [...t.slice(0, -1), { user: text, reply: r.reply, trace: r.trace }])
    } catch (e) {
      setTurns((t) => [...t.slice(0, -1), { user: text, trace: [], error: e instanceof ApiError ? e.message : String(e) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chat agent</h1>
          <p className="sub">
            Answers with the same gateway tools as your MCP clients, acting as <strong>{user.email}</strong>
            {cfg && <> · model <code>{cfg.llm_model}</code></>}
          </p>
        </div>
        {turns.length > 0 && <button onClick={() => { setTurns([]); setHistory([]) }}>New chat</button>}
      </div>
      {cfg && !cfg.llm_configured && <div className="alert warn">No LLM API key is configured, so the agent cannot answer yet. Set <code>llm.apiKey</code> in the gateway's Helm secrets.</div>}
      <section className="panel chat">
        <div className="chat-log" ref={logRef}>
          {turns.length === 0 && (
            <div className="stack" style={{ margin: 'auto', textAlign: 'center', alignItems: 'center' }}>
              <p className="sub">Try one of these:</p>
              <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="stack">
              <div className="msg user">{t.user}</div>
              {t.trace.length > 0 && (
                <div className="tool-calls">
                  {t.trace.map((c, j) => (
                    <details key={j} className="tool-call">
                      <summary>
                        {c.server === 'gateway'
                          ? <span className="badge">🔎 tool search</span>
                          : <span className={`badge ${c.is_error ? 'bad' : 'ok'}`}>{c.is_error ? 'error' : 'tool call'}</span>}
                        <span className="badge accent">{c.server}</span>
                        <code>{c.tool.includes('__') ? c.tool.split('__').slice(1).join('__') : c.tool}</code>
                        <span className="sub mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                          {JSON.stringify(c.arguments)}
                        </span>
                      </summary>
                      <pre>{c.result_preview}</pre>
                    </details>
                  ))}
                </div>
              )}
              {t.reply !== undefined && <div className="msg assistant">{t.reply || '(no text reply)'}</div>}
              {t.error && <div className="alert bad" style={{ alignSelf: 'flex-start' }}>{t.error}</div>}
            </div>
          ))}
          {busy && <div className="msg assistant sub">Thinking and calling tools…</div>}
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <textarea value={input} placeholder="Ask about orders, products, or anything your tools can reach…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }} />
          <button className="primary" type="submit" disabled={busy || !input.trim()}>Send</button>
        </form>
      </section>
    </>
  )
}
