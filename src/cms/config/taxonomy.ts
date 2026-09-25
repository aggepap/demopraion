/**
 * A category taxonomy for a post collection (articles, answers, case studies).
 *
 * An ordinary collection, like every taxonomy in the core: one document in the
 * default locale with a per-locale title, so a post in any language points at
 * the same term. `hierarchical` adds the `parent` self-relation and the tree
 * picker. Same field shape as the booking terms, without a module gate — post
 * categories are live whenever the collection that uses them is.
 */
import { defineCollection, type CollectionDefinition } from './collection';
import { f, type Field } from './fields';
import type { IconName } from '../admin/ui/icon-names';

export interface TaxonomyCollectionOptions {
  key: string;
  label: string;
  labelPlural: string;
  /** Public archive path, e.g. `/blog/categories/{slug}`. */
  pathTemplate: string;
  icon?: IconName;
  hierarchical?: boolean;
  extraFields?: Field[];
}

export function taxonomyCollection(opts: TaxonomyCollectionOptions): CollectionDefinition {
  return defineCollection({
    key: opts.key,
    label: opts.label,
    labelPlural: opts.labelPlural,
    icon: opts.icon ?? 'folder-tree',
    titlePath: 'title',
    seo: true,
    routing: { pathTemplate: opts.pathTemplate },
    fields: [
      f.text('title', {
        label: opts.label,
        required: true,
        maxLength: 191,
        localized: true,
        description: 'The name, shown as the heading of its page and wherever it is listed. Each language has its own.',
      }),
      f.textarea('description', {
        label: 'Description',
        localized: true,
        rows: 3,
        description: 'Shown at the top of the category page.',
      }),
      ...(opts.hierarchical
        ? [
            f.relation('parent', {
              label: 'Parent',
              to: opts.key,
              picker: 'categoryTree',
              shared: true,
              description: 'Leave empty for a top-level category.',
            }),
          ]
        : []),
      ...(opts.extraFields ?? []),
    ],
  });
}
