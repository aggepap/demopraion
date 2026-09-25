import Link from 'next/link';

import { adminHref } from '@/cms/admin/admin-path';
import { getAdminPath } from '@/cms/core/paths';

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold text-neutral-900">403 — Forbidden</h1>
      <p className="text-sm text-neutral-600">You don’t have permission to view this page.</p>
      <Link href={adminHref(getAdminPath())} className="text-sm text-neutral-800 underline">
        Back to dashboard
      </Link>
    </div>
  );
}
