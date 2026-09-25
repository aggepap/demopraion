'use client';

import { useState, type ReactNode } from 'react';

/**
 * Product-page tab strip (Description / Specifications / any admin-defined
 * field group set to render as its own tab).
 *
 * Only the tab *selection* is interactive, so the panels are passed in as
 * already-rendered server content — the rich-text description and the resolved
 * custom-field tables never ship their renderers to the browser. Every panel
 * stays in the DOM (hidden) so the content is still crawlable and findable
 * with in-page search.
 */

export interface ProductTab {
  id: string;
  label: string;
  content: ReactNode;
}

export function ProductTabs({ tabs }: { tabs: ProductTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  if (tabs.length === 0) return null;

  // A single tab needs no chrome — just show it.
  if (tabs.length === 1) return <div>{tabs[0].content}</div>;

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border-soft">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`product-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`product-panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={`-mb-px border-b-2 px-4 py-2.5 font-body text-sm font-medium transition-colors ${
                isActive
                  ? 'border-warm-gold-deep text-warm-gold-deep'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`product-panel-${tab.id}`}
          aria-labelledby={`product-tab-${tab.id}`}
          hidden={tab.id !== active}
          className="pt-6"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
