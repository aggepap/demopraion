import 'server-only';

import { getBrand } from '@/cms/core/brand';
import config from '@/site.config';

/**
 * The site's brand, as saved in Admin → Settings → Branding, with
 * `src/site.brand.ts` as the fallback for a database that has none yet.
 * Server components call this; client components use `useBrand()`.
 */
export const siteBrand = () => getBrand(config.brand);
