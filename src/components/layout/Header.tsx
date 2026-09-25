'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { AccountLink } from '@/components/account/AccountLink';
import { CartButton } from '@/components/shop/cart/CartButton';
import { WishlistCount } from '@/components/shop/wishlist/WishlistCount';
import { ButtonLink } from '@/components/ui/Button';
import { Link } from '@/lib/i18n/routing';
import { navItems } from '@/lib/nav';
import { useBrand } from '@/cms/core/brand/BrandProvider';
import { cn } from '@/lib/utils';

interface HeaderProps {
  /** Public locales in display order (from admin language settings). */
  publicLocales: string[];
  /** The main (URL-unprefixed) locale. */
  mainLocale: string;
  commerceEnabled: boolean;
  bookingEnabled: boolean;
  /** Shop accounts (`customers` module). Hides the account link when off. */
  customersEnabled?: boolean;
}

/**
 * Sticky site header: wordmark, primary nav, language switcher, contact CTA,
 * cart (when commerce is on). Below `md` the nav moves into MobileMenu.
 */
export function Header({
  publicLocales,
  mainLocale,
  commerceEnabled,
  bookingEnabled,
  customersEnabled = false,
}: HeaderProps) {
  const brand = useBrand();
  const navT = useTranslations('nav');
  const headerT = useTranslations('header');
  const items = navItems({ commerce: commerceEnabled, booking: bookingEnabled });
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-50 w-full border-b transition-colors duration-200',
          scrolled ? 'bg-soft-pearl/95 backdrop-blur border-border-soft' : 'bg-soft-pearl border-transparent',
        )}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 md:h-20 flex items-center justify-between gap-6">
          <Link
            href="/"
            aria-label={headerT('logoAlt')}
            className="font-display text-xl font-semibold tracking-tight text-midnight-navy"
          >
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an uploaded file of unknown size; SVG allowed
              <img src={brand.logoUrl} alt={brand.name} className="h-8 w-auto md:h-10" />
            ) : (
              brand.name
            )}
          </Link>

          <nav className="hidden md:block" aria-label="Primary">
            <ul className="flex items-center gap-1">
              {items.map((item) => (
                <li key={item.labelKey}>
                  <Link
                    href={item.href}
                    className="px-3 py-2 text-sm font-medium text-text-primary hover:text-warm-gold-deep transition-colors whitespace-nowrap"
                  >
                    {navT(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden md:block">
              <LanguageSwitcher locales={publicLocales} mainLocale={mainLocale} />
            </div>
            <ButtonLink href="/contact" variant="primary" size="sm" className="hidden sm:inline-flex whitespace-nowrap">
              {headerT('ctaLabel')}
            </ButtonLink>
            {commerceEnabled ? <WishlistCount /> : null}
            {customersEnabled ? <AccountLink /> : null}
            {commerceEnabled ? <CartButton /> : null}
            <button
              type="button"
              className="md:hidden p-2 -m-2 text-midnight-navy rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-midnight-navy"
              aria-label={headerT('openMenu')}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="w-6 h-6" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        publicLocales={publicLocales}
        mainLocale={mainLocale}
        commerceEnabled={commerceEnabled}
        bookingEnabled={bookingEnabled}
      />
    </>
  );
}
