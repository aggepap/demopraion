/**
 * Popups: content that appears over a page rather than in it.
 *
 * Off by default (`popups` module). The rules live in `policy.ts` and are
 * shared with the browser runtime; nothing here decides what a visitor has
 * already seen, because only their browser knows that.
 */
export { popupCollection } from './collection';
export {
  choosePopup,
  isPopupActive,
  matchesTarget,
  shouldShowAgain,
  toPopupRecord,
  type PopupFrequency,
  type PopupRecord,
  type PopupTarget,
} from './policy';
export {
  POPUP_PRESETS,
  popupPreset,
  resolvePopupDesign,
  safeColor,
  type PopupDesign,
  type PopupPreset,
  type PopupTextSize,
} from './presets';
export { listPopups, popupTrackRoute, POPUP_STAT_SCOPE, type PopupPayload } from './read';
