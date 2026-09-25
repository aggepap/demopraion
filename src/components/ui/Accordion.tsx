'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { padQuestionPunctuation } from '@/lib/text-utils';
import { cn } from '@/lib/utils';

export interface AccordionItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
}

interface AccordionProps {
  items: ReadonlyArray<AccordionItem>;
  /** Allow multiple panels open simultaneously. Default true (suits FAQs). */
  allowMultiple?: boolean;
  /** Forwarded to each panel's wrapping <div>. Useful for nested compact styling. */
  className?: string;
  /** Tone — light is default; dark inverts colors for use over midnight-navy backgrounds. */
  tone?: 'light' | 'dark';
}

/**
 * Custom accordion using the modern `grid-rows-[0fr|1fr]` height trick — no
 * JavaScript measurement, smooth open/close, content-aware height. ARIA wired
 * for screen readers (aria-expanded on trigger, role=region on panel).
 *
 * Used by FAQSection and MobileMenu submenus.
 */
export function Accordion({ items, allowMultiple = true, className, tone = 'light' }: AccordionProps) {
  const baseId = useId();
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(allowMultiple ? prev : []);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDark = tone === 'dark';

  return (
    <div
      className={cn(
        'divide-y',
        isDark ? 'divide-soft-pearl/15' : 'divide-border-soft',
        className
      )}
    >
      {items.map((item) => {
        const isOpen = openIds.has(item.id);
        const triggerId = `${baseId}-trigger-${item.id}`;
        const panelId = `${baseId}-panel-${item.id}`;

        return (
          <div key={item.id}>
            <button
              id={triggerId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(item.id)}
              className={cn(
                'group flex w-full items-center justify-between gap-6 py-6 text-left',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-2',
                isDark
                  ? 'focus-visible:ring-offset-midnight-navy'
                  : 'focus-visible:ring-offset-soft-pearl'
              )}
            >
              <span
                className={cn(
                  'font-display text-lg md:text-xl font-medium',
                  isDark ? 'text-soft-pearl' : 'text-text-primary'
                )}
              >
                {/* Thin-space pad before `;` / `?` so italic Fraunces
                    doesn't visually cram question marks against the
                    preceding letter. No effect on labels without those
                    punctuation chars (e.g. mobile nav submenus). */}
                {padQuestionPunctuation(item.question)}
              </span>
              <ChevronDown
                className={cn(
                  'h-5 w-5 flex-shrink-0 transition-transform duration-200',
                  isOpen && 'rotate-180',
                  isDark ? 'text-warm-gold' : 'text-warm-gold-deep'
                )}
                aria-hidden
              />
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out',
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              )}
            >
              <div className="overflow-hidden">
                <div
                  className={cn(
                    'pb-6 font-body text-base leading-relaxed',
                    isDark ? 'text-soft-pearl/80' : 'text-text-muted'
                  )}
                >
                  {item.answer}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
