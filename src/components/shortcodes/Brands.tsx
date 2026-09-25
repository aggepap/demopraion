import { listPublishedDocuments } from '@/cms/core/read';
import { Link } from '@/lib/i18n/routing';
import { safeHref } from '@/components/ui/Button';

/**
 * The brand logos, from the `brand` collection.
 *
 * A server component: the logos are content, so they are read at render time
 * and cached with the page rather than fetched in the browser.
 */
export async function Brands({
  layout = 'row',
  limit = 12,
  locale = 'el',
}: {
  layout?: 'row' | 'grid';
  limit?: number;
  locale?: string;
}) {
  const docs = await listPublishedDocuments('brand', locale, { limit });
  if (docs.length === 0) return null;

  return (
    <ul
      className={
        layout === 'grid'
          ? 'my-6 grid grid-cols-2 items-center gap-6 sm:grid-cols-4'
          : 'my-6 flex flex-wrap items-center justify-center gap-8'
      }
    >
      {docs.slice(0, limit).map((doc) => {
        const data = doc.data as Record<string, unknown>;
        const title = String(data.title ?? '');
        const logo = typeof data.logo === 'string' ? data.logo : '';
        const url = typeof data.url === 'string' ? data.url : '';
        const image = logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a CMS media route, not a static asset
          <img
            src={`/api/cms/media/file/${encodeURIComponent(logo)}`}
            alt={title}
            className="h-10 w-auto object-contain opacity-80 transition-opacity hover:opacity-100"
          />
        ) : (
          <span className="font-body text-text-muted text-sm">{title}</span>
        );
        return (
          <li key={doc.id} className="flex items-center justify-center">
            {url ? (
              <Link href={safeHref(url)} target="_blank" rel="noopener noreferrer">
                {image}
              </Link>
            ) : (
              image
            )}
          </li>
        );
      })}
    </ul>
  );
}
