import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignOutButton } from '@/components/account/AccountPanels';
import type { Locale } from '@/lib/i18n/config';
import { Link } from '@/lib/i18n/routing';

import { AccountShell } from './AccountShell';
import { requireCustomerPage } from './require-customer';

/**
 * Signed-in screens read the customer on the SERVER and redirect a guest to the
 * sign-in page. The session is never trusted from the browser here — the page
 * itself is what decides whether there is anything to render.
 */
interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function AccountPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const customer = await requireCustomerPage(locale);

  const t = await getTranslations({ locale, namespace: 'account' });
  const links: { href: string; label: string }[] = [
    { href: '/account/orders', label: t('ordersTitle') },
    { href: '/account/addresses', label: t('addressesTitle') },
    { href: '/account/profile', label: t('profileTitle') },
    { href: '/account/privacy', label: t('privacyTitle') },
  ];

  return (
    <AccountShell
      eyebrow={t('eyebrow')}
      title={t('overviewTitle')}
      intro={t('signedInAs', { email: customer.email })}
      actions={<SignOutButton />}
    >
      {customer.emailVerifiedAt === null ? (
        <p role="status" className="font-body text-sm text-amber-800">
          {t('emailNotConfirmed')}
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="border-border-soft font-body text-text-primary hover:border-warm-gold block rounded-sm border bg-white px-4 py-3 text-sm transition-colors"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </AccountShell>
  );
}
