/**
 * Script snippets: JavaScript an administrator saves once and places anywhere
 * with `[script name="<slug>"]`.
 *
 * Running their code is the feature, so nothing here tries to judge whether it
 * is safe — no filter can. What it does guarantee is that a snippet lands where
 * it was meant to and nowhere else: inline code cannot close its own script
 * element, and an external script is loaded only over https from a plain host.
 * Who may save one at all is the `cms.scripts.manage` permission's job.
 *
 * Client-safe: zod and pure functions only, so the admin form and the server
 * validate against the same rules.
 */
import { z } from 'zod';

/** The same grammar as a shortcode name: it is typed by hand into a page body. */
export const SNIPPET_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Generous for a tag manager's loader, small enough to never bloat a page. */
export const MAX_CODE_LENGTH = 64 * 1024;
export const MAX_SRC_LENGTH = 2048;

/** Cookie category keys, as the Cookies screen creates them. */
const CATEGORY_KEY = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export const SNIPPET_KINDS = ['inline', 'external'] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

/*
 * The HTML parser ends a script element at the bytes `</script`, whatever JS
 * string or comment they sit in — so code containing them would close the tag
 * and turn the rest into markup. Refused rather than escaped: an escape would
 * silently change the code the administrator wrote.
 */
const CLOSES_SCRIPT = /<\/script/i;
const SCRIPT_WRAPPER = /^\s*<script\b/i;

const inlineCode = z
  .string()
  .max(MAX_CODE_LENGTH, `Keep the code under ${MAX_CODE_LENGTH / 1024} KB.`)
  .refine((code) => code.trim().length > 0, 'Paste the JavaScript to run.')
  .refine(
    (code) => !SCRIPT_WRAPPER.test(code),
    'Paste only the JavaScript — without the <script> and </script> tags around it.',
  )
  .refine((code) => !CLOSES_SCRIPT.test(code), 'The code cannot contain "</script".');

const externalSrc = z
  .string()
  .trim()
  .max(MAX_SRC_LENGTH)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && url.hostname.length > 0;
    } catch {
      return false;
    }
  }, 'Use a full https:// address, without a username or password.');

const shared = {
  name: z.string().trim().min(1, 'Give the snippet a name.').max(120),
  slug: z.string().trim().max(64).regex(SNIPPET_SLUG, 'Lowercase letters, numbers and dashes only.'),
  /** `null` = runs without consent; for code that connects a service rather than tracks. */
  consentCategory: z
    .union([z.literal(''), z.string().max(64).regex(CATEGORY_KEY), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  /** Run once the page is idle rather than right after it becomes interactive. */
  lazy: z.boolean().default(false),
  enabled: z.boolean().default(true),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((value) => (value ? value : null)),
};

const inlineInput = z
  .object({ ...shared, kind: z.literal('inline'), code: inlineCode })
  .strict()
  .transform((value) => ({ ...value, src: null }));

const externalInput = z
  .object({
    ...shared,
    kind: z.literal('external'),
    src: externalSrc,
  })
  .strict()
  .transform((value) => ({ ...value, code: null }));

/** Create and update take the whole snippet: the form always sends all of it. */
export const snippetInputSchema = z.discriminatedUnion('kind', [inlineInput, externalInput]);
export type SnippetInput = z.output<typeof snippetInputSchema>;

/** A stored snippet, as the service returns it. */
export interface SnippetRecord {
  id: number;
  slug: string;
  name: string;
  kind: SnippetKind;
  code: string | null;
  src: string | null;
  lazy: boolean;
  consentCategory: string | null;
  enabled: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Exactly what crosses into the browser to run a snippet. */
export interface PublicSnippet {
  slug: string;
  kind: SnippetKind;
  code: string | null;
  src: string | null;
  lazy: boolean;
  consentCategory: string | null;
}

/** Notes, the name and the row id stay on the server: they are for administrators. */
export function publicSnippet(row: SnippetRecord): PublicSnippet {
  return {
    slug: row.slug,
    kind: row.kind,
    code: row.code,
    src: row.src,
    lazy: row.lazy,
    consentCategory: row.consentCategory,
  };
}

/** The origin a Content-Security-Policy `script-src` has to allow for `src`. */
export function externalHost(src: string | null): string | null {
  if (!src) return null;
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

export function scriptShortcode(slug: string): string {
  return `[script name="${slug}"]`;
}
