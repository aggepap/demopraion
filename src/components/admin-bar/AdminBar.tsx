'use client';

import { Eye, LayoutDashboard, Pencil, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { exitPreviewHref, type AdminBarLocale, type AdminBarModel } from '@/lib/admin-bar';

const LABELS: Record<
  AdminBarLocale,
  { bar: string; admin: string; edit: string; preview: string; exitPreview: string }
> = {
  el: {
    bar: 'Εργαλεία διαχειριστή',
    admin: 'Διαχείριση',
    edit: 'Επεξεργασία',
    preview: 'Προεπισκόπηση',
    exitPreview: 'Έξοδος',
  },
  en: {
    bar: 'Admin tools',
    admin: 'Admin',
    edit: 'Edit',
    preview: 'Preview',
    exitPreview: 'Exit preview',
  },
};

const LINK_CLASS =
  'inline-flex items-center gap-1.5 hover:text-warm-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-2 focus-visible:ring-offset-midnight-navy';

type SetEditHref = (update: (current: string | null) => string | null) => void;

/** Null outside an admin session, so an edit target on a visitor's page is inert. */
const EditTargetContext = createContext<SetEditHref | null>(null);

export function AdminBarView({
  bar,
  editHref,
  path,
}: {
  bar: AdminBarModel;
  editHref: string | null;
  /** The page being viewed — where "exit preview" returns to. */
  path: string | null;
}) {
  const t = LABELS[bar.locale];
  const admin = bar.admin;
  return (
    <nav aria-label={t.bar} className="bg-midnight-navy text-soft-pearl font-body text-sm">
      <div className="max-w-7xl mx-auto px-6 h-9 flex items-center gap-6">
        {admin ? (
          <a href={admin.href} className={LINK_CLASS}>
            <LayoutDashboard aria-hidden className="h-4 w-4" />
            {t.admin}
          </a>
        ) : null}
        {admin?.canEdit && editHref ? (
          <a href={editHref} className={LINK_CLASS}>
            <Pencil aria-hidden className="h-4 w-4" />
            {t.edit}
          </a>
        ) : null}
        {bar.preview ? (
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-warm-gold px-2 py-0.5 text-xs font-medium uppercase tracking-wider-2 text-midnight-navy">
              <Eye aria-hidden className="h-3.5 w-3.5" />
              {t.preview}
            </span>
            {/* A plain link, not a fetch: the route turns draft mode off and
                redirects, so a full navigation reloads the published page. */}
            <a href={exitPreviewHref(path)} className={LINK_CLASS}>
              <X aria-hidden className="h-4 w-4" />
              {t.exitPreview}
            </a>
          </span>
        ) : null}
        {admin ? (
          <span className="ml-auto truncate text-soft-pearl/70">{admin.userName}</span>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * Puts the admin bar above the page and lets the page below name the document
 * it shows. `bar` is null for everyone who is neither an admin nor in preview
 * mode, and then this renders the page alone — no bar, no context.
 */
export function AdminBarProvider({ bar, children }: { bar: AdminBarModel | null; children: ReactNode }) {
  const [editHref, setEditHref] = useState<string | null>(null);
  const path = usePathname();
  if (!bar) return <>{children}</>;
  return (
    <EditTargetContext.Provider value={setEditHref}>
      <AdminBarView bar={bar} editHref={editHref} path={path} />
      {children}
    </EditTargetContext.Provider>
  );
}

/**
 * Registers the current page's edit link with the bar. The layout renders
 * before the page knows which document it holds, so the page reports it up;
 * leaving the page clears it — unless the next page already replaced it.
 */
export function RegisterEditTarget({ href }: { href: string }) {
  const setEditHref = useContext(EditTargetContext);
  useEffect(() => {
    if (!setEditHref) return;
    setEditHref(() => href);
    return () => setEditHref((current) => (current === href ? null : current));
  }, [setEditHref, href]);
  return null;
}
