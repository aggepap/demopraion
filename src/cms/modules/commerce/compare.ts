/**
 * Product comparison data (addendum §6). Projects a small set of products into
 * a side-by-side shape: header facts (image / price / availability) plus the
 * union of their attributes + specs as comparable rows. Read-only over the
 * published catalog.
 */
import 'server-only';

import { getProduct, getSiteCurrency } from './read';

type Localized = string | Record<string, string> | undefined;

function resolveLoc(v: Localized, locale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = v[locale];
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return String(pick ?? any ?? '').trim();
  }
  return '';
}

export interface CompareProduct {
  slug: string;
  title: string;
  /** Gallery-image uuid (the client builds the media URL). */
  image?: string;
  price: number;
  currency: string;
  availability: string;
  href: string;
  /** Attribute name → resolved value labels. */
  attributes: { name: string; values: string[] }[];
  /** Spec label → value. */
  specs: { label: string; value: string }[];
}

/** At most 4 products, projected for comparison; missing slugs are skipped. */
export async function getCompareData(slugs: string[], locale: string): Promise<CompareProduct[]> {
  const currency = await getSiteCurrency();
  const out: CompareProduct[] = [];

  for (const slug of slugs.slice(0, 4)) {
    const doc = await getProduct(slug, locale);
    if (!doc) continue;
    const data = doc.data as Record<string, unknown>;

    const gallery = Array.isArray(data.gallery) ? (data.gallery as { image?: string }[]) : [];
    const rawAttrs = Array.isArray(data.attributes)
      ? (data.attributes as { name?: Localized; values?: { label?: Localized }[] }[])
      : [];
    const attributes = rawAttrs
      .map((a) => ({
        name: resolveLoc(a.name, locale),
        values: (a.values ?? []).map((v) => resolveLoc(v.label, locale)).filter(Boolean),
      }))
      .filter((a) => a.name && a.values.length > 0);

    const rawSpecs = Array.isArray(data.specs) ? (data.specs as { label?: string; value?: string }[]) : [];
    const specs = rawSpecs
      .map((s) => ({ label: String(s.label ?? '').trim(), value: String(s.value ?? '').trim() }))
      .filter((s) => s.label && s.value);

    out.push({
      slug: doc.slug,
      title: String(data.title ?? doc.metaTitle ?? doc.slug),
      image: gallery.find((g) => g.image)?.image,
      price: Number(data.price ?? 0),
      currency,
      availability: String(data.availability ?? 'in-stock'),
      href: `/shop/${doc.slug}`,
      attributes,
      specs,
    });
  }
  return out;
}
