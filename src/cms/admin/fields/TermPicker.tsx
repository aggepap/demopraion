'use client';

/**
 * Managed picker for taxonomy relations (`picker: 'categoryTree' | 'termList'`).
 *
 * Shows the selected terms as chips, and a "Manage …" drawer listing every term
 * with checkboxes to select, plus inline create / rename / delete — so the
 * vocabulary can be curated without leaving the document form. That drawer is
 * the whole reason a taxonomy can be documents without costing the editor a
 * second screen.
 *
 * Two variants:
 * - `categoryTree` nests rows by their `parent` self-relation.
 * - `termList` is flat, for a collection with no `parent` field. It is not a
 *   cosmetic difference: the tree variant posts `data.parent` on create, and a
 *   collection without that field rejects the unknown key — every create from
 *   the drawer would answer 400.
 */
import { useEffect, useMemo, useState } from 'react';

import type { RelationField } from '../../config';
import { slugify } from '../../core/slug';
import { cmsApi, CmsApiError } from '../api-client';
import { Button, Drawer, Icon, IconButton, InfoTip, Select, TextInput } from '../ui';
import { useConfirm } from '../ui/ConfirmDialog';

interface TermRow {
  id: number;
  /** Title resolved for the active locale (display). */
  title: string;
  /** Raw title as stored — a localized `{ [locale]: string }` map (or a legacy
   *  plain string) — kept for per-locale renaming. */
  titleRaw: unknown;
  parentId?: number;
  data: Record<string, unknown>;
}

/** What the drawer calls the thing it manages. */
interface TermNoun {
  singular: string;
  plural: string;
}

const DEFAULT_NOUN: TermNoun = { singular: 'category', plural: 'categories' };

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Resolve a (possibly localized) title for display, with sensible fallbacks. */
function resolveTitle(raw: unknown, locale: string, defaultLocale: string, fallback: string): string {
  if (typeof raw === 'string') return raw.trim() || fallback;
  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    const pick = (l: string) =>
      typeof map[l] === 'string' && (map[l] as string).trim() ? (map[l] as string) : undefined;
    const any = Object.values(map).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    return pick(locale) || pick(defaultLocale) || any || fallback;
  }
  return fallback;
}

export function TermPicker({
  field,
  locale,
  locales,
  defaultLocale,
  value,
  onChange,
}: {
  field: RelationField;
  locale: string;
  /** Every site locale, so a new term can be born with a name in all of them. */
  locales: string[];
  defaultLocale: string;
  value: unknown;
  onChange: (value: number | number[] | undefined) => void;
}) {
  const flat = field.picker === 'termList';
  const noun = field.pickerNoun ?? DEFAULT_NOUN;

  // Only positive integers are ids. The cast this used to be rendered a
  // pre-migration `{id,label,slug}` row as a chip reading `#[object Object]`,
  // which says nothing about what is wrong or what to do about it. The read
  // path has always filtered the same way (`relationIds`); so does this now.
  const raw: unknown[] = field.many
    ? Array.isArray(value)
      ? value
      : []
    : value == null
      ? []
      : [value];
  const selected: number[] = raw.filter(
    (v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0,
  );
  const legacyRows = raw.length - selected.length;

  const [terms, setTerms] = useState<TermRow[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each mutation to re-run the fetch effect.
  const [reload, setReload] = useState(0);
  const refetch = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    // Terms are canonical in the site default locale (single entities with
    // localized titles), so list them there regardless of the document's tab —
    // that keeps a selected id resolvable in every language, no dangling `#id`.
    cmsApi
      .list<{ id: number; slug: string; data: Record<string, unknown> }>(field.to, {
        locale: defaultLocale,
        pageSize: 100,
      })
      .then((res) => {
        if (!active) return;
        setTerms(
          res.items.map((o) => {
            const data = o.data ?? {};
            const parent = data.parent;
            return {
              id: o.id,
              title: resolveTitle(data.title, locale, defaultLocale, o.slug),
              titleRaw: data.title,
              parentId: typeof parent === 'number' ? parent : undefined,
              data,
            };
          }),
        );
      })
      .catch(() => {
        /* best-effort — an empty list still lets you create the first term */
      });
    return () => {
      active = false;
    };
  }, [field.to, locale, defaultLocale, reload]);

  const byId = useMemo(() => new Map(terms.map((c) => [c.id, c])), [terms]);

  const setSelected = (ids: number[]) => {
    if (field.many) onChange(ids.length ? ids : undefined);
    else onChange(ids.length ? ids[ids.length - 1] : undefined);
  };
  const toggle = (id: number) =>
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-sm bg-warm-gold/15 px-2 py-1 text-xs text-warm-gold-deep"
            >
              {byId.get(id)?.title ?? `#${id}`}
              <button type="button" onClick={() => toggle(id)} aria-label="Remove" className="hover:text-red-700">
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">No {noun.plural} selected.</p>
      )}

      {legacyRows > 0 ? (
        <p className="rounded-sm border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          {legacyRows} {legacyRows === 1 ? `${noun.singular} is` : `${noun.plural} are`} still stored in the
          old per-experience format and cannot be shown here. Run{' '}
          <code className="font-mono">npm run db:migrate-booking-facets</code> to turn them into shared{' '}
          {noun.plural}. Until then this document cannot be saved, and picking {noun.plural} below would
          replace the old entries.
        </p>
      ) : null}

      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Icon name="tags" size={14} /> Manage {noun.plural}
        </Button>
      </div>

      {open ? (
        <ManageDrawer
          terms={terms}
          byId={byId}
          selected={selected}
          locale={locale}
          locales={locales}
          defaultLocale={defaultLocale}
          collection={field.to}
          flat={flat}
          noun={noun}
          error={error}
          setError={setError}
          onToggle={toggle}
          onChanged={refetch}
          onClose={() => {
            setOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ManageDrawer({
  terms,
  byId,
  selected,
  locale,
  locales,
  defaultLocale,
  collection,
  flat,
  noun,
  error,
  setError,
  onToggle,
  onChanged,
  onClose,
}: {
  terms: TermRow[];
  byId: Map<number, TermRow>;
  selected: number[];
  locale: string;
  locales: string[];
  defaultLocale: string;
  collection: string;
  flat: boolean;
  noun: TermNoun;
  error: string | null;
  setError: (e: string | null) => void;
  onToggle: (id: number) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newParent, setNewParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { confirm, dialog } = useConfirm();

  // children keyed by parent id; `0` holds the roots (no/absent parent).
  const childrenOf = useMemo(() => {
    const map = new Map<number, TermRow[]>();
    for (const c of terms) {
      const key = !flat && c.parentId && byId.has(c.parentId) ? c.parentId : 0;
      (map.get(key) ?? map.set(key, []).get(key)!).push(c);
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [terms, byId, flat]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function createTerm() {
    const title = newTitle.trim();
    if (!title) return;
    // The core slugifier, not a local one: it transliterates Greek instead of
    // discarding it. An ASCII-only slug is EMPTY for a Greek name, and on a
    // Greek-default site that meant every term created here fell back to the
    // generic base and came out as `term-2`, `term-3` — and this slug is the
    // public filter key.
    const base = slugify(title) || 'term';
    const parent = !flat && newParent ? Number(newParent) : undefined;
    /*
     * Seed EVERY site locale, not just the default and the active one.
     *
     * Those two collapse to one entry whenever you are editing in the default
     * language — the common case — and the term is created `published`, where
     * a required localized field is enforced for every locale. The result was a
     * flat "title.en is required" on a form with a single name box and nowhere
     * to type an English one.
     *
     * The seeded name is the same string in each language; translating it is a
     * rename on that locale's tab, which the drawer already does per-locale.
     */
    const titleMap: Record<string, string> = {};
    for (const l of [...locales, defaultLocale, locale]) titleMap[l] = title;
    await run(async () => {
      // Retry with a numeric suffix if the slug (→ unique canonical path) clashes.
      for (let attempt = 0; ; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
        try {
          // Created in the default locale so it's the single canonical entity.
          await cmsApi.create(collection, {
            slug,
            locale: defaultLocale,
            status: 'published',
            data: { title: titleMap, ...(parent ? { parent } : {}) },
          });
          break;
        } catch (err) {
          const conflict = err instanceof CmsApiError && (err.status === 409 || err.code === 'conflict');
          if (!conflict || attempt >= 5) throw err;
        }
      }
      setNewTitle('');
      setNewParent('');
    });
  }

  async function rename(term: TermRow) {
    const title = editTitle.trim();
    if (!title) return;
    // Set only the active locale's title, preserving the other languages.
    const existing =
      term.titleRaw && typeof term.titleRaw === 'object'
        ? { ...(term.titleRaw as Record<string, string>) }
        : typeof term.titleRaw === 'string' && term.titleRaw
          ? { [defaultLocale]: term.titleRaw }
          : {};
    existing[locale] = title;
    await run(async () => {
      // The slug is deliberately left alone. It is the public filter key, so a
      // rename must not move the URL — and leaving it fixed is what stops a
      // reworded term splitting into two filter entries.
      await cmsApi.update(collection, term.id, { data: { ...term.data, title: existing } });
      setEditingId(null);
    });
  }

  async function remove(term: TermRow) {
    const ok = await confirm({
      title: `Delete ${noun.singular} "${term.title}"?`,
      message: `Anything using it keeps its other ${noun.plural}. This cannot be undone.`,
    });
    if (!ok) return;
    await run(async () => {
      await cmsApi.remove(collection, term.id);
      if (selected.includes(term.id)) onToggle(term.id);
    });
  }

  const renderNode = (term: TermRow, depth: number): React.ReactNode => {
    const kids = flat ? [] : (childrenOf.get(term.id) ?? []);
    const isEditing = editingId === term.id;
    return (
      <div key={term.id}>
        <div
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-50"
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {depth > 0 ? <Icon name="chevron-right" size={12} className="text-neutral-300" /> : null}
          <input
            type="checkbox"
            className="h-4 w-4 accent-warm-gold-deep"
            // The row's only name was the text beside it, which is not a label.
            aria-label={term.title}
            checked={selected.includes(term.id)}
            onChange={() => onToggle(term.id)}
          />
          {isEditing ? (
            <>
              <TextInput
                value={editTitle}
                autoFocus
                className="h-7 flex-1"
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && rename(term)}
              />
              <IconButton type="button" aria-label="Save" disabled={busy} onClick={() => rename(term)}>
                <Icon name="check" size={14} />
              </IconButton>
              <IconButton type="button" aria-label="Cancel" onClick={() => setEditingId(null)}>
                <Icon name="x" size={14} />
              </IconButton>
            </>
          ) : (
            <>
              <span className="flex-1 truncate text-sm text-neutral-800">{term.title}</span>
              <IconButton
                type="button"
                aria-label="Rename"
                onClick={() => {
                  setEditingId(term.id);
                  setEditTitle(term.title);
                }}
              >
                <Icon name="file-edit" size={14} />
              </IconButton>
              <IconButton
                type="button"
                aria-label="Delete"
                className="hover:text-red-700"
                disabled={busy}
                onClick={() => remove(term)}
              >
                <Icon name="trash" size={14} />
              </IconButton>
            </>
          )}
        </div>
        {kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const roots = childrenOf.get(0) ?? [];

  return (
    <Drawer title={`Manage ${noun.plural}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        {/* New term */}
        <div className="rounded-sm border border-neutral-200 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">New {noun.singular}</p>
            <InfoTip label={`About new ${noun.plural}`}>
              Created straight away as published, with the same name in every language. To translate the
              name, switch the form to that language and rename it here.
            </InfoTip>
          </div>
          <div className="flex flex-col gap-2">
            <TextInput
              placeholder={`${cap(noun.singular)} name`}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTerm()}
            />
            <div className="flex items-center gap-2">
              {/* A flat collection has no `parent` field, and every document
                  schema is strict — posting `parent` there is a 400. */}
              {flat ? null : (
                <Select
                  aria-label={`Put the new ${noun.singular} inside`}
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                  className="flex-1"
                >
                  <option value="">— top level —</option>
                  {terms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                type="button"
                size="sm"
                className={flat ? 'ml-auto' : undefined}
                disabled={busy || !newTitle.trim()}
                onClick={createTerm}
              >
                <Icon name="plus" size={14} /> Add
              </Button>
            </div>
          </div>
        </div>

        {/* Tree (flat when the collection does not nest) */}
        <div className="flex flex-col gap-0.5">
          {roots.length > 0 ? (
            <div className="mb-1 flex items-center gap-1.5 px-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">All {noun.plural}</p>
              <InfoTip label={`About the ${noun.plural} list`}>
                Tick one to add it to this document. Renaming changes the name only in the language you are
                editing; its web address stays the same.
              </InfoTip>
            </div>
          ) : null}
          {roots.length > 0 ? (
            roots.map((c) => renderNode(c, 0))
          ) : (
            <p className="px-2 py-4 text-center text-sm text-neutral-400">
              No {noun.plural} yet — create your first one above.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
      {dialog}
    </Drawer>
  );
}
