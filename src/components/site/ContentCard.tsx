import Image from 'next/image';

import { Link } from '@/lib/i18n/routing';
import { mediaUrl, type ContentEntry } from '@/lib/site/content';

/**
 * One entry in a content listing — an article, an answer, a case study.
 *
 * The same markup used to be written out twice, in the index template and the
 * category template, which is how a card gains a fix in one listing and not the
 * other. `segment` is the collection's URL prefix (`blog`, `faq`,
 * `case-studies`), so one component serves all three.
 */
export function ContentCard({ entry, segment }: { entry: ContentEntry; segment: string }) {
  return (
    <article className="flex h-full flex-col">
      {entry.image ? (
        <Image
          src={mediaUrl(entry.image)}
          alt=""
          width={800}
          height={450}
          sizes="(max-width: 640px) 100vw, 33vw"
          className="mb-4 aspect-video w-full rounded-sm object-cover"
        />
      ) : null}
      {entry.eyebrow ? (
        <p className="text-xs uppercase tracking-wider-2 text-text-muted">{entry.eyebrow}</p>
      ) : null}
      <h2 className="mt-1 font-display text-xl font-semibold text-midnight-navy">
        <Link href={`/${segment}/${entry.slug}`} className="hover:underline underline-offset-4">
          {entry.title}
        </Link>
      </h2>
      {entry.summary ? <p className="mt-2 text-text-muted line-clamp-3">{entry.summary}</p> : null}
    </article>
  );
}
