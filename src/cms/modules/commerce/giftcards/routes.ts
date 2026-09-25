import 'server-only';

import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createRoute } from '../../../core/api/handler';
import { idParam } from '../../../core/api/params';
import { ok } from '../../../core/api/respond';
import { logAudit } from '../../../core/audit';
import { badRequest, notFound } from '../../../core/errors';
import { adapter, getDb, schema } from '../../../db';
import { PERMISSIONS, requireApiPerm } from '../../auth';
import { getSiteCurrency } from '../read';
import { sendGiftCardEmail } from './emails';
import { formatGiftCardCode, isGiftCardUsable } from './policy';
import { deliverIssuedGiftCard, giftCardHistory } from './rules';
import { findGiftCardByCode, getGiftCardConfig, quoteGiftCards } from './service';

/**
 * Gift card endpoints.
 *
 * The public one is a balance check, and it is the only place a stranger can
 * ask anything about a card — so it is rate limited hard, says the same thing
 * for "no such card", "void" and "expired", and never reveals who owns it.
 */

export function giftCardCheckRoute() {
  return createRoute({
    // A gift card code is money; this is the endpoint somebody would guess at.
    rateLimit: { scope: 'giftcard-check', max: 5, windowMs: 60_000 },
    captcha: { rateLimit: { scope: 'giftcard-check-captcha', max: 30, windowMs: 60_000 } },
    input: z.object({ code: z.string().trim().min(4).max(32) }).strict(),
    handler: async ({ input }) => {
      const config = await getGiftCardConfig();
      if (!config.enabled) throw notFound();

      const row = await findGiftCardByCode(input.code);
      // One answer for every kind of "no", so the endpoint cannot be used to
      // tell a real-but-spent code from one that never existed.
      if (!row || !isGiftCardUsable({ ...row }, new Date())) {
        throw badRequest('That code cannot be used.');
      }
      return ok({ balance: row.balance, currency: row.currency });
    },
  });
}

/** What these codes would cover, for the checkout summary. */
export function giftCardQuoteRoute() {
  return createRoute({
    rateLimit: { scope: 'giftcard-quote', max: 20, windowMs: 60_000 },
    input: z
      .object({
        codes: z.array(z.string().trim().min(4).max(32)).max(5),
        amountDue: z.coerce.number().int().min(0),
      })
      .strict(),
    handler: async ({ input }) => {
      const config = await getGiftCardConfig();
      if (!config.enabled) throw notFound();
      const currency = await getSiteCurrency();
      const quote = await quoteGiftCards(input.codes, input.amountDue, currency);
      return ok(quote);
    },
  });
}

/** Admin: the list, with balances. */
export function giftCardsListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    handler: async () => {
      const rows = await getDb()
        .select({
          id: schema.giftCards.id,
          codeLast4: schema.giftCards.codeLast4,
          currency: schema.giftCards.currency,
          initialAmount: schema.giftCards.initialAmount,
          balance: schema.giftCards.balance,
          status: schema.giftCards.status,
          expiresAt: schema.giftCards.expiresAt,
          recipientEmail: schema.giftCards.recipientEmail,
          sendAt: schema.giftCards.sendAt,
          sentAt: schema.giftCards.sentAt,
          createdAt: schema.giftCards.createdAt,
        })
        .from(schema.giftCards)
        .orderBy(desc(schema.giftCards.id))
        .limit(200);
      return ok({ giftCards: rows });
    },
  });
}

/** Admin: one card's history — its issue, then every movement of its balance. */
export function giftCardHistoryRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.ordersRead),
    handler: async ({ params }) => {
      const id = idParam(params.id);
      const db = getDb();
      const [card] = await db
        .select({
          id: schema.giftCards.id,
          initialAmount: schema.giftCards.initialAmount,
          createdAt: schema.giftCards.createdAt,
          orderId: schema.giftCards.orderId,
        })
        .from(schema.giftCards)
        .where(eq(schema.giftCards.id, id))
        .limit(1);
      if (!card) throw notFound();
      const rows = await db
        .select({
          id: schema.giftCardTransactions.id,
          type: schema.giftCardTransactions.type,
          amount: schema.giftCardTransactions.amount,
          balanceAfter: schema.giftCardTransactions.balanceAfter,
          orderId: schema.giftCardTransactions.orderId,
          note: schema.giftCardTransactions.note,
          createdAt: schema.giftCardTransactions.createdAt,
        })
        .from(schema.giftCardTransactions)
        .where(eq(schema.giftCardTransactions.giftCardId, id))
        .orderBy(asc(schema.giftCardTransactions.id))
        .limit(500);
      return ok({ entries: giftCardHistory(card, rows) });
    },
  });
}

/** Admin: issue one by hand, or void one. */
export function giftCardWriteRoute(opts: {
  /** The language of the email a hand-issued card is sent in (`config.defaultLocale`). */
  defaultLocale: string;
}) {
  return {
    POST: createRoute({
      rateLimit: { scope: 'giftcard-admin', max: 30, windowMs: 60_000 },
      guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
      input: z
        .object({
          amount: z.coerce.number().int().positive().max(100_000_00),
          recipientName: z.string().trim().max(191).optional(),
          recipientEmail: z.string().trim().email().max(255).optional(),
          message: z.string().trim().max(500).optional(),
        })
        .strict(),
      handler: async ({ input, auth }) => {
        const config = await getGiftCardConfig();
        if (!config.enabled) throw notFound();

        const { generateGiftCardCode, hashGiftCardCode, normalizeGiftCardCode } =
          await import('./policy');
        const { encryptSecret } = await import('../../../core/tokens/crypto');
        const pepper = process.env.CMS_GIFTCARD_PEPPER;
        if (!pepper || pepper.length < 32)
          throw badRequest('CMS_GIFTCARD_PEPPER is not configured.');

        const code = generateGiftCardCode();
        const last4 = normalizeGiftCardCode(code).slice(-4);
        const currency = await getSiteCurrency();
        const recipientEmail = input.recipientEmail || null;
        const message = input.message || null;
        const result = await getDb()
          .insert(schema.giftCards)
          .values({
            codeHash: hashGiftCardCode(code, pepper),
            codeLast4: last4,
            codeEncrypted: encryptSecret(code),
            currency,
            initialAmount: input.amount,
            balance: input.amount,
            // Issued by hand: it is spendable now.
            status: 'active',
            sendAt: new Date(),
            /*
             * With nobody to email, the card is handed over now. Otherwise "sent"
             * is recorded only once the email has actually gone, so a failed send
             * shows as a card still due rather than one that arrived.
             */
            sentAt: recipientEmail ? null : new Date(),
            recipientName: input.recipientName || null,
            recipientEmail,
            message,
            issuedBy: auth.userId,
            expiresAt:
              config.expiryMonths > 0
                ? new Date(Date.now() + config.expiryMonths * 30 * 86_400_000)
                : null,
          });
        const id = adapter.insertId(result);
        await logAudit({
          userId: auth.userId,
          action: 'giftcard.issue',
          subjectType: 'gift_card',
          subjectId: last4,
        });

        // The same email the delivery job sends for a card bought in the shop.
        const { emailed } = await deliverIssuedGiftCard(
          { code: formatGiftCardCode(code), recipientEmail, message, amount: input.amount, currency },
          (card) => sendGiftCardEmail(card, opts.defaultLocale)
        );
        if (emailed) {
          await getDb()
            .update(schema.giftCards)
            .set({ sentAt: new Date() })
            .where(eq(schema.giftCards.id, id));
          await logAudit({
            userId: auth.userId,
            action: 'giftcard.send',
            subjectType: 'gift_card',
            subjectId: last4,
          });
        }
        // The only time the code is returned: the admin has to be able to pass
        // it on when they issued it by hand.
        return ok({ code: formatGiftCardCode(code), emailed });
      },
    }),
    PATCH: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.ordersWrite),
      input: z.object({ status: z.enum(['void', 'active']) }).strict(),
      handler: async ({ input, params, auth }) => {
        const id = idParam(params.id);
        const db = getDb();
        const [card] = await db
          .select({
            balance: schema.giftCards.balance,
            status: schema.giftCards.status,
          })
          .from(schema.giftCards)
          .where(eq(schema.giftCards.id, id))
          .limit(1);
        if (!card) throw notFound();
        if (card.status === input.status) return ok({ id, status: input.status });

        await db
          .update(schema.giftCards)
          .set({ status: input.status })
          .where(eq(schema.giftCards.id, id));
        // In the card's own history as well as the audit log: "why can this card
        // not be used" is asked on the gift cards screen.
        await db.insert(schema.giftCardTransactions).values({
          giftCardId: id,
          type: input.status === 'void' ? 'void' : 'adjust',
          amount: 0,
          balanceAfter: card.balance,
          actor: auth.userId ? String(auth.userId) : null,
          note: input.status === 'void' ? null : 'Restored',
        });
        await logAudit({
          userId: auth.userId,
          action: 'giftcard.status',
          subjectType: 'gift_card',
          subjectId: id,
          after: { status: input.status },
        });
        return ok({ id, status: input.status });
      },
    }),
  };
}
