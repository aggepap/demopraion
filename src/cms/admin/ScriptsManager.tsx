'use client';

import { useState } from 'react';

import { externalHost, scriptShortcode, type SnippetKind } from '../core/scripts/schema';
import { cmsApi, CmsApiError } from './api-client';
import { CopyShortcodeButton } from './CopyShortcodeButton';
import { Badge, Button, Checkbox, Field, InfoTip, Select, TextInput, Textarea } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/**
 * Admin → Scripts: JavaScript saved once and placed anywhere with
 * `[script name="<slug>"]`.
 *
 * Each snippet either runs for every visitor (a service connection — a chat
 * widget, a booking engine) or waits for one cookie category. External scripts
 * are only loaded if the site's Content-Security-Policy allows their host, and
 * that policy lives in code, not here — so the screen says which host to add
 * rather than letting a snippet fail silently in production.
 */

export interface SnippetRow {
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
}

export interface ConsentCategoryOption {
  key: string;
  name: string;
}

type Draft = Omit<SnippetRow, 'id'> & { id: number | null };

const EMPTY: Draft = {
  id: null,
  slug: '',
  name: '',
  kind: 'inline',
  code: '',
  src: '',
  lazy: false,
  consentCategory: null,
  enabled: true,
  notes: '',
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** The request body: only the field that belongs to the kind — the schema refuses the other. */
function toBody(snippet: Omit<Draft, 'id'>) {
  return {
    name: snippet.name,
    slug: snippet.slug,
    kind: snippet.kind,
    ...(snippet.kind === 'inline' ? { code: snippet.code ?? '' } : { src: snippet.src ?? '' }),
    lazy: snippet.lazy,
    consentCategory: snippet.consentCategory,
    enabled: snippet.enabled,
    notes: snippet.notes,
  };
}

/** zod `flatten()` field errors, as the route factory returns them on a 422. */
function fieldErrors(err: unknown): Record<string, string[]> {
  if (!(err instanceof CmsApiError) || !err.issues || typeof err.issues !== 'object') return {};
  const fields = (err.issues as { fieldErrors?: unknown }).fieldErrors;
  return fields && typeof fields === 'object' ? (fields as Record<string, string[]>) : {};
}

function CspNotice({ src }: { src: string | null }) {
  const host = externalHost(src);
  if (!host) return null;
  return (
    <p className="text-xs text-amber-800">
      Loads from <code className="font-mono">{host}</code>. The site&apos;s Content-Security-Policy must list this
      host under <code className="font-mono">script-src</code> (in <code className="font-mono">next.config.ts</code>{' '}
      and the server config), or browsers will block it.
    </p>
  );
}

export function ScriptsManager({
  initial,
  categories,
}: {
  initial: SnippetRow[];
  categories: ConsentCategoryOption[];
}) {
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const categoryName = (key: string) => categories.find((c) => c.key === key)?.name ?? key;

  async function refresh() {
    const res = await cmsApi.listScripts<SnippetRow[]>();
    setRows(res.data);
  }

  function open(next: Draft) {
    setDraft(next);
    setSlugTouched(next.id !== null);
    setErrors({});
    setMessage(null);
  }

  const patch = (change: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...change } : current));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setErrors({});
    setMessage(null);
    const body = toBody(draft);
    try {
      if (draft.id === null) await cmsApi.createScript(body);
      else await cmsApi.updateScript(draft.id, body);
      await refresh();
      setDraft(null);
    } catch (err) {
      if (err instanceof CmsApiError && err.status === 409) {
        setErrors({ slug: ['Another snippet already uses this shortcode name.'] });
      } else {
        setErrors(fieldErrors(err));
        setMessage(err instanceof CmsApiError ? err.message : 'Could not save the snippet.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: SnippetRow) {
    setMessage(null);
    try {
      await cmsApi.updateScript(row.id, toBody({ ...row, enabled: !row.enabled }));
      await refresh();
    } catch (err) {
      setMessage(err instanceof CmsApiError ? err.message : 'Could not update the snippet.');
    }
  }

  async function remove(row: SnippetRow) {
    const ok = await confirm({
      title: `Delete “${row.name}”?`,
      message: `Every ${scriptShortcode(row.slug)} on the site will render nothing. This cannot be undone.`,
    });
    if (!ok) return;
    try {
      await cmsApi.deleteScript(row.id);
      await refresh();
    } catch (err) {
      setMessage(err instanceof CmsApiError ? err.message : 'Could not delete the snippet.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <p className="max-w-2xl text-sm text-neutral-600">
        Save a JavaScript snippet once, then place its shortcode in any page, post or section. Code on this screen runs
        in every visitor&apos;s browser — only add scripts from sources you trust.
      </p>

      {message ? (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      ) : null}

      {draft === null ? (
        <div>
          <Button type="button" onClick={() => open(EMPTY)}>
            Add snippet
          </Button>
        </div>
      ) : (
        <form
          onSubmit={save}
          aria-label={draft.id === null ? 'New snippet' : `Edit ${draft.name}`}
          className="flex max-w-2xl flex-col gap-4 rounded-sm border border-neutral-200 bg-white p-4"
        >
          <Field label="Name" required error={errors.name}>
            <TextInput
              value={draft.name}
              maxLength={120}
              onChange={(e) =>
                patch({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })
              }
            />
          </Field>
          <Field
            label="Shortcode name"
            required
            description="The name inside the shortcode you place in pages. Lowercase letters, numbers and dashes."
            error={errors.slug}
          >
            <TextInput
              value={draft.slug}
              maxLength={64}
              className="font-mono"
              onChange={(e) => {
                setSlugTouched(true);
                patch({ slug: e.target.value });
              }}
            />
          </Field>
          {draft.slug ? (
            <p className="text-xs text-neutral-600">
              Place it with <code className="font-mono">{scriptShortcode(draft.slug)}</code>
              {/* A consequence, so printed rather than tucked behind the "i". */}
              {draft.id !== null ? ' — changing the name breaks shortcodes already placed.' : null}
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 flex items-center gap-1 text-sm font-medium text-neutral-800">
              Type
              <InfoTip label="About the snippet type">
                Inline code is typed here and runs inside the page. An external script is a file the browser
                loads from another address, such as a chat or booking widget.
              </InfoTip>
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="snippet-kind"
                checked={draft.kind === 'inline'}
                onChange={() => patch({ kind: 'inline' })}
              />
              Inline code
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="snippet-kind"
                checked={draft.kind === 'external'}
                onChange={() => patch({ kind: 'external' })}
              />
              External script (URL)
            </label>
          </fieldset>

          {draft.kind === 'inline' ? (
            <Field
              label="JavaScript"
              required
              description="Only the code — without the <script> tags around it."
              error={errors.code}
            >
              <Textarea
                value={draft.code ?? ''}
                rows={12}
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(e) => patch({ code: e.target.value })}
              />
            </Field>
          ) : (
            <>
              <Field label="Script URL" required description="A full https:// address." error={errors.src}>
                <TextInput
                  type="url"
                  value={draft.src ?? ''}
                  placeholder="https://"
                  className="font-mono"
                  onChange={(e) => patch({ src: e.target.value })}
                />
              </Field>
              <CspNotice src={draft.src} />
            </>
          )}
          <p className="text-xs text-neutral-600">
            If the script sends data or loads images from other hosts, those hosts may also need adding to the
            policy&apos;s <code className="font-mono">connect-src</code> / <code className="font-mono">img-src</code>.
          </p>

          <Field
            label="Cookie consent"
            description="Tracking and advertising code must wait for consent. Code that only connects a service the visitor asked for (chat, bookings) can run straight away."
            error={errors.consentCategory}
          >
            <Select
              value={draft.consentCategory ?? ''}
              onChange={(e) => patch({ consentCategory: e.target.value || null })}
            >
              <option value="">None — runs for every visitor</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  After consent: {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Checkbox
            label="Load when the page is idle"
            info="For scripts that are not needed straight away; keeps them from slowing the first view."
            checked={draft.lazy}
            onChange={(e) => patch({ lazy: e.target.checked })}
          />
          <Checkbox
            label="Enabled"
            hint="A disabled snippet renders nothing wherever its shortcode is placed."
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <Field label="Notes" description="For administrators only; never sent to the site." error={errors.notes}>
            <Textarea value={draft.notes ?? ''} rows={2} maxLength={2000} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save snippet'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No script snippets yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-sm border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-neutral-900">{row.name}</span>
                <Badge tone={row.kind === 'inline' ? 'neutral' : 'blue'}>
                  {row.kind === 'inline' ? 'Inline' : 'External'}
                </Badge>
                {row.enabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="amber">Disabled</Badge>}
                <span className="text-xs text-neutral-600">
                  {row.consentCategory ? `After consent: ${categoryName(row.consentCategory)}` : 'Runs without consent'}
                </span>
                <InfoTip label="About these labels">
                  Inline: the code is stored here. External: the browser loads a script file from another
                  address. Disabled snippets render nothing where their shortcode is placed. “After consent”
                  waits until the visitor accepts that cookie category; “Runs without consent” runs for everyone.
                </InfoTip>
              </div>
              <CopyShortcodeButton shortcode={scriptShortcode(row.slug)} />
              {row.kind === 'external' ? <CspNotice src={row.src} /> : null}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => open({ ...row, notes: row.notes ?? '' })}>
                  Edit
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => toggle(row)}>
                  {row.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(row)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
