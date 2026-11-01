'use client';
// Hash shortened in the middle, full value on hover and in the copy (DESIGN 7.8).
import { useState } from 'react';
import { EXPLORER } from '@/lib/config';
import { shortHash } from '@/lib/format';

export function HashLink({ hash, href }: { hash: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <span className="hash">
      <a href={href ?? `${EXPLORER}${hash}`} title={hash} target="_blank" rel="noreferrer">{shortHash(hash)}</a>
      <button type="button" onClick={copy} aria-label={`Copy ${hash}`}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  );
}
