import config from '@/site.config';
import { previewMdxAction } from '@/app/admin/actions/mdx-preview';
import { DocumentForm, labelText } from '@/cms/admin';
import { getCustomFieldsConfig, getSeoFieldsFor, mergeCustomFields } from '@/cms/core';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { getAdminPath } from '@/cms/core/paths';
import { resolveAdminCollection } from '@/lib/cms/collection-route';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';

export default async function NewDocumentPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection: key } = await params;
  const base = resolveAdminCollection(key, '/new');

  const user = await requirePerm(PERMISSIONS.contentWrite);
  // Publishing is a separate permission, so the form must know: without it,
  // offering the statuses the server will refuse is a dead end.
  const canPublish = hasPerm(user.permissions, PERMISSIONS.contentPublish);

  // Admin-defined custom fields are merged in here (and their definitions
  // passed along) so category-scoped fields appear as soon as the editor picks
  // a category, not only after the first save.
  const [{ editing }, collection, customFields, seoFields] = await Promise.all([
    getLocaleSettings(),
    mergeCustomFields(config, base),
    getCustomFieldsConfig(key),
    getSeoFieldsFor(base),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">
        New {labelText(collection.label, config.defaultLocale, key)}
      </h1>
      <DocumentForm
        renderMdxPreview={previewMdxAction}
        adminPath={getAdminPath()}
        collection={collection}
        locales={editing}
        defaultLocale={config.defaultLocale}
        canPublish={canPublish}
        customFields={customFields}
        seoFields={seoFields}
      />
    </div>
  );
}
