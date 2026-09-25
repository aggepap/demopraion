'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Checkbox, Field, Section, TextInput } from './ui';

/**
 * Settings → Ecommerce → Gift cards.
 *
 * Whether the shop sells them, for how much, and for how long a card stays
 * spendable. Amounts are typed in the currency (25, 50) and stored in minor
 * units, like every other amount in commerce. The server checks the same rules
 * again (`checkStructuredSetting`), so a mistake is refused with a reason
 * either way.
 */

const GIFTCARDS_KEY = 'ecommerce.giftCards';

export interface GiftCardConfigView {
  enabled: boolean;
  presets: number[];
  allowCustom: boolean;
  minAmount: number;
  maxAmount: number;
  expiryMonths: number;
}

export interface GiftCardSettingsForm {
  enabled: boolean;
  /** Comma-separated amounts in major units, e.g. "25, 50, 100". */
  presets: string;
  allowCustom: boolean;
  minAmount: string;
  maxAmount: string;
  expiryMonths: string;
}

const MAX_MINOR = 100_000_00;

/** "25,50" → minor units, or `null` when a value is not an amount. */
function toMinor(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** The form, as the config the server stores — or the first thing wrong with it. */
export function giftCardSettingsFromForm(
  form: GiftCardSettingsForm
): { ok: true; value: GiftCardConfigView } | { ok: false; message: string } {
  const parts = form.presets
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const presets: number[] = [];
  for (const part of parts) {
    const minor = toMinor(part);
    if (minor === null || minor < 1 || minor > MAX_MINOR) {
      return { ok: false, message: `Preset amounts: "${part}" is not an amount.` };
    }
    if (!presets.includes(minor)) presets.push(minor);
  }
  if (presets.length > 12) return { ok: false, message: 'Preset amounts: at most 12.' };

  const minAmount = toMinor(form.minAmount);
  const maxAmount = toMinor(form.maxAmount);
  if (minAmount === null || minAmount < 1 || minAmount > MAX_MINOR) {
    return { ok: false, message: 'The smallest custom amount has to be above zero.' };
  }
  if (maxAmount === null || maxAmount < 1 || maxAmount > MAX_MINOR) {
    return { ok: false, message: 'The largest custom amount has to be above zero.' };
  }
  if (maxAmount < minAmount) {
    return { ok: false, message: 'The largest custom amount cannot be below the smallest.' };
  }
  const expiryMonths = Number(form.expiryMonths);
  if (!Number.isInteger(expiryMonths) || expiryMonths < 0 || expiryMonths > 120) {
    return { ok: false, message: 'Expiry has to be a whole number of months from 0 (never) to 120.' };
  }
  if (form.enabled && presets.length === 0 && !form.allowCustom) {
    return { ok: false, message: 'Offer at least one preset amount, or allow a custom amount.' };
  }

  return {
    ok: true,
    value: {
      enabled: form.enabled,
      presets,
      allowCustom: form.allowCustom,
      minAmount,
      maxAmount,
      expiryMonths,
    },
  };
}

const major = (minor: number) => String(minor / 100);

export function GiftCardSettings({ initial, currency }: { initial: GiftCardConfigView; currency: string }) {
  const [form, setForm] = useState<GiftCardSettingsForm>({
    enabled: initial.enabled,
    presets: initial.presets.map(major).join(', '),
    allowCustom: initial.allowCustom,
    minAmount: major(initial.minAmount),
    maxAmount: major(initial.maxAmount),
    expiryMonths: String(initial.expiryMonths),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<GiftCardSettingsForm>) => {
    setSaved(false);
    setForm((cur) => ({ ...cur, ...patch }));
  };

  async function save() {
    const checked = giftCardSettingsFromForm(form);
    if (!checked.ok) {
      setError(checked.message);
      setSaved(false);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await cmsApi.updateSiteSettings({ [GIFTCARDS_KEY]: checked.value });
      setSaved(true);
    } catch (err) {
      setError(apiErrorText(err, 'Could not save the gift card settings.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Gift cards">
      <div className="flex max-w-lg flex-col gap-4">
        <Checkbox
          label="Sell gift cards"
          info="Turns on the Gift cards screen, the gift card code field at checkout and products of type “Gift card”."
          hint="Switched off, existing cards cannot be spent and the gift card product pages say they are unavailable."
          checked={form.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <Field
          label={`Preset amounts (${currency})`}
          description="The amounts offered on a gift card product, separated by commas — for example 25, 50, 100. Up to 12."
        >
          <TextInput value={form.presets} onChange={(e) => set({ presets: e.target.value })} />
        </Field>
        <Checkbox
          label="Allow a custom amount"
          info="Lets the buyer type their own amount, between the smallest and largest below."
          checked={form.allowCustom}
          onChange={(e) => set({ allowCustom: e.target.checked })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`Smallest custom amount (${currency})`}
            description="The least a buyer can type when a custom amount is allowed."
          >
            <TextInput
              type="number"
              min={0.01}
              step="0.01"
              value={form.minAmount}
              onChange={(e) => set({ minAmount: e.target.value })}
            />
          </Field>
          <Field
            label={`Largest custom amount (${currency})`}
            description="The most a buyer can type when a custom amount is allowed."
          >
            <TextInput
              type="number"
              min={0.01}
              step="0.01"
              value={form.maxAmount}
              onChange={(e) => set({ maxAmount: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Expires after (months)"
          description="How long a card can be spent from the day it is issued. 0 means it never expires. 24 months is the default."
        >
          <TextInput
            type="number"
            min={0}
            max={120}
            step={1}
            value={form.expiryMonths}
            onChange={(e) => set({ expiryMonths: e.target.value })}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-700">
            Saved.
          </p>
        ) : null}
        <Button type="button" onClick={() => void save()} disabled={saving}>
          Save
        </Button>
      </div>
    </Section>
  );
}
