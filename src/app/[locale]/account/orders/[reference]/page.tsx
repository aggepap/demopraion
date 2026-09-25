import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getCustomerOrder } from '@/cms/modules/customers';
import type { Locale } from '@/lib/i18n/config';
import { formatPrice } from '@/lib/money';

import { AccountShell } from '../../AccountShell';
import { requireCustomerPage } from '../../require-customer';

interface PageProps {
  params: Promise<{ locale: Locale; reference: string }>;
}

export default async function AccountOrderPage({ params }: PageProps) {
  const { locale, reference } = await params;
  setRequestLocale(locale);
  const customer = await requireCustomerPage(locale);

  // Scoped to this customer inside the query: somebody else's reference is not
  // "forbidden", it simply does not exist for them.
  const [t, order] = await Promise.all([
    getTranslations({ locale, namespace: 'account' }),
    getCustomerOrder(customer.id, reference),
  ]);
  if (!order) notFound();

  return (
    <AccountShell
      eyebrow={t('eyebrow')}
      title={order.reference}
      intro={t(`status.${order.status}`)}
    >
      <ul className="flex flex-col gap-2">
        {order.items.map((item) => (
          <li
            key={item.id}
            className="border-border-soft flex items-center justify-between gap-4 border-b py-2"
          >
            <span className="font-body text-text-primary text-sm">
              {item.name}
              {item.variantLabel ? ` — ${item.variantLabel}` : ''} × {item.quantity}
            </span>
            <span className="font-body text-text-muted text-sm">
              {formatPrice(item.lineTotal / 100, order.currency, locale)}
            </span>
          </li>
        ))}
      </ul>
      <p className="font-body text-text-primary text-base font-medium">
        {t('total')}: {formatPrice(order.total / 100, order.currency, locale)}
      </p>
    </AccountShell>
  );
}
