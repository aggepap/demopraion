import type { Edit } from './markdown-actions';

/**
 * Apply an `Edit` to a live textarea.
 *
 * ## Why `execCommand`, which is deprecated
 *
 * It is the only way to change a textarea's value that leaves the browser's
 * **native undo stack** intact. Both alternatives — assigning `.value` and
 * `setRangeText()` — clear it, so a writer who bolds a word and then presses
 * Ctrl+Z loses the paragraph instead of the emphasis. For an editorial surface
 * where people type thousands of words, that is a data-loss-shaped bug, not a
 * polish issue. It also fires a real `input` event, so React's `onChange` runs
 * and the controlled value stays in sync without a second code path.
 *
 * The fallback is correct, just less pleasant: it updates through React and
 * loses undo for that one edit.
 */
export function applyEdit(
  el: HTMLTextAreaElement,
  edit: Edit,
  onChange: (next: string) => void,
): void {
  el.focus();
  el.setSelectionRange(edit.from, edit.to);

  let inserted = false;
  try {
    inserted =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, edit.text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    onChange(el.value.slice(0, edit.from) + edit.text + el.value.slice(edit.to));
  }

  // The selection is restored after the value settles: React may re-render
  // between here and the next frame, and setting it now would be overwritten.
  requestAnimationFrame(() => {
    el.setSelectionRange(edit.selStart, edit.selEnd);
  });
}
