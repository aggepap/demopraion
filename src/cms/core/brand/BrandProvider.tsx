'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { SiteBrand } from './policy';

/**
 * The brand for client components (the header, the mobile menu). Server
 * components call `getBrand()` directly; this carries the same value across the
 * boundary once, from the layout, instead of each client component asking.
 */
const BrandContext = createContext<SiteBrand | null>(null);

export function BrandProvider({ value, children }: { value: SiteBrand; children: ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): SiteBrand {
  const brand = useContext(BrandContext);
  if (!brand) throw new Error('useBrand() needs a <BrandProvider> above it (the locale layout).');
  return brand;
}
