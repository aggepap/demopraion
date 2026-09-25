import { getTranslations, setRequestLocale } from 'next-intl/server';

import { listCustomerOrders } from '@/cms/modules/customers';
import type { Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';
import { formatPrice } from '@/lib/money';

import { AccountShell } from '../AccountShell';
import { requireCustomerPage } from '../require-customer';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function AccountOrdersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const customer = await requireCustomerPage(locale);

  const [t, orders] = await Promise.all([
    getTranslations({ locale, namespace: 'account' }),
    listCustomerOrders(customer.id),
  ]);

  return (
    <AccountShell eyebrow={t('eyebrow')} title={t('ordersTitle')}>
      {orders.length === 0 ? (
        <p className="font-body text-text-muted text-sm">{t('noOrders')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/account/orders/${order.reference}`}
                className="border-border-soft hover:border-warm-gold flex flex-wrap items-center justify-between gap-3 rounded-sm border bg-white px-4 py-3 transition-colors"
              >
                <span className="font-body text-text-primary text-sm font-medium">
                  {order.reference}
                </span>
                <span className="font-body text-text-muted text-sm">
                  {order.createdAt.toISOString().slice(0, 10)}
                </span>
                <span className="font-body text-text-muted text-sm">
                  {t(`status.${order.status}`)}
                </span>
                <span className="font-body text-text-primary text-sm">
                  {formatPrice(order.total / 100, order.currency, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}
