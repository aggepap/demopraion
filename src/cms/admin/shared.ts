/**
 * Serialisable helpers shared between admin server pages and client
 * components. A `ResolvedCollection` is already plain data (its `fields` are
 * plain objects), so it crosses the server→client boundary as-is; only the
 * full `CmsConfig` (which holds a Map) must not be passed to client code.
 */
import type { Field, FieldLabel, ResolvedCollection } from '../config';
import type { IconName } from './ui/icon-names';

export type CollectionSummary = Pick<
  ResolvedCollection,
  'key' | 'label' | 'labelPlural' | 'icon' | 'singleton' | 'hidden' | 'module'
>;

export interface SidebarToolSummary {
  href: string;
  label: string;
  icon?: IconName;
  group?: string;
}

/**
 * Module key → sidebar heading, in render order.
 *
 * Collections and tools belonging to a listed module get their own section
 * instead of falling into Content. A map rather than a pair of hardcoded
 * filters because the second module proved the point: a `booking` collection
 * used to land silently next to Articles, which is not wrong enough to notice
 * and not right enough to keep.
 */
export const MODULE_GROUPS: ReadonlyArray<{ module: string; label: string; group: string }> = [
  { module: 'commerce', label: 'Ecommerce', group: 'ecommerce' },
  { module: 'booking', label: 'Booking', group: 'booking' },
];

/**
 * The Settings tab holding the Praion.ai connection.
 *
 * Shared rather than written out twice: the settings page names the tab and the
 * retired `/admin/api-tokens` route redirects to it, and a tab name that no tab
 * answers to silently lands on General — the exact failure `?tab=seo` had.
 */
export const PRAION_TAB = 'Connect to Praion.ai';

export interface SidebarSections {
  content: CollectionSummary[];
  modules: { label: string; items: CollectionSummary[]; tools: SidebarToolSummary[] }[];
  system: SidebarToolSummary[];
}

/**
 * Split collections and tools into the sidebar's sections.
 *
 * Pure and separate from the component so it can be tested without a router or
 * a nav context — the interesting behaviour is entirely in this sorting, and it
 * is the part that breaks quietly when a module is added.
 */
export function groupSidebarItems(
  collections: CollectionSummary[],
  tools: SidebarToolSummary[] = [],
): SidebarSections {
  const visible = collections.filter((c) => !c.hidden);
  const grouped = new Set(MODULE_GROUPS.map((g) => g.module));
  const groupKeys = new Set(MODULE_GROUPS.map((g) => g.group));

  return {
    content: visible.filter((c) => !c.module || !grouped.has(c.module)),
    modules: MODULE_GROUPS.map((g) => ({
      label: g.label,
      items: visible.filter((c) => c.module === g.module),
      tools: tools.filter((t) => t.group === g.group),
    })).filter((s) => s.items.length > 0 || s.tools.length > 0),
    // Anything no module claims is System — including a tool whose group names a
    // module that has since been removed, which should still be reachable rather
    // than vanishing from the nav.
    system: tools.filter((t) => !t.group || !groupKeys.has(t.group)),
  };
}

/**
 * The collections an editor sees in the sidebar and on the dashboard.
 *
 * One rule for both screens: not `hidden`, and not tied to a module that is
 * switched off. Having no public page is a different matter — that is decided
 * by `routing` — so testimonials, brands and popups are listed here even
 * though visitors never reach them at a URL of their own.
 */
export function visibleAdminCollections<T extends Pick<CollectionSummary, 'hidden' | 'module'>>(
  collections: T[],
  moduleFlags: Readonly<Record<string, boolean>>,
): T[] {
  return collections.filter((c) => !c.hidden && (!c.module || moduleFlags[c.module] === true));
}

/** Resolve a (possibly per-locale) label to display text. */
export function labelText(label: FieldLabel | undefined, locale: string, fallback: string): string {
  if (!label) return fallback;
  if (typeof label === 'string') return label;
  return label[locale] ?? Object.values(label)[0] ?? fallback;
}

/** A run of leaf fields under one heading, or a self-chroming group/repeater. */
export type FormBlock =
  | { type: 'section'; title: string; fields: Field[] }
  | { type: 'field'; field: Field };

/**
 * Group a field list into form blocks, preserving declared order. Leaf fields
 * collect into titled sections (by explicit `field.section`, else a default
 * "Content"/"Details"); each `group`/`repeater` renders standalone since it
 * brings its own Section chrome.
 *
 * Used both for a collection's top-level fields (`DocumentForm`) and for a
 * group's children (`GroupControl`), so admin-defined fields assigned to a
 * group get their own heading inside it.
 *
 * `nestRepeaters` changes that one rule: a repeater or group naming a section
 * joins it instead of standing alone. Without it, one price with its seasonal
 * overrides is two cards — "Pricing" holding a single number, then "Seasonal
 * prices" beside it — and a section's own fields can even render AFTER the
 * repeater that belongs to it, because the repeater broke the run. Opt-in, per
 * collection, so the collections that were laid out around the old rule keep it.
 */
export function buildBlocks(
  fields: Field[],
  defaultTitle = 'Content',
  { nestRepeaters = false }: { nestRepeaters?: boolean } = {},
): FormBlock[] {
  const blocks: FormBlock[] = [];
  let run: Field[] = [];
  let runTitle = '';
  let leafRuns = 0;

  const flush = () => {
    if (run.length) {
      blocks.push({ type: 'section', title: runTitle || defaultTitle, fields: run });
      run = [];
    }
  };

  for (const f of fields) {
    const standalone = f.kind === 'group' || f.kind === 'repeater';
    // A sectioned repeater is only absorbed when the collection asked for it AND
    // it says which section it belongs to; an unsectioned one has no card to
    // join and keeps its own.
    if (standalone && !(nestRepeaters && f.section)) {
      flush();
      blocks.push({ type: 'field', field: f });
      continue;
    }
    const title = f.section ?? (leafRuns === 0 ? defaultTitle : 'Details');
    if (run.length && title !== runTitle) flush();
    if (run.length === 0) {
      runTitle = title;
      leafRuns++;
    }
    run.push(f);
  }
  flush();
  return blocks;
}

export function collectionSummary(c: ResolvedCollection): CollectionSummary {
  return {
    key: c.key,
    label: c.label,
    labelPlural: c.labelPlural,
    icon: c.icon,
    singleton: c.singleton,
    hidden: c.hidden,
    module: c.module,
  };
}
