import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isModuleEnabled } from '@/cms/core';
import config from '@/site.config';

/**
 * Every account screen is private and per-request: nothing under here may be
 * cached or indexed, and the whole segment disappears when the module is off.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AccountLayout({ children }: { children: ReactNode }) {
  if (!(await isModuleEnabled(config, 'customers'))) notFound();
  return <>{children}</>;
}
