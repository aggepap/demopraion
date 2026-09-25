import type { ComponentType } from 'react';

import { Brands } from '@/components/shortcodes/Brands';
import { GoogleReviews } from '@/components/shortcodes/GoogleReviews';
import { Testimonials } from '@/components/shortcodes/Testimonials';
import { Countdown } from '@/components/shortcodes/Countdown';
import { Script } from '@/components/shortcodes/Script';

/**
 * What each shortcode actually renders on THIS site.
 *
 * Site-owned glue: the CMS core decides which shortcodes exist and what their
 * attributes may be; this file decides what they look like. A name with no
 * entry here simply renders nothing, which is what a site that has not styled a
 * block yet should do.
 */
/*
 * The props are `Record<string, unknown>` because they arrive from a page body
 * and have already been validated against the declared attribute shape by
 * `resolveShortcode`. Each component narrows what it needs; the map cannot be
 * typed per entry without a generic the caller has no way to supply.
 */
export type ShortcodeComponent = ComponentType<Record<string, unknown>>;

export const SHORTCODE_COMPONENTS: Record<string, ShortcodeComponent> = {
  brands: Brands as ShortcodeComponent,
  'google-reviews': GoogleReviews as ShortcodeComponent,
  testimonials: Testimonials as ShortcodeComponent,
  countdown: Countdown as ShortcodeComponent,
  script: Script as ShortcodeComponent,
};
