'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';

import { adminHref } from './admin-path';
import { useAdminNav } from './AdminNav';
import type { CollectionSummary } from './shared';
import { groupSidebarItems, labelText } from './shared';
import { Icon, type IconName } from './ui';
import { collectionIcon } from './ui/icon-names';
import { cn } from './ui/cn';

export interface SidebarTool {
  href: string;
  label: string;
  icon?: IconName;
  /** Group key to render under — see `MODULE_GROUPS`. Defaults to 'system'. */
  group?: string;
}


/** Admin sidebar. Collections + tools come from the site config / permissions
 *  (server-resolved), so the nav reflects config changes with no bespoke code.
 *  Icons are `collection.icon` + per-tool icons, from the names `Icon` bundles
 *  (`ui/icon-names.ts`). */
export function Sidebar({
  siteName,
  collections,
  locale,
  tools = [],
  adminPath,
}: {
  siteName: string;
  collections: CollectionSummary[];
  locale: string;
  tools?: SidebarTool[];
  /** The admin URL segment (`ADMIN_PATH`), resolved on the server. */
  adminPath: string;
}) {
  const pathname = usePathname();
  const { open } = useAdminNav();

  const itemClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors',
      active
        ? 'bg-warm-gold/15 text-warm-gold font-medium'
        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
    );

  const groupLabel = 'mt-5 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400';

  const dashboardHref = adminHref(adminPath);

  const collectionLink = (c: CollectionSummary) => {
    const href = adminHref(adminPath, c.key);
    return (
      <Link key={c.key} href={href} className={itemClass(pathname === href || pathname.startsWith(`${href}/`))}>
        <Icon name={collectionIcon(c.icon, c.key)} size={16} />
        {labelText(c.labelPlural, locale, c.key)}
      </Link>
    );
  };

  const toolLink = (t: SidebarTool) => (
    <Link
      key={t.href}
      href={t.href}
      className={itemClass(pathname === t.href || pathname.startsWith(`${t.href}/`))}
    >
      <Icon name={t.icon ?? 'settings'} size={16} />
      {t.label}
    </Link>
  );

  // Module-owned collections get their own sections, so the storefront catalog
  // and the booking model stay visually distinct from editorial content. The
  // sorting itself is pure and lives in `shared.ts`, where it is unit-tested.
  const { content: contentItems, modules: moduleSections, system: systemTools } = groupSidebarItems(
    collections,
    tools,
  );

  return (
    <aside
      id="admin-sidebar"
      aria-label="Primary navigation"
      // One element, two behaviours: an off-canvas drawer below `md` (slid out
      // of view unless opened, so it never squeezes the page into a sideways
      // scroll), and the unchanged static column from `md` up.
      className={cn(
        'z-40 flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-neutral-900 p-3 text-neutral-100',
        'fixed inset-y-0 left-0 transition-transform duration-200 ease-out',
        'md:static md:translate-x-0 md:transition-none',
        open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
      )}
    >
      <div className="mb-3 flex items-center gap-2 px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-warm-gold text-midnight-navy">
          <Icon name="dashboard" size={16} />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-display text-sm font-semibold text-white">{siteName}</span>
          <span className="text-[10px] uppercase tracking-wider text-neutral-400">CMS</span>
        </span>
      </div>

      {/* Top rather than bottom: the nav below is long enough to scroll, and
          the way out should never be below the fold. Never "active" — the
          public site has its own root layout, so Next does a full load. */}
      <Link href="/" className={cn(itemClass(false), 'mb-2')}>
        <Icon name="arrow-left" size={16} />
        Back to site
      </Link>

      <Link href={dashboardHref} className={itemClass(pathname === dashboardHref)}>
        <Icon name="dashboard" size={16} />
        Dashboard
      </Link>

      <div className={groupLabel}>Content</div>
      {contentItems.map(collectionLink)}

      {moduleSections.map((section) => (
        <Fragment key={section.label}>
          <div className={groupLabel}>{section.label}</div>
          {section.items.map(collectionLink)}
          {section.tools.map(toolLink)}
        </Fragment>
      ))}

      {systemTools.length > 0 ? (
        <>
          <div className={groupLabel}>System</div>
          {systemTools.map(toolLink)}
        </>
      ) : null}
    </aside>
  );
}
