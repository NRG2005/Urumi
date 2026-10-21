import { Fragment, type ReactNode } from 'react'

// A deliberately tiny Markdown subset for chat replies: **bold**, `code`, links, bullet lists, paragraphs.
// Built from React elements (never innerHTML), so model output cannot inject markup or scripts.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) out.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer">{tok.slice(1, tok.indexOf(']'))}</a>)
    else out.push(<a key={key} href={tok} target="_blank" rel="noreferrer">{tok}</a>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `li-${blocks.length}-${i}`)}</li>)}</ul>)
    list = []
  }
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/)
    if (bullet) { list.push(bullet[1]); return }
    flush()
    if (!line.trim()) return
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    blocks.push(heading
      ? <p key={i}><strong>{inline(heading[1], `h-${i}`)}</strong></p>
      : <p key={i}>{inline(line, `p-${i}`)}</p>)
  })
  flush()
  return <Fragment>{blocks}</Fragment>
}
