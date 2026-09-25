'use client';

import { useEffect, useState } from 'react';

import type { RelationField } from '../../config';
import { cmsApi } from '../api-client';
import { Icon, TextInput } from '../ui';

interface DocOption {
  id: number;
  slug: string;
  metaTitle: string | null;
  data: Record<string, unknown>;
}

function optionLabel(doc: DocOption): string {
  const data = doc.data ?? {};
  const fromData =
    (typeof data.title === 'string' && data.title) ||
    (typeof data.name === 'string' && data.name) ||
    (typeof data.question === 'string' && data.question) ||
    '';
  return doc.metaTitle || fromData || doc.slug || `#${doc.id}`;
}

/**
 * Relation picker with typeahead search (server-side `search`) + the current
 * selection shown as removable chips. Replaces the old fetch-100 checkbox wall.
 */
export function RelationPicker({
  field,
  value,
  onChange,
}: {
  field: RelationField;
  value: unknown;
  onChange: (value: number | number[] | undefined) => void;
}) {
  const selectedIds: number[] = field.many
    ? Array.isArray(value)
      ? (value as number[])
      : []
    : typeof value === 'number'
      ? [value]
      : [];

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [results, setResults] = useState<DocOption[]>([]);
  const [known, setKnown] = useState<Record<number, string>>({});
  const [openList, setOpenList] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let active = true;
    cmsApi
      .list<DocOption>(field.to, { search: debouncedQ || undefined, pageSize: 50 })
      .then((r) => {
        if (!active) return;
        setResults(r.items);
        setKnown((prev) => {
          const next = { ...prev };
          for (const o of r.items) next[o.id] = optionLabel(o);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [field.to, debouncedQ]);

  function add(id: number) {
    if (field.many) {
      if (!selectedIds.includes(id)) onChange([...selectedIds, id]);
    } else {
      onChange(id);
    }
    setQ('');
    setOpenList(false);
  }

  function remove(id: number) {
    if (field.many) {
      const next = selectedIds.filter((x) => x !== id);
      onChange(next.length ? next : undefined);
    } else {
      onChange(undefined);
    }
  }

  const available = results.filter((o) => !selectedIds.includes(o.id));
  const canAddMore = field.many || selectedIds.length === 0;

  return (
    <div className="flex flex-col gap-2">
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-sm bg-warm-gold/15 px-2 py-1 text-xs text-warm-gold-deep"
            >
              {known[id] ?? `#${id}`}
              <button type="button" onClick={() => remove(id)} aria-label="Remove" className="hover:text-red-700">
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {canAddMore ? (
        <div className="relative">
          <TextInput
            value={q}
            placeholder={`Search ${field.to}…`}
            onChange={(e) => {
              setQ(e.target.value);
              setOpenList(true);
            }}
            onFocus={() => setOpenList(true)}
            onBlur={() => setTimeout(() => setOpenList(false), 150)}
          />
          {openList && available.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-sm border border-neutral-200 bg-white shadow-lg">
              {available.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(o.id)}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
                  >
                    {optionLabel(o)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
