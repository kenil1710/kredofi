import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppChrome } from '@/components/AppChrome';
import { AppFooter } from '@/components/AppFooter';
import { DocsBody } from '@/components/DocsBody';
import { DocsNav } from '@/components/DocsNav';
import { GuillocheStrip } from '@/components/GuillocheStrip';
import { DOC_PAGES, docBySlug, plainText } from '@/lib/docs/pages';

export const dynamicParams = false;
export function generateStaticParams() { return DOC_PAGES.map((p) => ({ slug: p.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = docBySlug((await params).slug);
  return page ? { title: `${page.title}, KredoFi docs`, description: page.summary } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docBySlug(slug);
  if (!page) notFound();
  const i = DOC_PAGES.indexOf(page);
  const prev = DOC_PAGES[i - 1], next = DOC_PAGES[i + 1];
  const index = DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, text: plainText(p.body) }));
  return (
    <div className="g-paper" style={{ minHeight: '100svh' }}>
      <AppChrome />
      <div className="wrap docs">
        <DocsNav pages={index} current={slug} />
        <article className="doc">
          <GuillocheStrip height={12} />
          <p className="doc-kicker">KredoFi docs</p>
          <h1>{page.title}</h1>
          <p className="doc-summary">{page.summary}</p>
          <DocsBody body={page.body} />
          <nav className="doc-pager" aria-label="Previous and next page">
            {prev ? <Link href={`/docs/${prev.slug}`}>← {prev.title}</Link> : <span />}
            {next ? <Link href={`/docs/${next.slug}`}>{next.title} →</Link> : <span />}
          </nav>
        </article>
      </div>
      <AppFooter />
    </div>
  );
}
