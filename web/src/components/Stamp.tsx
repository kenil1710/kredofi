'use client';
// Stamps (DESIGN 2.3): double-border rectangles in Bodoni caps. They press in (scale 1.5 to 1,
// 300 ms, slight overshoot). `shakeRef` gets the 300 ms screen shake (big stamps); DEFAULT also
// adds one 6 px horizontal shake (DESIGN 7.4 #2).
import { useEffect, useRef } from 'react';
import { replayClass } from '@/lib/motion';

export type StampKind = 'approved' | 'rejected' | 'paid' | 'default';

const TONE: Record<StampKind, 'violet' | 'red'> = { approved: 'violet', rejected: 'red', paid: 'violet', default: 'red' };

export function Stamp({
  kind,
  children,
  small = false,
  press = 0,
  rotate = -7,
  shakeRef,
  paperBg = true,
  style,
}: {
  kind: StampKind;
  children: React.ReactNode;
  small?: boolean;
  /** Change this number to press the stamp (0 = shown without animation). */
  press?: number;
  rotate?: number;
  shakeRef?: React.RefObject<HTMLElement | null>;
  paperBg?: boolean;
  style?: React.CSSProperties;
}) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!press) return;
    replayClass(el.current, 'pressing');
    if (shakeRef?.current) {
      const target = shakeRef.current;
      const t = setTimeout(() => replayClass(target, kind === 'default' ? 'shake-x' : 'shake'), 180);
      return () => clearTimeout(t);
    }
  }, [press, kind, shakeRef]);
  return (
    <span
      ref={el}
      className={`stamp ${TONE[kind]}${small ? ' small' : ''}${paperBg ? ' paper-bg' : ''}`}
      style={{ ['--rot' as string]: `${rotate}deg`, ...style }}
    >
      {children}
    </span>
  );
}
