'use client';
// "Skip to content" for keyboard users (audit Nov 7): hidden until focused, then jumps past the nav to the page's
// main content (main, else the first article or h1), which takes focus.
export function SkipLink() {
  const skip = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.querySelector<HTMLElement>('main, article, h1');
    if (!target) return;
    e.preventDefault();
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView({ block: 'start' });
  };
  return <a className="skip" href="#main" onClick={skip}>Skip to content</a>;
}
