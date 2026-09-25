import 'server-only';

import { z } from 'zod';

import { createRoute } from '../../core/api/handler';
import { ok } from '../../core/api/respond';
import { localizedText, localizedValue } from '../../core/content/localized';
import { listPublishedDocuments } from '../../core/read';
import { incrementCounter } from '../../core/stats/counters';
import { toPopupRecord, type PopupRecord } from './policy';
import { resolvePopupDesign, type PopupDesign } from './presets';

/**
 * The popups a page might show, and the counter behind them.
 *
 * Read on the server and handed to the client runtime as a small list: the
 * decision about WHICH one to show needs the visitor's own history, which only
 * the browser has, but everything else — is it published, in date, for this
 * page — is decided here so a visitor never downloads a campaign they cannot
 * see.
 */

export const POPUP_STAT_SCOPE = 'popup';

export interface PopupPayload {
  record: PopupRecord;
  title: string;
  bodyHtml: null;
  body: unknown;
  image: string | null;
  buttonLabel: string;
  buttonUrl: string;
  position: string;
  size: string;
  /** The chosen preset with the editor's overrides already applied. */
  design: PopupDesign;
  trigger: string;
  triggerValue: number;
}

/**
 * One stored popup as the runtime needs it.
 *
 * Title, body and button text are `localized` fields, stored as a per-locale
 * map; they are resolved here to the visitor's language (falling back to the
 * site's main one), rather than shown as "[object Object]".
 */
export function toPopupPayload(
  doc: { id: number; slug: string; data: unknown },
  locale: string,
  defaultLocale: string
): PopupPayload {
  const data = (doc.data ?? {}) as Record<string, unknown>;
  const triggerValue = Number(data.triggerValue);
  return {
    record: toPopupRecord(doc.id, doc.slug, {
      ...data,
      target: {
        mode: data.targetMode,
        paths: data.targetPaths,
        exclude: data.targetExclude,
      },
    }),
    title: localizedText(data.title, locale, defaultLocale),
    bodyHtml: null,
    body: localizedValue(data.body, locale, defaultLocale),
    image: typeof data.image === 'string' && data.image ? data.image : null,
    buttonLabel: localizedText(data.buttonLabel, locale, defaultLocale),
    buttonUrl: String(data.buttonUrl ?? ''),
    position: String(data.position ?? 'center'),
    size: String(data.size ?? 'm'),
    design: resolvePopupDesign({
      preset: typeof data.preset === 'string' ? data.preset : undefined,
      backgroundImage: typeof data.backgroundImage === 'string' ? data.backgroundImage : undefined,
      backgroundColor: typeof data.backgroundColor === 'string' ? data.backgroundColor : undefined,
      textColor: typeof data.textColor === 'string' ? data.textColor : undefined,
      buttonColor: typeof data.buttonColor === 'string' ? data.buttonColor : undefined,
      buttonTextColor: typeof data.buttonTextColor === 'string' ? data.buttonTextColor : undefined,
      textSize: typeof data.textSize === 'string' ? data.textSize : undefined,
    }),
    trigger: String(data.trigger ?? 'delay'),
    triggerValue: Number.isFinite(triggerValue) ? triggerValue : 5,
  };
}

/** Every published popup for a locale, as the runtime needs them. */
export async function listPopups(locale: string, defaultLocale: string): Promise<PopupPayload[]> {
  const docs = await listPublishedDocuments('popup', locale, { limit: 50 });
  return docs.map((doc) => toPopupPayload(doc, locale, defaultLocale));
}

/**
 * `POST /api/cms/popups/track` — impressions, clicks and closes.
 *
 * Anonymous and aggregate, like the wishlist counter: a number per popup per
 * day, with nothing about who saw it.
 */
export function popupTrackRoute() {
  return createRoute({
    rateLimit: { scope: 'popup-track', max: 120, windowMs: 60_000 },
    input: z
      .object({
        popupId: z.coerce.number().int().positive(),
        metric: z.enum(['impression', 'click', 'close']),
      })
      .strict(),
    handler: async ({ input }) => {
      await incrementCounter({
        scope: POPUP_STAT_SCOPE,
        subjectId: input.popupId,
        metric: input.metric,
      });
      return ok({ counted: true });
    },
  });
}
