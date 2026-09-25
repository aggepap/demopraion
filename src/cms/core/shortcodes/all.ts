import { SNIPPET_SLUG } from '../scripts/schema';
import { defineShortcode, type ShortcodeRegistry } from './registry';

/**
 * Every shortcode this CMS ships.
 *
 * One object rather than a registry modules push into at import time: the list
 * of what an editor can type is then readable in one place, and a module that a
 * site never imports cannot leave a shortcode behind that renders nothing.
 *
 * Each entry names the module that must be on. A site with that module off gets
 * "switched off" in the editor and nothing at all on the public page.
 */
export const SHORTCODES: ShortcodeRegistry = {
  'google-reviews': defineShortcode({
    name: 'google-reviews',
    label: 'Google reviews',
    description: 'Reviews pulled from your Google Business Profile.',
    module: 'googleReviews',
    attrs: {
      layout: { kind: 'select', options: ['carousel', 'grid', 'badge'], default: 'carousel' },
      location: { kind: 'text', maxLength: 40, default: 'all' },
      limit: { kind: 'int', min: 1, max: 50, default: 6 },
      min: { kind: 'int', min: 1, max: 5, default: 1 },
    },
  }),
  testimonials: defineShortcode({
    name: 'testimonials',
    label: 'Testimonials',
    description: 'Quotes you entered yourself under Content → Testimonials.',
    module: 'googleReviews',
    attrs: {
      layout: { kind: 'select', options: ['carousel', 'grid'], default: 'grid' },
      limit: { kind: 'int', min: 1, max: 50, default: 6 },
    },
  }),
  form: defineShortcode({
    name: 'form',
    label: 'Form',
    description: 'One of your forms, placed in the page.',
    attrs: {
      id: { kind: 'text', maxLength: 64, default: '' },
      title: { kind: 'text', maxLength: 120, default: '' },
    },
  }),
  popup: defineShortcode({
    name: 'popup',
    label: 'Popup (inline)',
    description: 'Shows a popup’s content in the page instead of over it.',
    module: 'popups',
    attrs: { id: { kind: 'text', maxLength: 64, default: '' } },
  }),
  brands: defineShortcode({
    name: 'brands',
    label: 'Brands',
    description: 'The brand logos you added under Content → Brands.',
    attrs: {
      layout: { kind: 'select', options: ['row', 'grid'], default: 'row' },
      limit: { kind: 'int', min: 1, max: 50, default: 12 },
    },
  }),
  countdown: defineShortcode({
    name: 'countdown',
    label: 'Countdown',
    description: 'Counts down to a date and time.',
    attrs: {
      // ISO 8601, checked here so a malformed date never reaches the component.
      to: {
        kind: 'text',
        maxLength: 32,
        pattern: /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
        default: '',
      },
      label: { kind: 'text', maxLength: 120, default: '' },
      expired: { kind: 'text', maxLength: 120, default: '' },
    },
  }),
  script: defineShortcode({
    name: 'script',
    label: 'Script snippet',
    description: 'A JavaScript snippet saved under Scripts, run where the shortcode is placed.',
    // The slug only: what runs, and whether it waits for consent, is decided on
    // the Scripts screen, never by whoever places the shortcode.
    attrs: { name: { kind: 'text', maxLength: 64, pattern: SNIPPET_SLUG, default: '' } },
  }),
};

/** The registry as a list, for the admin dialog. */
export function shortcodeList() {
  return Object.values(SHORTCODES);
}
