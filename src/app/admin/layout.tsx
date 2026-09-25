import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { BrandStyle } from '@/cms/core/brand/BrandStyle';

import '../globals.css';

/**
 * Admin root layout. The site's `src/app/layout.tsx` is a pass-through (the
 * real site root lives under `[locale]`), so the admin tree owns its own
 * `<html>`/`<body>` — including the brand fonts, which otherwise only live on
 * the `[locale]` layout (the admin used to fall back to system-ui). Always
 * noindex.
 */
const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fraunces',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin', 'latin-ext', 'greek'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CMS',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      {/* The saved brand colours — the admin wears the site's palette too. */}
      <head>
        <BrandStyle />
      </head>
      <body className="font-body bg-neutral-100 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
