import type { ProductSort } from '@/cms/modules/commerce';

/** Raw shop query string (search, sort, page, price, `tag`, and `attr_<name>` keys). */
export type ShopSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedShopParams {
  q: string;
  sort: ProductSort;
  page: number;
  minPrice?: number;
  maxPrice?: number;
  /** For the query: attribute name → selected values. */
  attrs: Record<string, string[]>;
  /** Selected tag slugs (`tag=a,b`). */
  tags: string[];
  /** For the price inputs (kept as strings). */
  minStr: string;
  maxStr: string;
}

const str = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

/** Parse the shop/category query string into search + filter options. */
export function parseShopParams(sp: ShopSearchParams): ParsedShopParams {
  const attrs: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(sp)) {
    if (key.startsWith('attr_')) {
      const values = str(val)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (values.length) attrs[key.slice(5)] = values;
    }
  }

  const minStr = str(sp.price_min).trim();
  const maxStr = str(sp.price_max).trim();
  const tags = str(sp.tag)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    q: str(sp.q).trim(),
    sort: (str(sp.sort) || 'newest') as ProductSort,
    page: Math.max(1, Number(str(sp.page)) || 1),
    minPrice: minStr ? Number(minStr) : undefined,
    maxPrice: maxStr ? Number(maxStr) : undefined,
    attrs,
    tags,
    minStr,
    maxStr,
  };
}
