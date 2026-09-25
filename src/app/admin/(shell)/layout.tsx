import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import config from '@/site.config';
import { getBrand } from '@/cms/core/brand';
import {
  AdminNavProvider,
  labelText,
  MobileNavBackdrop,
  Sidebar,
  type SidebarTool,
  TopBar,
  type TopBarItem,
  collectionSummary,
  IdleLogout,
  ModuleFlagsProvider,
  visibleAdminCollections,
  EditLockProvider,
} from '@/cms/admin';
import { resolveModuleFlags } from '@/cms/core';
import { locksEnabled } from '@/cms/core/locks';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { sessionIdleSeconds } from '@/cms/modules/auth/session-idle';
import { getAdminPath } from '@/cms/core/paths';
import { ADMIN_PATH_HEADER } from '@/cms/core/admin-deep-link';
import { safeNextPath } from '@/cms/admin/safe-next';
import { adminHref } from '@/cms/admin/admin-path';

/** Authenticated admin shell. Requires the base `cms.access` permission;
 *  unauthenticated users are redirected to the login page. Collections tied to
 *  a disabled module are hidden; system tools are gated by permission. */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  /*
   * The path the visitor actually asked for, so signing in returns them to it
   * rather than to the dashboard. A layout is handed no pathname; middleware
   * stamps it on the request. Re-validated here even though middleware
   * overwrites any client copy — it steers a post-login redirect, and
   * `safeNextPath` falling back to the admin root is also what makes a request
   * that somehow arrives unstamped sign in normally instead of erroring.
   */
  const requested = safeNextPath((await headers()).get(ADMIN_PATH_HEADER), getAdminPath());
  const user = await requirePerm(PERMISSIONS.access, requested);
  const moduleFlags = await resolveModuleFlags(config);
  const { name: siteName } = await getBrand(config.brand);
  const collections = visibleAdminCollections(config.collections.map(collectionSummary), moduleFlags);

  // Every href below goes through this: the segment is `ADMIN_PATH`, and the
  // route tree's own `/admin` stops resolving once that has been moved.
  const adminPath = getAdminPath();
  const href = (path: string) => adminHref(adminPath, path);

  const tools: SidebarTool[] = [];
  const can = (perm: string) => hasPerm(user.permissions, perm);
  if (can(PERMISSIONS.formsRead)) tools.push({ href: href('submissions'), label: 'Submissions', icon: 'submissions' });
  if (moduleFlags.newsletter && can(PERMISSIONS.newsletterRead))
    tools.push({ href: href('newsletter'), label: 'Newsletter', icon: 'newsletter' });
  if (can(PERMISSIONS.seoRead)) tools.push({ href: href('seo'), label: 'SEO', icon: 'seo' });
  if (can(PERMISSIONS.mediaRead)) tools.push({ href: href('media'), label: 'Media', icon: 'media' });
  if (can(PERMISSIONS.usersManage)) tools.push({ href: href('users'), label: 'Users', icon: 'users' });
  // Its own permission, not `usersManage`: managing users and deciding what a
  // role may do are separate privileges, and the API has always treated them so.
  if (can(PERMISSIONS.rolesManage)) tools.push({ href: href('roles'), label: 'Roles', icon: 'roles' });
  // The Praion.ai connection is a tab inside Settings, not a sidebar entry of
  // its own — see `settings/page.tsx`. Same reasoning as shipping and coupons:
  // it is configuration, and the sidebar is for places content lives.
  if (moduleFlags.commerce && can(PERMISSIONS.ordersRead))
    tools.push({ href: href('orders'), label: 'Orders', icon: 'orders', group: 'ecommerce' });
  if (moduleFlags.customers && can(PERMISSIONS.customersRead))
    tools.push({ href: href('customers'), label: 'Customers', icon: 'users', group: 'ecommerce' });
  if (moduleFlags.commerce && can(PERMISSIONS.ordersRead))
    tools.push({ href: href('gift-cards'), label: 'Gift cards', icon: 'orders', group: 'ecommerce' });
  if (moduleFlags.commerce && can(PERMISSIONS.reviewsRead))
    tools.push({ href: href('reviews'), label: 'Reviews', icon: 'reviews', group: 'ecommerce' });
  if (moduleFlags.commerce && can(PERMISSIONS.ordersRead))
    tools.push({ href: href('abandoned'), label: 'Abandoned carts', icon: 'abandoned', group: 'ecommerce' });
  // `/admin/reservations`, not `/admin/bookings`: the alias map already routes
  // `bookings` to the `booking` collection (key + "s"), so a tool on that path
  // would shadow the Experiences list for anyone who typed the plural.
  if (moduleFlags.booking && can(PERMISSIONS.reservationsRead))
    tools.push({ href: href('reservations'), label: 'Reservations', icon: 'bookings', group: 'booking' });
  if (moduleFlags.booking && can(PERMISSIONS.scheduleRead))
    tools.push({ href: href('availability'), label: 'Availability', icon: 'calendar', group: 'booking' });
  if (can(PERMISSIONS.auditRead)) tools.push({ href: href('audit'), label: 'Audit log', icon: 'audit' });
  // Ungated on purpose — the only entry here that is not behind a permission.
  // It manages the signed-in user's own two-factor settings, and hiding it
  // behind `usersManage` would leave most editors unable to protect their login.
  tools.push({ href: href('account'), label: 'Your account', icon: 'lock' });
  if (can(PERMISSIONS.settingsRead)) {
    tools.push({ href: href('cookies'), label: 'Cookies', icon: 'cookies' });
    tools.push({ href: href('settings'), label: 'Settings', icon: 'settings' });
  }
  if (can(PERMISSIONS.scriptsManage)) tools.push({ href: href('scripts'), label: 'Scripts', icon: 'code' });

  const items: TopBarItem[] = [
    ...collections.map((c) => ({
      href: href(c.key),
      label: labelText(c.labelPlural, user.locale, c.key),
      isCollection: true,
    })),
    ...tools.map((t) => ({ href: t.href, label: t.label })),
  ];

  return (
    <AdminNavProvider>
      {/*
        The module switches, for controls deep inside a form that need them —
        the rich-text editor's "+ Block" list greys out blocks whose module is
        off. Resolved here once, like the sidebar's own filtering.
      */}
      <ModuleFlagsProvider flags={moduleFlags}>
      {/*
        The edit-lock socket is opened once for the whole shell rather than per
        editor, so moving between documents and orders does not tear a
        connection down and build another. Like `IdleLogout` below, everything
        it needs that only the server can read — whether locking is configured
        at all, and the dev-only URL override — is resolved here and handed
        down; the client can read neither.
      */}
      <EditLockProvider
        enabled={locksEnabled()}
        wsUrl={process.env.NEXT_PUBLIC_CMS_LOCK_WS_URL ?? ''}
        currentUserId={user.userId}
      >
      <div className="flex min-h-screen bg-neutral-100">
        <Sidebar
          siteName={siteName}
          collections={collections}
          locale={user.locale}
          tools={tools}
          adminPath={adminPath}
        />
        <MobileNavBackdrop />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar userName={user.name} items={items} adminPath={adminPath} />
          {/*
            `min-w-0` lets a wide child (a data table) shrink instead of forcing
            the column wider; `overflow-x-hidden` then guarantees the shell
            itself never scrolls sideways on a phone. Anything that genuinely
            needs horizontal room — every data table here — carries its own
            `overflow-x-auto` box, so this clips nothing a user needs to reach.
          */}
          <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6 lg:p-8">{children}</main>
        </div>
        {/*
          The idle window is resolved on the server and handed down, exactly as
          `adminPath` is: the client cannot read either env var, and the two
          halves of the timeout disagreeing about how long an hour is would be a
          confusing bug to chase.
        */}
        <IdleLogout idleSeconds={sessionIdleSeconds()} adminPath={adminPath} />
      </div>
      </EditLockProvider>
      </ModuleFlagsProvider>
    </AdminNavProvider>
  );
}
