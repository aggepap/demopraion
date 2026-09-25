'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Field, Section, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/**
 * Settings → Ecommerce → Shipping → Couriers.
 *
 * The credentials a courier's API needs (today: BoxNow's client id and secret).
 * Write-only: the server says whether each one is set and shows at most its
 * last four characters, and the inputs always start empty — a stored secret
 * never comes back to the browser.
 */

export interface CourierSecretView {
  key: string;
  label: string;
  module: string | null;
  set: boolean;
  masked: string | null;
  updatedAt: string | null;
}

/**
 * What each key is, behind the "i". Whether it is set is not here: that is
 * status, and stays visible under the field.
 */
const KEY_HELP: Record<string, string> = {
  'courier.boxnow.clientId':
    'The client ID of your BoxNow partner account. With the secret, it lets the order panel create BoxNow vouchers and checkout show the locker picker.',
  'courier.boxnow.clientSecret':
    'The client secret that goes with the client ID, from the same BoxNow partner account. Stored encrypted; after saving only its last four characters are shown.',
};

export function CourierCredentials({ initial }: { initial: CourierSecretView[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function save(key: string, value: string | null) {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      const res = await cmsApi.saveCourierSecret<CourierSecretView[]>(key, value);
      setRows(res.data);
      setDrafts((cur) => ({ ...cur, [key]: '' }));
      setSaved(value === null ? 'Cleared.' : 'Saved.');
    } catch (err) {
      setError(apiErrorText(err, 'Could not save the courier credentials.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Couriers">
      {dialog}
      <p className="mb-3 max-w-2xl text-sm text-neutral-600">
        BoxNow vouchers are created from the order panel with these credentials, from your BoxNow partner
        account. ACS, Speedex and ELTA need none here: book the parcel in their own system and add its
        tracking number to the order.
      </p>
      <div className="flex max-w-lg flex-col gap-4">
        {rows.map((row) => (
          <form
            key={row.key}
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = (drafts[row.key] ?? '').trim();
              if (!value) return setError(`Type a new ${row.label} to save, or use Clear.`);
              void save(row.key, value);
            }}
          >
            <Field
              className="min-w-[14rem] flex-1"
              label={row.label}
              description={KEY_HELP[row.key] ?? 'A credential for this courier’s API.'}
            >
              <TextInput
                type="password"
                autoComplete="off"
                maxLength={2048}
                placeholder={row.set ? row.masked ?? '••••' : 'Not set'}
                value={drafts[row.key] ?? ''}
                onChange={(e) => setDrafts((cur) => ({ ...cur, [row.key]: e.target.value }))}
              />
            </Field>
            <Button type="submit" size="sm" disabled={busy !== null}>
              Save
            </Button>
            {row.set ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Clear the ${row.label}?`,
                    message: 'BoxNow vouchers and the locker picker stop working until it is entered again.',
                    confirmLabel: 'Clear',
                  });
                  if (ok) void save(row.key, null);
                }}
              >
                Clear
              </Button>
            ) : null}
            <span className="w-full text-xs text-neutral-600">
              {row.set ? `Set · ${row.masked ?? ''} — type a new value to replace it` : 'Not set'}
            </span>
          </form>
        ))}
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-700">
            {saved}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
