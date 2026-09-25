import { getTranslations } from 'next-intl/server';

import { ButtonLink } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';

/** The 404 body, shared by `not-found.tsx` and `/page-not-found`. */
export async function NotFoundContent() {
  const t = await getTranslations('notFound');
  return (
    <section className="w-full py-24 md:py-40">
      <div className="max-w-7xl mx-auto px-6">
        <Eyebrow className="mb-4">{t('eyebrow')}</Eyebrow>
        <h1 className="font-display font-semibold tracking-tight leading-[1.05] text-4xl sm:text-5xl max-w-3xl text-midnight-navy">
          {t('h1')}
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-text-muted max-w-2xl">{t('body')}</p>
        <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <ButtonLink href="/" variant="primary" size="md">
            {t('ctaHome')}
          </ButtonLink>
          <ButtonLink href="/contact" variant="secondary" size="md">
            {t('ctaContact')}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
