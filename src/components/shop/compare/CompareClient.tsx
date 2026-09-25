'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { CompareProduct } from '@/cms/modules/commerce';
import { useCompare } from '@/components/shop/compare/CompareProvider';
import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

/**
 * The comparison table (addendum §6). Reads the selection from the compare
 * context (localStorage) and fetches each product's compare projection, then
 * lays them out side by side — header facts + the union of attributes/specs as
 * rows. Client because the selection lives in the browser.
 */
export function CompareClient({ locale }: { locale: string }) {
  const t = useTranslations('shop');
  const { items, remove } = useCompare();
  const [rows, setRows] = useState<CompareProduct[]>([]);
  // The slugKey the current `rows` correspond to — set only inside the async
  // callback, so the effect body performs no synchronous setState.
  const [loadedKey, setLoadedKey] = useState('');

  const slugKey = items.map((i) => i.slug).join(',');
  useEffect(() => {
    // No selection → nothing to fetch; the empty state is handled in render
    // (guarded by `items.length`).
    if (!slugKey) return;
    const controller = new AbortController();
    fetch(`/api/cms/commerce/compare?slugs=${encodeURIComponent(slugKey)}&locale=${locale}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setRows(d.data as CompareProduct[]);
          setLoadedKey(slugKey);
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => controller.abort();
  }, [slugKey, locale]);

  const loading = Boolean(slugKey) && loadedKey !== slugKey;

  if (items.length === 0) {
    return (
      <p className="font-body text-base text-text-muted">
        {t('compareEmpty')}{' '}
        <Link href="/shop" className="text-warm-gold-deep hover:underline">
          {t('title')}
        </Link>
      </p>
    );
  }

  // Row labels = the union of attribute names + spec labels across all products.
  const attrNames = [...new Set(rows.flatMap((p) => p.attributes.map((a) => a.name)))];
  const specLabels = [...new Set(rows.flatMap((p) => p.specs.map((s) => s.label)))];

  const attrValue = (p: CompareProduct, name: string) =>
    p.attributes.find((a) => a.name === name)?.values.join(', ') ?? '—';
  const specValue = (p: CompareProduct, label: string) =>
    p.specs.find((s) => s.label === label)?.value ?? '—';

  return (
    <div className="overflow-x-auto">
      {loading && rows.length === 0 ? (
        <p className="py-8 font-body text-sm text-text-muted">…</p>
      ) : (
        <table className="w-full min-w-[640px] border-collapse text-left font-body text-sm">
          <thead>
            <tr className="align-top">
              <th className="w-40 px-3 py-3" />
              {rows.map((p) => (
                <th key={p.slug} className="px-3 py-3">
                  <div className="flex flex-col gap-2">
                    <Link href={p.href} className="block aspect-square overflow-hidden rounded-sm bg-bone-cream">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/cms/media/file/${p.image}`} alt={p.title} className="h-full w-full object-cover" />
                      ) : null}
                    </Link>
                    <Link href={p.href} className="font-display text-base font-medium text-midnight-navy hover:text-warm-gold-deep">
                      {p.title}
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(p.slug)}
                      className="w-fit font-body text-xs text-text-muted hover:text-red-600"
                    >
                      {t('remove')}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border-soft">
              <th className="px-3 py-2 font-semibold text-midnight-navy">{t('price')}</th>
              {rows.map((p) => (
                <td key={p.slug} className="px-3 py-2 text-text-primary">
                  {formatPrice(p.price, p.currency, locale)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-border-soft">
              <th className="px-3 py-2 font-semibold text-midnight-navy">{t('availabilityLabel')}</th>
              {rows.map((p) => (
                <td key={p.slug} className="px-3 py-2 text-text-muted">
                  {t(`availability.${p.availability}`)}
                </td>
              ))}
            </tr>
            {attrNames.map((name) => (
              <tr key={`attr-${name}`} className="border-t border-border-soft">
                <th className="px-3 py-2 font-semibold text-midnight-navy">{name}</th>
                {rows.map((p) => (
                  <td key={p.slug} className="px-3 py-2 text-text-muted">
                    {attrValue(p, name)}
                  </td>
                ))}
              </tr>
            ))}
            {specLabels.map((label) => (
              <tr key={`spec-${label}`} className="border-t border-border-soft">
                <th className="px-3 py-2 font-semibold text-midnight-navy">{label}</th>
                {rows.map((p) => (
                  <td key={p.slug} className="px-3 py-2 text-text-muted">
                    {specValue(p, label)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
