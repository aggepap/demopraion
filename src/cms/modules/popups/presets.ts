/**
 * Ready-made popup designs.
 *
 * An owner picks one and is finished: every preset carries its own colours,
 * text size and layout, so a popup with nothing else filled in still looks
 * deliberate. Every one of those defaults can then be overridden per popup —
 * background image, colours, text size, button colours and label.
 *
 * ## Why the colours are guarded
 *
 * A colour comes from an admin form and ends up in a `style` attribute. A field
 * that accepted "red; background-image: url(…)" would be a way to write
 * arbitrary CSS into every visitor's page, so anything that is not a plain hex
 * colour is refused and the preset's own default is used instead.
 *
 * Pure and client-safe: the admin form and the storefront render from the same
 * table, so a preview cannot drift from the real thing.
 */

export type PopupTextSize = 's' | 'm' | 'l';

export interface PopupPresetDefaults {
  background: string;
  text: string;
  buttonBackground: string;
  buttonText: string;
  textSize: PopupTextSize;
}

export interface PopupPreset {
  id: string;
  label: string;
  description: string;
  /** How the panel is laid out; the dialog maps this to classes. */
  layout: 'card' | 'split' | 'bar' | 'corner' | 'takeover' | 'plain';
  /** Whether the design is built around a picture, so the editor can say so. */
  usesImage: boolean;
  defaults: PopupPresetDefaults;
}

export const POPUP_PRESETS: readonly PopupPreset[] = [
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'A centred card with the picture on top. The safe default.',
    layout: 'card',
    usesImage: true,
    defaults: {
      background: '#ffffff',
      text: '#1b2430',
      buttonBackground: '#1b2430',
      buttonText: '#ffffff',
      textSize: 'm',
    },
  },
  {
    id: 'split',
    label: 'Split',
    description: 'Picture on one side, words on the other. Wider; best for an offer.',
    layout: 'split',
    usesImage: true,
    defaults: {
      background: '#ffffff',
      text: '#1b2430',
      buttonBackground: '#b8873b',
      buttonText: '#ffffff',
      textSize: 'm',
    },
  },
  {
    id: 'banner',
    label: 'Bottom banner',
    description: 'A quiet strip along the bottom. The least interrupting of them.',
    layout: 'bar',
    usesImage: false,
    defaults: {
      background: '#1b2430',
      text: '#f7f5f2',
      buttonBackground: '#b8873b',
      buttonText: '#ffffff',
      textSize: 's',
    },
  },
  {
    id: 'corner',
    label: 'Corner card',
    description: 'A small card in the corner, out of the way of the page.',
    layout: 'corner',
    usesImage: false,
    defaults: {
      background: '#ffffff',
      text: '#1b2430',
      buttonBackground: '#1b2430',
      buttonText: '#ffffff',
      textSize: 's',
    },
  },
  {
    id: 'takeover',
    label: 'Full-screen',
    description:
      'A full-screen picture with the words over it. Strong — and Google penalises one of these opening on load on a phone.',
    layout: 'takeover',
    usesImage: true,
    defaults: {
      background: '#1b2430',
      text: '#ffffff',
      buttonBackground: '#ffffff',
      buttonText: '#1b2430',
      textSize: 'l',
    },
  },
  {
    id: 'plain',
    label: 'Plain text',
    description: 'Words and a button, nothing else. For a notice rather than an offer.',
    layout: 'plain',
    usesImage: false,
    defaults: {
      background: '#f7f5f2',
      text: '#1b2430',
      buttonBackground: '#1b2430',
      buttonText: '#ffffff',
      textSize: 'm',
    },
  },
];

/** A preset by id. An unknown one falls back rather than rendering nothing. */
export function popupPreset(id: string): PopupPreset {
  return POPUP_PRESETS.find((preset) => preset.id === id) ?? POPUP_PRESETS[0];
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * A hex colour, or the fallback.
 *
 * An allow-list rather than an escape list: the set of valid colours is small
 * and known, so there is no need to reason about which characters are
 * dangerous in a `style` attribute.
 */
export function safeColor(raw: string | null | undefined, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return HEX.test(value) ? value : fallback;
}

/** Fixed classes, so a text size can never be a number typed into a form. */
const TEXT_CLASSES: Record<PopupTextSize, string> = {
  s: 'text-sm',
  m: 'text-base',
  l: 'text-lg sm:text-xl',
};

export interface PopupDesignInput {
  preset?: string;
  backgroundImage?: string;
  backgroundColor?: string;
  textColor?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  textSize?: string;
}

export interface PopupDesign {
  preset: PopupPreset;
  background: string;
  text: string;
  buttonBackground: string;
  buttonText: string;
  textSize: PopupTextSize;
  textClass: string;
  /** Ready-to-use media URL, or null when the popup has no picture. */
  backgroundImage: string | null;
}

function textSizeOf(raw: string | undefined, fallback: PopupTextSize): PopupTextSize {
  return raw === 's' || raw === 'm' || raw === 'l' ? raw : fallback;
}

/** What a popup actually renders as: its preset, with the editor's overrides. */
export function resolvePopupDesign(input: PopupDesignInput): PopupDesign {
  const preset = popupPreset(input.preset ?? '');
  const { defaults } = preset;
  const textSize = textSizeOf(input.textSize, defaults.textSize);
  const image = typeof input.backgroundImage === 'string' ? input.backgroundImage.trim() : '';

  return {
    preset,
    background: safeColor(input.backgroundColor, defaults.background),
    text: safeColor(input.textColor, defaults.text),
    buttonBackground: safeColor(input.buttonColor, defaults.buttonBackground),
    buttonText: safeColor(input.buttonTextColor, defaults.buttonText),
    textSize,
    textClass: TEXT_CLASSES[textSize],
    // Encoded: the id comes out of a document and is interpolated into a CSS url().
    backgroundImage: image ? `/api/cms/media/file/${encodeURIComponent(image)}` : null,
  };
}
