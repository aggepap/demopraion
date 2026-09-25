import { CmsApiError } from './api-client';

/**
 * The most specific thing the server said, not the most general.
 *
 * A validation refusal carries two messages: a summary ("Validation failed.") and, in
 * `issues`, the sentence that names the field and the rule — "A wildcard source has to end
 * with \"/*\"", "That pattern takes too long on some paths". Screens that showed only
 * `err.message` therefore showed the one half with no information in it, and the author was
 * left to guess which of their inputs was wrong. The document form already digs the field
 * errors out (F-004); every other screen showed the summary.
 *
 * Field errors first, then path errors, then form-level ones, then the summary, then the
 * caller's fallback. At most two are shown: a wall of messages is its own kind of unhelpful.
 */
export function apiErrorText(err: unknown, fallback: string): string {
  if (!(err instanceof CmsApiError)) return err instanceof Error ? err.message : fallback;

  const issues = err.issues as
    | {
        fieldErrors?: Record<string, string[]>;
        pathErrors?: Record<string, string[]>;
        formErrors?: string[];
      }
    | undefined;

  const specific = [
    ...Object.values(issues?.fieldErrors ?? {}).flat(),
    ...Object.values(issues?.pathErrors ?? {}).flat(),
    ...(issues?.formErrors ?? []),
  ].filter((m): m is string => typeof m === 'string' && m.trim() !== '');

  if (specific.length) return specific.slice(0, 2).join(' ');
  return err.message || fallback;
}
