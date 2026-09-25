'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Checkbox, Field, Icon, IconButton, Section, Select, TextInput } from './ui';

// Mirrors ShippingConfig in the commerce module (kept literal so this client
// component doesn't import the server-only shipping module).
type Method = 'flat' | 'weight' | 'zone';
interface WeightTier {
  minWeight: number;
  charge: number;
}
interface Zone {
  name: string;
  countries: string[];
  charge: number;
}
interface Surcharge {
  provider: string;
  charge: number;
}
interface PickupLocation {
  id: string;
  name: string;
  address?: string;
  hours?: string;
}
interface PickupConfig {
  enabled: boolean;
  charge: number;
  locations: PickupLocation[];
}
export interface ShippingConfig {
  method: Method;
  baseCharge: number;
  freeThreshold: number;
  weightTiers: WeightTier[];
  zones: Zone[];
  paymentSurcharges: Surcharge[];
  pickup: PickupConfig;
}

const SHIPPING_KEY = 'ecommerce.shipping';
const numOrZero = (v: string) => (v === '' ? 0 : Number(v));

export function ShippingSettings({
  initial,
  currency,
  paymentProviders,
}: {
  initial: ShippingConfig;
  currency: string;
  paymentProviders: string[];
}) {
  const [cfg, setCfg] = useState<ShippingConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ShippingConfig>(key: K, value: ShippingConfig[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));

  // Older stored configs predate the pickup block; the server normalises on read,
  // but stay defensive so the panel can't crash on a hand-edited setting.
  const pickup: PickupConfig = cfg.pickup ?? { enabled: false, charge: 0, locations: [] };
  const setPickup = (patch: Partial<PickupConfig>) => set('pickup', { ...pickup, ...patch });
  const patchLocation = (i: number, patch: Partial<PickupLocation>) =>
    setPickup({ locations: pickup.locations.map((loc, x) => (x === i ? { ...loc, ...patch } : loc)) });

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await cmsApi.updateSiteSettings({ [SHIPPING_KEY]: cfg });
      setSaved(true);
    } catch (err) {
      // The sentence that names the zone and the rule, not "Validation failed."
      setError(apiErrorText(err, 'Could not save the shipping settings.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {error ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          Shipping settings saved.
        </div>
      ) : null}

      <Section
        title="Method"
        info="These rules price an order the customer ships without picking a shipping method. Once you add shipping methods below, checkout offers those instead and a chosen method’s own price applies."
      >
        <Field
          label="Shipping method"
          description="How the shipping cost is calculated at checkout: one flat price, the standard charge plus a weight surcharge, or a price per country zone."
        >
          <Select value={cfg.method} onChange={(e) => set('method', e.target.value as Method)}>
            <option value="flat">Flat rate</option>
            <option value="weight">By weight</option>
            <option value="zone">By country / zone</option>
          </Select>
        </Field>
        <Field
          label={`Standard charge (${currency})`}
          description="The shipping price for flat rate, the starting price for weight tiers, and the fallback when no zone matches."
        >
          <TextInput
            type="number"
            min={0}
            step="any"
            value={cfg.baseCharge || ''}
            onChange={(e) => set('baseCharge', numOrZero(e.target.value))}
          />
        </Field>
        <Field
          label={`Free shipping over (${currency})`}
          description="Shipping is free when the items subtotal reaches this amount. Empty or 0 means never free."
        >
          <TextInput
            type="number"
            min={0}
            step="any"
            value={cfg.freeThreshold || ''}
            onChange={(e) => set('freeThreshold', numOrZero(e.target.value))}
          />
        </Field>
      </Section>

      {cfg.method === 'weight' ? (
        <Section
          title="Weight surcharges"
          info="Extra charge added to the base when total cart weight reaches a limit. The highest matching tier applies."
        >
          <div className="flex flex-col gap-2">
            {cfg.weightTiers.map((tier, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field
                  label="From weight"
                  description="Applies when the cart’s total weight reaches this. Product weights are added as entered, without converting units."
                >
                  <TextInput
                    type="number"
                    min={0}
                    step="any"
                    placeholder="e.g. 5"
                    className="w-28"
                    value={tier.minWeight || ''}
                    onChange={(e) => {
                      const next = [...cfg.weightTiers];
                      next[i] = { ...tier, minWeight: numOrZero(e.target.value) };
                      set('weightTiers', next);
                    }}
                  />
                </Field>
                <Field label={`Extra charge (${currency})`} description="Added to the standard charge.">
                  <TextInput
                    type="number"
                    min={0}
                    step="any"
                    className="w-28"
                    value={tier.charge || ''}
                    onChange={(e) => {
                      const next = [...cfg.weightTiers];
                      next[i] = { ...tier, charge: numOrZero(e.target.value) };
                      set('weightTiers', next);
                    }}
                  />
                </Field>
                <IconButton
                  aria-label="Remove"
                  className="mb-1 hover:text-red-700"
                  onClick={() => set('weightTiers', cfg.weightTiers.filter((_, x) => x !== i))}
                >
                  <Icon name="trash" size={14} />
                </IconButton>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set('weightTiers', [...cfg.weightTiers, { minWeight: 0, charge: 0 }])}
              >
                <Icon name="plus" size={14} /> Add tier
              </Button>
            </div>
          </div>
        </Section>
      ) : null}

      {cfg.method === 'zone' ? (
        <Section
          title="Zones"
          info="Flat charge per destination. Countries are comma-separated (match the checkout country field). Falls back to the standard charge if no zone matches."
        >
          <div className="flex flex-col gap-3">
            {cfg.zones.map((zone, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-sm border border-neutral-200 p-3">
                <div className="flex items-end gap-2">
                  <Field className="flex-1" label="Zone name" description="For you only; customers do not see it.">
                    <TextInput
                      placeholder="e.g. Europe"
                      value={zone.name}
                      onChange={(e) => {
                        const next = [...cfg.zones];
                        next[i] = { ...zone, name: e.target.value };
                        set('zones', next);
                      }}
                    />
                  </Field>
                  <Field label={`Charge (${currency})`} description="The shipping price for these countries.">
                    <TextInput
                      type="number"
                      min={0}
                      step="any"
                      className="w-28"
                      value={zone.charge || ''}
                      onChange={(e) => {
                        const next = [...cfg.zones];
                        next[i] = { ...zone, charge: numOrZero(e.target.value) };
                        set('zones', next);
                      }}
                    />
                  </Field>
                  <IconButton
                    aria-label="Remove"
                    className="mb-1 hover:text-red-700"
                    onClick={() => set('zones', cfg.zones.filter((_, x) => x !== i))}
                  >
                    <Icon name="trash" size={14} />
                  </IconButton>
                </div>
                <Field
                  label="Countries"
                  description="Separated by commas, written as customers type them in the checkout Country field (upper or lower case both match)."
                >
                  <TextInput
                    placeholder="e.g. Greece, Cyprus"
                    value={zone.countries.join(', ')}
                    onChange={(e) => {
                      const next = [...cfg.zones];
                      next[i] = {
                        ...zone,
                        countries: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      };
                      set('zones', next);
                    }}
                  />
                </Field>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set('zones', [...cfg.zones, { name: '', countries: [], charge: 0 }])}
              >
                <Icon name="plus" size={14} /> Add zone
              </Button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        title="Store pickup"
        info="Let customers collect their order instead of having it shipped. Digital-only carts never see the option."
      >
        <Checkbox
          label="Offer store pickup at checkout"
          info="Adds “Collect in store” at checkout. The customer gives no delivery address and pays the pickup charge instead of shipping."
          checked={pickup.enabled}
          onChange={(e) => setPickup({ enabled: e.target.checked })}
        />

        {pickup.enabled ? (
          <>
            <Field
              label={`Pickup charge (${currency})`}
              description="Handling fee for collecting in store. Usually 0 — it replaces shipping entirely (no zones, weight tiers or free-shipping threshold)."
            >
              <TextInput
                type="number"
                min={0}
                step="any"
                className="w-28"
                value={pickup.charge || ''}
                onChange={(e) => setPickup({ charge: numOrZero(e.target.value) })}
              />
            </Field>
            <Field
              label="Locations"
              description="Stores the customer can choose from. With none listed, pickup is offered without a choice of store."
            >
              <div className="flex flex-col gap-3">
                {pickup.locations.map((loc, i) => (
                  <div key={loc.id} className="flex flex-col gap-2 rounded-sm border border-neutral-200 p-3">
                    <div className="flex items-end gap-2">
                      <Field className="flex-1" label="Store name" description="Shown to the customer when they choose where to collect.">
                        <TextInput value={loc.name} onChange={(e) => patchLocation(i, { name: e.target.value })} />
                      </Field>
                      <IconButton
                        aria-label="Remove"
                        className="mb-1 hover:text-red-700"
                        onClick={() => setPickup({ locations: pickup.locations.filter((_, x) => x !== i) })}
                      >
                        <Icon name="trash" size={14} />
                      </IconButton>
                    </div>
                    <Field label="Address" description="Where to collect. Shown at checkout and on the order.">
                      <TextInput value={loc.address ?? ''} onChange={(e) => patchLocation(i, { address: e.target.value })} />
                    </Field>
                    <Field label="Opening hours" description="When the order can be collected, as free text.">
                      <TextInput
                        placeholder="e.g. Mon–Fri 09:00–17:00"
                        value={loc.hours ?? ''}
                        onChange={(e) => patchLocation(i, { hours: e.target.value })}
                      />
                    </Field>
                  </div>
                ))}
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setPickup({
                        locations: [
                          ...pickup.locations,
                          { id: crypto.randomUUID().slice(0, 8), name: '', address: '', hours: '' },
                        ],
                      })
                    }
                  >
                    <Icon name="plus" size={14} /> Add location
                  </Button>
                </div>
              </div>
            </Field>
          </>
        ) : null}
      </Section>

      <Section
        title="Payment surcharges"
        info="Extra fee for a payment method (e.g. cash on delivery). Applied on top of shipping."
      >
        <div className="flex flex-col gap-2">
          {cfg.paymentSurcharges.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field className="flex-1" label="Payment method" description="The fee is added when the customer pays this way.">
                <Select
                  value={s.provider}
                  onChange={(e) => {
                    const next = [...cfg.paymentSurcharges];
                    next[i] = { ...s, provider: e.target.value };
                    set('paymentSurcharges', next);
                  }}
                >
                  <option value="">— provider —</option>
                  {paymentProviders.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Fee (${currency})`} description="Added to the order on top of shipping, as its own line.">
                <TextInput
                  type="number"
                  min={0}
                  step="any"
                  className="w-28"
                  value={s.charge || ''}
                  onChange={(e) => {
                    const next = [...cfg.paymentSurcharges];
                    next[i] = { ...s, charge: numOrZero(e.target.value) };
                    set('paymentSurcharges', next);
                  }}
                />
              </Field>
              <IconButton
                aria-label="Remove"
                className="mb-1 hover:text-red-700"
                onClick={() => set('paymentSurcharges', cfg.paymentSurcharges.filter((_, x) => x !== i))}
              >
                <Icon name="trash" size={14} />
              </IconButton>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                set('paymentSurcharges', [
                  ...cfg.paymentSurcharges,
                  { provider: paymentProviders[0] ?? '', charge: 0 },
                ])
              }
            >
              <Icon name="plus" size={14} /> Add surcharge
            </Button>
          </div>
        </div>
      </Section>

      <div className="flex flex-col gap-2">
        {/*
          The refusal beside the button that caused it, as well as at the top.
          One incomplete zone blocks the whole panel, and this page is long: the only message
          was at the very top, far above the Save someone had just pressed near the bottom, so
          it read as a save that had done nothing at all.
        */}
        {error ? (
          <div
            role="alert"
            className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}
        <div>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save shipping settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
