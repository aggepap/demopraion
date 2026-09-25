/**
 * Write-boundary validation for the settings that are not plain text.
 *
 * Three managed keys hold structured JSON rather than a string: the shipping
 * configuration, the coupon list, and the admin-defined custom fields. The
 * settings route validated the typed keys and let these three through untouched —
 * its own comment said so, leaving their shape "to their existing sanitisers",
 * which run on *read*. So the database would accept any JSON at all, and the only
 * thing keeping the admin working was that every reader coerced defensively.
 *
 * That is the same assumption that failed for the gift-wrap fee (F-032): "3,50"
 * stored happily and the reader turned it into 0, which meant free gift wrapping
 * with nothing on screen to say so. Coercion at read time hides bad data instead
 * of refusing it.
 *
 * Two strategies, chosen per key rather than uniformly:
 *
 * - Shipping and coupons get a schema here. Their shapes are small, stable, and —
 *   in shipping's case — barely checked on read at all: `getShippingConfig`
 *   coerces the top level but passes `weightTiers`, `zones` and
 *   `paymentSurcharges` through as-is whenever they are arrays, so a zone with a
 *   missing country list reaches the shipping calculation.
 * - Custom fields are validated by running the sanitiser that already owns their
 *   rules, and storing its result. A second description of that shape in zod
 *   would be a copy free to drift from the one the readers actually use; this way
 *   every field is checked by the one function that knows what a field may be,
 *   and what is stored is exactly what a reader would have accepted.
 */
import { z } from 'zod';

import {
  BRAND_IDENTITY_KEY,
  BRAND_PALETTE_KEY,
  brandIdentitySchema,
  brandPaletteSchema,
} from '../brand/policy';
import { sanitizeCustomFieldsConfig } from '../fields/definitions';
import { sanitizeSeoFieldOverrides } from '../seo/field-overrides';
import { SCHEMA_POLICY_KEY, schemaPolicySchema } from '../structured-data/policy';
import {
  CUSTOM_FIELDS_KEY,
  ECOMMERCE_WISHLIST_KEY,
  ECOMMERCE_GIFTCARDS_KEY,
  GOOGLE_REVIEWS_KEY,
  SEO_FIELDS_KEY,
  ECOMMERCE_COUPONS_KEY,
  ECOMMERCE_SHIPPING_KEY,
} from './schema';

/** A charge in major units. Coerced because a form field produces a string, and
 *  never negative — every one of these is an amount added, not a discount. */
const charge = z.coerce.number().finite().min(0);

const couponSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    type: z.enum(['percent', 'fixed']),
    // The percentage bound is enforced below, where the type is known.
    value: charge,
    minSubtotal: charge,
    /** `YYYY-MM-DD`, or empty for "never expires". */
    expiresAt: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
    usageLimit: z.coerce.number().int().min(0),
    perCustomerLimit: z.coerce.number().int().min(0),
    active: z.boolean(),
  })
  .strict()
  .refine((c) => c.type !== 'percent' || c.value <= 100, {
    message: 'A percentage discount cannot exceed 100.',
    path: ['value'],
  });

const couponsSchema = z.array(couponSchema).max(500).superRefine((list, ctx) => {
  // Two rows with the same code is not a shape error but it is always a mistake:
  // `validateCoupon` resolves with `.find()`, so the first silently wins and the
  // other is dead configuration nobody can see is dead.
  const seen = new Set<string>();
  list.forEach((c, i) => {
    const key = c.code.trim().toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate coupon code "${c.code}" — only the first would ever apply.`,
        path: [i, 'code'],
      });
    }
    seen.add(key);
  });
});

const pickupLocationSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(191),
    address: z.string().trim().max(255).optional(),
    hours: z.string().trim().max(191).optional(),
  })
  .strict();

const shippingSchema = z
  .object({
    method: z.enum(['flat', 'weight', 'zone']),
    baseCharge: charge,
    freeThreshold: charge,
    weightTiers: z
      .array(z.object({ minWeight: charge, charge }).strict())
      .max(50),
    zones: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(191),
            // The reader does not check this, and the calculation calls
            // `.includes()` on it.
            countries: z.array(z.string().trim().min(2).max(8)).max(300),
            charge,
          })
          .strict(),
      )
      .max(100)
      .superRefine((zones, ctx) => {
        /*
         * A country in two zones is the same mistake as a duplicate coupon code, and
         * was refused for coupons but not here.
         *
         * `calculateShipping` resolves the zone with `.find()`, so the first listing a
         * country wins and every later one is dead configuration that reads as live.
         * An admin who adds a cheaper zone for a country already covered by an
         * expensive one sees it saved, sees it in the list, and quotes the old price
         * for as long as nobody works out why. Compared case-insensitively and trimmed,
         * because that is how the resolver compares them.
         */
        const owner = new Map<string, string>();
        zones.forEach((zone, zi) => {
          (zone.countries ?? []).forEach((raw, ci) => {
            const country = raw.trim().toLowerCase();
            const first = owner.get(country);
            if (first !== undefined) {
              ctx.addIssue({
                code: 'custom',
                message:
                  `"${raw}" is already in the zone "${first}", so this zone would never ` +
                  `apply to it — shipping uses the first zone that lists a country.`,
                path: [zi, 'countries', ci],
              });
              return;
            }
            owner.set(country, zone.name);
          });
        });
      }),
    paymentSurcharges: z
      .array(z.object({ provider: z.string().trim().min(1).max(64), charge }).strict())
      .max(50)
      .superRefine((rows, ctx) => {
        /*
         * Two surcharges for one provider is the third instance of this same mistake, and
         * the only array in this schema that had not been given the check: coupons refuse a
         * duplicate code (F-043), zones refuse an overlapping country (F-071), and
         * `calculateShipping` resolves the surcharge with `.find()` exactly as those do —
         * so the first row silently wins and the second is dead configuration that reads as
         * live. Easy to do by accident, too: "+ Add surcharge" defaults to the first
         * provider on every click, so clicking it twice produces this without touching the
         * dropdown.
         */
        const seen = new Map<string, number>();
        rows.forEach((row, i) => {
          const key = row.provider.trim().toLowerCase();
          const first = seen.get(key);
          if (first !== undefined) {
            ctx.addIssue({
              code: 'custom',
              message:
                `There is already a surcharge for "${row.provider}" (row ${first + 1}), so this ` +
                `one would never apply — only the first is used.`,
              path: [i, 'provider'],
            });
            return;
          }
          seen.set(key, i);
        });
      }),
    pickup: z
      .object({
        enabled: z.boolean(),
        charge,
        locations: z.array(pickupLocationSchema).max(200),
      })
      .strict(),
  })
  .strict();

export type StructuredCheck =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** First zod issue, as one readable sentence naming where it is. */
function firstIssue(label: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? ` at ${issue.path.join('.')}` : '';
  return `${label}${where}: ${issue.message}`;
}

/**
 * The wishlist config. `maxItems` is bounded here as well as on read: a cap of
 * a million would be stored happily and then quietly clamped, which is the
 * "coerced on read" habit this file exists to end.
 */
/**
 * The Google reviews config. Locations are addressed by slug from a shortcode,
 * so a slug that could never be typed is refused rather than stored.
 */
const googleReviewsSchema = z
  .object({
    enabled: z.boolean(),
    minRating: z.coerce.number().int().min(1).max(5),
    sort: z.enum(['newest', 'rating']),
    locations: z
      .array(
        z
          .object({
            slug: z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase letters, numbers and dashes'),
            label: z.string().trim().min(1).max(191),
            source: z.enum(['gbp', 'places']),
            placeId: z.string().trim().max(191).default(''),
            resourceName: z.string().trim().max(191).default(''),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

/** The gift card config. Amounts are minor units, and bounded: a preset of a
 *  million euro is a typo, not an offer. */
const giftCardsSchema = z
  .object({
    enabled: z.boolean(),
    presets: z.array(z.coerce.number().int().min(1).max(100_000_00)).max(12),
    allowCustom: z.boolean(),
    minAmount: z.coerce.number().int().min(1).max(100_000_00),
    maxAmount: z.coerce.number().int().min(1).max(100_000_00),
    /** 0 = never expires. */
    expiryMonths: z.coerce.number().int().min(0).max(120),
  })
  .strict()
  .refine((config) => config.maxAmount >= config.minAmount, {
    message: 'The largest amount cannot be below the smallest.',
    path: ['maxAmount'],
  });

const wishlistSchema = z
  .object({
    enabled: z.boolean(),
    maxItems: z.coerce.number().int().min(1).max(200),
    trackStats: z.boolean(),
  })
  .strict();

/**
 * Validate one structured key, returning the value to store.
 *
 * `undefined` means "not a structured key" — the caller carries on with its own
 * checks. Anything else is either a clean value or a refusal with a message that
 * names the field, which is what makes a bad save fixable rather than mysterious.
 */
export function checkStructuredSetting(key: string, value: unknown): StructuredCheck | undefined {
  if (key === ECOMMERCE_COUPONS_KEY) {
    const parsed = couponsSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Coupons', parsed.error) };
  }

  if (key === GOOGLE_REVIEWS_KEY) {
    const parsed = googleReviewsSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Google reviews', parsed.error) };
  }

  if (key === ECOMMERCE_GIFTCARDS_KEY) {
    const parsed = giftCardsSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Gift cards', parsed.error) };
  }

  if (key === BRAND_IDENTITY_KEY) {
    const parsed = brandIdentitySchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Branding', parsed.error) };
  }

  if (key === SCHEMA_POLICY_KEY) {
    const parsed = schemaPolicySchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Structured data', parsed.error) };
  }

  if (key === BRAND_PALETTE_KEY) {
    const parsed = brandPaletteSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Brand colours', parsed.error) };
  }

  if (key === ECOMMERCE_WISHLIST_KEY) {
    const parsed = wishlistSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Wishlist settings', parsed.error) };
  }

  if (key === ECOMMERCE_SHIPPING_KEY) {
    const parsed = shippingSchema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: firstIssue('Shipping settings', parsed.error) };
  }

  if (key === CUSTOM_FIELDS_KEY) {
    // Shaped `Record<collectionKey, CustomFieldsConfig>`, so each collection's
    // config goes through the sanitiser that owns the rules for a field.
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'Custom fields must be an object keyed by collection.' };
    }
    const out: Record<string, unknown> = {};
    for (const [collection, config] of Object.entries(value as Record<string, unknown>)) {
      out[collection] = sanitizeCustomFieldsConfig(config);
    }
    return { ok: true, value: out };
  }

  if (key === SEO_FIELDS_KEY) {
    // Same strategy as the custom fields: validate by running the sanitiser
    // that owns the rules and store its output, so there is no second
    // description of the shape free to drift from the one readers use.
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'SEO field settings must be an object.' };
    }
    return { ok: true, value: sanitizeSeoFieldOverrides(value) };
  }

  return undefined;
}
