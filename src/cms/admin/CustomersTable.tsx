'use client';

import { useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { Badge, Button, Section, Table, Tbody, Td, Th, Thead, TextInput } from './ui';

/**
 * Shop customer accounts.
 *
 * Read-mostly, and that is the design rather than an omission. An administrator
 * can look, search, and switch an account off; there is no "sign in as this
 * customer", no password reveal and no password set. An admin screen that could
 * take over a shopper's account would make every account worth attacking
 * through the admin, and nothing here needs it — a customer who cannot get in
 * uses the reset link like anybody else.
 */

export interface AdminCustomerView {
  id: number;
  email: string;
  name: string | null;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  deletedAt: string | null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

export function CustomersTable({
  initial,
  initialTotal,
  canWrite,
}: {
  initial: AdminCustomerView[];
  initialTotal: number;
  canWrite: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const reload = (term: string) =>
    run(async () => {
      const res = await cmsApi.list<AdminCustomerView>('customers', { search: term });
      setRows(res.items);
      setTotal(res.total);
    });

  return (
    <Section title={`Customers (${total})`}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void reload(search);
        }}
      >
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search customers"
        />
        <Button type="submit" disabled={busy}>
          Search
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No customer accounts yet.</p>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th info="Orders linked to this account, in any status.">Orders</Th>
              <Th>Registered</Th>
              <Th>Last sign-in</Th>
              <Th
                info={
                  <>
                    Active: can sign in. Unconfirmed: registered but has not clicked the link in the confirmation
                    email yet — they can sign in, but earlier guest orders are not attached until they confirm.
                    Disabled: switched off by you. Deleted: the customer deleted the account; their orders are kept
                    without their personal details.
                  </>
                }
              >
                Status
              </Th>
              {canWrite ? (
                <Th info="Disable signs the customer out everywhere at once and stops them signing in. Their orders are not touched, and Enable lets them back in.">
                  Actions
                </Th>
              ) : null}
            </tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const deleted = row.deletedAt !== null;
              return (
                <tr key={row.id}>
                  <Td>{row.email}</Td>
                  <Td>{row.name ?? '—'}</Td>
                  <Td>{row.orderCount}</Td>
                  <Td>{day(row.createdAt)}</Td>
                  <Td>{day(row.lastLoginAt)}</Td>
                  <Td>
                    {deleted ? (
                      <Badge tone="neutral">Deleted</Badge>
                    ) : row.status === 'disabled' ? (
                      <Badge tone="amber">Disabled</Badge>
                    ) : row.emailVerifiedAt ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="amber">Unconfirmed</Badge>
                    )}
                  </Td>
                  {canWrite ? (
                    <Td>
                      {deleted ? null : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const next = row.status === 'disabled' ? 'active' : 'disabled';
                              await cmsApi.update('customers', row.id, { status: next });
                              setRows((cur) =>
                                cur.map((c) => (c.id === row.id ? { ...c, status: next } : c))
                              );
                            })
                          }
                        >
                          {row.status === 'disabled' ? 'Enable' : 'Disable'}
                        </Button>
                      )}
                    </Td>
                  ) : null}
                </tr>
              );
            })}
          </Tbody>
        </Table>
      )}
    </Section>
  );
}
