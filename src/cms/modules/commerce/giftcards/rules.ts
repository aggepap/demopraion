/**
 * Gift card rules that need no secrets: what may be bought, what an issued
 * card does next, and how its ledger reads.
 *
 * Kept apart from `policy.ts` (which hashes codes with `node:crypto`) so the
 * storefront and the admin can share the same rules as the server.
 */
import type { GiftCardConfig } from './policy';

/** An amount (minor units) the shop sells a card for. */
export function isGiftCardAmountAllowed(config: GiftCardConfig, amount: number): boolean {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  if (config.presets.includes(amount)) return true;
  return config.allowCustom && amount >= config.minAmount && amount <= config.maxAmount;
}

/** What a shopper chose for a gift card line. */
export interface GiftCardPurchase {
  /** Minor units. */
  amount: number;
  recipientName: string | null;
  recipientEmail: string;
  message: string | null;
  /** `YYYY-MM-DD`: the day the card is emailed. */
  sendAt: string;
}

export interface GiftCardPurchaseInput {
  amount?: unknown;
  recipientName?: unknown;
  recipientEmail?: unknown;
  message?: unknown;
  sendAt?: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;
/** How far ahead a card may be scheduled. */
const MAX_DAYS_AHEAD = 366;

const text = (value: unknown, max: number): string | null => {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s.slice(0, max) : null;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Check a gift card purchase against the shop's rules, at checkout.
 *
 * The product page offers only valid choices, but the cart is the shopper's
 * browser storage: the amount is a price the server did not set, so it is
 * checked again here. A send date may be up to a day in the past (a shopper in
 * another time zone choosing "today") and up to a year ahead.
 */
export function validateGiftCardPurchase(
  config: GiftCardConfig,
  input: GiftCardPurchaseInput | null | undefined,
  today: Date = new Date(),
): { ok: true; value: GiftCardPurchase } | { ok: false; message: string } {
  if (!config.enabled) return { ok: false, message: 'Gift cards are not available at the moment.' };
  if (!input) return { ok: false, message: 'Please choose the gift card amount and who it is for.' };

  const amount = Number(input.amount);
  if (!isGiftCardAmountAllowed(config, amount)) {
    return { ok: false, message: 'That gift card amount is not available.' };
  }

  const recipientEmail = text(input.recipientEmail, 255);
  if (!recipientEmail || !EMAIL.test(recipientEmail)) {
    return { ok: false, message: 'Please give the email address the gift card should be sent to.' };
  }

  let sendAt = isoDay(today);
  const requested = text(input.sendAt, 10);
  if (requested) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || Number.isNaN(Date.parse(`${requested}T00:00:00Z`))) {
      return { ok: false, message: 'The gift card send date is not a date.' };
    }
    const earliest = isoDay(new Date(today.getTime() - DAY_MS));
    const latest = isoDay(new Date(today.getTime() + MAX_DAYS_AHEAD * DAY_MS));
    if (requested < earliest) return { ok: false, message: 'The gift card send date is in the past.' };
    if (requested > latest) return { ok: false, message: 'A gift card can be scheduled up to a year ahead.' };
    sendAt = requested < sendAt ? sendAt : requested;
  }

  return {
    ok: true,
    value: {
      amount,
      recipientName: text(input.recipientName, 191),
      recipientEmail,
      message: text(input.message, 500),
      sendAt,
    },
  };
}

/**
 * Email a card that was just issued by hand, if it has a recipient.
 *
 * A failed send is reported rather than thrown: the card already exists and
 * its code has been shown to the admin, who can pass it on themselves.
 */
export async function deliverIssuedGiftCard<
  Card extends { recipientEmail: string | null; code: string; message: string | null; amount: number; currency: string },
>(card: Card, send: (card: Card) => Promise<void>): Promise<{ emailed: boolean }> {
  if (!card.recipientEmail) return { emailed: false };
  try {
    await send(card);
    return { emailed: true };
  } catch (err) {
    console.error('[commerce/giftcards] manual issue email failed', err);
    return { emailed: false };
  }
}

export interface GiftCardLedgerRow {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number;
  orderId: number | null;
  note: string | null;
  createdAt: Date | string;
}

export interface GiftCardHistoryEntry {
  key: string;
  at: string;
  label: string;
  /** Signed, minor units. */
  amount: number;
  balanceAfter: number;
  orderId: number | null;
  note: string | null;
}

const TX_LABELS: Record<string, string> = {
  issue: 'Issued',
  redeem: 'Redeemed',
  reversal: 'Restored (order cancelled)',
  refund_credit: 'Refunded to card',
  void: 'Voided',
  adjust: 'Adjusted',
  expire: 'Expired',
};

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : String(value));

/**
 * A card's history, oldest first: its issue, then every ledger row.
 *
 * Issuing writes no ledger row — the card is born with its balance — so the
 * first entry is made from the card itself.
 */
export function giftCardHistory(
  card: { initialAmount: number; createdAt: Date | string; orderId: number | null },
  rows: readonly GiftCardLedgerRow[],
): GiftCardHistoryEntry[] {
  const movements = [...rows]
    .sort((a, b) => iso(a.createdAt).localeCompare(iso(b.createdAt)) || a.id - b.id)
    .map((row) => ({
      key: String(row.id),
      at: iso(row.createdAt),
      label: row.type === 'adjust' && row.note ? row.note : (TX_LABELS[row.type] ?? row.type),
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      orderId: row.orderId,
      note: row.type === 'adjust' ? null : row.note,
    }));
  return [
    {
      key: 'issue',
      at: iso(card.createdAt),
      label: card.orderId ? 'Issued (bought with an order)' : 'Issued',
      amount: card.initialAmount,
      balanceAfter: card.initialAmount,
      orderId: card.orderId,
      note: null,
    },
    ...movements,
  ];
}
