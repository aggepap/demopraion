import { defineCollection, f, type CollectionDefinition, type Field } from '../../config';

/**
 * Testimonials an owner types in themselves.
 *
 * Separate from the synced Google reviews on purpose: those are Google's text
 * and are never edited, while these are quotes the business collected — from an
 * email, a phone call, a card. Mixing them into one table would make it
 * possible to "edit" a Google review, which is exactly what must not happen.
 */
export interface TestimonialCollectionOptions {
  key?: string;
  label?: string;
  labelPlural?: string;
  extraFields?: Field[];
}

export const DEFAULT_TESTIMONIAL_TYPE = 'testimonial';

export function testimonialCollection(
  opts: TestimonialCollectionOptions = {}
): CollectionDefinition {
  return defineCollection({
    key: opts.key ?? DEFAULT_TESTIMONIAL_TYPE,
    label: opts.label ?? 'Testimonial',
    labelPlural: opts.labelPlural ?? 'Testimonials',
    icon: 'reviews',
    // Listed under Content while the Google reviews module is on — the module
    // that places them with [testimonials]. No `routing`: a quote has no page.
    module: 'googleReviews',
    seo: false,
    fields: [
      f.text('title', {
        label: 'Who said it',
        required: true,
        maxLength: 191,
        description: 'The name shown under the quote.',
      }),
      f.text('role', {
        label: 'Role or company',
        maxLength: 191,
        description: 'Optional. Shown after the name, e.g. “Owner, Blue Café”.',
      }),
      f.textarea('quote', {
        label: 'What they said',
        required: true,
        localized: true,
        maxLength: 1000,
        description: 'The quote itself, in each language you want it shown in.',
      }),
      f.image('photo', {
        label: 'Photo',
        description: 'Optional. A small round picture beside the name.',
      }),
      f.select('rating', {
        label: 'Stars',
        options: [
          { value: '' },
          { value: '5' },
          { value: '4' },
          { value: '3' },
          { value: '2' },
          { value: '1' },
        ],
        description: 'Optional — leave empty for a quote with no rating.',
      }),
    ],
  });
}
