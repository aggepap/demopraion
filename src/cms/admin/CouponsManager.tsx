'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Checkbox, Field, Icon, IconButton, Section, Select, TextInput } from './ui';

// Mirrors Coupon in the commerce module (kept literal — no server import).
type CouponType = 'percent' | 'fixed';
export interface Coupon {
  code: string;
  type: CouponType;
  value: number;
  minSubtotal: number;
  expiresAt: string;
  usageLimit: number;
  perCustomerLimit: number;
  active: boolean;
}

const COUPONS_KEY = 'ecommerce.coupons';

/**
 * What each coupon field does, as `validateCoupon` and `countCouponRedemptions`
 * in the commerce module actually apply it.
 */
const COUPON_HELP = {
  code: 'What the customer types at checkout. Upper or lower case both work. A row without a code is not saved.',
  type: 'A percentage of the items subtotal, or a fixed amount off it. Shipping is never discounted.',
  percent: 'The percentage taken off the items subtotal, up to 100.',
  fixed: (currency: string) =>
    `The amount in ${currency} taken off the items subtotal. It never takes the items below zero.`,
  minSubtotal: 'The code only works when the items subtotal reaches this amount. Empty means no minimum.',
  expiresAt: 'The last day the code works. Empty means it never expires.',
  usageLimit:
    'How many orders can use the code in total. Orders that are cancelled or refunded give their use back. Empty means no limit.',
  perCustomerLimit:
    'How many orders one customer can use it on, counted by email address. Empty means no limit.',
  active: 'Switched off, checkout refuses the code but it stays in the list. Turn it back on at any time.',
};
const numOrZero = (v: string) => (v === '' ? 0 : Number(v));

export function CouponsManager({ initial, currency }: { initial: Coupon[]; currency: string }) {
  const [coupons, setCoupons] = useState<Coupon[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [droppedCount, setDroppedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Coupon>) =>
    setCoupons((cs) => cs.map((c, x) => (x === i ? { ...c, ...p } : c)));
  const remove = (i: number) => setCoupons((cs) => cs.filter((_, x) => x !== i));
  const add = () =>
    setCoupons((cs) => [
      ...cs,
      { code: '', type: 'percent', value: 0, minSubtotal: 0, expiresAt: '', usageLimit: 0, perCustomerLimit: 0, active: true },
    ]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    setDroppedCount(0);
    try {
      const clean = coupons
        .map((c) => ({ ...c, code: c.code.trim() }))
        .filter((c) => c.code);
      /*
       * A row with no code cannot be saved — a coupon is identified by its code — and it was
       * dropped silently while the banner said "Coupons saved." exactly as if everything had
       * been. The row then vanished on the next reload with no explanation. Dropping it is
       * still right; not mentioning it is not.
       */
      const dropped = coupons.length - clean.length;
      await cmsApi.updateSiteSettings({ [COUPONS_KEY]: clean });
      setCoupons(clean);
      setSaved(true);
      setDroppedCount(dropped);
    } catch (err) {
      setError(apiErrorText(err, 'Could not save the coupons.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {error ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          Coupons saved.
          {droppedCount > 0
            ? ` ${droppedCount} row${droppedCount === 1 ? '' : 's'} without a code ${
                droppedCount === 1 ? 'was' : 'were'
              } not saved — a coupon needs a code.`
            : ''}
        </div>
      ) : null}

      <Section
        title="Discount codes"
        info="Percentage or fixed-amount codes customers enter at checkout. The discount applies to the items subtotal, never to shipping."
      >
        <div className="flex flex-col gap-2">
          {coupons.length === 0 ? (
            <p className="text-sm text-neutral-600">No coupons yet.</p>
          ) : null}
          {coupons.map((c, i) => (
            /*
             * Labelled fields rather than placeholders. The row used to be "CODE", a
             * bare "%" box and "∞" placeholders — the placeholder vanished as soon as
             * something was typed, and nothing said what "∞" or "min" meant.
             */
            <div key={i} className="flex flex-wrap items-end gap-3 rounded-sm border border-neutral-200 p-3">
              <Field label="Code" description={COUPON_HELP.code}>
                <TextInput
                  placeholder="SUMMER10"
                  className="w-32 font-mono uppercase"
                  value={c.code}
                  onChange={(e) => patch(i, { code: e.target.value })}
                />
              </Field>
              <Field label="Type" description={COUPON_HELP.type}>
                <Select
                  className="w-28"
                  value={c.type}
                  onChange={(e) => patch(i, { type: e.target.value as CouponType })}
                >
                  <option value="percent">% off</option>
                  <option value="fixed">{currency} off</option>
                </Select>
              </Field>
              <Field
                label="Amount"
                description={c.type === 'percent' ? COUPON_HELP.percent : COUPON_HELP.fixed(currency)}
              >
                <TextInput
                  type="number"
                  min={0}
                  // A percentage cannot exceed 100. Without this the field happily
                  // took 150 for an intended 15 and gave the whole order away.
                  max={c.type === 'percent' ? 100 : undefined}
                  step="any"
                  className="w-24"
                  placeholder={c.type === 'percent' ? '%' : currency}
                  value={c.value || ''}
                  onChange={(e) => patch(i, { value: numOrZero(e.target.value) })}
                />
              </Field>
              <Field label={`Minimum order (${currency})`} description={COUPON_HELP.minSubtotal}>
                <TextInput
                  type="number"
                  min={0}
                  step="any"
                  className="w-24"
                  placeholder="None"
                  value={c.minSubtotal || ''}
                  onChange={(e) => patch(i, { minSubtotal: numOrZero(e.target.value) })}
                />
              </Field>
              <Field label="Expires" description={COUPON_HELP.expiresAt}>
                <TextInput
                  type="date"
                  className="w-40"
                  value={c.expiresAt}
                  onChange={(e) => patch(i, { expiresAt: e.target.value })}
                />
              </Field>
              <Field label="Max uses" description={COUPON_HELP.usageLimit}>
                <TextInput
                  type="number"
                  min={0}
                  step={1}
                  className="w-20"
                  placeholder="∞"
                  value={c.usageLimit || ''}
                  onChange={(e) => patch(i, { usageLimit: numOrZero(e.target.value) })}
                />
              </Field>
              <Field label="Per customer" description={COUPON_HELP.perCustomerLimit}>
                <TextInput
                  type="number"
                  min={0}
                  step={1}
                  className="w-20"
                  placeholder="∞"
                  value={c.perCustomerLimit || ''}
                  onChange={(e) => patch(i, { perCustomerLimit: numOrZero(e.target.value) })}
                />
              </Field>
              <Checkbox
                className="pb-2"
                label="Active"
                info={COUPON_HELP.active}
                checked={c.active}
                onChange={(e) => patch(i, { active: e.target.checked })}
              />
              <IconButton aria-label="Remove" className="ml-auto mb-1 hover:text-red-700" onClick={() => remove(i)}>
                <Icon name="trash" size={14} />
              </IconButton>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm" onClick={add}>
              <Icon name="plus" size={14} /> Add coupon
            </Button>
          </div>
        </div>
      </Section>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save coupons'}
        </Button>
      </div>
    </div>
  );
}
