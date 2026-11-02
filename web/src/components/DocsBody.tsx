// Renders a docs page body (the small Markdown subset in lib/docs/pages.ts) to React elements.
// No HTML is ever injected: every piece of text becomes a text node.
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { anchorOf } from '@/lib/docs/pages';
import { DocsDiagram } from './DocsDiagram';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[6]) {
      const href = m[7];
      out.push(href.startsWith('/') || href.startsWith('#')
        ? <Link key={k} href={href}>{m[6]}</Link>
        : <a key={k} href={href} target="_blank" rel="noreferrer">{m[6]}</a>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function DocsBody({ body }: { body: string }) {
  const lines = body.trim().split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${n++}`;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith(':::diagram')) { blocks.push(<DocsDiagram key={key} />); i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="doc-code"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{2,3}) (.+)$/.exec(line);
    if (h) {
      const id = anchorOf(h[2]);
      const H = h[1].length === 2 ? 'h2' : 'h3';
      blocks.push(<H key={key} id={id}><a className="anchor" href={`#${id}`} aria-label={`Link to ${h[2]}`}>#</a>{h[2]}</H>);
      i++; continue;
    }
    if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body2] = rows;
      blocks.push(
        <div key={key} className="doc-table"><table>
          <thead><tr>{cells(head).map((c, j) => <th key={j} scope="col">{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
          <tbody>{body2.map((r, ri) => <tr key={ri}>{cells(r).map((c, j) => <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={key}>{items.map((t, j) => <li key={j}>{inline(t, `${key}i${j}`)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |\||- |\d+\. |```|:::)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key}>{inline(para.join(' '), key)}</p>);
  }
  return <Fragment>{blocks}</Fragment>;
}
