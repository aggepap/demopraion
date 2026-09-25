import { CookiesManager } from '@/cms/admin';
import { listCookieCatalog } from '@/cms/core/cookies/service';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export const dynamic = 'force-dynamic';

export default async function CookiesPage() {
  await requirePerm(PERMISSIONS.settingsRead);
  const catalog = await listCookieCatalog();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Cookies</h1>
      <CookiesManager initial={JSON.parse(JSON.stringify(catalog))} />
    </div>
  );
}
