import { defineCollection, f, type CollectionDefinition } from '../../config';
import { POPUP_PRESETS } from './presets';

/**
 * A popup: what it says, where it appears, and how often.
 *
 * A collection rather than a settings blob because a popup is content — it has
 * a body, an image, a draft state and a publish date, and the people who write
 * one are the people who write pages.
 *
 * Colours are chosen from the site's own palette rather than typed as CSS: a
 * free-text colour box produces a popup that matches nothing on the site, and
 * a value that reaches a `style` attribute unchecked.
 */
export function popupCollection(): CollectionDefinition {
  return defineCollection({
    key: 'popup',
    label: 'Popup',
    labelPlural: 'Popups',
    icon: 'submissions',
    module: 'popups',
    // No page of its own (no `routing`): a popup appears on other pages. Still
    // listed under Content, while the popups module is on.
    seo: false,
    sections: [
      { title: 'Content' },
      { title: 'Where', description: 'Which pages it appears on, and where on the screen.' },
      { title: 'When', description: 'What makes it appear, and how often one visitor sees it.' },
      { title: 'Design', collapsed: true },
    ],
    fields: [
      f.text('title', {
        label: 'Title',
        required: true,
        maxLength: 191,
        localized: true,
        description: 'The heading of the popup. Also what screen readers announce when it opens.',
        section: 'Content',
      }),
      f.richText('body', {
        label: 'Body',
        localized: true,
        description: 'The text under the heading.',
        section: 'Content',
      }),
      f.image('image', {
        label: 'Image',
        description: 'Not shown by any design yet. For a picture, use “Background picture” under Design.',
        section: 'Content',
      }),
      f.text('buttonLabel', {
        label: 'Button text',
        maxLength: 60,
        localized: true,
        description: 'The words on the button. The button only appears when this and the link are both filled in.',
        section: 'Content',
      }),
      f.text('buttonUrl', {
        label: 'Button link',
        maxLength: 500,
        description: 'Where the button goes, e.g. /shop or a full https:// address.',
        section: 'Content',
      }),

      f.select('targetMode', {
        label: 'Show on',
        options: [
          { value: 'all', label: 'Every page' },
          { value: 'paths', label: 'Only the pages I list' },
        ],
        default: 'all',
        description: 'Every page, or only the pages listed below. The “Never on” list applies either way.',
        section: 'Where',
      }),
      f.textarea('targetPaths', {
        label: 'Pages',
        description: 'One path per line, e.g. /shop or /shop/* for everything under it.',
        section: 'Where',
      }),
      f.textarea('targetExclude', {
        label: 'Never on',
        description: 'One path per line. These win over the list above — /checkout is a good idea.',
        section: 'Where',
      }),
      f.select('position', {
        label: 'Position',
        options: [
          { value: 'center', label: 'Middle of the screen' },
          { value: 'bottom-bar', label: 'Bar along the bottom' },
          { value: 'top-bar', label: 'Bar along the top' },
          { value: 'bottom-right', label: 'Bottom corner' },
        ],
        default: 'center',
        description: 'The middle position also dims the page behind it. The Bottom banner, Corner card and Full-screen designs choose their own place.',
        section: 'Where',
      }),
      f.select('size', {
        label: 'Size',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
        ],
        default: 'm',
        description: 'How wide the popup is. The Split, Bottom banner and Full-screen designs set their own width.',
        section: 'Where',
      }),

      f.select('trigger', {
        label: 'Appears',
        options: [
          { value: 'delay', label: 'After a few seconds' },
          { value: 'load', label: 'Immediately' },
          { value: 'scroll', label: 'After scrolling down' },
          { value: 'exit', label: 'When the pointer leaves the page (desktop)' },
        ],
        default: 'delay',
        description: 'What makes it open. Only one popup ever shows at a time.',
        section: 'When',
      }),
      f.text('triggerValue', {
        label: 'Seconds, or percent scrolled',
        maxLength: 5,
        description: 'Used by “after a few seconds” (e.g. 5) and “after scrolling” (e.g. 50).',
        section: 'When',
      }),
      f.select('frequencyMode', {
        label: 'How often',
        options: [
          { value: 'days', label: 'Once every few days' },
          { value: 'once', label: 'Once only, ever' },
          { value: 'always', label: 'Every visit' },
        ],
        default: 'days',
        description: 'Remembered in each visitor’s own browser, so a new device or cleared browser data shows it again.',
        section: 'When',
      }),
      f.text('frequencyDays', {
        label: 'Days between showings',
        maxLength: 4,
        description: 'For “once every few days”: how long before the same visitor sees it again. Empty means 7.',
        section: 'When',
      }),
      f.text('startAt', {
        label: 'Start date',
        maxLength: 10,
        description: 'YYYY-MM-DD. Optional.',
        section: 'When',
      }),
      f.text('endAt', {
        label: 'End date',
        maxLength: 10,
        description: 'YYYY-MM-DD, the last day it shows (until midnight UTC). Optional.',
        section: 'When',
      }),
      f.text('priority', {
        label: 'Priority',
        maxLength: 4,
        description: 'When two popups could appear on one page, the higher number wins.',
        section: 'When',
      }),

      f.select('preset', {
        label: 'Design',
        options: POPUP_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
        default: POPUP_PRESETS[0].id,
        description: POPUP_PRESETS.map((preset) => `${preset.label}: ${preset.description}`).join(
          ' · '
        ),
        section: 'Design',
      }),
      f.image('backgroundImage', {
        label: 'Background picture',
        description: 'Used by the Spotlight, Split and Full-screen designs. The others ignore it.',
        section: 'Design',
      }),
      /*
       * Colours are optional: every design already has its own, and an empty
       * field means "whatever the design says". They are validated as hex on
       * the way out, because they end up in a style attribute.
       */
      f.color('backgroundColor', {
        label: 'Background colour',
        description: 'Leave empty to keep the design’s own colour.',
        section: 'Design',
      }),
      f.color('textColor', {
        label: 'Text colour',
        description: 'Leave empty to keep the design’s own colour.',
        section: 'Design',
      }),
      f.color('buttonColor', {
        label: 'Button colour',
        description: 'Leave empty to keep the design’s own colour.',
        section: 'Design',
      }),
      f.color('buttonTextColor', {
        label: 'Button text colour',
        description: 'Leave empty to keep the design’s own colour.',
        section: 'Design',
      }),
      f.select('textSize', {
        label: 'Text size',
        options: [
          { value: '', label: 'As the design' },
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
        ],
        default: '',
        description: '“As the design” keeps the size the chosen design uses.',
        section: 'Design',
      }),
    ],
  });
}
