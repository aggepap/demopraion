'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * Product comparison selection (addendum §6). A small localStorage-backed set
 * of products (slug + title) the shopper wants to compare, capped so the table
 * stays readable. Client-only — no backend, like the cart + recently-viewed.
 */

export interface CompareItem {
  slug: string;
  title: string;
}

const MAX = 4;
const STORAGE_KEY = STORAGE_KEYS.compare;

interface CompareContextValue {
  items: CompareItem[];
  has: (slug: string) => boolean;
  toggle: (item: CompareItem) => void;
  remove: (slug: string) => void;
  clear: () => void;
  full: boolean;
  max: number;
}

const CompareContext = createContext<CompareContextValue | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CompareItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(parsed)) setItems(parsed.slice(0, MAX) as CompareItem[]);
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota errors */
    }
  }, [items]);

  const toggle = useCallback((item: CompareItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.slug === item.slug)) return prev.filter((i) => i.slug !== item.slug);
      if (prev.length >= MAX) return prev; // capped
      return [...prev, { slug: item.slug, title: item.title }];
    });
  }, []);

  const remove = useCallback((slug: string) => setItems((prev) => prev.filter((i) => i.slug !== slug)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CompareContextValue>(
    () => ({
      items,
      has: (slug: string) => items.some((i) => i.slug === slug),
      toggle,
      remove,
      clear,
      full: items.length >= MAX,
      max: MAX,
    }),
    [items, toggle, remove, clear],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareContextValue {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error('useCompare must be used within a CompareProvider');
  return ctx;
}
