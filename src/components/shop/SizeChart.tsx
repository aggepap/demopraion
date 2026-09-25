import { getTranslations } from 'next-intl/server';

import type { ResolvedSizeChart } from '@/cms/modules/commerce';
import type { Locale } from '@/lib/i18n/config';

/**
 * The size-guide block on a product page (addendum §3). Server component — a
 * static, crawlable table. Rendered as its own section with `id="size-guide"`
 * so the "Size guide" link in the buy box can anchor to it (the tabs elsewhere
 * hide inactive panels, which an anchor can't reveal).
 */
export async function SizeChart({ chart, locale }: { chart: ResolvedSizeChart; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shop' });

  return (
    <section id="size-guide" className="mt-16 max-w-3xl scroll-mt-24">
      <h2 className="font-display text-2xl font-semibold text-midnight-navy">{t('sizeGuide')}</h2>
      {chart.title ? (
        <p className="mt-1 font-body text-sm font-medium text-text-primary">{chart.title}</p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left font-body text-sm">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 font-semibold text-midnight-navy">{t('size')}</th>
              {chart.headers.map((h, i) => (
                <th key={i} className="px-3 py-2 font-semibold text-midnight-navy">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border-soft/60">
                <td className="px-3 py-2 font-medium text-text-primary">{row.size}</td>
                {chart.headers.map((_, ci) => (
                  <td key={ci} className="px-3 py-2 text-text-muted">
                    {row.cells[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chart.note ? <p className="mt-3 font-body text-xs text-text-muted">{chart.note}</p> : null}
    </section>
  );
}
