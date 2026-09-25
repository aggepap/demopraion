/**
 * Every name `<Icon>` can draw — and so every value `collection.icon` accepts.
 *
 * `collection.icon` was documented as "any lucide name", while `Icon` only
 * maps the fixed set below and silently drew a generic document for anything
 * else. A typo, or a perfectly valid lucide name that simply is not bundled,
 * gave a wrong icon and no error. `Icon` now takes only these names, so `tsc`
 * catches a bad one at every call site, and `collection.icon` is typed
 * `IconName` too. `collectionIcon()` still falls back (and warns) for values
 * that reach it untyped. Bundling all of
 * lucide to honour the old promise would ship every icon to every admin page.
 *
 * To add one: import it in `Icon.tsx`, add it to the map there, and list its
 * name here — `Icon.tsx` types its map as `Record<IconName, …>`, so forgetting
 * either half fails to compile.
 *
 * Its own file with no imports so config types can use it without pulling a
 * client component (or lucide) into the config layer.
 */
export const ICON_NAMES = [
  'user-pen',
  'tags',
  'tag',
  'newspaper',
  'message-circle-question',
  'briefcase',
  'sailboat',
  'anchor',
  'map-pin',
  'folder-tree',
  'file-text',
  'shopping-bag',
  'dashboard',
  'submissions',
  'seo',
  'users',
  'roles',
  'audit',
  'media',
  'cookies',
  'code',
  'settings',
  'plus',
  'orders',
  'reviews',
  'abandoned',
  'newsletter',
  'bookings',
  'calendar',
  'ruler',
  'shipping',
  'coupons',
  'file-edit',
  'refresh-cw',
  'trash',
  'copy',
  'grip',
  'chevron-down',
  'chevron-up',
  'chevrons-up',
  'chevrons-down',
  'chevron-right',
  'eye',
  'eye-off',
  'menu',
  'x',
  'upload',
  'check',
  'search',
  'lock',
  'logout',
  'external',
  'arrow-left',
  'image',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value);
}

const warned = new Set<string>();

/**
 * A collection's `icon`, as something `<Icon>` can draw.
 *
 * `CollectionDefinition.icon` is still typed `string` (restricting it to
 * `IconName` touches every module's collection factory), so a name outside the
 * list can reach the admin. It is drawn as the generic document icon, as
 * before — but no longer silently: outside production it says which
 * collection asked for what, once.
 */
export function collectionIcon(icon: string | undefined, collectionKey?: string): IconName {
  if (icon === undefined || isIconName(icon)) return icon ?? 'file-text';
  if (process.env.NODE_ENV !== 'production' && !warned.has(icon)) {
    warned.add(icon);
    console.warn(
      `[cms] Unknown admin icon ${JSON.stringify(icon)}` +
        (collectionKey ? ` on collection "${collectionKey}"` : '') +
        ' — drawing "file-text". Use one of ICON_NAMES in src/cms/admin/ui/icon-names.ts.',
    );
  }
  return 'file-text';
}
