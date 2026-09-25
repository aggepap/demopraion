import type { ReactNode } from 'react';

import config from '@/site.config';
import {
  ApiTokensManager,
  BrandSettings,
  CouponsManager,
  CourierCredentials,
  CustomFieldsManager,
  GiftCardSettings,
  SeoFieldsManager,
  ShippingMethodsManager,
  ShippingSettings,
  SettingsForm,
  StructuredDataSettings,
  WishlistSettings,
  labelText,
  PRAION_TAB,
} from '@/cms/admin';
import {
  getAllCustomFields,
  getSeoFieldOverrides,
  getSettings,
  isModuleEnabled,
  listDocuments,
  MANAGED_SETTING_KEYS,
  resolveModuleFlags,
  type CustomFieldsConfig,
} from '@/cms/core';
import {
  COURIER_SECRET_DEFS,
  getCoupons,
  getGiftCardConfig,
  getShippingConfig,
  getSiteCurrency,
  getWishlistConfig,
  listShippingMethods,
  listShippingZones,
  paymentProviderKeys,
} from '@/cms/modules/commerce';
import { listSecretSummaries } from '@/cms/core/secrets/service';
// Side effect: attaches Stripe and PayPal to the registry, so the shipping
// screen can offer a surcharge row per provider that is actually selectable.
import '@/cms/core/payments/register';
import { listApiTokens } from '@/cms/core/tokens/service';
import { getBrand } from '@/cms/core/brand';
import type { BrandIdentity } from '@/cms/core/brand/policy';
import {
  availableSchemaCategories,
  getSchemaPolicy,
  schemaPolicyHints,
} from '@/cms/core/structured-data';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { getLocaleSettings } from '@/lib/i18n/locale-settings';

/**
 * Taxonomy-style collections — classifications rather than content, so they
 * don't get a Fields tab. Everything else that renders a public page does,
 * which means a new content collection is included automatically.
 */
const TAXONOMY_KEYS = new Set(['topic', 'author', 'category']);

/**
 * Collections an editor may extend with custom fields. The mechanism itself is
 * collection-agnostic (see `cms/core/fields`); this only decides which ones
 * surface a tab in the admin.
 */
function customFieldCollections(moduleFlags: Record<string, boolean>) {
  return config.collections.filter(
    (c) =>
      !c.hidden &&
      Boolean(c.routing.pathTemplate) &&
      !TAXONOMY_KEYS.has(c.key) &&
      (!c.module || moduleFlags[c.module])
  );
}

/**
 * Conditional visibility scopes a field to categories, which only means
 * something for a collection that actually carries a `categories` relation
 * (`documentCategoryIds` reads exactly that key). Collections without one get
 * no picker rather than a filter that could never match.
 */
function hasCategoryRelation(collection: { fields: { kind: string; key: string }[] }): boolean {
  return collection.fields.some((f) => f.kind === 'relation' && f.key === 'categories');
}

/** Resolve a category document's (possibly per-locale) title for the picker. */
function categoryLabel(data: Record<string, unknown>, locale: string, fallback: string): string {
  const title = data.title;
  if (typeof title === 'string' && title.trim()) return title;
  if (title && typeof title === 'object') {
    const map = title as Record<string, string>;
    const pick = map[locale] ?? Object.values(map).find((v) => typeof v === 'string' && v.trim());
    if (pick) return pick;
  }
  return fallback;
}

export default async function SettingsPage() {
  const user = await requirePerm(PERMISSIONS.settingsRead);

  const [settings, moduleFlags, localeSettings, commerceEnabled] = await Promise.all([
    getSettings(MANAGED_SETTING_KEYS),
    resolveModuleFlags(config),
    getLocaleSettings(),
    isModuleEnabled(config, 'commerce'),
  ]);

  // Bespoke editors that live inside a module's own settings tab, keyed by tab
  // name. A module that is switched off contributes no key, so its tab does not
  // exist at all.
  const moduleTabs: Record<string, { label: string; content: ReactNode }[]> = {};

  // Shipping + coupon config are sub-tabs of Settings → Ecommerce (no separate
  // sidebar items).
  if (commerceEnabled) {
    const [shipping, coupons, currency, wishlist, giftCards] = await Promise.all([
      getShippingConfig(),
      getCoupons(),
      getSiteCurrency(),
      getWishlistConfig(),
      getGiftCardConfig(),
    ]);
    /*
     * Shipping methods and courier credentials live in tables that arrived in a
     * migration, so a database a step behind answers "table doesn't exist".
     * Caught so the rest of the Shipping tab still works and the section says why.
     */
    let methodsData: {
      zones: Awaited<ReturnType<typeof listShippingZones>>;
      methods: Awaited<ReturnType<typeof listShippingMethods>>;
      couriers: Awaited<ReturnType<typeof listSecretSummaries>>;
    } | null = null;
    let methodsError: string | null = null;
    try {
      const [zones, methods, couriers] = await Promise.all([
        listShippingZones(),
        listShippingMethods(),
        listSecretSummaries(COURIER_SECRET_DEFS),
      ]);
      methodsData = { zones, methods, couriers };
    } catch (err) {
      methodsError = err instanceof Error ? err.message : 'unknown error';
    }
    moduleTabs.Ecommerce = [
      {
        label: 'Shipping',
        content: (
          <div className="flex flex-col gap-6">
            <ShippingSettings
              initial={JSON.parse(JSON.stringify(shipping))}
              currency={currency}
              paymentProviders={paymentProviderKeys()}
            />
            {methodsData ? (
              <>
                <ShippingMethodsManager
                  initialZones={JSON.parse(JSON.stringify(methodsData.zones))}
                  initialMethods={JSON.parse(JSON.stringify(methodsData.methods))}
                  currency={currency}
                  pickupLocations={shipping.pickup.locations.map((loc) => ({ id: loc.id, name: loc.name }))}
                />
                <CourierCredentials initial={methodsData.couriers} />
              </>
            ) : (
              <div
                role="alert"
                className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                Could not load the shipping methods: {methodsError}. If this database has not had{' '}
                <code>npm run db:migrate</code> run against it, that is why.
              </div>
            )}
          </div>
        ),
      },
      {
        label: 'Coupons',
        content: (
          <CouponsManager initial={JSON.parse(JSON.stringify(coupons))} currency={currency} />
        ),
      },
      {
        label: 'Wishlist',
        content: <WishlistSettings initial={wishlist} />,
      },
      {
        label: 'Gift cards',
        content: <GiftCardSettings initial={giftCards} currency={currency} />,
      },
    ];
  }

  /*
   * Settings → Fields.
   *
   * The first sub-tab is the built-in SEO/AEO set, which is site-wide: every
   * collection carries it, so a tab per collection would be the same list
   * fifteen times. The rest are the per-collection custom fields.
   */
  const seoOverrides = await getSeoFieldOverrides();
  const seoCollections = config.collections
    .filter((c) => !c.hidden && c.seo)
    .filter((c) => !c.module || moduleFlags[c.module])
    .map((c) => ({
      key: c.key,
      label: labelText(c.labelPlural, config.defaultLocale, c.key),
    }));

  const fieldsTabs: { label: string; content: ReactNode }[] = [
    {
      label: 'SEO & AEO',
      content: (
        <SeoFieldsManager
          initial={seoOverrides}
          locales={localeSettings.editing}
          collections={seoCollections}
        />
      ),
    },
  ];

  // One further sub-tab per collection that accepts admin-defined custom
  // fields, skipping any whose module is switched off.
  const eligible = customFieldCollections(moduleFlags);

  if (eligible.length > 0) {
    // Only fetch the category list if some eligible collection can scope by it.
    const needsCategories = eligible.some(hasCategoryRelation);
    const [storedFields, categoryDocs] = await Promise.all([
      getAllCustomFields(),
      needsCategories
        ? listDocuments('category', { locale: config.defaultLocale, pageSize: 100 })
        : Promise.resolve(null),
    ]);
    const categories = (categoryDocs?.items ?? []).map((doc) => ({
      id: doc.id,
      label: categoryLabel(doc.data, config.defaultLocale, doc.slug),
    }));

    fieldsTabs.push(
      ...eligible.map((collection) => ({
        label: labelText(collection.labelPlural, config.defaultLocale, collection.key),
        content: (
          <CustomFieldsManager
            collectionKey={collection.key}
            initial={storedFields as Record<string, CustomFieldsConfig>}
            locales={localeSettings.editing}
            // `seo` too: the SEO group is appended at runtime, so a custom
            // field of that name would be silently shadowed by it.
            reservedKeys={[...collection.fields.map((f) => f.key), 'seo']}
            collectionKeys={[...config.collectionByKey.keys()]}
            categories={hasCategoryRelation(collection) ? categories : []}
          />
        ),
      }))
    );
  }

  /*
   * Settings → Connect to Praion.ai.
   *
   * Its own permission, not `settingsRead`: a key imported here can rewrite
   * every published page on the site, so being allowed to read settings is not
   * enough to see or manage one. The tab simply does not exist without
   * `cms.tokens.manage` — and not at all with the `pm` bridge switched off,
   * which would offer to connect a system whose endpoints all answer 404.
   */
  const extraTabs: { label: string; content: ReactNode }[] = [];

  /*
   * Settings → Branding. The name, contact details, logo and colours, stored in
   * the database so a CMS update never overwrites them.
   */
  const brand = await getBrand(config.brand);
  const identity: BrandIdentity = {
    name: brand.name,
    legalName: brand.legalName,
    tagline: brand.tagline,
    email: brand.email,
    phone: brand.phone,
    address: brand.address,
    socials: brand.socials,
    logoId: brand.logoId,
    logoDarkId: brand.logoDarkId,
    faviconId: brand.faviconId,
    ogImageId: brand.ogImageId,
  };
  extraTabs.push({
    label: 'Branding',
    content: <BrandSettings initialIdentity={identity} initialPalette={brand.palette} />,
  });

  /*
   * Settings → Structured data. What each kind of content tells search engines
   * it is — one card per category this site actually has.
   */
  const [schemaPolicy, schemaHints] = await Promise.all([getSchemaPolicy(config), schemaPolicyHints(config)]);
  extraTabs.push({
    label: 'Structured data',
    content: (
      <StructuredDataSettings
        initial={schemaPolicy}
        categories={availableSchemaCategories({
          collectionKeys: [...config.collectionByKey.keys()],
          moduleFlags,
          // An empty setting means every kind, as in `getBookingKinds`.
          bookingKinds: schemaHints.bookingKinds?.length ? schemaHints.bookingKinds : undefined,
        })}
        brandHasAddress={Boolean(brand.address.street || brand.address.city)}
      />
    ),
  });

  if (moduleFlags.pm && hasPerm(user.permissions, PERMISSIONS.tokensManage)) {
    /*
     * The load is caught rather than allowed to throw.
     *
     * On its own route a failure here cost one screen; on this one it would take
     * down every settings tab with it — languages, modules, shipping — none of
     * which have anything to do with Praion.ai. The likely cause is also
     * mundane and self-inflicted: `cms_api_tokens` arrived in a migration, so
     * any database a step behind answers "table doesn't exist". The tab still
     * appears and says so, which is both narrower and more use than a 500.
     */
    // Only the query is guarded — building the JSX inside a `try` would catch
    // nothing anyway, since React renders it long after this function returns.
    let tokens: Awaited<ReturnType<typeof listApiTokens>> | null = null;
    let loadError: string | null = null;
    try {
      tokens = await listApiTokens();
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'unknown error';
    }

    extraTabs.push({
      label: PRAION_TAB,
      content: tokens ? (
        <ApiTokensManager initial={JSON.parse(JSON.stringify(tokens))} />
      ) : (
        <div
          role="alert"
          className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Could not load the connected keys: {loadError}. If this database has not had{' '}
          <code>npm run db:migrate</code> run against it, that is why.
        </div>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Settings</h1>
      <SettingsForm
        settings={settings}
        moduleFlags={moduleFlags}
        localeSettings={localeSettings}
        moduleTabs={moduleTabs}
        fieldsTabs={fieldsTabs}
        extraTabs={extraTabs}
      />
    </div>
  );
}
