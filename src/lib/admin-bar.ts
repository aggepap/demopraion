/**
 * The front-end admin bar: who sees it and where its links go.
 *
 * Pure so the layout, the per-page edit target and the tests all agree. The bar
 * is convenience only — every link it offers lands on an admin screen that runs
 * its own permission guard, so hiding or showing it is never access control.
 */
import { hasPerm, PERMISSIONS } from '@/cms/modules/auth/permissions';

export type AdminBarLocale = 'el' | 'en';

export interface AdminBarModel {
  /** Null when the bar is shown only to get out of preview mode (see below). */
  admin: {
    href: string;
    userName: string;
    /** Mirrors the edit screen's own guard (`cms.content.read`). */
    canEdit: boolean;
  } | null;
  locale: AdminBarLocale;
  /** Next draft mode is on: the page may be showing unpublished content. */
  preview: boolean;
}

interface SessionUser {
  name: string;
  permissions: readonly string[];
  locale: string;
}

interface RequestState {
  preview: boolean;
  /** The page's locale — labels for a bar with no admin session behind it. */
  siteLocale: string;
}

const barLocale = (locale: string): AdminBarLocale => (locale === 'en' ? 'en' : 'el');

/** What an admin session unlocks in the bar; null for anyone else. */
export function adminAccessFor(
  user: SessionUser | null,
  adminPath: string,
): AdminBarModel['admin'] {
  if (!user || !hasPerm(user.permissions, PERMISSIONS.access)) return null;
  return {
    href: `/${adminPath}`,
    userName: user.name,
    canEdit: hasPerm(user.permissions, PERMISSIONS.contentRead),
  };
}

export function adminBarFor(
  user: SessionUser | null,
  adminPath: string,
  { preview, siteLocale }: RequestState,
): AdminBarModel | null {
  const admin = adminAccessFor(user, adminPath);
  if (user && admin) return { admin, locale: barLocale(user.locale), preview };
  // The draft cookie outlives the admin session (sign out mid-preview and it
  // stays), and it keeps serving drafts. Whoever holds it still needs a way
  // out — but gets nothing else, not even the admin path.
  if (preview) return { admin: null, locale: barLocale(siteLocale), preview };
  return null;
}

export interface EditableDocument {
  type: string;
  id: number;
  locale: string;
}

/** The generic editor route, `/{admin}/{collection}/{id}`, opened on this
 *  document's language tab. */
export function adminEditHref(adminPath: string, doc: EditableDocument): string {
  return `/${adminPath}/${encodeURIComponent(doc.type)}/${doc.id}?locale=${encodeURIComponent(doc.locale)}`;
}

/** Leaves draft mode and lands back on `path`. The route runs the target
 *  through `safeRedirectPath`, so this cannot become an open redirect. */
export function exitPreviewHref(path: string | null): string {
  return `/api/cms/preview/disable?redirect=${encodeURIComponent(path || '/')}`;
}
