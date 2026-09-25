/**
 * The site's brand — who it is and what colours it wears — as data.
 *
 * Both live in `site_settings` and are edited in Admin → Settings → Branding, so a
 * CMS update (which replaces the core wholesale) can never repaint a live site, and
 * an owner never needs a deploy to change a phone number or an accent colour. Code
 * only supplies the defaults a fresh or unreachable database falls back to.
 *
 * Pure and client-safe: the admin screen, the settings validator, the read layer
 * and the email renderer all share these shapes, so there is exactly one answer to
 * "what is a valid brand".
 */
import { z } from 'zod';

/** `site_settings` key: name, contact details, socials and media references. */
export const BRAND_IDENTITY_KEY = 'brand.identity';
/** `site_settings` key: colour token → `#rrggbb`. */
export const BRAND_PALETTE_KEY = 'brand.palette';

/**
 * The colour tokens `globals.css` defines in `@theme`. The names are load-bearing
 * — the admin, shop and booking screens are styled with the utilities Tailwind
 * generates from them — so this list is fixed and only the values are editable.
 */
export const PALETTE_TOKENS = [
  {
    key: 'midnight-navy',
    group: 'Brand',
    label: 'Ink',
    hint: 'Dark surfaces: the footer and primary buttons.',
  },
  {
    key: 'warm-gold',
    group: 'Brand',
    label: 'Accent',
    hint: 'Highlights, eyebrows and hover states.',
  },
  {
    key: 'warm-gold-dark',
    group: 'Brand',
    label: 'Accent, darker',
    hint: 'Accent on hover and pressed.',
  },
  {
    key: 'warm-gold-deep',
    group: 'Brand',
    label: 'Accent text',
    hint: 'Accent-coloured text on a light background. Must stay readable (4.5:1).',
  },
  { key: 'soft-pearl', group: 'Surfaces', label: 'Page background', hint: 'Behind everything.' },
  {
    key: 'bone-cream',
    group: 'Surfaces',
    label: 'Raised surface',
    hint: 'Cards and subtle bands.',
  },
  { key: 'text-primary', group: 'Text', label: 'Main text', hint: 'Body copy and headings.' },
  {
    key: 'text-muted',
    group: 'Text',
    label: 'Secondary text',
    hint: 'Captions and supporting copy.',
  },
  {
    key: 'text-light',
    group: 'Text',
    label: 'Faint text',
    hint: 'Placeholders and disabled labels.',
  },
  {
    key: 'border-soft',
    group: 'Borders and states',
    label: 'Borders',
    hint: 'Dividers and input outlines.',
  },
  { key: 'error', group: 'Borders and states', label: 'Error', hint: 'Validation messages.' },
] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number]['key'];
export type Palette = Record<PaletteToken, string>;

const TOKEN_KEYS = new Set<string>(PALETTE_TOKENS.map((t) => t.key));
const isToken = (key: string): key is PaletteToken => TOKEN_KEYS.has(key);

/** The neutral values of the base `globals.css`. */
export const BASE_PALETTE: Palette = {
  'midnight-navy': '#111827',
  'warm-gold': '#6b7280',
  'warm-gold-dark': '#4b5563',
  'warm-gold-deep': '#374151',
  'soft-pearl': '#ffffff',
  'bone-cream': '#f3f4f6',
  'text-primary': '#111827',
  'text-muted': '#4b5563',
  'text-light': '#9ca3af',
  'border-soft': '#e5e7eb',
  error: '#b91c1c',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z
  .string()
  .regex(HEX, 'Use a six-digit colour such as #1b2430.')
  .transform((v) => v.toLowerCase());

/** Only the tokens sent are stored; the rest keep the stylesheet's values. */
export const brandPaletteSchema = z.record(z.string(), hex).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    if (!isToken(key))
      ctx.addIssue({ code: 'custom', path: [key], message: 'Not a colour this site uses.' });
  }
});

const text = (max: number) => z.string().trim().max(max);
const mediaRef = z.string().uuid().nullable();

export const brandIdentitySchema = z
  .object({
    name: z.string().trim().min(1, 'The site needs a name.').max(120),
    legalName: text(200),
    tagline: text(300),
    email: z.union([z.literal(''), z.string().trim().email()]),
    phone: text(40),
    address: z
      .object({ street: text(200), city: text(120), postcode: text(20), country: text(120) })
      .strict(),
    /** Network name → profile URL. http(s) only: these are rendered as links. */
    socials: z
      .record(
        z.string().regex(/^[a-z0-9-]{1,30}$/),
        z
          .string()
          .trim()
          .url()
          .max(500)
          .regex(/^https?:\/\//i)
      )
      .refine((s) => Object.keys(s).length <= 12, 'At most 12 social links.'),
    logoId: mediaRef,
    logoDarkId: mediaRef,
    faviconId: mediaRef,
    ogImageId: mediaRef,
  })
  .strict();

export type BrandIdentity = z.infer<typeof brandIdentitySchema>;

/** What code may supply as a fallback — typically `src/site.brand.ts`. */
export type BrandDefaults = Partial<Omit<BrandIdentity, 'address'>> & {
  address?: Partial<BrandIdentity['address']>;
};

/** The identity as the site reads it: stored, else code defaults, else empty. */
export function parseBrandIdentity(raw: unknown, defaults: BrandDefaults = {}): BrandIdentity {
  const stored = brandIdentitySchema.safeParse(raw);
  if (stored.success) return stored.data;
  return {
    name: defaults.name || 'Site',
    legalName: defaults.legalName ?? '',
    tagline: defaults.tagline ?? '',
    email: defaults.email ?? '',
    phone: defaults.phone ?? '',
    address: { street: '', city: '', postcode: '', country: '', ...defaults.address },
    socials: Object.fromEntries(Object.entries(defaults.socials ?? {}).filter(([, url]) => url)),
    logoId: defaults.logoId ?? null,
    logoDarkId: defaults.logoDarkId ?? null,
    faviconId: defaults.faviconId ?? null,
    ogImageId: defaults.ogImageId ?? null,
  };
}

/** Only the valid, known tokens of a stored value — never anything else. */
function storedTokens(raw: unknown): Partial<Palette> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Palette> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isToken(key) && typeof value === 'string' && HEX.test(value))
      out[key] = value.toLowerCase();
  }
  return out;
}

/** The full palette: stored tokens over the base. For emails and the admin form. */
export function parsePalette(raw: unknown): Palette {
  return { ...BASE_PALETTE, ...storedTokens(raw) };
}

/**
 * The stored tokens as CSS variables on `:root`.
 *
 * Only what is stored is emitted: with nothing saved the stylesheet's own values
 * stand. Every value has passed the hex check, so nothing here can close the
 * `<style>` element it is rendered into.
 */
export function paletteCss(raw: unknown): string {
  const entries = Object.entries(storedTokens(raw));
  if (entries.length === 0) return '';
  return `:root{${entries.map(([k, v]) => `--color-${k}:${v};`).join('')}}`;
}

const mediaUrl = (uuid: string | null): string | null =>
  uuid ? `/api/cms/media/file/${uuid}` : null;

/** The brand as the front end, admin and emails consume it. */
export interface SiteBrand extends BrandIdentity {
  /** `tel:` target derived from `phone` — digits and a leading `+`. */
  phoneHref: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
  palette: Palette;
}

export function resolveBrand(identity: BrandIdentity, palette: Palette): SiteBrand {
  return {
    ...identity,
    phoneHref: identity.phone.replace(/[^\d+]/g, ''),
    logoUrl: mediaUrl(identity.logoId),
    logoDarkUrl: mediaUrl(identity.logoDarkId),
    faviconUrl: mediaUrl(identity.faviconId),
    ogImageUrl: mediaUrl(identity.ogImageId),
    palette,
  };
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const luminance = (value: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(value.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
