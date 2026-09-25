'use client';

import { User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Link } from '@/lib/i18n/routing';

/**
 * The header's account link.
 *
 * It asks the server who is signed in from the BROWSER, on purpose. Reading the
 * session cookie in the layout would mark every page in the site dynamic, and a
 * page that renders per request cannot be cached at all — one link in the
 * header is not worth the whole site's static rendering.
 *
 * Until the answer arrives the link still renders, pointing at the account
 * page, which redirects a guest to sign in. So it is never a hole in the layout
 * and never shifts once it resolves.
 */
export function AccountLink() {
  const t = useTranslations('account');
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cms/customer/me')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          body: { ok?: boolean; data?: { customer?: { name?: string; email?: string } } } | null
        ) => {
          const customer = body?.ok ? body.data?.customer : null;
          if (!cancelled && customer) setName(customer.name || customer.email || null);
        }
      )
      .catch(() => {
        // A failed lookup just means the link keeps its signed-out label.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/account"
      className="text-text-primary hover:text-warm-gold-deep -m-2 flex items-center gap-1.5 p-2 text-sm font-medium transition-colors"
      aria-label={name ? t('myAccountNamed', { name }) : t('signIn')}
    >
      <User className="h-5 w-5" aria-hidden />
      <span className="hidden max-w-[10rem] truncate lg:inline">{name ?? t('signIn')}</span>
    </Link>
  );
}
