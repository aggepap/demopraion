'use client';

import { useId, useRef, useState, type ReactNode } from 'react';

import { cn } from './cn';

/**
 * An accessible tab strip for the admin.
 *
 * Tabs were hand-rolled in four places before this — the document form's
 * language switcher, two strips in the settings form, and the shop's
 * `ProductTabs` — and each copy got a different subset of the semantics right.
 * None of them implemented arrow-key navigation, which is the part of the
 * pattern a keyboard user actually relies on: the WAI-ARIA tabs pattern puts
 * exactly ONE tab in the tab order and moves between them with the arrow keys,
 * so reaching the panel does not mean tabbing past every other label.
 *
 * Panels stay mounted and are hidden with the `hidden` attribute rather than
 * being conditionally rendered. Inside a form that matters: switching tabs must
 * not tear down and rebuild the controls in the tab you left.
 */

export interface TabDef {
  id: string;
  label: string;
  /** Small count/dot after the label — e.g. how many fields carry a value. */
  badge?: ReactNode;
  content: ReactNode;
}

/** The DOM ids that tie a tab to its panel (`aria-controls` / `aria-labelledby`). */
export function tabDomIds(prefix: string, id: string): { tab: string; panel: string } {
  return { tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` };
}

/**
 * Which tab a key press moves to, or -1 for a key the strip does not handle.
 * Arrow keys wrap; Home/End jump to the ends — the WAI-ARIA tabs pattern.
 */
export function nextTabIndex(key: string, index: number, count: number): number {
  if (count <= 0) return -1;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

export interface TabListItem {
  id: string;
  /** Anything — the document form puts status dots and screen-reader text here. */
  label: ReactNode;
  badge?: ReactNode;
  /**
   * The id of the panel this tab controls. Defaults to its own `panel` id from
   * `tabDomIds`; a caller with ONE panel for every tab passes that panel's id.
   */
  controls?: string;
}

/**
 * The strip alone, controlled: the caller owns which tab is selected and
 * renders the panel(s) itself, giving each one `role="tabpanel"`, the `panel`
 * id from `tabDomIds(idPrefix, id)` and `aria-labelledby` its `tab` id.
 *
 * For screens where the panels are not independent children — the document
 * form re-renders ONE form for whichever language is selected, and has to run
 * its own logic (URL, messages) on every switch — so `Tabs` below cannot own
 * the state. Both share this, so both get the keyboard pattern.
 */
export function TabList({
  tabs,
  activeId,
  onSelect,
  label,
  idPrefix,
  className,
}: {
  tabs: TabListItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Names the tab strip for assistive technology, e.g. "Language". */
  label: string;
  /** From `useId()` in the caller, shared with its panels. */
  idPrefix: string;
  className?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  /** Arrow/Home/End move the selection AND the focus, per the ARIA pattern. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(e.key, tabs.findIndex((t) => t.id === activeId), tabs.length);
    if (next < 0) return;
    e.preventDefault();
    onSelect(tabs[next].id);
    stripRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabDomIds(idPrefix, tabs[next].id).tab)}`)
      ?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex flex-wrap items-center gap-1', className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const ids = tabDomIds(idPrefix, tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={isActive}
            aria-controls={tab.controls ?? ids.panel}
            // Roving tabindex: only the selected tab is a tab stop.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold',
              isActive
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-600 hover:text-neutral-800',
            )}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({
  tabs,
  label,
  className,
}: {
  tabs: TabDef[];
  /** Names the tab strip for assistive technology, e.g. "SEO sections". */
  label: string;
  className?: string;
}) {
  const uid = useId();
  const [active, setActive] = useState(tabs[0]?.id ?? '');

  if (tabs.length === 0) return null;

  // The selected tab may have been removed (a field disabled in settings, say).
  const activeId = tabs.some((t) => t.id === active) ? active : tabs[0].id;

  return (
    <div className={className}>
      <TabList
        tabs={tabs}
        activeId={activeId}
        onSelect={setActive}
        label={label}
        idPrefix={uid}
        className="border-b border-neutral-200"
      />

      {tabs.map((tab) => {
        const ids = tabDomIds(uid, tab.id);
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={ids.panel}
            aria-labelledby={ids.tab}
            hidden={tab.id !== activeId}
            className="flex flex-col gap-4 pt-4"
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
