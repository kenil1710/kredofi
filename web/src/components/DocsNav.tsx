'use client';
// Docs sidebar: page list with search over titles and full text (snippets for matches).
// On phones it collapses into a "Contents" disclosure above the page.
import Link from 'next/link';
import { useMemo, useState } from 'react';

type Entry = { slug: string; title: string; summary: string; text: string };

export function DocsNav({ pages, current }: { pages: Entry[]; current: string }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query) return null;
    return pages.flatMap((p) => {
      const inTitle = p.title.toLowerCase().includes(query);
      const at = p.text.toLowerCase().indexOf(query);
      if (!inTitle && at < 0) return [];
      const snip = at >= 0 ? `${at > 40 ? '…' : ''}${p.text.slice(Math.max(0, at - 40), at + query.length + 60)}…` : p.summary;
      return [{ ...p, snip }];
    });
  }, [pages, query]);

  const list = (
    <nav aria-label="Documentation">
      <label className="docs-search">
        <span className="sr-only">Search the docs</span>
        <input type="search" placeholder="Search the docs" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {hits ? (
        <ol className="docs-hits" aria-live="polite">
          {hits.length === 0 && <li className="none">Nothing matches &ldquo;{q}&rdquo;.</li>}
          {hits.map((h) => (
            <li key={h.slug}><Link href={`/docs/${h.slug}`} onClick={() => setQ('')}><b>{h.title}</b><span>{h.snip}</span></Link></li>
          ))}
        </ol>
      ) : (
        <ol className="docs-list">
          {pages.map((p) => (
            <li key={p.slug}><Link href={`/docs/${p.slug}`} aria-current={p.slug === current ? 'page' : undefined}>{p.title}</Link></li>
          ))}
        </ol>
      )}
    </nav>
  );

  return (
    <>
      <aside className="docs-side">{list}</aside>
      <details className="docs-mobile">
        <summary>Contents and search</summary>
        {list}
      </details>
    </>
  );
}
