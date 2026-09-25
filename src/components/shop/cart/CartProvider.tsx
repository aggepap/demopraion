'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clampQuantity } from '@/cms/modules/commerce/quantity';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/** A single cart line. `unitPrice` is in MAJOR units (for display); the server
 *  re-prices authoritatively at checkout. `key` = slug + variation identity. */
export interface CartItem {
  key: string;
  slug: string;
  title: string;
  variationId?: string;
  optionsLabel?: string;
  sku?: string;
  unitPrice: number;
  currency: string;
  imageUrl?: string;
  quantity: number;
  locale: string;
  /** Digital/virtual line — an all-virtual cart skips the address + shipping (§5). */
  virtual?: boolean;
  /** Purchase limits (§6) carried so the drawer can enforce them. */
  minQty?: number;
  maxQty?: number;
  qtyStep?: number;
  /** A gift card line: what the shopper chose. Re-validated at checkout. */
  giftCard?: CartGiftCard;
}

/** A gift card's choices, as the product page collected them. */
export interface CartGiftCard {
  /** Minor units. */
  amount: number;
  recipientName: string;
  recipientEmail: string;
  message: string;
  /** `YYYY-MM-DD`, or '' for "send now". */
  sendAt: string;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  currency: string;
  /** True when the cart is non-empty and every line is virtual (§5). */
  allVirtual: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  addItem: (item: Omit<CartItem, 'key' | 'quantity'>, quantity?: number) => void;
  removeItem: (key: string) => void;
  setQty: (key: string, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = STORAGE_KEYS.cart;
/**
 * A cart line's identity. A gift card's choices are part of it: two cards for
 * two people are two lines, not one line of two.
 */
export function cartLineKey(slug: string, variationId?: string, giftCard?: CartGiftCard): string {
  const base = `${slug}::${variationId ?? ''}`;
  if (!giftCard) return base;
  const { amount, recipientEmail, recipientName, sendAt, message } = giftCard;
  return `${base}::gc:${JSON.stringify([amount, recipientEmail.toLowerCase(), recipientName, sendAt, message])}`;
}

/** What checkout is sent for one line. The server re-prices everything. */
export function checkoutLine(item: Pick<CartItem, 'slug' | 'variationId' | 'quantity' | 'giftCard'>) {
  const line = { slug: item.slug, variationId: item.variationId, quantity: item.quantity };
  if (!item.giftCard) return line;
  const { amount, recipientName, recipientEmail, message, sendAt } = item.giftCard;
  return {
    ...line,
    giftCard: {
      amount,
      recipientName: recipientName.trim() || undefined,
      recipientEmail: recipientEmail.trim(),
      message: message.trim() || undefined,
      sendAt: sendAt || undefined,
    },
  };
}

/** Snap a line's quantity to its stored purchase limits (§6). A
 *  sold-individually product is stored with min = max = 1, so clamping to those
 *  bounds forces a single unit without a separate flag. */
const clampLine = (item: CartItem, quantity: number): number =>
  clampQuantity(
    { min: item.minQty ?? 1, max: item.maxQty ?? null, step: item.qtyStep ?? 1, soldIndividually: false },
    quantity,
  );

export function CartProvider({ currency, children }: { currency: string; children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Hydrate from storage after mount (a lazy initializer would mismatch
        // the SSR-empty cart). This one-shot sync is intentional.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed)) setItems(parsed as CartItem[]);
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota errors */
    }
  }, [items, hydrated]);

  const addItem = useCallback((item: Omit<CartItem, 'key' | 'quantity'>, quantity = 1) => {
    const key = cartLineKey(item.slug, item.variationId, item.giftCard);
    setItems((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) =>
          i.key === key ? { ...i, quantity: clampLine(i, i.quantity + quantity) } : i,
        );
      }
      const line = { ...item, key, quantity } as CartItem;
      return [...prev, { ...line, quantity: clampLine(line, quantity) }];
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const setQty = useCallback((key: string, quantity: number) => {
    setItems((prev) =>
      prev.flatMap((i) =>
        i.key === key ? (quantity <= 0 ? [] : [{ ...i, quantity: clampLine(i, quantity) }]) : [i],
      ),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const allVirtual = items.length > 0 && items.every((i) => i.virtual);
    return { items, count, subtotal, currency, allVirtual, isOpen, open, close, addItem, removeItem, setQty, clear };
  }, [items, currency, isOpen, open, close, addItem, removeItem, setQty, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
