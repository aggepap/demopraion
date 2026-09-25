/**
 * Attaches the real providers to the registry.
 *
 * This project has no boot hook (no `instrumentation.ts`, no global bootstrap),
 * and Next builds a separate module graph per route bundle — a registration
 * performed in one route is invisible to another. So this is a side-effect
 * module: importing it registers, and every route that resolves a provider
 * imports it.
 *
 * Importing it from several places is correct, not wasteful. Module-scope code
 * runs once per graph, and `registerPaymentProvider` is idempotent by key.
 *
 *   import '@/cms/core/payments/register';
 *
 * `manualProvider` is not registered here — the registry is seeded with it, so
 * a site with no gateway configured still works.
 */
import 'server-only';

import { registerPaymentProvider } from './index';
import { paypalProvider } from './paypal';
import { stripeProvider } from './stripe';
import { vivaProvider } from './viva';

registerPaymentProvider(stripeProvider);
registerPaymentProvider(paypalProvider);
registerPaymentProvider(vivaProvider);

/**
 * No-op that exists to be called.
 *
 * A bare side-effect import is a bundler's favourite thing to tree-shake. A
 * route that wants to be certain can call this instead; either way the module
 * body above has already run.
 */
export function ensurePaymentProvidersRegistered(): void {
  /* the registrations above are the point */
}
