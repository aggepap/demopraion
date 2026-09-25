/**
 * Pure projection of a product document's `data` into the props the
 * `ProductShowcase` buy box needs (addendum §6 — shared by the product page and
 * the quick-view modal so their gallery/variation handling can't drift).
 *
 * Client-safe: no server imports. Resolves media uuids to the public media URL
 * and per-locale labels inline. The async/aggregate parts (badges, quantity
 * rules, grouped components, reviews) stay with the caller.
 */
import type { ShowcaseAttribute, ShowcaseImage, ShowcaseVariation } from './ProductShowcase';

type Localized = string | Record<string, string> | undefined;

const mediaUrl = (uuid: string) => `/api/cms/media/file/${uuid}`;

function resolveLoc(v: Localized, locale: string, defaultLocale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = (l: string) => (typeof v[l] === 'string' && v[l].trim() ? v[l] : undefined);
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return (pick(locale) || pick(defaultLocale) || any || '').trim();
  }
  return '';
}

interface RawGalleryImage {
  image?: string;
  alt?: string;
}
interface RawAttrValue {
  id?: string;
  label?: Localized;
  color?: string;
  image?: string;
  gallery?: RawGalleryImage[];
}
interface RawAttribute {
  id?: string;
  name?: Localized;
  swatchType?: string;
  values?: RawAttrValue[];
}
interface RawVariation {
  id?: string;
  options?: Record<string, string>;
  price?: number;
  stock?: number;
  sku?: string;
  enabled?: boolean;
  image?: string;
}

export interface ShowcaseData {
  title: string;
  subtitle?: string;
  images: ShowcaseImage[];
  attributes: ShowcaseAttribute[];
  variations: ShowcaseVariation[];
  basePrice: number;
  compareAt?: number;
  availability: string;
  productType: string;
  /** External / affiliate CTA, when set. */
  external?: { url: string; label: string };
  /** Digital download file names, when set. */
  digital?: { includes: string[] };
  /** Every distinct image URL (base + variant galleries), for JSON-LD. */
  allImageUrls: string[];
}

export interface ProjectShowcaseOptions {
  locale: string;
  defaultLocale: string;
}

/** Map a product document's `data` into showcase props for `locale`. */
export function projectShowcase(
  data: Record<string, unknown>,
  { locale, defaultLocale }: ProjectShowcaseOptions,
): ShowcaseData {
  const title = String(data.title ?? '');
  const gallery = (Array.isArray(data.gallery) ? data.gallery : []) as RawGalleryImage[];
  const attributes = (Array.isArray(data.attributes) ? data.attributes : []) as RawAttribute[];
  const variations = (Array.isArray(data.variations) ? data.variations : []) as RawVariation[];

  const images: ShowcaseImage[] = gallery
    .filter((g) => g.image)
    .map((g) => ({ url: mediaUrl(g.image!), alt: g.alt || title }));

  const showcaseAttributes: ShowcaseAttribute[] = attributes
    .filter((a) => typeof a.id === 'string' && a.id && (a.values?.length ?? 0) > 0)
    .map((a) => ({
      id: a.id!,
      name: resolveLoc(a.name, locale, defaultLocale),
      swatchType: a.swatchType || 'button',
      values: (a.values ?? [])
        .filter((v) => typeof v.id === 'string' && v.id)
        .map((v) => ({
          id: v.id!,
          label: resolveLoc(v.label, locale, defaultLocale) || v.id!,
          color: v.color,
          imageUrl: v.image ? mediaUrl(v.image) : undefined,
          gallery: (Array.isArray(v.gallery) ? v.gallery : [])
            .filter((g) => g.image)
            .map((g) => ({ url: mediaUrl(g.image!), alt: g.alt || title })),
        })),
    }));

  const showcaseVariations: ShowcaseVariation[] = variations.map((v) => ({
    id: String(v.id ?? ''),
    options: v.options && typeof v.options === 'object' ? v.options : {},
    price: v.price != null ? Number(v.price) : undefined,
    stock: v.stock != null ? Number(v.stock) : undefined,
    sku: v.sku ? String(v.sku) : undefined,
    enabled: v.enabled,
    imageUrl: v.image ? mediaUrl(String(v.image)) : undefined,
  }));

  const variantImageUrls = showcaseAttributes.flatMap((a) => a.values.flatMap((v) => v.gallery ?? [])).map((g) => g.url);
  const allImageUrls = [...new Set([...images.map((i) => i.url), ...variantImageUrls])];

  const productType = String(data.productType ?? 'standard');

  let external: ShowcaseData['external'];
  if (productType === 'external' && typeof data.externalUrl === 'string' && data.externalUrl.trim()) {
    external = { url: data.externalUrl.trim(), label: resolveLoc(data.externalLabel as Localized, locale, defaultLocale) };
  }

  let digital: ShowcaseData['digital'];
  if (productType === 'digital') {
    const files = (Array.isArray(data.downloadFiles) ? data.downloadFiles : []) as { name?: string }[];
    digital = { includes: files.map((f) => String(f?.name ?? '').trim()).filter(Boolean) };
  }

  return {
    title,
    subtitle: data.subtitle ? String(data.subtitle) : undefined,
    images,
    attributes: showcaseAttributes,
    variations: showcaseVariations,
    basePrice: Number(data.price ?? 0),
    compareAt: data.compareAtPrice != null ? Number(data.compareAtPrice) : undefined,
    availability: String(data.availability ?? 'in-stock'),
    productType,
    external,
    digital,
    allImageUrls,
  };
}
