import 'server-only';

import { getSetting } from '../../core/settings';

/** The `site_settings` key choosing how the price filter is offered. */
export const ECOMMERCE_PRICE_CONTROL_KEY = 'ecommerce.filters.priceControl';

export const PRICE_CONTROLS = ['slider', 'fields'] as const;
export type PriceControl = (typeof PRICE_CONTROLS)[number];
export const DEFAULT_PRICE_CONTROL: PriceControl = 'slider';

/**
 * Slider or a pair of number boxes. The slider is the default because it is
 * what the design calls for; the boxes remain for a shop whose prices span
 * several orders of magnitude, where a slider's precision is useless.
 *
 * The accessible number inputs are rendered either way — the setting decides
 * whether the slider sits above them, not whether the filter is operable.
 */
export async function getPriceControl(): Promise<PriceControl> {
  const raw = await getSetting<string>(ECOMMERCE_PRICE_CONTROL_KEY);
  return PRICE_CONTROLS.includes(raw as PriceControl)
    ? (raw as PriceControl)
    : DEFAULT_PRICE_CONTROL;
}
