'use client';

import { useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { CookieScanner } from './CookieScanner';
import { Field, InfoTip } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

interface Service {
  id: number;
  categoryId: number;
  name: string;
  provider: string | null;
  purpose: Record<string, string> | null;
  enabled: boolean;
}

interface Category {
  id: number;
  key: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  required: boolean;
  sortOrder: number;
  services: Service[];
}

const input =
  'rounded-sm border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';
const primaryBtn = 'rounded-sm bg-warm-gold px-3 py-1.5 text-sm font-medium text-midnight-navy hover:bg-warm-gold-dark';
const ghostBtn = 'rounded-sm border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100';

/** The explanations shared by the add and edit forms, said once. */
const HELP = {
  key: 'The name the code uses for this category. Google Analytics waits for the category with the key “analytics”, and a script snippet names the category it waits for. Left empty, it is made from the name; it cannot be edited here afterwards.',
  required:
    'For cookies the site cannot work without, such as the sign-in session. The banner shows the category as always on, and visitors cannot switch it off.',
  provider: 'The company behind the service, e.g. Google. The banner lists it under the category.',
  purpose:
    'What the service does and why it stores data, in one short sentence per language. Shown to visitors in the cookie banner.',
  enabled: 'Off hides the service from the banner and the cookie declaration, without deleting it.',
} as const;

/** Machine-slug from a display name (used when the key field is left blank). */
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Build a `{el,en}` locale map from two inputs, or null when both are empty. */
function localeMap(el: string, en: string): Record<string, string> | null {
  if (!el.trim() && !en.trim()) return null;
  return { el: el.trim(), en: (en.trim() || el.trim()) };
}

export interface ServicePatch {
  name?: string;
  provider?: string | null;
  purpose?: Record<string, string> | null;
  enabled?: boolean;
}
export interface CategoryPatch {
  name?: Record<string, string>;
  description?: Record<string, string> | null;
  required?: boolean;
}

export function CookiesManager({ initial }: { initial: Category[] }) {
  const [categories, setCategories] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const [key, setKey] = useState('');
  const [nameEl, setNameEl] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [required, setRequired] = useState(false);

  async function refresh() {
    const res = await cmsApi.getCookieCatalog<Category[]>();
    setCategories(res.data);
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nameEl.trim()) return setError('Enter a name (EL).');
    const finalKey = (key.trim() || slugify(nameEl)).slice(0, 64);
    if (!finalKey) return setError('Enter a key (letters/numbers).');
    try {
      await cmsApi.createCookieCategory({
        key: finalKey,
        name: { el: nameEl, en: nameEn || nameEl },
        required,
        sortOrder: categories.length,
      });
      setKey('');
      setNameEl('');
      setNameEn('');
      setRequired(false);
      await refresh();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Failed to add category');
    }
  }

  const updateCategory = async (id: number, patch: CategoryPatch) => {
    await cmsApi.updateCookieCategory(id, patch);
    await refresh();
  };
  const removeCategory = async (id: number) => {
    const ok = await confirm({
      title: 'Delete this category?',
      message: 'Every service inside it is deleted too. This cannot be undone.',
    });
    if (!ok) return;
    await cmsApi.deleteCookieCategory(id);
    await refresh();
  };
  const addService = async (categoryId: number, svc: ServicePatch) => {
    await cmsApi.createCookieService({ categoryId, ...svc });
    await refresh();
  };
  const updateService = async (id: number, patch: ServicePatch) => {
    await cmsApi.updateCookieService(id, patch);
    await refresh();
  };
  const removeService = async (id: number) => {
    await cmsApi.deleteCookieService(id);
    await refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {/* Inside the manager, not the page: the scanner proposes rows into these
          categories and has to refresh the same list when one is added. */}
      <CookieScanner categories={categories} onDeclared={refresh} />

      <form onSubmit={addCategory} className="flex flex-wrap items-end gap-2 rounded-sm border border-neutral-200 bg-white p-4">
        <input className={input} aria-label="Name" placeholder="Name (EL) *" value={nameEl} onChange={(e) => setNameEl(e.target.value)} />
        <input className={input} aria-label="Name" placeholder="Name (EN)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        {/*
          Wide enough to show its own placeholder. The shared `input` class sets
          no width, so this field sized itself to the form and cut the hint mid
          word — "key — optional (auto from na" — which is exactly the field
          whose behaviour needs explaining.
        */}
        <Field label="Key" description={HELP.key}>
          <input
            className={`${input} w-full min-w-[16rem] sm:w-auto`}
            aria-label="Key — optional, generated from the name when left empty"
            placeholder="key — optional (auto from name)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <span className="flex items-center gap-1">
          <label className="flex min-h-[1.5rem] cursor-pointer items-center gap-1.5 rounded-sm px-1 text-xs text-neutral-700 hover:bg-neutral-100">
            <input
              type="checkbox"
              aria-label="Required category"
              className="h-4 w-4"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            required
          </label>
          <InfoTip label="About required categories">{HELP.required}</InfoTip>
        </span>
        <button type="submit" className={primaryBtn}>
          Add category
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {categories.length ? (
          categories.map((c) => (
            <CategoryCard
              key={c.id}
              category={c}
              onUpdate={updateCategory}
              onRemove={removeCategory}
              onAddService={addService}
              onUpdateService={updateService}
              onRemoveService={removeService}
            />
          ))
        ) : (
          <p className="rounded-sm border border-dashed border-neutral-300 px-3 py-10 text-center text-sm text-neutral-600">
            No cookie categories yet.
          </p>
        )}
      </div>
      {dialog}
    </div>
  );
}

function CategoryCard({
  category,
  onUpdate,
  onRemove,
  onAddService,
  onUpdateService,
  onRemoveService,
}: {
  category: Category;
  onUpdate: (id: number, patch: CategoryPatch) => void;
  onRemove: (id: number) => void;
  onAddService: (categoryId: number, svc: ServicePatch) => void;
  onUpdateService: (id: number, patch: ServicePatch) => void;
  onRemoveService: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-sm border border-neutral-200 bg-white p-4">
      {editing ? (
        <CategoryEditor
          category={category}
          onSave={(patch) => {
            onUpdate(category.id, patch);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="mb-3 flex items-start justify-between">
          <div>
            <span className="text-sm font-semibold text-neutral-900">{category.name.el ?? category.key}</span>
            <span className="ml-2 font-mono text-xs text-neutral-600">{category.key}</span>
            {category.required ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">required</span>
                <InfoTip label="About required categories">{HELP.required}</InfoTip>
              </span>
            ) : null}
            {category.description?.el ? (
              <p className="mt-1 max-w-xl text-xs text-neutral-600">{category.description.el}</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="text-xs text-neutral-700 hover:underline">
              Edit
            </button>
            <button onClick={() => onRemove(category.id)} className="text-xs text-red-700 hover:underline">
              Delete
            </button>
          </div>
        </div>
      )}

      <ul className="mb-3 flex flex-col gap-1">
        {category.services.length ? (
          category.services.map((s) => (
            <ServiceRow key={s.id} service={s} onUpdate={onUpdateService} onRemove={onRemoveService} />
          ))
        ) : (
          <li className="text-xs text-neutral-600">No services.</li>
        )}
      </ul>

      <AddServiceForm onAdd={(svc) => onAddService(category.id, svc)} />
    </div>
  );
}

function CategoryEditor({
  category,
  onSave,
  onCancel,
}: {
  category: Category;
  onSave: (patch: CategoryPatch) => void;
  onCancel: () => void;
}) {
  const [nameEl, setNameEl] = useState(category.name.el ?? '');
  const [nameEn, setNameEn] = useState(category.name.en ?? '');
  const [descEl, setDescEl] = useState(category.description?.el ?? '');
  const [descEn, setDescEn] = useState(category.description?.en ?? '');
  const [required, setRequired] = useState(category.required);

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className={input} aria-label="Name" placeholder="Name (EL)" value={nameEl} onChange={(e) => setNameEl(e.target.value)} />
        <input className={input} aria-label="Name" placeholder="Name (EN)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        <input className={input} aria-label="Description" placeholder="Description (EL)" value={descEl} onChange={(e) => setDescEl(e.target.value)} />
        <input className={input} aria-label="Description" placeholder="Description (EN)" value={descEn} onChange={(e) => setDescEn(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <input
            type="checkbox"
            aria-label="Required category"
            className="h-4 w-4"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          /> required
        </label>
        <InfoTip label="About required categories">{HELP.required}</InfoTip>
        <button
          onClick={() =>
            onSave({
              name: { el: nameEl, en: nameEn || nameEl },
              description: localeMap(descEl, descEn),
              required,
            })
          }
          className={primaryBtn}
        >
          Save
        </button>
        <button onClick={onCancel} className={ghostBtn}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  onUpdate,
  onRemove,
}: {
  service: Service;
  onUpdate: (id: number, patch: ServicePatch) => void;
  onRemove: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.name);
  const [provider, setProvider] = useState(service.provider ?? '');
  const [purposeEl, setPurposeEl] = useState(service.purpose?.el ?? '');
  const [purposeEn, setPurposeEn] = useState(service.purpose?.en ?? '');
  const [enabled, setEnabled] = useState(service.enabled);

  if (editing) {
    return (
      <li className="flex flex-col gap-2 rounded-sm bg-neutral-50 p-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input className={input} aria-label="Service name" placeholder="Service name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Provider" description={HELP.provider}>
            <input className={input} placeholder="Provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
          </Field>
          <Field label="Purpose (EL)" description={HELP.purpose}>
            <input className={input} placeholder="Purpose (EL)" value={purposeEl} onChange={(e) => setPurposeEl(e.target.value)} />
          </Field>
          <Field label="Purpose (EN)">
            <input className={input} placeholder="Purpose (EN)" value={purposeEn} onChange={(e) => setPurposeEn(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enabled
          </label>
          <InfoTip label="About enabled">{HELP.enabled}</InfoTip>
          <button
            onClick={() => {
              onUpdate(service.id, {
                name,
                provider: provider || null,
                purpose: localeMap(purposeEl, purposeEn),
                enabled,
              });
              setEditing(false);
            }}
            className={primaryBtn}
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className={ghostBtn}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-sm bg-neutral-50 px-3 py-1.5 text-sm">
      <div className="min-w-0">
        <span className={service.enabled ? '' : 'text-neutral-600 line-through'}>{service.name}</span>
        {service.provider ? <span className="ml-2 text-xs text-neutral-600">· {service.provider}</span> : null}
        {service.purpose?.el ? <p className="text-xs text-neutral-600">{service.purpose.el}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => setEditing(true)} className="text-xs text-neutral-700 hover:underline">
          edit
        </button>
        <button onClick={() => onRemove(service.id)} className="text-xs text-red-700 hover:underline">
          remove
        </button>
      </div>
    </li>
  );
}

function AddServiceForm({ onAdd }: { onAdd: (svc: ServicePatch) => void }) {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [purposeEl, setPurposeEl] = useState('');
  const [purposeEn, setPurposeEn] = useState('');

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <input className={input} aria-label="Service" placeholder="Service (e.g. Google Analytics)" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="Provider" description={HELP.provider}>
        <input className={input} placeholder="Provider (e.g. Google)" value={provider} onChange={(e) => setProvider(e.target.value)} />
      </Field>
      <Field label="Purpose (EL)" description={HELP.purpose}>
        <input className={input} placeholder="Purpose (EL)" value={purposeEl} onChange={(e) => setPurposeEl(e.target.value)} />
      </Field>
      <Field label="Purpose (EN)">
        <input className={input} placeholder="Purpose (EN)" value={purposeEn} onChange={(e) => setPurposeEn(e.target.value)} />
      </Field>
      <div>
        <button
          onClick={() => {
            if (!name.trim()) return;
            onAdd({ name, provider: provider || null, purpose: localeMap(purposeEl, purposeEn) });
            setName('');
            setProvider('');
            setPurposeEl('');
            setPurposeEn('');
          }}
          className={ghostBtn}
        >
          Add service
        </button>
      </div>
    </div>
  );
}
