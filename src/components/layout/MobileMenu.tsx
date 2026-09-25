'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import { useDialog } from '@/cms/admin/ui/use-dialog';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { ButtonLink } from '@/components/ui/Button';
import { Link } from '@/lib/i18n/routing';
import { navItems } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { useBrand } from '@/cms/core/brand/BrandProvider';

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  publicLocales: string[];
  mainLocale: string;
  commerceEnabled: boolean;
  bookingEnabled: boolean;
}

/**
 * Full-screen mobile navigation. Modal behaviour (scroll lock, Escape, focus
 * trap and restore) comes from the shared `useDialog` hook; `invisible` when
 * closed keeps its links out of the tab order.
 */
export function MobileMenu({ open, onClose, publicLocales, mainLocale, commerceEnabled, bookingEnabled }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const brand = useBrand();
  const navT = useTranslations('nav');
  const headerT = useTranslations('header');
  const items = navItems({ commerce: commerceEnabled, booking: bookingEnabled });
  useDialog({ open, onClose, panelRef });

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={headerT('openMenu')}
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-[60] bg-soft-pearl flex flex-col md:hidden transition-[opacity,visibility] duration-200',
        open ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none',
      )}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-soft">
        <span className="font-display text-lg font-semibold text-midnight-navy">{brand.name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={headerT('closeMenu')}
          className="p-2 -m-2 text-midnight-navy rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-midnight-navy"
        >
          <X className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-6 py-6" aria-label="Primary">
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.labelKey} className="border-b border-border-soft">
              <Link
                href={item.href}
                onClick={onClose}
                className="block py-5 font-display text-lg font-medium text-text-primary hover:text-warm-gold-deep"
              >
                {navT(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border-soft px-6 py-6 flex flex-col gap-4">
        <ButtonLink href="/contact" variant="primary" size="md" className="w-full" onClick={onClose}>
          {headerT('ctaLabel')}
        </ButtonLink>
        <div className="flex items-center justify-between">
          <LanguageSwitcher locales={publicLocales} mainLocale={mainLocale} />
          {brand.email ? (
            <a href={`mailto:${brand.email}`} className="text-sm text-text-muted hover:text-text-primary">
              {brand.email}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
