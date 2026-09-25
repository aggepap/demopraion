'use client';

import { Fragment, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { apiErrorText } from './api-error-text';
import { Badge, Button, Field, Section, Table, Tbody, Td, Textarea, Th, Thead, TextInput } from './ui';

/**
 * Gift cards and their balances.
 *
 * The codes are not here, and cannot be: only their HMAC is stored, so even
 * this screen cannot show one. A card issued by hand returns its code once, at
 * the moment it is created, and an admin who loses it issues another — which is
 * the correct trade for a credential that is money.
 */

export interface GiftCardView {
  id: number;
  codeLast4: string;
  currency: string;
  initialAmount: number;
  balance: number;
  status: string;
  expiresAt: string | null;
  recipientEmail: string | null;
  sendAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** One line of a card's history (see `giftCardHistory` in the commerce module). */
export interface GiftCardHistoryView {
  key: string;
  at: string;
  label: string;
  amount: number;
  balanceAfter: number;
  orderId: number | null;
  note: string | null;
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

/** A card's movements, oldest first, with the balance after each. */
export function GiftCardHistory({ entries, currency }: { entries: GiftCardHistoryView[]; currency: string }) {
  return (
    <ol className="flex flex-col gap-1 text-xs">
      {entries.map((entry) => (
        <li key={entry.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="w-20 shrink-0 text-neutral-600">{day(entry.at)}</span>
          <span className="min-w-[10rem] font-medium text-neutral-900">{entry.label}</span>
          <span className={entry.amount < 0 ? 'text-red-700' : 'text-neutral-800'}>
            {entry.amount > 0 ? '+' : ''}
            {money(entry.amount, currency)}
          </span>
          <span className="text-neutral-600">balance {money(entry.balanceAfter, currency)}</span>
          {entry.orderId ? <span className="text-neutral-600">Order #{entry.orderId}</span> : null}
          {entry.note ? <span className="text-neutral-600">{entry.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function GiftCardsTable({
  initial,
  canWrite,
}: {
  initial: GiftCardView[];
  canWrite: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [amount, setAmount] = useState('25');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [issued, setIssued] = useState<{ code: string; emailedTo: string | null; emailFailed: boolean } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, GiftCardHistoryView[] | 'loading' | 'error'>>({});

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? apiErrorText(err, 'Failed') : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(id: number) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    setHistory((cur) => ({ ...cur, [id]: 'loading' }));
    try {
      const res = await cmsApi.giftCardHistory<GiftCardHistoryView>(id);
      setHistory((cur) => ({ ...cur, [id]: res.data.entries }));
    } catch {
      setHistory((cur) => ({ ...cur, [id]: 'error' }));
    }
  }

  const columns = canWrite ? 8 : 7;

  return (
    <Section title={`Gift cards (${rows.length})`}>
      {canWrite ? (
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const recipient = email.trim();
              const res = await cmsApi.create<{ code: string; emailed?: boolean }>('gift-cards', {
                amount: Math.round(Number(amount) * 100),
                recipientEmail: recipient || undefined,
                message: message.trim() || undefined,
              });
              // Shown once, because it can never be shown again.
              setIssued({
                code: res.data.code,
                emailedTo: res.data.emailed ? recipient : null,
                emailFailed: Boolean(recipient) && !res.data.emailed,
              });
              setEmail('');
              setMessage('');
              const list = await cmsApi.listGiftCards<GiftCardView>();
              setRows(list.data.giftCards);
            });
          }}
        >
          <Field
            label="Amount"
            description="The card’s value in the shop currency. It is spendable straight away and expires after the period set in Settings → Ecommerce → Gift cards."
          >
            <TextInput
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field
            label="Send to (optional)"
            description="The card and its code are emailed to this address now. Leave empty to hand the code over yourself."
          >
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field
            className="min-w-[14rem] flex-1"
            label="Message (optional)"
            description="A personal note included in the email to the recipient."
          >
            <Textarea rows={1} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>
            Issue a card
          </Button>
        </form>
      ) : null}

      {issued ? (
        <p role="status" className="mb-3 rounded-sm bg-green-50 p-3 text-sm text-green-800">
          Card created: <code className="font-mono tracking-widest">{issued.code}</code>. Copy it now
          — it is stored encrypted and cannot be shown again.
          {issued.emailedTo ? ` It has been emailed to ${issued.emailedTo}.` : null}
        </p>
      ) : null}
      {issued?.emailFailed ? (
        <p role="alert" className="mb-3 text-sm text-red-700">
          The card was created, but the email could not be sent. Pass the code on yourself.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No gift cards yet.</p>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th info="The last four characters of the code. The full code is never stored, so it cannot be shown again.">
                Card
              </Th>
              <Th info="What the card was worth when it was issued.">Value</Th>
              <Th info="What is left to spend. History shows every purchase and adjustment.">Balance</Th>
              <Th>Recipient</Th>
              <Th info="When the card was emailed. “due” is the date a card bought as a gift is scheduled to be sent.">
                Sent
              </Th>
              <Th>Expires</Th>
              <Th info="Active: can be spent. Scheduled: bought as a gift and not delivered yet — it becomes spendable when it is sent. Expired: past its expiry date. Void: switched off by you.">
                Status
              </Th>
              {canWrite ? (
                <Th info="Void stops the card being spent; Restore makes it spendable again with the same balance.">
                  Actions
                </Th>
              ) : null}
            </tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const entries = history[row.id];
              return (
                <Fragment key={row.id}>
                  <tr>
                    <Td>
                      <span className="flex items-center gap-2">
                        ••••{row.codeLast4}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={openId === row.id}
                          aria-controls={`giftcard-history-${row.id}`}
                          onClick={() => void toggleHistory(row.id)}
                        >
                          History
                        </Button>
                      </span>
                    </Td>
                    <Td>{money(row.initialAmount, row.currency)}</Td>
                    <Td>{money(row.balance, row.currency)}</Td>
                    <Td>{row.recipientEmail ?? '—'}</Td>
                    <Td>{day(row.sentAt) === '—' ? `due ${day(row.sendAt)}` : day(row.sentAt)}</Td>
                    <Td>{day(row.expiresAt)}</Td>
                    <Td>
                      {row.status === 'void' ? (
                        <Badge tone="red">Void</Badge>
                      ) : row.status === 'expired' ? (
                        <Badge tone="neutral">Expired</Badge>
                      ) : row.status === 'scheduled' ? (
                        <Badge tone="amber">Scheduled</Badge>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      )}
                    </Td>
                    {canWrite ? (
                      <Td>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const next = row.status === 'void' ? 'active' : 'void';
                              await cmsApi.update('gift-cards', row.id, { status: next });
                              setRows((cur) =>
                                cur.map((c) => (c.id === row.id ? { ...c, status: next } : c))
                              );
                              // The history gained a line; drop the cached copy.
                              setHistory((cur) => {
                                const rest = { ...cur };
                                delete rest[row.id];
                                return rest;
                              });
                              if (openId === row.id) setOpenId(null);
                            })
                          }
                        >
                          {row.status === 'void' ? 'Restore' : 'Void'}
                        </Button>
                      </Td>
                    ) : null}
                  </tr>
                  {openId === row.id ? (
                    <tr id={`giftcard-history-${row.id}`}>
                      <Td colSpan={columns} className="bg-neutral-50">
                        {entries === 'loading' || entries === undefined ? (
                          <p className="text-xs text-neutral-600">Loading…</p>
                        ) : entries === 'error' ? (
                          <p role="alert" className="text-xs text-red-700">
                            Could not load this card&apos;s history.
                          </p>
                        ) : (
                          <GiftCardHistory entries={entries} currency={row.currency} />
                        )}
                      </Td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </Tbody>
        </Table>
      )}
    </Section>
  );
}
