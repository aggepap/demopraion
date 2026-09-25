/**
 * Gift cards, which are money.
 *
 * ## A code is a bearer credential
 *
 * Whoever types the code spends the balance, so only its HMAC is stored, under
 * a pepper held in the environment. A stolen `gift_cards` table is then a list
 * of balances rather than a wallet. Crockford's base32 alphabet drops I, L, O
 * and U, so a code read down a telephone cannot be misheard.
 *
 * ## Redeeming is a payment, not a discount
 *
 * A discount changes what the shop earned; a gift card does not. The order's
 * total stays exactly what was sold, and the card reduces only the amount still
 * DUE from the gateway — which is also the honest treatment for VAT, since the
 * tax was accounted for when the card was bought.
 *
 * Pure: the balances come from the database, the arithmetic happens here.
 */
import { createHmac, randomBytes } from 'node:crypto';

/** Crockford base32, minus the letters that are misread aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;
const GROUP = 4;

export type GiftCardStatus = 'scheduled' | 'active' | 'void' | 'expired';

export interface GiftCardRow {
  id: number;
  codeHash: string;
  /** Minor units. */
  balance: number;
  initialAmount: number;
  currency: string;
  status: GiftCardStatus;
  expiresAt: Date | null;
}

export function generateGiftCardCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return formatGiftCardCode(code);
}

/** What the customer types, whatever the spacing or case. */
export function normalizeGiftCardCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** `ABCD-EFGH-JKMN-PQRS` — grouped so it can be read out and typed back. */
export function formatGiftCardCode(code: string): string {
  const clean = normalizeGiftCardCode(code);
  return (clean.match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? [clean]).join('-');
}

/**
 * The stored form. HMAC rather than a plain hash so the pepper is required:
 * without it, a leaked table plus a dictionary of generated codes would be
 * enough to find the valuable ones.
 */
export function hashGiftCardCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizeGiftCardCode(code)).digest('hex');
}

/** Spendable right now. */
export function isGiftCardUsable(card: GiftCardRow, now: Date): boolean {
  if (card.status !== 'active') return false;
  if (card.balance <= 0) return false;
  return !card.expiresAt || card.expiresAt.getTime() > now.getTime();
}

export interface AppliedGiftCard {
  giftCardId: number;
  amount: number;
}

/**
 * Spend cards against what is owed, in the order given.
 *
 * Never more than a card holds and never more than the order owes — the two
 * bounds that stop a gift card from becoming free money in either direction.
 */
export function applyGiftCards(
  cards: readonly GiftCardRow[],
  amountDue: number,
  currency = 'EUR',
  now: Date = new Date()
): { applied: AppliedGiftCard[]; amountDue: number } {
  let remaining = Math.max(0, amountDue);
  const applied: AppliedGiftCard[] = [];

  for (const card of cards) {
    if (remaining === 0) break;
    if (!isGiftCardUsable(card, now)) continue;
    // Refused rather than converted: inventing an exchange rate at checkout is
    // a way to be wrong about money in public.
    if (card.currency !== currency) continue;

    const amount = Math.min(card.balance, remaining);
    if (amount <= 0) continue;
    applied.push({ giftCardId: card.id, amount });
    remaining -= amount;
  }

  return { applied, amountDue: remaining };
}

/**
 * How a refund is split.
 *
 * The customer's own money goes back first, and the voucher only takes what is
 * left. The other order would hand back cash for a card somebody was given.
 */
export function planGiftCardRefund(input: {
  amount: number;
  gatewayPaid: number;
  giftCardPaid: number;
}): { toGateway: number; toGiftCard: number } {
  const toGateway = Math.min(input.amount, Math.max(0, input.gatewayPaid));
  const toGiftCard = Math.min(input.amount - toGateway, Math.max(0, input.giftCardPaid));
  return { toGateway, toGiftCard };
}

export interface GiftCardConfig {
  enabled: boolean;
  /** Offered amounts, minor units. */
  presets: number[];
  allowCustom: boolean;
  minAmount: number;
  maxAmount: number;
  /** 0 = never expires. Greek consumer law makes a long life the safe default. */
  expiryMonths: number;
}

/** The `site_settings` key holding the (structured JSON) gift card config. */
export const ECOMMERCE_GIFTCARDS_KEY = 'ecommerce.giftCards';

const MAX_AMOUNT = 100_000_00;

export function parseGiftCardConfig(raw: unknown): GiftCardConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const presets = Array.isArray(value.presets) ? value.presets : [];
  const expiryMonths = Number(value.expiryMonths);
  const minAmount = Number(value.minAmount);
  const maxAmount = Number(value.maxAmount);

  return {
    enabled: value.enabled === true,
    presets: presets
      .map((entry) => Number(entry))
      .filter((amount) => Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_AMOUNT),
    allowCustom: value.allowCustom === true,
    minAmount: Number.isSafeInteger(minAmount) && minAmount > 0 ? minAmount : 1000,
    maxAmount: Number.isSafeInteger(maxAmount) && maxAmount > 0 ? maxAmount : 50_000,
    expiryMonths: Number.isSafeInteger(expiryMonths) && expiryMonths >= 0 ? expiryMonths : 24,
  };
}
