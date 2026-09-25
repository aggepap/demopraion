/**
 * Gift cards and every movement of their balance.
 *
 * ## Two tables, not one
 *
 * The card carries the current balance; the ledger says how it got there. A
 * balance with no history is impossible to answer questions about — "the
 * customer says they had €20 left" needs rows, not a number.
 *
 * ## What is stored
 *
 * The HMAC of the code, never the code (see `policy.ts`), plus an encrypted
 * copy so the card can be re-sent to its recipient. `code_last4` is for the
 * admin list, where a card has to be recognisable without being spendable.
 */
import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varbinary,
  varchar,
} from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';
import { orders, payments } from './commerce';

export const giftCardStatusValues = ['scheduled', 'active', 'void', 'expired'] as const;

export const giftCards = mysqlTable(
  'gift_cards',
  {
    id: int('id').autoincrement().primaryKey(),
    /** HMAC-SHA256 of the normalised code, under `CMS_GIFTCARD_PEPPER`. */
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    /** For the admin list: enough to recognise, not enough to spend. */
    codeLast4: varchar('code_last4', { length: 8 }).notNull().default(''),
    /** AES-GCM, so the card can be emailed again if it never arrived. */
    codeEncrypted: varbinary('code_encrypted', { length: 512 }),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /** Minor units. */
    initialAmount: int('initial_amount').notNull(),
    balance: int('balance').notNull(),
    status: mysqlEnum('status', giftCardStatusValues).notNull().default('scheduled'),
    expiresAt: timestamp('expires_at'),
    /** The order that bought it, when it was not issued by hand. */
    orderId: int('order_id').references(() => orders.id, { onDelete: 'set null' }),
    /** The line it came from — the idempotency key when a webhook is replayed. */
    orderItemId: int('order_item_id'),
    purchaserEmail: varchar('purchaser_email', { length: 255 }),
    recipientName: varchar('recipient_name', { length: 191 }),
    recipientEmail: varchar('recipient_email', { length: 255 }),
    message: text('message'),
    /** When the recipient should receive it — a birthday, not today. */
    sendAt: timestamp('send_at'),
    sentAt: timestamp('sent_at'),
    issuedBy: int('issued_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    hashUniq: unique('uniq_gift_cards_code_hash').on(t.codeHash),
    // One card per purchased line: a replayed capture webhook must not mint a
    // second card for the same purchase.
    itemUniq: unique('uniq_gift_cards_order_item').on(t.orderItemId),
    statusIdx: index('idx_gift_cards_status_send').on(t.status, t.sendAt),
  })
);

export const giftCardTxTypes = [
  'issue',
  'redeem',
  'reversal',
  'refund_credit',
  'void',
  'adjust',
  'expire',
] as const;

export const giftCardTransactions = mysqlTable(
  'gift_card_transactions',
  {
    id: int('id').autoincrement().primaryKey(),
    giftCardId: int('gift_card_id')
      .notNull()
      .references(() => giftCards.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', giftCardTxTypes).notNull(),
    /** Signed, minor units: negative spends, positive credits. */
    amount: int('amount').notNull(),
    /** The balance after this movement, so the ledger can be read on its own. */
    balanceAfter: int('balance_after').notNull(),
    orderId: int('order_id').references(() => orders.id, { onDelete: 'set null' }),
    paymentId: int('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    actor: varchar('actor', { length: 191 }),
    note: varchar('note', { length: 500 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ cardIdx: index('idx_gift_card_tx_card').on(t.giftCardId) })
);

export type GiftCardRecord = typeof giftCards.$inferSelect;
export type GiftCardTransactionRecord = typeof giftCardTransactions.$inferSelect;
