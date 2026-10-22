import { Fragment, type ReactNode } from 'react'

// A deliberately small Markdown subset for chat replies: paragraphs, headings, bullet and numbered
// lists, tables, **bold**, *italic*, `code` and links. Built from React elements (never innerHTML),
// so model output cannot inject markup or scripts.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)|]+|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<!\w)_[^_\s][^_]*_(?!\w))/g
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
    else if (tok.startsWith('http')) out.push(<a key={key} href={tok} target="_blank" rel="noreferrer">{tok}</a>)
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let list: { ordered: boolean; items: string[] } | null = null
  const flushList = () => {
    if (!list) return
    const k = `l-${blocks.length}`
    const items = list.items.map((l, i) => <li key={i}>{inline(l, `${k}-${i}`)}</li>)
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()

    // table: a header row, a --- separator row, then body rows
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flushList()
      const head = cells(line)
      const body: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]))
      i--
      const k = `t-${blocks.length}`
      blocks.push(
        <div key={k} className="md-table">
          <table>
            <thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `${k}-h${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }

    const bullet = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      const ordered = /\d/.test(bullet[1])
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push(bullet[2])
      continue
    }
    flushList()
    if (!line.trim() || /^-{3,}$/.test(line.trim())) continue
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    blocks.push(heading
      ? <p key={i}><strong>{inline(heading[1], `h-${i}`)}</strong></p>
      : <p key={i}>{inline(line, `p-${i}`)}</p>)
  }
  flushList()
  return <Fragment>{blocks}</Fragment>
}
