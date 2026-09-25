/**
 * The experience field set as this site is actually configured today.
 *
 * `bookingCollection()` declares every field any kind could ever need, once, at
 * module load. Which kinds a particular site sells is a SETTING, read per
 * request. This is the seam between the two — see `FieldResolver` in
 * `config/config.ts`, and note that it runs inside `mergeCustomFields`, the one
 * path both the editor and the validator take.
 *
 * Adding a third kind touches nothing here: the logic is "how many kinds may be
 * authored", not "which two".
 */
import 'server-only';

import type { Field, SelectOption } from '../../config';
import type { BookingKind } from './collection';
import { getBookingKinds } from './settings-read';

/**
 * Decide the shape of the `kind` field for one document.
 *
 * Three cases, and the third is the one that matters:
 *
 *   several kinds sold          → the selector is shown, narrowed to those
 *                                 kinds. An option nobody sells is not offered.
 *   one kind sold, doc agrees   → the selector is hidden and defaults to it. An
 *                                 editor creating a villa on a villas-only site
 *                                 is not asked a question with one answer.
 *   one kind sold, doc differs  → the selector is SHOWN, and keeps the
 *                                 document's own kind among its options. An
 *                                 experience saved as transport before the site
 *                                 narrowed to stays would otherwise be
 *                                 stranded: its transport fields visible
 *                                 (correctly — it IS a transport experience)
 *                                 with no control on screen to change it.
 */
export function resolveKindField(field: Field, allowed: readonly string[], storedKind: unknown): Field {
  // Only a select carries `options` and a `default`, and `kind` is one.
  // Anything else means the collection changed shape underneath this — leave it
  // alone rather than stamping properties its kind does not have.
  if (field.kind !== 'select') return field;
  if (allowed.length === 0 || allowed.length >= field.options.length) return field;

  const stored = typeof storedKind === 'string' && storedKind ? storedKind : null;
  const keep = new Set<string>(allowed);
  if (stored) keep.add(stored);

  const options: SelectOption[] = field.options.filter((o) => keep.has(o.value));
  if (options.length === 0) return field;

  if (options.length === 1) {
    // Hidden, but still stored and still validated — `default` is what the zod
    // schema stamps onto a new document, so `data.kind` is explicit from the
    // first save rather than being inferred forever after.
    return { ...field, options, hidden: true, default: options[0].value };
  }

  // Several to choose between: show the selector, but only over what this site
  // sells (plus whatever this document already is).
  return { ...field, options, default: allowed[0] };
}

/**
 * The `FieldResolver` for the `booking` collection.
 *
 * Only ever touches `kind`. Everything else — which sections a kind shows — is
 * already handled by `showIf` reading that one value, so narrowing the site to
 * one kind needs exactly one field changed here and nothing else anywhere.
 */
export async function bookingFieldResolver(
  fields: Field[],
  ctx: { data?: Record<string, unknown> },
): Promise<Field[]> {
  const allowed: readonly BookingKind[] = await getBookingKinds();
  return fields.map((field) =>
    field.key === 'kind' ? resolveKindField(field, allowed, ctx.data?.kind) : field,
  );
}
