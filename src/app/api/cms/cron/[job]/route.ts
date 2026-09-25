/**
 * Scheduled jobs: `POST /api/cms/cron/<job>` with `x-cron-secret: $CMS_CRON_SECRET`.
 *
 * The one list of what an external scheduler can run. A job belonging to a
 * module that is switched off answers 404, like the module's other endpoints.
 * The older per-job endpoints (abandoned-cart reminders, reservation expiry)
 * keep working with their own secrets; their jobs are here too, so one secret
 * and one scheduler entry per job is enough.
 */
import { resolveModuleFlags } from '@/cms/core';
import { cronRoute } from '@/cms/core/cron/service';
import { publishDueScheduled, scheduledPublisher } from '@/cms/core/documents/publish-scheduled';
import { expireStaleReservations } from '@/cms/modules/booking';
import {
  cancelStaleOrders,
  deliverDueGiftCards,
  expireGiftCards,
  processReminders,
  sendGiftCardEmail,
} from '@/cms/modules/commerce';
import { syncAllReviewLocations } from '@/cms/modules/reviews-external';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = cronRoute({
  jobs: {
    // Scheduled documents whose time has passed are stored as published. The
    // admin also does this whenever its lists are opened; the job keeps the
    // status right for sites where nobody looks for a while.
    'content-publish-scheduled': {
      run: async () => ({ ...(await publishDueScheduled(scheduledPublisher())) }),
    },
    'commerce-stale-orders': { module: 'commerce', run: cancelStaleOrders },
    'google-reviews-sync': { module: 'googleReviews', run: syncAllReviewLocations },
    // Gift cards are sent on the day the buyer chose, not the day they bought.
    'giftcard-deliver': {
      module: 'commerce',
      run: () => deliverDueGiftCards((card) => sendGiftCardEmail(card, config.defaultLocale)),
    },
    'giftcard-expire': { module: 'commerce', run: expireGiftCards },
    'commerce-abandoned-reminders': {
      module: 'commerce',
      run: () => processReminders({ defaultLocale: config.defaultLocale }),
    },
    // Lapses unanswered enquiries and releases abandoned payment holds. Same
    // sweep as the legacy `POST /api/cms/reservations/expire`.
    'booking-expire': {
      module: 'booking',
      run: async () => ({ ...(await expireStaleReservations()) }),
    },
  },
  moduleFlags: () => resolveModuleFlags(config),
});
