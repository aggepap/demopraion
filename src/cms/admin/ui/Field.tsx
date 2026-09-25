'use client';

import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from './cn';
import { FieldTip } from './InfoTip';

/**
 * Label + control + help, wired together properly.
 *
 * History worth keeping: this used to render `<label htmlFor={htmlFor}>` while
 * no caller ever passed `htmlFor` and no control produced an `id`, so every
 * admin field had a label associated with nothing — screen readers announced an
 * unnamed input and `getByLabel('Slug')` matched zero elements. It is a client
 * component so `useId()` can mint that id here instead of asking ~40 call sites
 * to invent one.
 *
 * The description is not printed under the field any more; it lives behind an
 * "i" affordance next to the label and is tied to the control with
 * `aria-describedby`, so assistive tech reads it without it crowding the form.
 *
 * `children` may also be a function. Cloning only works on a single element
 * child, and a field that renders a control *plus* something else — the
 * per-locale tab strip above a `localized` field is the case in the admin — fell
 * through to the untouched branch: the label kept pointing at an id nothing had,
 * exactly the defect this component exists to fix, still live for every
 * localized field. Such a caller takes the ids as an argument and puts them on
 * whichever element is the real control.
 *
 * `composite` is for content that is a whole widget rather than one control —
 * the tag multi-select, the relation and category pickers, the image picker, the
 * rich-text editor. Cloning an `id` onto one of those succeeds as a React prop
 * and never reaches the DOM, so their labels were dangling as well, just less
 * visibly than the localized case: five of the six collections had at least one.
 * A widget gets a labelled `group` instead of a label pointing at nothing, which
 * is also the honest description — there is no single control to name.
 */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}
export function Field({
  label,
  required,
  description,
  error,
  htmlFor,
  composite,
  children,
  className,
}: {
  label?: ReactNode;
  required?: boolean;
  description?: ReactNode;
  error?: string | string[] | null;
  /** Escape hatch for a caller that manages its own control id. */
  htmlFor?: string;
  /** The children are a composite widget, not a single labelable control. */
  composite?: boolean;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
  className?: string;
}) {
  const autoId = useId();
  const controlId = htmlFor ?? `${autoId}-control`;
  const labelId = `${autoId}-label`;
  const descId = `${autoId}-desc`;
  const errId = `${autoId}-err`;
  const err = Array.isArray(error) ? error.join(', ') : error;

  // Point the label at the control, and hand the control its descriptions.
  const describedBy = [description ? descId : null, err ? errId : null].filter(Boolean).join(' ');
  const controlProps: FieldControlProps = {
    id: controlId,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(err ? { 'aria-invalid': true as const } : {}),
  };

  // A function child places the ids itself. Otherwise clone them onto a single
  // element child; anything else (a fragment, a list of inputs) is left alone
  // rather than guessed at — use the function form for those.
  const only =
    composite || typeof children === 'function' || Children.count(children) !== 1
      ? null
      : Children.only(children);
  const rendered =
    typeof children === 'function'
      ? children(controlProps)
      : only && isValidElement(only) && !htmlFor
        ? cloneElement(only as ReactElement<Record<string, unknown>>, {
            ...controlProps,
            id: (only.props as { id?: string }).id ?? controlId,
          })
        : children;

  // A widget is wrapped in a group that carries the label, whichever way its
  // content was produced — a localized picker is both a function child and a
  // composite, and needs the group as much as a plain one does.
  const control = composite ? (
    <div
      role="group"
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={describedBy || undefined}
    >
      {rendered}
    </div>
  ) : (
    rendered
  );

  return (
    // `relative` is load-bearing: it is the box the info bubble is positioned
    // against. The group is *named* so a field nested in another field's box
    // (a repeater row inside a section) does not open every inner bubble when
    // anything in the outer one takes focus.
    <div className={cn('group/field relative flex flex-col gap-1.5', className)}>
      {label ? (
        <div className="flex items-center gap-1">
          <label
            id={labelId}
            // A composite widget has no single control to point at; the group
            // below carries `aria-labelledby` back to this label instead.
            htmlFor={composite ? undefined : controlId}
            className="text-sm font-medium text-neutral-800"
          >
            {label}
            {/* The asterisk means "required to publish", not "required to
                save" — drafts are allowed to be unfinished. Without saying so,
                a star that never blocks anything reads as a broken rule. */}
            {required ? (
              <span className="text-warm-gold-deep ml-0.5" title="Required to publish">
                *<span className="sr-only"> (required to publish)</span>
              </span>
            ) : null}
          </label>
          {description ? <FieldTip id={descId}>{description}</FieldTip> : null}
        </div>
      ) : description ? (
        // No label to put the "i" beside, but the control is still described by
        // this id — without an element behind it, `aria-describedby` pointed at
        // nothing and the help was lost to everyone.
        <p id={descId} className="text-xs text-neutral-600">
          {description}
        </p>
      ) : null}
      {control}
      {err ? (
        <p id={errId} className="text-xs text-red-700">
          {err}
        </p>
      ) : null}
    </div>
  );
}
