import { ScriptsManager } from '@/cms/admin';
import { listCookieCatalog } from '@/cms/core/cookies/service';
import { listSnippets } from '@/cms/core/scripts/service';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export const dynamic = 'force-dynamic';

export default async function ScriptsPage() {
  await requirePerm(PERMISSIONS.scriptsManage);
  const [snippets, catalog] = await Promise.all([listSnippets(), listCookieCatalog()]);
  // Required categories are always on, so waiting for one would be no gate at all.
  const categories = catalog
    .filter((category) => !category.required)
    .map((category) => ({
      key: category.key,
      name: category.name.en || category.name.el || category.key,
    }));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Scripts</h1>
      <ScriptsManager
        initial={snippets.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          kind: row.kind,
          code: row.code,
          src: row.src,
          lazy: row.lazy,
          consentCategory: row.consentCategory,
          enabled: row.enabled,
          notes: row.notes,
        }))}
        categories={categories}
      />
    </div>
  );
}
