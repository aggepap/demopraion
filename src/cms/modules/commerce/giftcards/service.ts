import 'server-only';

import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import { getSetting } from '../../../core/settings';
import { encryptSecret } from '../../../core/tokens/crypto';
import { getDb, schema } from '../../../db';
import {
  applyGiftCards,
  ECOMMERCE_GIFTCARDS_KEY,
  formatGiftCardCode,
  generateGiftCardCode,
  hashGiftCardCode,
  isGiftCardUsable,
  normalizeGiftCardCode,
  parseGiftCardConfig,
  planGiftCardRefund,
  type GiftCardRow,
} from './policy';

/**
 * Gift cards against the database.
 *
 * Every balance change goes through `movement`, which writes the ledger row in
 * the same statement that changes the balance. A balance that moved without a
 * ledger row is a number nobody can explain, and this is money.
 */

/** Without a pepper a code hash is guessable, so there is no default. */
function pepper(): string {
  const value = process.env.CMS_GIFTCARD_PEPPER;
  if (!value || value.length < 32) {
    throw new Error(
      'CMS_GIFTCARD_PEPPER is missing or shorter than 32 characters. ' +
        'Gift cards cannot be issued or redeemed without it.'
    );
  }
  return value;
}

export async function getGiftCardConfig() {
  return parseGiftCardConfig(await getSetting(ECOMMERCE_GIFTCARDS_KEY));
}

function toRow(row: typeof schema.giftCards.$inferSelect): GiftCardRow {
  return {
    id: row.id,
    codeHash: row.codeHash,
    balance: row.balance,
    initialAmount: row.initialAmount,
    currency: row.currency,
    status: row.status,
    expiresAt: row.expiresAt,
  };
}

/** Look a card up by what the customer typed. */
export async function findGiftCardByCode(code: string) {
  const [row] = await getDb()
    .select()
    .from(schema.giftCards)
    .where(eq(schema.giftCards.codeHash, hashGiftCardCode(code, pepper())))
    .limit(1);
  return row ?? null;
}

/**
 * One balance change, with its ledger row.
 *
 * The update is conditional on the balance it read, so two simultaneous
 * redemptions cannot both succeed against the same money: the loser sees zero
 * rows changed and is told to try again.
 */
async function movement(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  input: {
    card: { id: number; balance: number };
    type: (typeof schema.giftCardTransactions.$inferSelect)['type'];
    amount: number;
    orderId?: number | null;
    actor?: string | null;
    note?: string | null;
  }
): Promise<number> {
  const balanceAfter = input.card.balance + input.amount;
  if (balanceAfter < 0) throw new Error('A gift card cannot go below zero.');

  const { adapter } = await import('../../../db');
  const result = await tx
    .update(schema.giftCards)
    .set({
      balance: balanceAfter,
      // A card spent to zero is still a valid card; it simply has nothing left.
      status: balanceAfter === 0 && input.amount < 0 ? 'active' : undefined,
    })
    .where(
      and(eq(schema.giftCards.id, input.card.id), eq(schema.giftCards.balance, input.card.balance))
    );
  if (adapter.affectedRows(result) === 0) {
    throw new Error('That gift card was used somewhere else a moment ago. Please try again.');
  }

  await tx.insert(schema.giftCardTransactions).values({
    giftCardId: input.card.id,
    type: input.type,
    amount: input.amount,
    balanceAfter,
    orderId: input.orderId ?? null,
    actor: input.actor ?? null,
    note: input.note ?? null,
  });
  return balanceAfter;
}

/**
 * What these codes are worth against an amount — WITHOUT spending anything.
 *
 * Checkout calls this to show the customer what they will still pay; the actual
 * spend happens inside the order transaction.
 */
export async function quoteGiftCards(
  codes: readonly string[],
  amountDue: number,
  currency: string
) {
  const cards: GiftCardRow[] = [];
  for (const code of codes.slice(0, 5)) {
    const row = await findGiftCardByCode(code);
    if (row) cards.push(toRow(row));
  }
  return applyGiftCards(cards, amountDue, currency);
}

/**
 * Spend the cards against an order, inside the order's own transaction.
 *
 * Each redemption also writes a `payments` row: a gift card is a way of paying,
 * so the order's payment history has to show it as one.
 */
export async function redeemGiftCards(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  input: { codes: readonly string[]; orderId: number; amountDue: number; currency: string }
): Promise<{ applied: { giftCardId: number; amount: number }[]; amountDue: number }> {
  if (input.codes.length === 0) return { applied: [], amountDue: input.amountDue };

  const rows: (typeof schema.giftCards.$inferSelect)[] = [];
  for (const code of input.codes.slice(0, 5)) {
    // Locked for the life of the transaction: the balance this reads is the
    // balance it spends.
    const [row] = await tx
      .select()
      .from(schema.giftCards)
      .where(eq(schema.giftCards.codeHash, hashGiftCardCode(code, pepper())))
      .limit(1)
      .for('update');
    if (row) rows.push(row);
  }

  const plan = applyGiftCards(rows.map(toRow), input.amountDue, input.currency);
  for (const entry of plan.applied) {
    const row = rows.find((candidate) => candidate.id === entry.giftCardId);
    if (!row) continue;
    await movement(tx, {
      card: row,
      type: 'redeem',
      amount: -entry.amount,
      orderId: input.orderId,
      note: 'Redeemed at checkout',
    });
    await tx.insert(schema.payments).values({
      orderId: input.orderId,
      provider: 'giftcard',
      providerRef: `giftcard:${row.id}`,
      status: 'captured',
      amount: entry.amount,
      currency: input.currency,
      method: 'giftcard',
    });
  }
  return plan;
}

/**
 * Put back what an order took, once.
 *
 * Called when an order is cancelled — including by the stale-order job — so a
 * customer who never paid does not lose the card's balance. Idempotent: the
 * ledger is the record of whether it has already happened.
 */
export async function reverseGiftCardRedemptions(orderId: number): Promise<number> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const redemptions = await tx
      .select()
      .from(schema.giftCardTransactions)
      .where(
        and(
          eq(schema.giftCardTransactions.orderId, orderId),
          eq(schema.giftCardTransactions.type, 'redeem')
        )
      );
    if (redemptions.length === 0) return 0;

    const reversals = await tx
      .select({ id: schema.giftCardTransactions.id })
      .from(schema.giftCardTransactions)
      .where(
        and(
          eq(schema.giftCardTransactions.orderId, orderId),
          eq(schema.giftCardTransactions.type, 'reversal')
        )
      );
    if (reversals.length > 0) return 0; // already put back

    let total = 0;
    for (const redemption of redemptions) {
      const [card] = await tx
        .select()
        .from(schema.giftCards)
        .where(eq(schema.giftCards.id, redemption.giftCardId))
        .limit(1)
        .for('update');
      if (!card) continue;
      await movement(tx, {
        card,
        type: 'reversal',
        amount: Math.abs(redemption.amount),
        orderId,
        note: 'Order cancelled',
      });
      total += Math.abs(redemption.amount);
    }
    return total;
  });
}

/** Refund money onto a card (the second half of `planGiftCardRefund`). */
export async function creditGiftCard(input: {
  giftCardId: number;
  amount: number;
  orderId?: number;
  actor?: string;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(schema.giftCards)
      .where(eq(schema.giftCards.id, input.giftCardId))
      .limit(1)
      .for('update');
    if (!card) return;
    await movement(tx, {
      card,
      type: 'refund_credit',
      amount: Math.abs(input.amount),
      orderId: input.orderId ?? null,
      actor: input.actor ?? null,
      note: 'Refunded to gift card',
    });
  });
}

/**
 * Mint the cards an order paid for.
 *
 * Runs when the money is confirmed, and is idempotent through the unique key on
 * `order_item_id` — a replayed capture webhook must not mint a second card.
 * Cards start `scheduled`; the delivery job sends them and makes them spendable.
 */
export async function issueGiftCardsForOrder(orderId: number): Promise<number> {
  const db = getDb();
  const config = await getGiftCardConfig();
  if (!config.enabled) return 0;

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  if (!order) return 0;

  let issued = 0;
  for (const item of items) {
    const snapshot = (item.snapshot ?? {}) as Record<string, unknown>;
    const gift = (snapshot.giftCard ?? null) as Record<string, unknown> | null;
    if (!gift) continue;

    const existing = await db
      .select({ id: schema.giftCards.id })
      .from(schema.giftCards)
      .where(eq(schema.giftCards.orderItemId, item.id))
      .limit(1);
    if (existing.length > 0) continue; // already minted for this line

    const code = generateGiftCardCode();
    const amount = Number(gift.amount) || item.unitPrice;
    const sendAt = gift.sendAt ? new Date(String(gift.sendAt)) : new Date();
    const expiresAt =
      config.expiryMonths > 0 ? new Date(Date.now() + config.expiryMonths * 30 * 86_400_000) : null;

    await db.insert(schema.giftCards).values({
      codeHash: hashGiftCardCode(code, pepper()),
      codeLast4: normalizeGiftCardCode(code).slice(-4),
      codeEncrypted: encryptSecret(formatGiftCardCode(code)),
      currency: order.currency,
      initialAmount: amount,
      balance: amount,
      status: 'scheduled',
      expiresAt,
      orderId: order.id,
      orderItemId: item.id,
      purchaserEmail: order.email,
      recipientName: gift.recipientName ? String(gift.recipientName) : null,
      recipientEmail: gift.recipientEmail ? String(gift.recipientEmail) : null,
      message: gift.message ? String(gift.message) : null,
      sendAt,
    });
    issued += 1;
  }
  return issued;
}

/**
 * The delivery job: send every card whose day has come.
 *
 * The claim and the send are separate statements on purpose — `sent_at` is set
 * first, conditionally, so two overlapping runs cannot both email the same
 * card. A send that then fails is visible as a card with a date and no email,
 * which an admin can re-send.
 */
export async function deliverDueGiftCards(
  send: (card: {
    id: number;
    code: string;
    recipientEmail: string | null;
    message: string | null;
    amount: number;
    currency: string;
  }) => Promise<void>
): Promise<{ sent: number }> {
  const db = getDb();
  const { adapter } = await import('../../../db');
  const { decryptSecret } = await import('../../../core/tokens/crypto');

  const due = await db
    .select()
    .from(schema.giftCards)
    .where(
      and(
        eq(schema.giftCards.status, 'scheduled'),
        isNull(schema.giftCards.sentAt),
        lte(schema.giftCards.sendAt, new Date())
      )
    )
    .limit(100);

  let sent = 0;
  for (const card of due) {
    const claimed = await db
      .update(schema.giftCards)
      .set({ sentAt: new Date(), status: 'active' })
      .where(and(eq(schema.giftCards.id, card.id), isNull(schema.giftCards.sentAt)));
    if (adapter.affectedRows(claimed) === 0) continue;

    try {
      await send({
        id: card.id,
        code: card.codeEncrypted ? decryptSecret(card.codeEncrypted) : '',
        recipientEmail: card.recipientEmail,
        message: card.message,
        amount: card.initialAmount,
        currency: card.currency,
      });
      sent += 1;
    } catch (err) {
      console.error('[commerce/giftcards] delivery failed', card.id, err);
    }
  }
  return { sent };
}

/** The expiry job: a card past its date can no longer be spent. */
export async function expireGiftCards(): Promise<{ expired: number }> {
  const db = getDb();
  const { adapter } = await import('../../../db');
  const result = await db
    .update(schema.giftCards)
    .set({ status: 'expired' })
    .where(and(eq(schema.giftCards.status, 'active'), lte(schema.giftCards.expiresAt, new Date())));
  return { expired: adapter.affectedRows(result) };
}

export { applyGiftCards, isGiftCardUsable, planGiftCardRefund, formatGiftCardCode, sql };
