'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  decodeWishlistCookie,
  encodeWishlistCookie,
  sameWishlistItem,
  type WishlistItem,
} from '@/cms/modules/commerce/wishlist-policy';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * The wishlist a visitor carries with them.
 *
 * A guest's list lives in `localStorage`, mirrored into a first-party cookie so
 * a browser that has cleared local storage (or refuses it in a private window)
 * still keeps it. Only ids are stored — see `wishlist-policy.ts`.
 *
 * A signed-in customer's list lives on the server instead. The first time a
 * session appears, whatever the device was holding is merged into the account's
 * list ONCE, and the device copy is then cleared: leaving it behind would
 * re-merge the same items on the next shared-computer sign-in.
 */

const STORAGE_KEY = STORAGE_KEYS.wishlist;
const COOKIE_KEY = STORAGE_KEYS.wishlist;
/** A year: a wishlist that expires in a fortnight is not a wishlist. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface WishlistContextValue {
  items: WishlistItem[];
  count: number;
  has: (productId: number, variationId?: string) => boolean;
  toggle: (productId: number, variationId?: string) => void;
  remove: (productId: number, variationId?: string) => void;
  enabled: boolean;
  full: boolean;
  maxItems: number;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function WishlistProvider({
  children,
  enabled = false,
  maxItems = 100,
  signedIn = false,
}: {
  children: ReactNode;
  enabled?: boolean;
  maxItems?: number;
  /** Decided on the server; a signed-in list is kept in the database. */
  signedIn?: boolean;
}) {
  const [items, setItems] = useState<WishlistItem[]>([]);

  // Load: the device copy for a guest, the account's for a customer.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const device = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return decodeWishlistCookie(raw);
      } catch {
        /* private window, or storage disabled */
      }
      return decodeWishlistCookie(readCookie(COOKIE_KEY));
    })();

    if (!signedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(device.slice(0, maxItems));
      return;
    }

    const load = async () => {
      if (device.length > 0) {
        await fetch('/api/cms/customer/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'merge', items: device }),
        }).catch(() => null);
        // Merged: the device copy has done its job and must not merge again.
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        writeCookie(COOKIE_KEY, '');
      }
      const res = await fetch('/api/cms/customer/wishlist').catch(() => null);
      const body = (await res?.json().catch(() => null)) as {
        ok?: boolean;
        data?: { items?: WishlistItem[] };
      } | null;
      if (!cancelled && body?.ok && body.data?.items) setItems(body.data.items);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, signedIn, maxItems]);

  // Save: a guest's list, to both places.
  useEffect(() => {
    if (!enabled || signedIn) return;
    const encoded = encodeWishlistCookie(items);
    try {
      localStorage.setItem(STORAGE_KEY, encoded);
    } catch {
      /* quota or private mode — the cookie below is the fallback */
    }
    writeCookie(COOKIE_KEY, encoded);
  }, [items, enabled, signedIn]);

  const persist = useCallback(
    (action: 'add' | 'remove', item: WishlistItem) => {
      if (!signedIn) return;
      void fetch('/api/cms/customer/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...item }),
      }).catch(() => null);
    },
    [signedIn]
  );

  const toggle = useCallback(
    (productId: number, variationId = '') => {
      const item = { productId, variationId };
      setItems((prev) => {
        if (prev.some((existing) => sameWishlistItem(existing, item))) {
          persist('remove', item);
          return prev.filter((existing) => !sameWishlistItem(existing, item));
        }
        if (prev.length >= maxItems) return prev;
        persist('add', item);
        // Anonymous, aggregate, and only when the shop asked for the number.
        void fetch('/api/cms/wishlist/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        }).catch(() => null);
        return [...prev, item];
      });
    },
    [maxItems, persist]
  );

  const remove = useCallback(
    (productId: number, variationId = '') => {
      const item = { productId, variationId };
      persist('remove', item);
      setItems((prev) => prev.filter((existing) => !sameWishlistItem(existing, item)));
    },
    [persist]
  );

  const value = useMemo<WishlistContextValue>(
    () => ({
      items,
      count: items.length,
      has: (productId, variationId = '') =>
        items.some((existing) => sameWishlistItem(existing, { productId, variationId })),
      toggle,
      remove,
      enabled,
      full: items.length >= maxItems,
      maxItems,
    }),
    [items, toggle, remove, enabled, maxItems]
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

/**
 * `null` when the module is off, so a component can simply render nothing
 * rather than every caller having to know whether the provider is mounted.
 */
export function useWishlist(): WishlistContextValue | null {
  return useContext(WishlistContext);
}
