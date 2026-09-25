'use client';

import { useState } from 'react';

import {
  BUSINESS_TYPES,
  PART_LABELS,
  SCHEMA_POLICY_KEY,
  TYPE_FAMILY,
  TYPE_HINTS,
  isLocalBusiness,
  partsFor,
  type BusinessType,
  type CategoryPolicy,
  type SchemaCategory,
  type SchemaPart,
  type SchemaPolicy,
  type SchemaType,
} from '../core/structured-data/policy';
import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Checkbox, Field, Section, Select, TextInput } from './ui';

/**
 * Settings → Structured data.
 *
 * What each kind of content tells search engines it is. One card per category
 * the site actually has, each offering only the types that fit it, and only the
 * parts the chosen type can carry — an Apartment has no price part, a page set
 * to None has nothing to switch at all. A single document can still pick another
 * type from its category's list in its SEO panel.
 */

const BUSINESS_HINT =
  'How the whole site describes the business to search engines, on every page. A local business (a shop, agency, hotel…) uses the address and phone from Branding.';

/** Each business type in plain words — the schema.org names mean little to an owner. */
export const BUSINESS_TYPE_HELP: Record<BusinessType, string> = {
  Organization: 'A company or brand with no premises customers visit. The safe choice when nothing else fits.',
  LocalBusiness: 'A business with premises customers visit, when none of the more specific types fits.',
  OnlineStore: 'A shop that sells online only, with no premises customers visit.',
  Store: 'A shop customers can walk into.',
  TravelAgency: 'Sells or organises trips, tours, cruises or transfers.',
  LodgingBusiness: 'Somewhere to stay, when Hotel, Bed and breakfast or Resort do not fit.',
  Hotel: 'A hotel.',
  BedAndBreakfast: 'A bed and breakfast or small guesthouse.',
  Resort: 'A resort: a place to stay with its own leisure facilities.',
  ProfessionalService: 'An office that sells a service, such as a law firm, an accountant or an agency.',
  Restaurant: 'A restaurant, café or bar.',
};

/** What each optional part adds to a page's structured data. */
export const PART_HELP: Record<SchemaPart, string> = {
  author: 'Tells search engines who wrote it.',
  dates: 'When it was first published and last updated, so results can show how recent it is.',
  image: 'The images of the page, which search engines may show beside the result.',
  speakable:
    'Marks the parts of the text suited to being read aloud by voice assistants. Has an effect only where the site’s design supports it.',
  brand: 'The product’s brand name.',
  reviews: 'The star rating and reviews, which Google may show as stars in results.',
  offers: 'The price and whether it can be bought or booked.',
};

export function StructuredDataSettings({
  initial,
  categories,
  brandHasAddress,
}: {
  initial: SchemaPolicy;
  /** The categories this site has — only these get a card. */
  categories: readonly SchemaCategory[];
  brandHasAddress: boolean;
}) {
  const [policy, setPolicy] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setBusiness = (patch: Partial<SchemaPolicy['business']>) => {
    setPolicy((prev) => ({ ...prev, business: { ...prev.business, ...patch } }));
    setSaved(false);
  };
  const setCategory = (key: SchemaCategory['key'], patch: Partial<CategoryPolicy>) => {
    setPolicy((prev) => ({
      ...prev,
      categories: { ...prev.categories, [key]: { ...prev.categories[key], ...patch } },
    }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // The whole policy, hidden categories included: switching a module off
      // and on again must not lose what was chosen for it.
      await cmsApi.updateSiteSettings({ [SCHEMA_POLICY_KEY]: policy });
      setSaved(true);
    } catch (err) {
      setError(apiErrorText(err, 'Could not save the structured data settings.'));
    } finally {
      setSaving(false);
    }
  }

  const local = isLocalBusiness(policy.business.type);

  return (
    <div className="flex flex-col gap-6">
      <Section title="Business type" info={BUSINESS_HINT}>
        <div className="flex max-w-lg flex-col gap-4">
          <Field
            label="The business is a"
            description={
              local
                ? `${BUSINESS_TYPE_HELP[policy.business.type]} Uses the address and phone from Branding.`
                : BUSINESS_TYPE_HELP[policy.business.type]
            }
          >
            <Select
              value={policy.business.type}
              onChange={(e) => setBusiness({ type: e.target.value as BusinessType })}
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          {local ? (
            <Field
              label="Price range"
              description="How expensive the business is, written like €€. Optional, and used only for a local business."
            >
              <TextInput
                maxLength={20}
                value={policy.business.priceRange}
                onChange={(e) => setBusiness({ priceRange: e.target.value })}
              />
            </Field>
          ) : null}
          {local && !brandHasAddress ? (
            <p role="alert" className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Google needs an address for a local business. Until one is added in Settings → Branding,
              the site is described as a plain Organization.
            </p>
          ) : null}
        </div>
      </Section>

      {categories.map((c) => {
        const p = policy.categories[c.key];
        const none = TYPE_FAMILY[p.type] === 'none';
        const faqFamily = TYPE_FAMILY[p.type] === 'faq';
        const parts = partsFor(c.key, p.type);
        return (
          <Section key={c.key} title={c.label}>
            <div className="flex max-w-lg flex-col gap-3">
              <Field label="Schema type" description={TYPE_HINTS[p.type]}>
                <Select
                  value={p.type}
                  onChange={(e) => setCategory(c.key, { type: e.target.value as SchemaType })}
                >
                  {c.types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
              </Field>
              {none ? null : (
                <>
                  <Checkbox
                    label="Breadcrumbs"
                    info="The path to the page (Home › Section › Page), which Google may show instead of the address."
                    checked={p.breadcrumbs}
                    onChange={(e) => setCategory(c.key, { breadcrumbs: e.target.checked })}
                  />
                  <Checkbox
                    label={
                      faqFamily
                        ? 'Include the FAQs from the SEO panel in the same FAQPage'
                        : 'Add the FAQs from the SEO panel'
                    }
                    info={
                      faqFamily
                        ? 'Adds the questions and answers written in each document’s SEO panel to the page’s own list of questions.'
                        : 'Adds the questions and answers written in each document’s SEO panel as a separate FAQ. AI assistants read them; Google shows FAQ results only for a few sites.'
                    }
                    checked={p.appendFaq}
                    onChange={(e) => setCategory(c.key, { appendFaq: e.target.checked })}
                  />
                  {parts.map((part) => (
                    <Checkbox
                      key={part}
                      label={PART_LABELS[part]}
                      info={PART_HELP[part]}
                      hint={
                        part === 'offers' && c.key === 'products'
                          ? 'Without it, Google cannot show the price or stock.'
                          : undefined
                      }
                      checked={p.parts[part] !== false}
                      onChange={(e) =>
                        setCategory(c.key, { parts: { ...p.parts, [part]: e.target.checked } })
                      }
                    />
                  ))}
                </>
              )}
            </div>
          </Section>
        );
      })}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          Save
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-700">
            Saved. Live on the next page load.
          </p>
        ) : null}
      </div>
    </div>
  );
}
