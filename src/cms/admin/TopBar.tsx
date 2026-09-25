'use client';

import { usePathname, useRouter } from 'next/navigation';

import { adminHref } from './admin-path';
import { MobileNavToggle } from './AdminNav';
import { cmsApi } from './api-client';
import { Icon } from './ui';

export interface TopBarItem {
  href: string;
  label: string;
  isCollection?: boolean;
}

export function TopBar({
  userName,
  items,
  adminPath,
}: {
  userName: string;
  items: TopBarItem[];
  /** The admin URL segment (`ADMIN_PATH`), resolved on the server. */
  adminPath: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const current = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const onListPage = Boolean(current && pathname === current.href);
  const onNew = pathname.endsWith('/new');
  const suffix = onNew ? ' · New' : current?.isCollection && !onListPage ? ' · Edit' : '';
  const title = current?.label ?? 'Dashboard';

  async function logout() {
    try {
      await cmsApi.logout();
    } finally {
      router.push(adminHref(adminPath, 'login'));
      router.refresh();
    }
  }

  return (
    <header className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center">
        <MobileNavToggle />
        {/*
          Not a heading: every page already renders its own <h1>, so this made
          two per document and left screen-reader users with an ambiguous
          outline. This is breadcrumb-style chrome telling you where you are.
        */}
        <p className="truncate font-display text-base font-semibold text-neutral-900" aria-hidden="true">
          {title}
          {suffix ? <span className="font-normal text-neutral-600">{suffix}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        {/*
          No "New" here on a list page: the page header already has one, directly above
          the list it adds to, and two differently-styled buttons for the same action a
          few pixels apart just make an editor wonder which is the real one — worse on a
          phone, where they nearly touch.
        */}
        <span className="hidden text-neutral-600 sm:inline">{userName}</span>
        <button
          onClick={logout}
          // The visible text is hidden on narrow screens to save room, which
          // left the button nameless there — an icon and nothing else. The
          // label has to be attached independently of what is on screen.
          aria-label="Sign out"
          className="inline-flex items-center gap-1.5 rounded-sm border border-neutral-300 px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-50"
        >
          <Icon name="logout" size={14} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
