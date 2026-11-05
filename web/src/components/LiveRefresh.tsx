'use client';
// Re-reads a server-rendered page in the background: the HTML works without JavaScript, the browser keeps it fresh.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function LiveRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
