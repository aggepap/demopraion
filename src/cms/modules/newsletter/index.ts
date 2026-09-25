/**
 * Newsletter module — subscriber capture and management.
 *
 * The `newsletter_subscribers` table and the `newsletter` module flag both
 * shipped with the schema port; nothing implemented either, so the site's two
 * signup forms resolved a stub and dropped every address (see
 * `src/lib/newsletter.ts`). This is that implementation.
 *
 * Gated by the module flag at the route level, with one deliberate exception
 * noted on the public route: see `src/app/api/newsletter/route.ts`.
 */
export {
  consentTextFor,
  isSubscribeSuccess,
  newsletterSubscribeBody,
  subscribeOutcome,
  subscriberPage,
  subscriberView,
  type NewsletterSubscribeInput,
  type SubscribeOutcome,
  type SubscriberStatus,
  type SubscriberView,
} from './logic';

export {
  deleteSubscriber,
  getSubscriber,
  listSubscribers,
  setSubscribed,
  subscribe,
  type ListSubscribersOptions,
  type ListSubscribersResult,
  type SubscribeInput,
  type SubscriberFilter,
} from './subscribers';

export {
  newsletterSubscribeRoute,
  subscriberDeleteRoute,
  subscriberUpdateRoute,
  subscribersListRoute,
} from './routes';
