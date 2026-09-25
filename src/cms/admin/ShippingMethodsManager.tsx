'use client';

import { useState } from 'react';

import {
  COURIER_LABELS,
  type CourierKey,
  type MethodKind,
  type ShippingMethodRow,
  type ShippingZoneRow,
} from '../modules/commerce/shipping-methods';
import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Checkbox, Drawer, Field, Section, Select, Table, Tbody, Td, TextInput, Th, Thead } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/**
 * Settings → Ecommerce → Shipping → Shipping methods.
 *
 * Zones (groups of countries) and the delivery options each offers — courier,
 * price, free-over threshold, delivery days, cash on delivery. The moment one
 * method exists, checkout offers these instead of the flat / weight / zone
 * calculation above; with none, nothing changes.
 */

type MethodView = Omit<ShippingMethodRow, 'weightTiers'>;

const COURIERS = Object.keys(COURIER_LABELS) as CourierKey[];
const KIND_LABELS: Record<MethodKind, string> = {
  address: 'Delivery to an address',
  locker: 'Parcel locker',
  pickup: 'Store pickup',
};

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

function eta(method: MethodView): string {
  const { etaMinDays: min, etaMaxDays: max } = method;
  if (min === null && max === null) return '—';
  if (min !== null && max !== null) return min === max ? `${min} days` : `${min}–${max} days`;
  return `${min ?? max} days`;
}

interface MethodForm {
  id: number | null;
  zoneId: string;
  name: string;
  courier: CourierKey;
  kind: MethodKind;
  cost: string;
  freeThreshold: string;
  etaMinDays: string;
  etaMaxDays: string;
  codAllowed: boolean;
  active: boolean;
  sort: string;
  pickupLocationId: string;
}

interface ZoneForm {
  id: number | null;
  name: string;
  countries: string;
  sort: string;
}

const toForm = (m: MethodView): MethodForm => ({
  id: m.id,
  zoneId: String(m.zoneId),
  name: m.name,
  courier: m.courier,
  kind: m.kind,
  cost: (m.cost / 100).toFixed(2),
  freeThreshold: m.freeThreshold === null ? '' : (m.freeThreshold / 100).toFixed(2),
  etaMinDays: m.etaMinDays === null ? '' : String(m.etaMinDays),
  etaMaxDays: m.etaMaxDays === null ? '' : String(m.etaMaxDays),
  codAllowed: m.codAllowed,
  active: m.active,
  sort: String(m.sort),
  pickupLocationId: m.pickupLocationId ?? '',
});

/** The API body for a method (money in minor units). */
function methodBody(m: MethodView) {
  return {
    zoneId: m.zoneId,
    name: m.name,
    courier: m.courier,
    kind: m.kind,
    cost: m.cost,
    freeThreshold: m.freeThreshold,
    etaMinDays: m.etaMinDays,
    etaMaxDays: m.etaMaxDays,
    codAllowed: m.codAllowed,
    pickupLocationId: m.pickupLocationId,
    active: m.active,
    sort: m.sort,
  };
}

/** The form as an API body, or the first thing wrong with it. */
function fromForm(form: MethodForm): { ok: true; body: ReturnType<typeof methodBody> } | { ok: false; message: string } {
  const minor = (raw: string) => Math.round(Number(raw.replace(',', '.')) * 100);
  const days = (raw: string) => (raw.trim() === '' ? null : Number(raw));
  if (!form.zoneId) return { ok: false, message: 'Choose a zone.' };
  if (!form.name.trim()) return { ok: false, message: 'Give the method a name.' };
  const cost = minor(form.cost || '0');
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, message: 'The cost has to be zero or more.' };
  const free = form.freeThreshold.trim() === '' ? null : minor(form.freeThreshold);
  if (free !== null && (!Number.isFinite(free) || free < 0)) {
    return { ok: false, message: '“Free over” has to be an amount, or empty for never.' };
  }
  const etaMinDays = days(form.etaMinDays);
  const etaMaxDays = days(form.etaMaxDays);
  for (const d of [etaMinDays, etaMaxDays]) {
    if (d !== null && (!Number.isInteger(d) || d < 0 || d > 90)) {
      return { ok: false, message: 'Delivery days are whole numbers from 0 to 90.' };
    }
  }
  return {
    ok: true,
    body: {
      zoneId: Number(form.zoneId),
      name: form.name.trim(),
      courier: form.courier,
      kind: form.kind,
      cost,
      freeThreshold: free,
      etaMinDays,
      etaMaxDays,
      codAllowed: form.codAllowed,
      pickupLocationId: form.kind === 'pickup' ? form.pickupLocationId || null : null,
      active: form.active,
      sort: Math.max(0, Math.min(999, Number(form.sort) || 0)),
    },
  };
}

export function ShippingMethodsManager({
  initialZones,
  initialMethods,
  currency,
  pickupLocations,
}: {
  initialZones: ShippingZoneRow[];
  initialMethods: MethodView[];
  currency: string;
  /** From Store pickup above: what a pickup method may point at. */
  pickupLocations: { id: string; name: string }[];
}) {
  const [zones, setZones] = useState(initialZones);
  const [methods, setMethods] = useState(initialMethods);
  const [zoneForm, setZoneForm] = useState<ZoneForm | null>(null);
  const [methodForm, setMethodForm] = useState<MethodForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function run(action: () => Promise<void>, onError: (message: string) => void = setError) {
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      await action();
    } catch (err) {
      onError(apiErrorText(err, 'That did not save.'));
    } finally {
      setBusy(false);
    }
  }

  const applyResult = (data: { zones?: ShippingZoneRow[]; methods?: MethodView[] }) => {
    if (data.zones) setZones(data.zones);
    if (data.methods) setMethods(data.methods);
  };

  const zoneMethods = (zoneId: number) =>
    methods.filter((m) => m.zoneId === zoneId).sort((a, b) => a.sort - b.sort || a.id - b.id);

  /** Re-number a zone's methods after moving one, saving only those that changed. */
  function move(zoneId: number, index: number, delta: -1 | 1) {
    const list = zoneMethods(zoneId);
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    const [picked] = reordered.splice(index, 1);
    if (!picked) return;
    reordered.splice(target, 0, picked);
    void run(async () => {
      for (const [i, m] of reordered.entries()) {
        const sort = i * 10;
        if (m.sort === sort) continue;
        const res = await cmsApi.saveShippingMethod<{ methods: MethodView[] }>(m.id, { ...methodBody(m), sort });
        applyResult(res.data);
      }
    });
  }

  const newMethod = (zoneId: number): MethodForm => ({
    id: null,
    zoneId: String(zoneId),
    name: '',
    courier: 'acs',
    kind: 'address',
    cost: '0.00',
    freeThreshold: '',
    etaMinDays: '',
    etaMaxDays: '',
    codAllowed: true,
    active: true,
    sort: String(zoneMethods(zoneId).length * 10),
    pickupLocationId: '',
  });

  return (
    <Section title="Shipping methods">
      {dialog}
      <p className="mb-3 max-w-2xl text-sm text-neutral-600">
        Delivery options the customer chooses between at checkout, per zone of countries. As soon as one
        method exists, checkout offers these instead of the calculation above; the payment surcharges above
        still apply.
      </p>

      {zones.length === 0 && methods.length === 0 ? (
        <p className="mb-3 text-sm text-neutral-600">
          No shipping methods yet — checkout uses the calculation above.
        </p>
      ) : null}

      <div className="flex flex-col gap-5">
        {zones.map((zone) => {
          const list = zoneMethods(zone.id);
          return (
            <div key={zone.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-neutral-900">
                  {zone.name} <span className="font-normal text-neutral-600">— {zone.countries.join(', ')}</span>
                </h4>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setZoneForm({ id: zone.id, name: zone.name, countries: zone.countries.join(', '), sort: String(zone.sort) })
                    }
                  >
                    Edit zone
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete the zone “${zone.name}”?`,
                        message:
                          list.length > 0
                            ? `Its ${list.length} shipping method(s) are deleted with it. Orders already placed keep what they were charged.`
                            : 'Orders already placed keep what they were charged.',
                        confirmLabel: 'Delete zone',
                      });
                      if (!ok) return;
                      void run(async () => {
                        const res = await cmsApi.deleteShippingZone<{ zones: ShippingZoneRow[]; methods: MethodView[] }>(zone.id);
                        applyResult(res.data);
                      });
                    }}
                  >
                    Delete zone
                  </Button>
                </span>
              </div>

              {list.length === 0 ? (
                <p className="text-sm text-neutral-600">No methods in this zone yet.</p>
              ) : (
                <Table>
                  <Thead>
                    <tr>
                      <Th>Method</Th>
                      <Th>Courier</Th>
                      <Th>Cost</Th>
                      <Th info="Shown at checkout as “Arrives in … working days”.">Delivery</Th>
                      <Th info="Whether this method is offered when the customer chooses to pay on delivery.">
                        Cash on delivery
                      </Th>
                      <Th info="Unticked, the method is kept but not offered at checkout.">Active</Th>
                      <Th info="The order the methods are listed in at checkout. Use the arrows to move one.">Order</Th>
                      <Th>Actions</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {list.map((m, i) => (
                      <tr key={m.id}>
                        <Td>
                          {m.name}
                          <span className="block text-xs text-neutral-600">{KIND_LABELS[m.kind]}</span>
                        </Td>
                        <Td>{COURIER_LABELS[m.courier] ?? m.courier}</Td>
                        <Td>
                          {money(m.cost, currency)}
                          {m.freeThreshold !== null ? (
                            <span className="block text-xs text-neutral-600">
                              free over {money(m.freeThreshold, currency)}
                            </span>
                          ) : null}
                        </Td>
                        <Td>{eta(m)}</Td>
                        <Td>{m.codAllowed ? 'Allowed' : 'Not allowed'}</Td>
                        <Td>
                          <input
                            type="checkbox"
                            aria-label={`${m.name} is offered at checkout`}
                            checked={m.active}
                            disabled={busy}
                            onChange={(e) =>
                              void run(async () => {
                                const res = await cmsApi.saveShippingMethod<{ methods: MethodView[] }>(m.id, {
                                  ...methodBody(m),
                                  active: e.target.checked,
                                });
                                applyResult(res.data);
                              })
                            }
                          />
                        </Td>
                        <Td>
                          <span className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Move ${m.name} up`}
                              disabled={busy || i === 0}
                              onClick={() => move(zone.id, i, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Move ${m.name} down`}
                              disabled={busy || i === list.length - 1}
                              onClick={() => move(zone.id, i, 1)}
                            >
                              ↓
                            </Button>
                          </span>
                        </Td>
                        <Td>
                          <span className="flex gap-1">
                            <Button type="button" variant="secondary" size="sm" onClick={() => setMethodForm(toForm(m))}>
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `Delete “${m.name}”?`,
                                  message: 'Checkout stops offering it. Orders already placed keep what they were charged.',
                                  confirmLabel: 'Delete method',
                                });
                                if (!ok) return;
                                void run(async () => {
                                  const res = await cmsApi.deleteShippingMethod<{ methods: MethodView[] }>(m.id);
                                  applyResult(res.data);
                                });
                              }}
                            >
                              Delete
                            </Button>
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              )}
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setMethodForm(newMethod(zone.id))}>
                  Add method
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setZoneForm({ id: null, name: '', countries: '', sort: String(zones.length * 10) })}>
          Add zone
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {zoneForm ? (
        <Drawer title={zoneForm.id ? 'Edit zone' : 'Add zone'} onClose={() => setZoneForm(null)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const countries = zoneForm.countries
                .split(/[,\s]+/)
                .map((c) => c.trim().toUpperCase())
                .filter(Boolean);
              if (!zoneForm.name.trim()) return setFormError('Give the zone a name.');
              if (countries.length === 0 || countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
                return setFormError('Countries are two-letter codes separated by commas, e.g. GR, CY.');
              }
              void run(
                async () => {
                  const res = await cmsApi.saveShippingZone<{ zones: ShippingZoneRow[]; methods: MethodView[] }>(zoneForm.id, {
                    name: zoneForm.name.trim(),
                    countries,
                    sort: Math.max(0, Math.min(999, Number(zoneForm.sort) || 0)),
                  });
                  applyResult(res.data);
                  setZoneForm(null);
                },
                setFormError,
              );
            }}
          >
            <Field label="Zone name" description="For you only; customers see the method names, not the zone.">
              <TextInput maxLength={120} value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} />
            </Field>
            <Field label="Countries" description="Two-letter country codes separated by commas, e.g. GR, CY. A country belongs to the first zone that lists it.">
              <TextInput value={zoneForm.countries} onChange={(e) => setZoneForm({ ...zoneForm, countries: e.target.value })} />
            </Field>
            <Field label="Order" description="Lower comes first in this list.">
              <TextInput type="number" min={0} max={999} value={zoneForm.sort} onChange={(e) => setZoneForm({ ...zoneForm, sort: e.target.value })} />
            </Field>
            {formError ? (
              <p role="alert" className="text-sm text-red-700">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              Save zone
            </Button>
          </form>
        </Drawer>
      ) : null}

      {methodForm ? (
        <Drawer title={methodForm.id ? 'Edit shipping method' : 'Add shipping method'} onClose={() => setMethodForm(null)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const checked = fromForm(methodForm);
              if (!checked.ok) return setFormError(checked.message);
              void run(
                async () => {
                  const res = await cmsApi.saveShippingMethod<{ methods: MethodView[] }>(methodForm.id, checked.body);
                  applyResult(res.data);
                  setMethodForm(null);
                },
                setFormError,
              );
            }}
          >
            <Field label="Zone" description="The countries this method is offered to.">
              <Select value={methodForm.zoneId} onChange={(e) => setMethodForm({ ...methodForm, zoneId: e.target.value })}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" description="What the customer sees, e.g. “ACS — next day”.">
              <TextInput maxLength={120} value={methodForm.name} onChange={(e) => setMethodForm({ ...methodForm, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Courier"
                description="Who carries the parcel. Decides the tracking link on shipments, and BoxNow vouchers can be created from the order."
              >
                <Select
                  value={methodForm.courier}
                  onChange={(e) => setMethodForm({ ...methodForm, courier: e.target.value as CourierKey })}
                >
                  {COURIERS.map((key) => (
                    <option key={key} value={key}>
                      {COURIER_LABELS[key]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" description="A parcel locker needs BoxNow; a store pickup needs one of the pickup locations above.">
                <Select
                  value={methodForm.kind}
                  onChange={(e) => setMethodForm({ ...methodForm, kind: e.target.value as MethodKind })}
                >
                  {(Object.keys(KIND_LABELS) as MethodKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {methodForm.kind === 'pickup' ? (
              <Field label="Pickup location" description="The store the customer collects from, from Store pickup above.">
                <Select
                  value={methodForm.pickupLocationId}
                  onChange={(e) => setMethodForm({ ...methodForm, pickupLocationId: e.target.value })}
                >
                  <option value="">— Choose —</option>
                  {pickupLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Cost (${currency})`} description="What the customer pays for this method. 0 shows it as free.">
                <TextInput type="number" min={0} step="0.01" value={methodForm.cost} onChange={(e) => setMethodForm({ ...methodForm, cost: e.target.value })} />
              </Field>
              <Field label={`Free over (${currency})`} description="Shipping is free when the basket reaches this amount. Empty = never free.">
                <TextInput type="number" min={0} step="0.01" value={methodForm.freeThreshold} onChange={(e) => setMethodForm({ ...methodForm, freeThreshold: e.target.value })} />
              </Field>
              <Field
                label="Delivery days (from)"
                description="Fewest working days to arrive. Shown at checkout; leave empty to show no estimate."
              >
                <TextInput type="number" min={0} max={90} value={methodForm.etaMinDays} onChange={(e) => setMethodForm({ ...methodForm, etaMinDays: e.target.value })} />
              </Field>
              <Field
                label="Delivery days (to)"
                description="Most working days to arrive. Leave empty when it is the same as “from”."
              >
                <TextInput type="number" min={0} max={90} value={methodForm.etaMaxDays} onChange={(e) => setMethodForm({ ...methodForm, etaMaxDays: e.target.value })} />
              </Field>
            </div>
            <Checkbox
              label="Cash on delivery allowed"
              info="Off hides this method when the customer pays on delivery."
              checked={methodForm.codAllowed}
              onChange={(e) => setMethodForm({ ...methodForm, codAllowed: e.target.checked })}
            />
            <Checkbox
              label="Active"
              info="Off keeps the method but stops offering it at checkout."
              checked={methodForm.active}
              onChange={(e) => setMethodForm({ ...methodForm, active: e.target.checked })}
            />
            <Field label="Order" description="Lower comes first within the zone.">
              <TextInput type="number" min={0} max={999} value={methodForm.sort} onChange={(e) => setMethodForm({ ...methodForm, sort: e.target.value })} />
            </Field>
            {formError ? (
              <p role="alert" className="text-sm text-red-700">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              Save method
            </Button>
          </form>
        </Drawer>
      ) : null}
    </Section>
  );
}
