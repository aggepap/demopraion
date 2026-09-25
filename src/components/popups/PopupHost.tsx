import { listPopups } from '@/cms/modules/popups';
import { RichText } from '@/components/cms/RichText';
import config from '@/site.config';

import { PopupRuntime, type PopupView } from './PopupRuntime';

/**
 * Reads the published popups on the server and hands them to the runtime.
 *
 * The bodies are rendered here, as React nodes, so a popup body can use the
 * same rich text — and the same shortcodes — as a page, without shipping a
 * renderer to the browser.
 */
export async function PopupHost({ locale }: { locale: string }) {
  const popups = await listPopups(locale, config.defaultLocale);
  if (popups.length === 0) return null;

  const views: PopupView[] = popups.map((popup) => ({
    record: popup.record,
    title: popup.title,
    body: <RichText value={popup.body} />,
    image: popup.image,
    buttonLabel: popup.buttonLabel,
    buttonUrl: popup.buttonUrl,
    position: popup.position,
    size: popup.size,
    design: popup.design,
    trigger: popup.trigger,
    triggerValue: popup.triggerValue,
  }));

  return <PopupRuntime popups={views} />;
}
