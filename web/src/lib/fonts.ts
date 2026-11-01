// Fonts (DESIGN 1, Type): Bodoni Moda for display, amounts, stamps; Public Sans for text.
// next/font self-hosts them, subset to Latin. Their CSS family names are hashed, so canvas
// drawing (drawNote) must use `display.style.fontFamily`, not the literal "Bodoni Moda".
import { Bodoni_Moda, Public_Sans } from 'next/font/google';

export const display = Bodoni_Moda({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

export const body = Public_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});
