'use client';
// Copy button (DESIGN 7.8): the text changes to "Copied" for 1.5 s. Falls back to a selected textarea +
// execCommand when the async clipboard is refused (e.g. focus was inside Plaid Link's frame a moment ago).
import { useState } from 'react';

function legacyCopy(text: string): boolean {
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

export function CopyButton({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button type="button" className={`copy${small ? ' copy-small' : ''}`} onClick={copy} aria-label={`Copy the ${label}`}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Type it' : 'Copy'}
    </button>
  );
}
