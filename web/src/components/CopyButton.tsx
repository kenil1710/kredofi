'use client';
// Copy button (DESIGN 7.8): the text changes to "Copied" for 1.5 s.
import { useState } from 'react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return <button type="button" className="copy" onClick={copy} aria-label={`Copy the ${label}`}>{copied ? 'Copied' : 'Copy'}</button>;
}
