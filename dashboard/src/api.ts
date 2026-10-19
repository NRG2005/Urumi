// Thin fetch wrapper. Auth is an httpOnly session cookie set by /api/auth/login,
// so the browser never holds a token that JavaScript could leak.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d: { msg: string }) => d.msg).join(', ') : data.detail
    throw new ApiError(resp.status, detail || resp.statusText)
  }
  return data as T
}

export type Role = 'admin' | 'member'
export interface User { id: number; email: string; name: string; role: Role }

export interface ToolView {
  name: string
  gateway_name: string
  description: string
  read_only: boolean | null
  min_role: Role
}

export interface Server {
  id: number
  slug: string
  name: string
  url: string
  auth_type: 'none' | 'bearer' | 'header'
  auth_header: string | null
  has_credential: boolean
  enabled: boolean
  status: 'connected' | 'unreachable' | 'disabled' | 'unknown'
  last_error: string | null
  last_checked_at: string | null
  tools_changed_at: string | null
  tools: ToolView[]
}

export interface ApiKey {
  id: number
  user_id: number
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface AuditEntry {
  id: number
  ts: string
  user_email: string
  via: 'mcp' | 'chat'
  server_slug: string | null
  tool_name: string
  duration_ms: number
  outcome: string
  error: string | null
}

export interface Stat { server_slug: string; calls: number; failures: number; p50_ms: number; p95_ms: number }

export interface Config { mcp_url: string; llm_configured: boolean; llm_model: string }

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—'

export const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.max(s, 0)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
