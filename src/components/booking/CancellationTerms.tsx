import { RichText } from '@/components/cms/RichText';

/**
 * The experience's cancellation terms on its public page: the free-cancellation
 * window and the policy text. Renders nothing when the experience states neither.
 *
 * The labels arrive already translated (and the day count already filled in) so
 * this stays a plain presentational component the page composes.
 */
export function CancellationTerms({
  freeCancellationDays,
  policy,
  labels,
}: {
  freeCancellationDays: number | null;
  /** Rich-text JSON, already checked to have content. */
  policy: unknown | null;
  labels: { title: string; freeCancellation: string };
}) {
  if (freeCancellationDays === null && policy === null) return null;
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">{labels.title}</h2>
      {freeCancellationDays !== null ? <p className="mt-2 font-medium">{labels.freeCancellation}</p> : null}
      {policy !== null ? <RichText value={policy} className="mt-2 text-sm text-neutral-600" /> : null}
    </section>
  );
}
