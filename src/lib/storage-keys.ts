import { storageKeys } from '@/cms/core/cookies/storage-keys';

/**
 * This site's browser-storage prefix, and the keys derived from it.
 *
 * `site.config.ts` passes the same prefix to `defineConfig`, which is what the
 * cookie declaration on /legal/cookies publishes; the components that write the
 * keys import them from here. Changing it on a live site empties returning
 * visitors' carts and re-asks their cookie consent.
 */
export const STORAGE_PREFIX = 'demo-site';

export const STORAGE_KEYS = storageKeys(STORAGE_PREFIX);
