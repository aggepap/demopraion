'use client';

import { useState } from 'react';

import { moduleLabel } from '../../core/settings/schema';
import { serializeShortcode, type AttrSpec, type ShortcodeDef } from '../../core/shortcodes';
import { useModuleFlags } from '../module-flags';
import { Button, Checkbox, Field, Select, TextInput } from '../ui';

/**
 * "Insert a block" for the rich-text editor.
 *
 * The list and the form both come from the shortcode registry, so an editor is
 * never asked to remember a name or guess an attribute, and the dialog cannot
 * offer something the server would then refuse. A shortcode whose module is off
 * is shown greyed with the reason, rather than hidden — "why can I not add
 * reviews?" is a question the screen should answer.
 *
 * The flags come from the admin shell (`ModuleFlagsProvider`) unless a caller
 * passes its own, and the reason names the module the way Settings → Modules
 * does — "Google reviews & testimonials", not the internal key.
 */
export function InsertShortcodeDialog({
  shortcodes,
  moduleFlags,
  onInsert,
  onClose,
}: {
  shortcodes: readonly ShortcodeDef[];
  moduleFlags?: Readonly<Record<string, boolean>>;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const shellFlags = useModuleFlags();
  const flags = moduleFlags ?? shellFlags;
  const [chosen, setChosen] = useState<ShortcodeDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const available = (def: ShortcodeDef) => !def.module || flags[def.module] === true;

  if (!chosen) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-neutral-900">Insert a block</h2>
        <ul className="flex flex-col gap-2">
          {shortcodes.map((def) => {
            const usable = available(def);
            return (
              <li key={def.name}>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => {
                    setChosen(def);
                    setValues(defaultValues(def));
                  }}
                  className={`w-full rounded-md border p-3 text-left ${
                    usable
                      ? 'border-neutral-200 hover:border-neutral-400'
                      : 'cursor-not-allowed border-neutral-100 opacity-60'
                  }`}
                >
                  <span className="block text-sm font-medium text-neutral-900">{def.label}</span>
                  {def.description ? (
                    <span className="block text-xs text-neutral-600">{def.description}</span>
                  ) : null}
                  {!usable ? (
                    <span className="mt-1 block text-xs text-amber-700">
                      Switch on the “{moduleLabel(def.module ?? '')}” module in Settings → Modules to use this.
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    );
  }

  const text = serializeShortcode(chosen.name, values);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-neutral-900">{chosen.label}</h2>
      {Object.entries(chosen.attrs).map(([key, spec]) => (
        <AttrField
          key={key}
          name={key}
          spec={spec}
          help={shortcodeAttrHelp(chosen.name, key)}
          value={values[key] ?? ''}
          onChange={(next) => setValues({ ...values, [key]: next })}
        />
      ))}
      {/* The exact text that goes into the page, so nothing is a surprise. */}
      <p className="rounded-sm bg-neutral-100 px-3 py-2 font-mono text-xs break-all text-neutral-700">
        {text}
      </p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => onInsert(text)}>
          Insert
        </Button>
        <Button type="button" variant="secondary" onClick={() => setChosen(null)}>
          Back
        </Button>
      </div>
    </div>
  );
}

/**
 * What each attribute does, behind the "i" beside it.
 *
 * Kept here rather than in the core registry because it describes what THIS
 * admin's editor sees; the names alone ("min", "location", "expired") meant
 * nothing to an owner. `form` and `popup` have no entry: the base site renders
 * nothing for them yet, so there is no behaviour to describe truthfully.
 */
const ATTR_HELP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'google-reviews': {
    layout: 'Carousel scrolls sideways, grid shows the reviews in rows, badge shows only the average stars and the number of reviews.',
    location: 'Leave as “all” to show reviews from every location. A location name that does not exist shows nothing.',
    limit: 'The most reviews to show (1–50).',
    min: 'Only show reviews with at least this many stars (1–5).',
  },
  testimonials: {
    layout: 'Carousel scrolls sideways; grid shows the quotes in rows.',
    limit: 'The most testimonials to show (1–50).',
  },
  brands: {
    layout: 'Row centres the logos in a line that wraps; grid lines them up in columns.',
    limit: 'The most logos to show (1–50).',
  },
  countdown: {
    to: 'The moment it counts down to, as 2026-12-24 or 2026-12-24T18:00.',
    label: 'Optional text above the clock.',
    expired: 'Optional text shown once the time has passed. Left empty, the countdown simply disappears.',
  },
  script: {
    name: 'The short name of a snippet saved on the Scripts screen. Whether it waits for cookie consent is set there.',
  },
};

export function shortcodeAttrHelp(shortcode: string, attr: string): string | undefined {
  return ATTR_HELP[shortcode]?.[attr];
}

function defaultValues(def: ShortcodeDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, spec] of Object.entries(def.attrs)) {
    out[key] =
      spec.kind === 'boolean'
        ? String(spec.default ?? false)
        : spec.default !== undefined
          ? String(spec.default)
          : '';
  }
  return out;
}

function AttrField({
  name,
  spec,
  help,
  value,
  onChange,
}: {
  name: string;
  spec: AttrSpec;
  help?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = name.charAt(0).toUpperCase() + name.slice(1).replace(/([A-Z])/g, ' $1');
  if (spec.kind === 'select') {
    return (
      <Field label={label} description={help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (spec.kind === 'boolean') {
    return (
      <Checkbox
        label={label}
        info={help}
        checked={value === 'true'}
        onChange={(e) => onChange(String(e.target.checked))}
      />
    );
  }
  return (
    <Field label={label} description={help}>
      <TextInput
        type={spec.kind === 'int' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
