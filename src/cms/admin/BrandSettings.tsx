'use client';

import { useState } from 'react';

import {
  BASE_PALETTE,
  BRAND_IDENTITY_KEY,
  BRAND_PALETTE_KEY,
  PALETTE_TOKENS,
  contrastRatio,
  type BrandIdentity,
  type Palette,
  type PaletteToken,
} from '../core/brand/policy';
import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { ColorControl } from './fields/FieldInput';
import { MediaPicker } from './fields/MediaPicker';
import { Button, Field, InfoTip, Section, TextInput } from './ui';

/**
 * Settings → Branding.
 *
 * Who the site is (name, contact details, logo) and the colours it wears. Both are
 * stored in the database rather than in the site's files, so they are the
 * owner's to change and a CMS update never touches them. A save is live on the
 * next page load — the palette is emitted as CSS variables at request time, not
 * compiled into the stylesheet.
 */

/** Text colours checked against both light surfaces, with the WCAG AA minimum. */
const CONTRAST_CHECKS: { token: PaletteToken; min: number }[] = [
  { token: 'text-primary', min: 4.5 },
  { token: 'text-muted', min: 4.5 },
  { token: 'warm-gold-deep', min: 4.5 },
];
const SURFACES: PaletteToken[] = ['soft-pearl', 'bone-cream'];

const labelOf = (token: PaletteToken) =>
  PALETTE_TOKENS.find((t) => t.key === token)?.label ?? token;

/** Readability problems in a palette, as sentences an owner can act on. */
function contrastProblems(palette: Palette): string[] {
  const problems: string[] = [];
  for (const { token, min } of CONTRAST_CHECKS) {
    for (const surface of SURFACES) {
      const ratio = contrastRatio(palette[token], palette[surface]);
      if (ratio < min) {
        problems.push(
          `${labelOf(token)} on ${labelOf(surface)} is ${ratio.toFixed(1)}:1 — below the ${min}:1 needed to read comfortably.`
        );
      }
    }
  }
  return problems;
}

const MEDIA_FIELDS: {
  key: 'logoId' | 'logoDarkId' | 'faviconId' | 'ogImageId';
  label: string;
  description: string;
}[] = [
  {
    key: 'logoId',
    label: 'Logo',
    description:
      'Shown in the header and at the top of emails. An SVG or a transparent PNG works best. Without one, the site name is shown as text.',
  },
  {
    key: 'logoDarkId',
    label: 'Logo on dark backgrounds',
    description: 'Optional. Used in the footer; falls back to the site name.',
  },
  {
    key: 'faviconId',
    label: 'Favicon',
    description: 'The small icon in the browser tab. A square image, at least 512×512.',
  },
  {
    key: 'ogImageId',
    label: 'Default share image',
    description:
      'Shown when a page without its own image is shared on social media. 1200×630 works everywhere.',
  },
];

/** Where the address goes — the reason to fill it in at all. */
const ADDRESS_HELP =
  "Shown on the contact page, and given to Google in the site’s structured data. A local business needs at least the street or the city.";

export function BrandSettings({
  initialIdentity,
  initialPalette,
}: {
  initialIdentity: BrandIdentity;
  initialPalette: Palette;
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [palette, setPalette] = useState(initialPalette);
  const [socials, setSocials] = useState(() => Object.entries(initialIdentity.socials));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof BrandIdentity>(key: K, value: BrandIdentity[K]) => {
    setIdentity((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  const setAddress = (key: keyof BrandIdentity['address'], value: string) =>
    set('address', { ...identity.address, [key]: value });
  const setColour = (token: PaletteToken, value: string) => {
    setPalette((prev) => ({ ...prev, [token]: value }));
    setSaved(false);
  };

  const problems = contrastProblems(palette);
  const groups = [...new Set(PALETTE_TOKENS.map((t) => t.group))];

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const cleanSocials = Object.fromEntries(
        socials
          .map(([network, url]) => [network.trim().toLowerCase(), url.trim()])
          .filter(([n, u]) => n && u)
      );
      await cmsApi.updateSiteSettings({
        [BRAND_IDENTITY_KEY]: { ...identity, socials: cleanSocials },
        [BRAND_PALETTE_KEY]: palette,
      });
      setSaved(true);
      // A full reload rather than `router.refresh()`: the admin wears the palette
      // too, and its `<style>` is only re-read on a fresh document.
      window.location.reload();
    } catch (err) {
      setError(apiErrorText(err, 'Could not save the branding.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Identity"
        description="The name and contact details visitors, search engines and emails see."
      >
        <div className="grid max-w-3xl gap-4 md:grid-cols-2">
          <Field
            label="Site name"
            required
            description="Page titles, the header, structured data and email."
          >
            <TextInput
              value={identity.name}
              maxLength={120}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field
            label="Legal name"
            description="The registered company name, for structured data. Optional."
          >
            <TextInput
              value={identity.legalName}
              maxLength={200}
              onChange={(e) => set('legalName', e.target.value)}
            />
          </Field>
          <Field
            label="Tagline"
            className="md:col-span-2"
            description="One line under the name — the default page description."
          >
            <TextInput
              value={identity.tagline}
              maxLength={300}
              onChange={(e) => set('tagline', e.target.value)}
            />
          </Field>
          <Field label="Email" description="The public contact address.">
            <TextInput
              type="email"
              value={identity.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Phone" description="As it should be shown, e.g. +30 210 123 4567.">
            <TextInput
              type="tel"
              value={identity.phone}
              maxLength={40}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label="Street" description={ADDRESS_HELP}>
            <TextInput
              value={identity.address.street}
              onChange={(e) => setAddress('street', e.target.value)}
            />
          </Field>
          <Field label="City" description={ADDRESS_HELP}>
            <TextInput
              value={identity.address.city}
              onChange={(e) => setAddress('city', e.target.value)}
            />
          </Field>
          <Field label="Postcode" description={ADDRESS_HELP}>
            <TextInput
              value={identity.address.postcode}
              onChange={(e) => setAddress('postcode', e.target.value)}
            />
          </Field>
          <Field
            label="Country"
            description="Given to Google in the site’s structured data. A two-letter code such as GR is what Google reads most reliably."
          >
            <TextInput
              value={identity.address.country}
              onChange={(e) => setAddress('country', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Social profiles"
          composite
          className="mt-4 max-w-3xl"
          description="A network name (instagram, facebook, linkedin…) and the full profile URL."
        >
          <div className="flex flex-col gap-2">
            {socials.map(([network, url], i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <TextInput
                  aria-label="Network"
                  value={network}
                  placeholder="instagram"
                  className="w-40"
                  onChange={(e) =>
                    setSocials(socials.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))
                  }
                />
                <TextInput
                  aria-label="Profile URL"
                  type="url"
                  value={url}
                  placeholder="https://"
                  className="min-w-0 flex-1"
                  onChange={(e) =>
                    setSocials(socials.map((row, j) => (j === i ? [row[0], e.target.value] : row)))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSocials(socials.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSocials([...socials, ['', '']])}
              >
                Add a profile
              </Button>
            </div>
          </div>
        </Field>
      </Section>

      <Section title="Logo and images">
        <div className="flex max-w-3xl flex-col gap-4">
          {MEDIA_FIELDS.map((m) => (
            <Field key={m.key} label={m.label} description={m.description} composite>
              <MediaPicker
                value={identity[m.key] ?? ''}
                onChange={(uuid) => set(m.key, uuid ?? null)}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section
        title="Colours"
        description="Every colour the site, the admin and emails are drawn with. Changes apply on the next page load."
      >
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <fieldset key={group} className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold text-neutral-700">{group}</legend>
              <div className="grid gap-4 md:grid-cols-2">
                {PALETTE_TOKENS.filter((t) => t.group === group).map((t) => (
                  <Field key={t.key} label={t.label} description={t.hint} composite>
                    <ColorControl
                      value={palette[t.key]}
                      onChange={(v) => setColour(t.key, typeof v === 'string' ? v : '')}
                    />
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1 text-sm font-semibold text-neutral-700">
              Preview
              <InfoTip label="About the preview">
                A sample drawn in the colours above as you change them. Nothing changes on the site until you
                press Save branding.
              </InfoTip>
            </p>
            <BrandPreview palette={palette} name={identity.name} />
          </div>

          {problems.length > 0 ? (
            <div
              role="alert"
              className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <p className="font-medium">Some text may be hard to read:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPalette(BASE_PALETTE);
                setSaved(false);
              }}
            >
              Reset colours to the neutral defaults
            </Button>
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save branding'}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-700">
            Saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A small mock of the site drawn in the unsaved palette. Decorative only. */
function BrandPreview({ palette, name }: { palette: Palette; name: string }) {
  return (
    <div
      aria-hidden
      className="max-w-3xl overflow-hidden rounded-sm border"
      style={{ borderColor: palette['border-soft'] }}
    >
      <div
        className="p-5"
        style={{ background: palette['soft-pearl'], color: palette['text-primary'] }}
      >
        <p
          className="text-xs font-semibold tracking-widest uppercase"
          style={{ color: palette['warm-gold-deep'] }}
        >
          Preview
        </p>
        <p className="mt-1 text-lg font-semibold">{name || 'Site name'}</p>
        <p className="mt-1 text-sm" style={{ color: palette['text-muted'] }}>
          Secondary text sits here, with a{' '}
          <span style={{ color: palette['warm-gold-deep'] }}>highlighted phrase</span>.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className="rounded-sm px-3 py-1.5 text-sm"
            style={{ background: palette['midnight-navy'], color: palette['soft-pearl'] }}
          >
            Primary button
          </span>
          <span
            className="rounded-sm px-3 py-1.5 text-sm"
            style={{ background: palette['warm-gold'], color: palette['soft-pearl'] }}
          >
            Accent
          </span>
          <span
            className="rounded-sm border px-3 py-1.5 text-sm"
            style={{ background: palette['bone-cream'], borderColor: palette['border-soft'] }}
          >
            Card
          </span>
          <span className="text-sm" style={{ color: palette.error }}>
            An error message
          </span>
        </div>
      </div>
      <div
        className="px-5 py-3 text-sm"
        style={{ background: palette['midnight-navy'], color: palette['soft-pearl'] }}
      >
        Footer
      </div>
    </div>
  );
}
