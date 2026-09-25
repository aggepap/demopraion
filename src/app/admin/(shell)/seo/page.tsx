import { SeoManager } from '@/cms/admin';
import { list404, listMeta, listRedirects } from '@/cms/core/seo/service';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export default async function SeoPage() {
  await requirePerm(PERMISSIONS.seoRead);
  const [redirects, notFounds, metas] = await Promise.all([listRedirects(), list404(), listMeta()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">SEO</h1>
      <SeoManager
        redirects={JSON.parse(JSON.stringify(redirects))}
        notFounds={JSON.parse(JSON.stringify(notFounds))}
        metas={JSON.parse(JSON.stringify(metas))}
      />
    </div>
  );
}
